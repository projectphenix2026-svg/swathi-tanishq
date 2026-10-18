import { savedMetaProvider } from '../lib/whatsapp-connection.js';
import express from 'express';
import { query, indiaStartOf, ago } from '../db/index.js';
import { config } from '../config.js';
import { getProvider, getSmsProvider } from '../providers/index.js';
import { clientSettings } from '../lib/campaigns.js';
import { calendar, indiaNow } from '../lib/occasions.js';
import { requireRole } from './auth.js';

const router = express.Router();

router.get('/', async (req, res) => {
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
  res.json({ customers, month: { ...month, spend: Math.round(month.spend * 100) / 100 }, inbox, recent, templates: t.n, lastExportAt: cl?.last_export_at || null, ...extra, ...charts });
});

// Settings the screens need: which provider, cost per message, sandbox hints, limits.
router.get('/settings', async (req, res) => {
  const p = getProvider();
  const sms = getSmsProvider();
  const limits = await clientSettings(req.clientId);
  const { rows: [cl] } = await query('SELECT last_export_at, sales_codes FROM clients WHERE id = $1', [req.clientId]);
  res.json({
    businessName: config.businessName,
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
router.put('/settings', requireRole('admin'), async (req, res) => {
  const cap = Number(req.body?.weeklyCap);
  const threshold = Number(req.body?.approvalThreshold);
  if (!Number.isInteger(cap) || cap < 0 || cap > 14) return res.status(400).json({ error: 'Weekly limit: a whole number from 0 (no limit) to 14.' });
  if (!Number.isInteger(threshold) || threshold < 1) return res.status(400).json({ error: 'Approval size: a whole number of customers, 1 or more.' });
  await query('UPDATE clients SET weekly_cap = $2, approval_threshold = $3 WHERE id = $1', [req.clientId, cap, threshold]);
  res.json({ weeklyCap: cap, approvalThreshold: threshold });
});

// The owner switches sales codes on or off.
router.put('/settings/sales-codes', requireRole('admin'), async (req, res) => {
  const on = Boolean(req.body?.on);
  await query('UPDATE clients SET sales_codes = $2 WHERE id = $1', [req.clientId, on ? 1 : 0]);
  res.json({ salesCodes: on });
});

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
