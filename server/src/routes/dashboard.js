import { savedMetaProvider } from '../lib/whatsapp-connection.js';
import { sendingPaused } from '../lib/number-status.js';
import express from 'express';
import { query, indiaStartOf, ago } from '../db/index.js';
import { config } from '../config.js';
import { getProvider, getSmsProvider } from '../providers/index.js';
import { clientSettings } from '../lib/campaigns.js';
import { calendar, indiaNow, ensureDefaultWishes } from '../lib/occasions.js';
import { getShop, forgetShop } from '../lib/shop.js';
import { normalizePhone } from '../lib/phone.js';
import { requireLevel } from './auth.js';

const router = express.Router();

router.get('/', async (req, res) => {
  await ensureDefaultWishes(req.clientId);
  const insights = await homeInsights(req.clientId, ['month', 'last', '90d'].includes(req.query.period) ? req.query.period : 'month');
  const { rows: [customers] } = await query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE whatsapp_opt_in = 1 AND opted_out_at IS NULL) AS reachable
       FROM contacts WHERE client_id = $1 AND phone NOT LIKE 'deleted:%'`,
    [req.clientId],
  );
  // This calendar month in India time.
  const { rows: [month] } = await query(
    `SELECT count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')) AS sent,
            count(*) FILTER (WHERE status IN ('delivered', 'read')) AS delivered,
            count(*) FILTER (WHERE status = 'read') AS read,
            count(*) FILTER (WHERE status = 'failed') AS failed,
            COALESCE(sum(cost), 0) AS spend
       FROM messages
      WHERE client_id = $1 AND direction = 'outbound'
        AND created_at >= $2`,
    [req.clientId, indiaStartOf('month')],
  );
  const { rows: [inbox] } = await query(
    `SELECT count(*) AS unread FROM messages WHERE client_id = $1 AND direction = 'inbound' AND seen_at IS NULL`,
    [req.clientId],
  );
  const { rows: recent } = await query(
    `SELECT c.id, c.name, c.status, c.created_at, c.scheduled_at,
            count(m.id) AS total,
            count(m.id) FILTER (WHERE m.status IN ('delivered', 'read')) AS delivered,
            count(m.id) FILTER (WHERE m.status = 'read') AS read
       FROM campaigns c LEFT JOIN messages m ON m.campaign_id = c.id
      WHERE c.client_id = $1 AND c.name NOT LIKE 'Order ready ·%' AND c.name NOT LIKE 'Repair ready ·%' GROUP BY c.id ORDER BY c.created_at DESC LIMIT 5`,
    [req.clientId],
  );
  const { rows: [t] } = await query('SELECT count(*) AS n FROM templates WHERE client_id = $1', [req.clientId]);
  const { rows: [extra] } = await query(
    `SELECT (SELECT count(*) FROM leads WHERE client_id = $1 AND status = 'new') AS new_leads,
            (SELECT count(*) FROM leads WHERE client_id = $1 AND status = 'new' AND created_at < ${ago('24 hours')}) AS overdue_leads,
            (SELECT count(*) FROM campaigns WHERE client_id = $1 AND status = 'pending_approval') AS pending_approval,
            (SELECT count(*) FROM occasions WHERE client_id = $1 AND enabled = 1) AS occasions_on,
            (SELECT count(*) FROM messages WHERE client_id = $1 AND occasion_id IS NOT NULL
               AND created_at >= $3) AS greetings_today,
            (SELECT COALESCE(sum(amount), 0) FROM redemptions WHERE client_id = $1
               AND redeemed_at >= $2) AS revenue,
            (SELECT count(*) FROM redemptions WHERE client_id = $1
               AND redeemed_at >= $2) AS redeemed`,
    [req.clientId, indiaStartOf('month'), indiaStartOf('day')],
  );
  const { rows: [cl] } = await query('SELECT last_export_at, sales_codes FROM clients WHERE id = $1', [req.clientId]);
  const charts = await homeCharts(req.clientId, Boolean(cl?.sales_codes));
  res.json({ customers, month: { ...month, spend: Math.round(month.spend * 100) / 100 }, inbox, recent, templates: t.n, lastExportAt: cl?.last_export_at || null, ...extra, ...charts, insights });
});

/**
 * Home's business numbers for a period (this month, last month or the last 90 days), all from what
 * Sandesh records: offers and wishes sent and Meta's ticks, replies and Interested taps within 7
 * days, sales codes used at the counter, consent and dates saved on customers, and the number's
 * Meta status. Tests to a staff phone are left out.
 */
async function homeInsights(clientId, period) {
  const now = new Date();
  const monthStart = indiaStartOf('month');
  const range = period === 'last'
    ? [indiaStartOf('month', new Date(Date.parse(monthStart) - 86400000)), monthStart]
    : period === '90d' ? [new Date(now.getTime() - 90 * 86400000).toISOString(), now.toISOString()]
      : [monthStart, now.toISOString()];
  const P = [clientId, ...range];
  const OFFERS = `(campaign_id IS NOT NULL OR occasion_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM campaigns tc WHERE tc.id = messages.campaign_id AND tc.name LIKE 'Test · %')`;
  const { rows: [f] } = await query(
    `SELECT count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')) AS sent,
            count(*) FILTER (WHERE status IN ('delivered', 'read')) AS delivered,
            count(*) FILTER (WHERE status = 'read') AS read,
            COALESCE(sum(cost), 0) AS spend
       FROM messages WHERE client_id = $1 AND direction = 'outbound' AND ${OFFERS} AND created_at >= $2 AND created_at < $3`,
    P,
  );
  // Wrote back or tapped a button within 7 days of getting an offer or wish.
  const { rows: [e] } = await query(
    `SELECT count(DISTINCT i.contact_id) AS n FROM messages i
      WHERE i.client_id = $1 AND i.direction = 'inbound' AND i.created_at >= $2 AND i.created_at < $3
        AND EXISTS (SELECT 1 FROM messages o WHERE o.contact_id = i.contact_id AND o.direction = 'outbound'
                      AND (o.campaign_id IS NOT NULL OR o.occasion_id IS NOT NULL) AND o.sent_at <= i.created_at
                      AND o.sent_at > strftime('%Y-%m-%dT%H:%M:%fZ', i.created_at, '-7 days'))`,
    P,
  );
  const { rows: [s] } = await query(
    `SELECT count(*) AS bought, COALESCE(sum(amount), 0) AS revenue FROM redemptions WHERE client_id = $1 AND redeemed_at >= $2 AND redeemed_at < $3`,
    P,
  );
  const { rows: [l] } = await query(
    `SELECT count(*) FILTER (WHERE created_at >= $2 AND created_at < $3) AS interested,
            count(*) FILTER (WHERE status = 'new') AS not_called
       FROM leads WHERE client_id = $1`,
    P,
  );
  // Best offers and wishes: most sales, then most read.
  const { rows: offers } = await query(
    `SELECT 'c' || c.id AS id, c.name,
            count(m.id) FILTER (WHERE m.status IN ('sent', 'delivered', 'read')) AS sent,
            count(m.id) FILTER (WHERE m.status = 'read') AS read,
            count(DISTINCT r.id) AS sales, COALESCE(sum(r.amount), 0) AS revenue
       FROM campaigns c JOIN messages m ON m.campaign_id = c.id LEFT JOIN redemptions r ON r.message_id = m.id
      WHERE c.client_id = $1 AND c.name NOT LIKE 'Test · %' AND m.created_at >= $2 AND m.created_at < $3
      GROUP BY c.id
     UNION ALL
     SELECT 'o' || o.id AS id, o.name,
            count(m.id) FILTER (WHERE m.status IN ('sent', 'delivered', 'read')) AS sent,
            count(m.id) FILTER (WHERE m.status = 'read') AS read,
            count(DISTINCT r.id) AS sales, COALESCE(sum(r.amount), 0) AS revenue
       FROM occasions o JOIN messages m ON m.occasion_id = o.id LEFT JOIN redemptions r ON r.message_id = m.id
      WHERE o.client_id = $1 AND m.created_at >= $2 AND m.created_at < $3
      GROUP BY o.id`,
    P,
  );
  const best = offers.filter((x) => x.sent > 0)
    .sort((a, b) => b.sales - a.sales || b.read / b.sent - a.read / a.sent)
    .slice(0, 3)
    .map((x) => ({ ...x, readPct: Math.round((100 * x.read) / x.sent) }));
  // Best time to send (last 90 days, India time): the 2-hour slot, weekday or weekend, where the
  // most messages were read within a day. Needs enough messages to mean anything.
  const { rows: slots } = await query(
    `SELECT CAST(strftime('%H', sent_at, '+330 minutes') AS INTEGER) AS h,
            CAST(strftime('%w', sent_at, '+330 minutes') AS INTEGER) AS wd,
            count(*) AS n,
            count(*) FILTER (WHERE read_at IS NOT NULL AND julianday(read_at) - julianday(sent_at) < 1) AS quick
       FROM messages WHERE client_id = $1 AND direction = 'outbound' AND sent_at IS NOT NULL
        AND status IN ('sent', 'delivered', 'read') AND sent_at > $2
      GROUP BY h, wd`,
    [clientId, new Date(now.getTime() - 90 * 86400000).toISOString()],
  );
  const buckets = {};
  for (const r of slots) {
    const key = `${r.h - (r.h % 2)}|${r.wd === 0 || r.wd === 6 ? 'weekends' : 'weekdays'}`;
    buckets[key] = buckets[key] || { n: 0, quick: 0 };
    buckets[key].n += Number(r.n);
    buckets[key].quick += Number(r.quick);
  }
  const total = Object.values(buckets).reduce((a, b) => a + b.n, 0);
  const top = Object.entries(buckets).filter(([, b]) => b.n >= 20).sort(([, a], [, b]) => b.quick / b.n - a.quick / a.n)[0];
  const hour = (h) => `${((h + 11) % 12) + 1} ${h < 12 || h === 24 ? 'am' : 'pm'}`;
  const bestTime = total >= 50 && top ? (() => {
    const [h, days] = top[0].split('|');
    return { label: `${hour(Number(h))}–${hour(Number(h) + 2)} on ${days}`, readPct: Math.round((100 * top[1].quick) / top[1].n), basedOn: total };
  })() : null;
  const { rows: [h] } = await query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE whatsapp_opt_in = 1 AND opted_out_at IS NULL) AS reachable,
            count(*) FILTER (WHERE birthday IS NOT NULL) AS with_birthday,
            count(*) FILTER (WHERE opted_out_at IS NOT NULL) AS stopped,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM messages mm WHERE mm.contact_id = c.id AND mm.direction = 'outbound' AND mm.status IN ('sent', 'delivered', 'read') AND mm.created_at > ${ago('90 days')})
                               AND NOT EXISTS (SELECT 1 FROM messages mr WHERE mr.contact_id = c.id AND mr.direction = 'outbound' AND mr.status = 'read' AND mr.created_at > ${ago('90 days')})
                               AND opted_out_at IS NULL) AS sleeping
       FROM contacts c WHERE client_id = $1 AND phone NOT LIKE 'deleted:%'`,
    [clientId],
  );
  const { rows: [acct] } = await query(
    `SELECT (SELECT quality FROM whatsapp_connection WHERE client_id = $1) AS quality,
            (SELECT daily_limit FROM whatsapp_connection WHERE client_id = $1) AS daily_limit,
            (SELECT live FROM whatsapp_connection WHERE client_id = $1) AS live,
            (SELECT count(*) FROM templates WHERE client_id = $1 AND archived_at IS NULL AND upper(COALESCE(provider_status, '')) = 'APPROVED') AS approved,
            (SELECT count(*) FROM templates WHERE client_id = $1 AND archived_at IS NULL) AS templates`,
    [clientId],
  );
  const spend = Math.round(Number(f.spend) * 100) / 100;
  return {
    period,
    funnel: { sent: f.sent, delivered: f.delivered, read: f.read, engaged: e.n, bought: s.bought },
    sales: { revenue: Number(s.revenue), bought: s.bought, spend, perRupee: spend > 0 ? Math.round(Number(s.revenue) / spend) : null },
    interested: { count: l.interested, notCalled: l.not_called },
    best,
    bestTime,
    health: h,
    account: { ...acct, dailyLimit: acct.daily_limit ?? (acct.live ? config.dailyLimit : null) },
  };
}

