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

/** True when an event falls on `target` (YYYY-MM-DD); a yearly event matches its month and day in any later year. */
function eventOn(o, target) {
  const fest = festivalDay(o);
  if (!fest) return false;
  if (!o.repeat_yearly) return fest === target;
  return target >= fest && dayKeys(target).includes(fest.slice(5));
}

/** The event's dates around `from`, for the upcoming list (a yearly event can fall in this year and next). */
function eventDates(o, from) {
  const fest = festivalDay(o);
  if (!fest) return [];
  if (!o.repeat_yearly) return [fest];
  const y = Number(from.slice(0, 4));
  return [y, y + 1]
    .map((yr) => `${yr}-${fest.slice(5) === '02-29' && !isLeap(yr) ? '02-28' : fest.slice(5)}`)
    .filter((d) => d >= fest);
}

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
      if (!eventOn(occasion, target)) continue;
    } else if (occasion.kind === 'personal') {
      // Family days: a spouse's or child's birthday, or any other day saved on the customer.
      extraWhere = [`EXISTS (SELECT 1 FROM contact_dates d WHERE d.contact_id = c.id AND substr(d.date, 6, 5) IN (SELECT value FROM json_each($X1)))`];
      extraParams = [dayKeys(target)];
    } else if (occasion.kind === 'thank_you') {
      // "After a purchase": customers who used a sales code `before` days ago (India date).
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

/** Which month-days fall in the window for each lead time: 'MM-DD' -> [{ sendOn, occasionDate, before }]. */
function windowDays(occasion, today, days) {
  const wanted = new Map();
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
  return wanted;
}

async function upcomingPersonal(clientId, occasion, days, today) {
  const wanted = windowDays(occasion, today, days);
  const { where, params } = audienceWhere(clientId, occasion.audience);
  params.push([...wanted.keys()]);
  const { rows } = await query(
    `SELECT substr(d.date, 6, 5) AS md, count(DISTINCT c.id) AS n, json_group_array(c.name) AS names
       FROM contact_dates d JOIN contacts c ON c.id = d.contact_id
      WHERE ${where} AND ${ELIGIBLE} AND substr(d.date, 6, 5) IN (SELECT value FROM json_each($${params.length}))
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

/**
 * The calendar: who has a birthday, anniversary or family day, and which festivals and shop
 * events fall, on each day from `from` for `days` days. Only customers who can get WhatsApp.
 */
export async function calendar(clientId, from, days = 42) {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const byMd = new Map();
  for (const d of dates) {
    for (const md of dayKeys(d)) {
      if (!byMd.has(md)) byMd.set(md, []);
      byMd.get(md).push(d);
    }
  }
  const mds = [...byMd.keys()];
  const out = Object.fromEntries(dates.map((d) => [d, { birthday: [], anniversary: [], personal: [], events: [] }]));
  const put = (md, kind, item) => {
    for (const d of byMd.get(md) || []) out[d][kind].push(item);
  };
  const people = await query(
    `SELECT c.id, c.name, substr(c.birthday, 6, 5) AS b, substr(c.anniversary, 6, 5) AS a FROM contacts c
      WHERE c.client_id = $1 AND c.phone NOT LIKE 'deleted:%' AND ${ELIGIBLE}
        AND (substr(c.birthday, 6, 5) IN (SELECT value FROM json_each($2)) OR substr(c.anniversary, 6, 5) IN (SELECT value FROM json_each($2)))`,
    [clientId, mds],
  );
  for (const r of people.rows) {
    if (mds.includes(r.b)) put(r.b, 'birthday', { id: r.id, name: r.name });
    if (mds.includes(r.a)) put(r.a, 'anniversary', { id: r.id, name: r.name });
  }
  const family = await query(
    `SELECT c.id, c.name, d.kind, d.label, substr(d.date, 6, 5) AS md FROM contact_dates d JOIN contacts c ON c.id = d.contact_id
      WHERE c.client_id = $1 AND c.phone NOT LIKE 'deleted:%' AND ${ELIGIBLE} AND substr(d.date, 6, 5) IN (SELECT value FROM json_each($2))`,
    [clientId, mds],
  );
  for (const r of family.rows) put(r.md, 'personal', { id: r.id, name: r.name, kind: r.kind, label: r.label });
  const { rows: events } = await query("SELECT * FROM occasions WHERE client_id = $1 AND kind = 'festival' AND enabled = 1", [clientId]);
  for (const o of events) {
    for (const d of dates) if (eventOn(o, d)) out[d].events.push({ id: o.id, name: o.name });
  }
  return out;
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
    const { where, params } = audienceWhere(clientId, occasion.audience);
    const { rows: [r] } = await query(
      `SELECT count(*) AS n, (SELECT json_group_array(name) FROM (SELECT c.name FROM contacts c WHERE ${where} AND ${ELIGIBLE} LIMIT 3)) AS names
         FROM contacts c WHERE ${where} AND ${ELIGIBLE}`,
      params,
    );
    for (const fest of eventDates(occasion, today)) {
      for (const before of occasion.days_before || [0]) {
        const sendOn = addDays(fest, -before);
        if (sendOn >= today && sendOn <= addDays(today, days - 1) && r.n) {
          list.push({ sendOn, occasionDate: fest, before, count: r.n, names: JSON.parse(r.names || '[]') });
        }
      }
    }
    return list.sort((a, b) => a.sendOn.localeCompare(b.sendOn));
  }
  if (occasion.kind === 'personal') return upcomingPersonal(clientId, occasion, days, today);
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

// The birthday and anniversary wishes every shop starts with, switched on, at 10 am on the day.
// Same names and wording as the ready-made wishes on the web, so the editor recognises them.
export const DEFAULT_WISHES = {
  birthday: {
    name: 'Birthday wishes',
    template: '🎂 Birthday wish',
    body: 'Happy birthday, {{name}}! 🎂\n\nEveryone at {{store}} wishes you a wonderful year ahead.\n\n*A birthday gift for you:* {{offer}}\n*Valid till:* {{offer_ends}}\n\nWe would love to see you at the store.',
    sms: 'Happy birthday {{name}}! Birthday gift at {{store}}: {{offer}} till {{offer_ends}}. -SWATHI',
    variables: { offer: 'a free silver coin with any purchase', offer_ends: 'a week after your birthday' },
  },
  anniversary: {
    name: 'Anniversary wishes',
    template: '💐 Anniversary wish',
    body: 'Happy anniversary, {{name}}! 💐\n\nWishing you both many more happy years together, from all of us at {{store}}.\n\n*Your anniversary gift:* {{offer}}\n*Valid till:* {{offer_ends}}\n\nWe look forward to seeing you both.',
    sms: 'Happy anniversary {{name}}! Gift at {{store}}: {{offer}} till {{offer_ends}}. -SWATHI',
    variables: { offer: '10% off making charges', offer_ends: 'a week after your anniversary' },
  },
};

/**
 * Birthdays and anniversaries need no setting up: the first time a shop is seen without one,
 * its wish is created and switched on. Done once per kind (clients.auto_wishes), so a wish the
 * owner later deletes is not brought back.
 */
export async function ensureDefaultWishes(clientId) {
  const { rows: [client] } = await query('SELECT name, auto_wishes FROM clients WHERE id = $1', [clientId]);
  if (!client) return;
  const done = new Set(String(client.auto_wishes || '').split(',').filter(Boolean));
  const todo = Object.keys(DEFAULT_WISHES).filter((k) => !done.has(k));
  if (!todo.length) return;
  for (const kind of todo) {
    const { rows: [existing] } = await query('SELECT id FROM occasions WHERE client_id = $1 AND kind = $2 LIMIT 1', [clientId, kind]);
    if (!existing) {
      const w = DEFAULT_WISHES[kind];
      let { rows: [t] } = await query('SELECT id FROM templates WHERE client_id = $1 AND name = $2 LIMIT 1', [clientId, w.template]);
      if (!t) {
        ({ rows: [t] } = await query(
          `INSERT INTO templates (client_id, name, category, body, sms_body, buttons, status) VALUES ($1, $2, 'marketing', $3, $4, '[]', 'approved') RETURNING id`,
          [clientId, w.template, w.body, w.sms],
        ));
      }
      await query(
        `INSERT INTO occasions (client_id, name, kind, days_before, send_hour, template_id, variables, audience, enabled)
         VALUES ($1, $2, $3, '[0]', 10, $4, $5, '{"mode":"all"}', 1)`,
        [clientId, w.name, kind, t.id, JSON.stringify({ store: client.name, ...w.variables })],
      );
    }
    done.add(kind);
  }
  await query('UPDATE clients SET auto_wishes = $2 WHERE id = $1', [clientId, [...done].join(',')]);
}

/**
 * Everyone with a birthday (or anniversary) saved, soonest first, and whether the wish reaches
 * them: 'yes', 'no_whatsapp' (no WhatsApp consent or said stop), or 'not_chosen' (the wish is
 * for chosen customers only), plus 'off' for all when the wish is switched off.
 */
export async function wishPeople(clientId, kind, occasion, now = new Date()) {
  const { date: today } = indiaNow(now);
  const col = column(kind);
  const { rows } = await query(
    `SELECT c.id, c.name, c.city, c.${col} AS date, CASE WHEN ${ELIGIBLE} THEN 1 ELSE 0 END AS can
       FROM contacts c WHERE c.client_id = $1 AND c.phone NOT LIKE 'deleted:%' AND c.${col} IS NOT NULL`,
    [clientId],
  );
  let inAudience = null;
  if (occasion && (occasion.audience?.mode || 'all') !== 'all') {
    const { where, params } = audienceWhere(clientId, occasion.audience);
    inAudience = new Set((await query(`SELECT c.id FROM contacts c WHERE ${where}`, params)).rows.map((r) => r.id));
  }
  const y = Number(today.slice(0, 4));
  const people = rows.map((r) => {
    const md = String(r.date).slice(5, 10);
    const fix = (yr) => (md === '02-29' && !isLeap(yr) ? '02-28' : md);
    let next = `${y}-${fix(y)}`;
    if (next < today) next = `${y + 1}-${fix(y + 1)}`;
    const days = Math.round((Date.parse(next) - Date.parse(today)) / 86400000);
    const year = Number(String(r.date).slice(0, 4));
    const status = !r.can ? 'no_whatsapp' : inAudience && !inAudience.has(r.id) ? 'not_chosen' : occasion?.enabled ? 'yes' : 'off';
    return { id: r.id, name: r.name, city: r.city, date: r.date, next, days, years: year > 1904 ? Number(next.slice(0, 4)) - year : null, status };
  }).sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  const count = (s) => people.filter((p) => p.status === s).length;
  return {
    people,
    counts: { saved: people.length, yes: count('yes'), no_whatsapp: count('no_whatsapp'), not_chosen: count('not_chosen'), off: count('off'), next30: people.filter((p) => p.days < 30 && p.status === 'yes').length },
  };
}
