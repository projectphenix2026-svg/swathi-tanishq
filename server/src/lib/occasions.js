// Occasion automations: birthday, anniversary and festival greetings, sent with no one
// touching the app. Each greeting has its own key (occasion + customer + date + days before),
// so however often the check runs, a customer gets each greeting once.
import { query } from '../db/index.js';
import { audienceWhere, ELIGIBLE, queueMessages } from './campaigns.js';
import { kick } from './dispatch.js';

const TZ = 'Asia/Kolkata';

/** Today's date and hour in India, e.g. { date: '2026-10-18', hour: 10 }. */
export function indiaNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Month-day keys that count as `target`: 29 Feb birthdays are greeted on 28 Feb in other years. */
function dayKeys(target) {
  const md = target.slice(5);
  return md === '02-28' && !isLeap(Number(target.slice(0, 4))) ? ['02-28', '02-29'] : [md];
}

const column = (kind) => (kind === 'birthday' ? 'birthday' : 'anniversary');
const festivalDay = (o) => (o.festival_date ? String(o.festival_date).slice(0, 10) : null);

/** Queues today's greetings for one occasion. Safe to run any number of times a day. */
export async function runOccasion(occasion, { now = new Date(), force = false } = {}) {
  const { date: today, hour } = indiaNow(now);
  if (!occasion.enabled) return { queued: 0, reason: 'switched off' };
  if (!force && hour < occasion.send_hour) return { queued: 0, reason: 'before send time' };
  const { rows: [template] } = await query('SELECT * FROM templates WHERE id = $1', [occasion.template_id]);
  if (!template || template.status !== 'approved') return { queued: 0, reason: 'template not ready' };

  let queued = 0;
  for (const before of occasion.days_before || [0]) {
    const target = addDays(today, before);
    let extraWhere = [];
    let extraParams = [];
    let suffixDate = target;
    if (occasion.kind === 'festival') {
      if (festivalDay(occasion) !== target) continue;
    } else if (occasion.kind === 'thank_you') {
      // "After a purchase": customers who used a bill code `before` days ago (India date).
      suffixDate = addDays(today, -before);
      extraWhere = [`EXISTS (SELECT 1 FROM redemptions r WHERE r.contact_id = c.id AND date(r.redeemed_at, '+330 minutes') = $X1)`];
      extraParams = [suffixDate];
    } else {
      extraWhere = [`substr(c.${column(occasion.kind)}, 6, 5) IN (SELECT value FROM json_each($X1))`];
      extraParams = [dayKeys(target)];
    }
    queued += await queueMessages(occasion.client_id, {
      audience: occasion.audience,
      template,
      variables: { ...occasion.variables, days_left: String(before) },
      keyPrefix: `occasion:${occasion.id}:contact:`,
      keySuffix: `:${suffixDate}:${before}`,
      occasionId: occasion.id,
      extraWhere,
      extraParams,
      ignoreCap: true, // greetings never count against the weekly offer limit
    });
  }
  if (queued) kick();
  return { queued };
}

/** The scheduler's tick: runs every enabled occasion. */
export async function runAllOccasions(opts = {}) {
  const { rows } = await query('SELECT * FROM occasions WHERE enabled = 1 ORDER BY id');
  let total = 0;
  for (const o of rows) {
    try {
      total += (await runOccasion(o, opts)).queued;
    } catch (err) {
      console.error(`[occasions] ${o.name} failed:`, err.message);
    }
  }
  if (total) console.log(`[occasions] queued ${total} greeting(s)`);
  return total;
}

/** Greetings coming up in the next `days` days, for the occasions screen (one query). */
export async function upcoming(clientId, occasion, days = 30, now = new Date()) {
  const { date: today } = indiaNow(now);
  const list = [];
  if (occasion.kind === 'thank_you') {
    // Purchases from the last few days whose thank-you is still to come.
    const maxDays = Math.max(...(occasion.days_before || [1]));
    const { where, params } = audienceWhere(clientId, occasion.audience);
    params.push(addDays(today, -maxDays));
    const { rows } = await query(
      `SELECT date(r.redeemed_at, '+330 minutes') AS d, count(DISTINCT c.id) AS n, json_group_array(DISTINCT c.name) AS names
         FROM redemptions r JOIN contacts c ON c.id = r.contact_id
        WHERE ${where} AND ${ELIGIBLE} AND date(r.redeemed_at, '+330 minutes') >= $${params.length}
        GROUP BY d`,
      params,
    );
    for (const r of rows) {
      for (const after of occasion.days_before || [1]) {
        const sendOn = addDays(r.d, after);
        if (sendOn >= today) list.push({ sendOn, occasionDate: r.d, before: after, count: r.n, names: JSON.parse(r.names || '[]').slice(0, 3) });
      }
    }
    return list.sort((a, b) => a.sendOn.localeCompare(b.sendOn));
  }
  if (occasion.kind === 'festival') {
    const fest = festivalDay(occasion);
    const { where, params } = audienceWhere(clientId, occasion.audience);
    const { rows: [r] } = await query(
      `SELECT count(*) AS n, (SELECT json_group_array(name) FROM (SELECT c.name FROM contacts c WHERE ${where} AND ${ELIGIBLE} LIMIT 3)) AS names
         FROM contacts c WHERE ${where} AND ${ELIGIBLE}`,
      params,
    );
    for (const before of occasion.days_before || [0]) {
      const sendOn = fest && addDays(fest, -before);
      if (sendOn && sendOn >= today && sendOn <= addDays(today, days - 1) && r.n) {
        list.push({ sendOn, occasionDate: fest, before, count: r.n, names: JSON.parse(r.names || '[]') });
      }
    }
    return list.sort((a, b) => a.sendOn.localeCompare(b.sendOn));
  }
  // Which occasion dates fall in the window for each lead time, keyed by month-day.
  const wanted = new Map(); // 'MM-DD' -> [{ sendOn, occasionDate, before }]
  for (let i = 0; i < days; i++) {
    const sendOn = addDays(today, i);
    for (const before of occasion.days_before || [0]) {
      const target = addDays(sendOn, before);
      for (const md of dayKeys(target)) {
        if (!wanted.has(md)) wanted.set(md, []);
        wanted.get(md).push({ sendOn, occasionDate: target, before });
      }
    }
  }
  const col = column(occasion.kind);
  const { where, params } = audienceWhere(clientId, occasion.audience);
  params.push([...wanted.keys()]);
  const { rows } = await query(
    `SELECT substr(c.${col}, 6, 5) AS md, count(*) AS n, json_group_array(c.name) AS names
       FROM contacts c
      WHERE ${where} AND ${ELIGIBLE} AND c.${col} IS NOT NULL AND substr(c.${col}, 6, 5) IN (SELECT value FROM json_each($${params.length}))
      GROUP BY md`,
    params,
  );
  const byDay = new Map();
  for (const r of rows) {
    for (const w of wanted.get(r.md) || []) {
      const key = `${w.sendOn}|${w.before}`;
      const entry = byDay.get(key) || { ...w, count: 0, names: [] };
      entry.count += r.n;
      entry.names.push(...JSON.parse(r.names).slice(0, 3 - entry.names.length));
      byDay.set(key, entry);
    }
  }
  return [...byDay.values()].sort((a, b) => a.sendOn.localeCompare(b.sendOn) || b.before - a.before);
}