// Whether WhatsApp sending is paused because the number is disconnected (every screen checks this).
router.get('/sending', async (req, res) => {
  res.json({ paused: await sendingPaused() });
});

// Settings the screens need: which provider, cost per message, sandbox hints, limits.
router.get('/settings', async (req, res) => {
  const p = getProvider();
  const sms = getSmsProvider();
  const limits = await clientSettings(req.clientId);
  const { rows: [cl] } = await query('SELECT last_export_at, sales_codes FROM clients WHERE id = $1', [req.clientId]);
  const shop = await getShop(req.clientId);
  res.json({
    businessName: shop.name,
    shop,
    provider: { name: p.name, label: p.label, stub: Boolean(p.stub), missing: p.missingConfig() },
    sms: { name: sms.name, label: sms.label, live: sms.live, missing: sms.missingConfig(), costPerSms: config.sms.costPerSms },
    metaTemplatesReady: Boolean((config.meta.wabaId && config.meta.accessToken) || savedMetaProvider()),
    whatsappConnected: Boolean(savedMetaProvider()),
    costPerMessage: config.costPerMessage,
    webhooksReachable: Boolean(config.publicBaseUrl),
    weeklyCap: limits.weekly_cap,
    approvalThreshold: limits.approval_threshold,
    role: req.user.role,
    lastExportAt: cl?.last_export_at || null,
    // Sales codes (a code in each message, typed at the counter) are optional and off at first.
    salesCodes: Boolean(cl?.sales_codes),
    sandbox:
      p.name === 'twilio'
        ? { number: process.env.TWILIO_SANDBOX_DISPLAY_NUMBER || config.twilio.whatsappFrom, joinCode: process.env.TWILIO_SANDBOX_JOIN_CODE || '' }
        : null,
  });
});

// Admins set the weekly limit and when big sends need approval.
router.put('/settings', requireLevel('owner'), async (req, res) => {
  const cap = Number(req.body?.weeklyCap);
  const threshold = Number(req.body?.approvalThreshold);
  if (!Number.isInteger(cap) || cap < 0 || cap > 14) return res.status(400).json({ error: 'Weekly limit: a whole number from 0 (no limit) to 14.' });
  if (!Number.isInteger(threshold) || threshold < 1) return res.status(400).json({ error: 'Approval size: a whole number of customers, 1 or more.' });
  await query('UPDATE clients SET weekly_cap = $2, approval_threshold = $3 WHERE id = $1', [req.clientId, cap, threshold]);
  res.json({ weeklyCap: cap, approvalThreshold: threshold });
});

// The owner edits the shop's name, address, phone and Google review link.
router.put('/shop', requireLevel('owner'), async (req, res) => {
  const b = req.body || {};
  const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const name = clean(b.name, 80);
  const errors = {};
  if (!name) errors.name = 'Enter the shop name.';
  let phone = clean(b.phone, 30);
  if (phone) {
    const p = normalizePhone(phone);
    if (!p.ok) errors.phone = p.reason;
    else phone = p.display;
  }
  const link = clean(b.googleReviewLink, 300);
  if (link && !/^https:\/\/\S+\.\S+/.test(link)) errors.googleReviewLink = 'The link must start with https://';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  await query(
    'UPDATE clients SET name = $2, address = $3, shop_phone = $4, google_review_link = $5 WHERE id = $1',
    [req.clientId, name, clean(b.address, 200) || null, phone || null, link || null],
  );
  forgetShop(req.clientId);
  res.json({ shop: await getShop(req.clientId) });
});

// The owner switches sales codes on or off.
router.put('/settings/sales-codes', requireLevel('owner'), async (req, res) => {
  const on = Boolean(req.body?.on);
  await query('UPDATE clients SET sales_codes = $2 WHERE id = $1', [req.clientId, on ? 1 : 0]);
  res.json({ salesCodes: on });
});

/**
 * Spending: what messages cost between two India dates (inclusive), day by day, by kind of
 * message and by send. Costs are the app's estimate (Meta's published price per message, as
 * recorded when each message went out); GST is added on top for the "with GST" figures.
 */
router.get('/spending', async (req, res) => {
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const today = indiaNow().date;
  const to = isDay(req.query.to) ? req.query.to : today;
  const from = isDay(req.query.from) ? req.query.from : `${to.slice(0, 8)}01`;
  if (from > to) return res.status(400).json({ error: 'The start date is after the end date.' });
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > 400) return res.status(400).json({ error: 'Pick a range of up to about a year.' });
  // India date of each message: UTC time + 5:30.
  const day = "date(COALESCE(m.sent_at, m.created_at), '+330 minutes')";
  const base = `FROM messages m WHERE m.client_id = $1 AND m.direction = 'outbound' AND m.status IN ('sent', 'delivered', 'read')
                AND ${day} BETWEEN $2 AND $3`;
  const kind = `CASE WHEN m.channel = 'sms' THEN 'sms' WHEN m.occasion_id IS NOT NULL THEN 'wishes'
                     WHEN m.campaign_id IS NOT NULL THEN 'messages' ELSE 'replies' END`;
  const params = [req.clientId, from, to];
  const { rows: byDay } = await query(`SELECT ${day} AS day, count(*) AS sent, COALESCE(sum(m.cost), 0) AS cost ${base} GROUP BY 1 ORDER BY 1`, params);
  const { rows: byKind } = await query(`SELECT ${kind} AS kind, count(*) AS sent, COALESCE(sum(m.cost), 0) AS cost ${base} GROUP BY 1`, params);
  const { rows: bySend } = await query(
    `SELECT COALESCE(c.id, -o.id) AS id, COALESCE(c.name, o.name) AS name, CASE WHEN c.id IS NULL THEN 'wishes' ELSE 'messages' END AS kind,
            min(${day}) AS first_day, count(*) AS sent, COALESCE(sum(m.cost), 0) AS cost
       FROM messages m LEFT JOIN campaigns c ON c.id = m.campaign_id LEFT JOIN occasions o ON o.id = m.occasion_id
      WHERE m.client_id = $1 AND m.direction = 'outbound' AND m.status IN ('sent', 'delivered', 'read')
        AND ${day} BETWEEN $2 AND $3 AND (m.campaign_id IS NOT NULL OR m.occasion_id IS NOT NULL)
      GROUP BY 1, 2, 3 ORDER BY cost DESC, sent DESC LIMIT 20`,
    params,
  );
  // Every day in the range, with zeros for days without messages, so the chart has no gaps.
  const map = new Map(byDay.map((d) => [d.day, d]));
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
    const r = map.get(d) || { sent: 0, cost: 0 };
    return { day: d, sent: r.sent, cost: round2(r.cost) };
  });
  const total = series.reduce((t, d) => ({ sent: t.sent + d.sent, cost: t.cost + d.cost }), { sent: 0, cost: 0 });
  res.json({
    from, to, days,
    gst: 0.18,
    pricePerMessage: config.costPerMessage,
    total: { sent: total.sent, cost: round2(total.cost), withGst: round2(total.cost * 1.18), perDay: round2(total.cost / days) },
    byKind: Object.fromEntries(byKind.map((k) => [k.kind, { sent: k.sent, cost: round2(k.cost) }])),
    series,
    bySend: bySend.map((s) => ({ ...s, cost: round2(s.cost) })),
  });
});

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Home's numbers and charts: new customers, last month's read rate, replies and Interested,
 * messages per week (8 weeks), what happened to the last message, customers by city, the next
 * 7 days' special days, and the getting-started steps.
 */
async function homeCharts(clientId, salesCodes) {
  const monthStart = indiaStartOf('month');
  const { rows: [nums] } = await query(
    `SELECT (SELECT count(*) FROM contacts WHERE client_id = $1 AND phone NOT LIKE 'deleted:%' AND created_at >= $2) AS new_customers,
            (SELECT count(*) FROM messages WHERE client_id = $1 AND direction = 'inbound' AND created_at >= $2) AS replies,
            (SELECT count(*) FROM leads WHERE client_id = $1 AND created_at >= $2) AS interested,
            (SELECT count(*) FROM messages WHERE client_id = $1 AND direction = 'outbound' AND status IN ('sent', 'delivered', 'read')
               AND created_at >= $3 AND created_at < $2) AS last_sent,
            (SELECT count(*) FROM messages WHERE client_id = $1 AND direction = 'outbound' AND status = 'read'
               AND created_at >= $3 AND created_at < $2) AS last_read,
            (SELECT count(*) FROM campaigns WHERE client_id = $1) AS campaigns,
            (SELECT count(*) FROM occasions WHERE client_id = $1 AND kind = 'birthday' AND enabled = 1) AS birthday_on`,
    [clientId, monthStart, indiaStartOf('month', new Date(Date.parse(monthStart) - 86400000))],
  );
  // Messages per week, oldest first: week 0 is the last 7 days.
  const { rows: weekRows } = await query(
    `SELECT CAST((julianday('now') - julianday(created_at)) / 7 AS INTEGER) AS w,
            count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')) AS sent,
            count(*) FILTER (WHERE status = 'read') AS read
       FROM messages WHERE client_id = $1 AND direction = 'outbound' AND channel = 'whatsapp' AND created_at >= ${ago('56 days')}
      GROUP BY w`,
    [clientId],
  );
  const today = indiaNow().date;
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const w = 7 - i;
    const r = weekRows.find((x) => x.w === w) || { sent: 0, read: 0 };
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() - w * 7);
    return { ending: end.toISOString().slice(0, 10), sent: r.sent, read: r.read };
  });
  // The last message that went out, step by step.
  const { rows: [last] } = await query(
    `SELECT c.id, c.name,
            count(m.id) FILTER (WHERE m.status IN ('sent', 'delivered', 'read')) AS sent,
            count(m.id) FILTER (WHERE m.status IN ('delivered', 'read')) AS delivered,
            count(m.id) FILTER (WHERE m.status = 'read') AS read,
            (SELECT count(DISTINCT i.contact_id) FROM messages i JOIN messages o ON o.contact_id = i.contact_id AND o.campaign_id = c.id
              WHERE i.direction = 'inbound' AND i.created_at > o.sent_at) AS replied,
            (SELECT count(*) FROM leads l WHERE l.campaign_id = c.id) AS interested,
            (SELECT count(*) FROM redemptions r JOIN messages rm ON rm.id = r.message_id WHERE rm.campaign_id = c.id) AS bought
       FROM campaigns c JOIN messages m ON m.campaign_id = c.id
      WHERE c.client_id = $1 AND c.name NOT LIKE 'Test · %' AND c.name NOT LIKE 'Order ready ·%' AND c.name NOT LIKE 'Repair ready ·%'
        AND c.status IN ('sending', 'completed')
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 1`,
    [clientId],
  );
  const { rows: cities } = await query(
    `SELECT min(city) AS city, count(*) AS n FROM contacts
      WHERE client_id = $1 AND phone NOT LIKE 'deleted:%' AND city IS NOT NULL AND trim(city) <> ''
      GROUP BY lower(trim(city)) ORDER BY n DESC LIMIT 6`,
    [clientId],
  );
  const cal = await calendar(clientId, today, 7);
  const upcoming = Object.entries(cal)
    .map(([date, d]) => ({ date, birthday: d.birthday.map((x) => x.name), anniversary: d.anniversary.map((x) => x.name), personal: d.personal.map((x) => x.name), events: d.events.map((x) => x.name) }))
    .filter((d) => d.birthday.length + d.anniversary.length + d.personal.length + d.events.length);
  return {
    ...nums,
    weeks,
    lastMessage: last ? { ...last, bought: salesCodes ? last.bought : null } : null,
    cities,
    upcoming,
  };
}

export default router;
