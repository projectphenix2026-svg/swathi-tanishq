// Occasion automations: birthday, anniversary and festival greetings, sent with no one
// touching the app. Each greeting has its own key (occasion + customer + date + days before),
// so however often the check runs, a customer gets each greeting once.
import { query } from '../db/index.js';
import { audienceWhere, ELIGIBLE, buildMessages, insertMessages } from './campaigns.js';
import { enqueueMessage } from './sender.js';

const TZ = 'Asia/Kolkata';
const PREFIX = { birthday: 'BDAY', anniversary: 'ANNIV', festival: 'FEST' };

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

/**
 * Customers whose birthday/anniversary falls on `target` (YYYY-MM-DD), any birth year.
 * 29 February dates are greeted on 28 February in other years.
 */
async function customersOnDay(clientId, occasion, target) {
  const col = occasion.kind === 'birthday' ? 'birthday' : 'anniversary';
  const md = target.slice(5);
  const year = Number(target.slice(0, 4));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = md === '02-28' && !leap ? ['02-28', '02-29'] : [md];
  const { where, params } = audienceWhere(clientId, occasion.audience);
  params.push(days);
  const { rows } = await query(
    `SELECT c.* FROM contacts c
      WHERE ${where} AND ${ELIGIBLE} AND c.${col} IS NOT NULL
        AND to_char(c.${col}, 'MM-DD') = ANY($${params.length}::text[])
      ORDER BY c.id`,
    params,
  );
  return rows;
}

/** Everyone in the occasion's audience (festivals). */
async function audienceOf(clientId, occasion) {
  const { where, params } = audienceWhere(clientId, occasion.audience);
  const { rows } = await query(`SELECT c.* FROM contacts c WHERE ${where} AND ${ELIGIBLE} ORDER BY c.id`, params);
  return rows;
}

/** Who gets which greeting on `today`. Used both to send and to preview. */
export async function dueGreetings(clientId, occasion, today) {
  const due = [];
  for (const before of occasion.days_before || [0]) {
    const target = addDays(today, before);
    let contacts = [];
    if (occasion.kind === 'festival') {
      const fest = occasion.festival_date ? String(occasion.festival_date instanceof Date ? occasion.festival_date.toISOString() : occasion.festival_date).slice(0, 10) : null;
      if (fest === target) contacts = await audienceOf(clientId, occasion);
    } else {
      contacts = await customersOnDay(clientId, occasion, target);
    }
    if (contacts.length) due.push({ before, target, contacts });
  }
  return due;
}

/** Queues today's greetings for one occasion. Safe to run any number of times a day. */
export async function runOccasion(occasion, { now = new Date(), force = false } = {}) {
  const { date: today, hour } = indiaNow(now);
  if (!occasion.enabled) return { queued: 0, reason: 'switched off' };
  if (!force && hour < occasion.send_hour) return { queued: 0, reason: 'before send time' };
  const { rows: [template] } = await query('SELECT * FROM templates WHERE id = $1', [occasion.template_id]);
  if (!template || template.status !== 'approved') return { queued: 0, reason: 'template not ready' };

  let queued = 0;
  let skipped = 0;
  for (const { before, target, contacts } of await dueGreetings(occasion.client_id, occasion, today)) {
    const vars = { ...occasion.variables, days_left: String(before) };
    const { rows, skipped: s } = await buildMessages(occasion.client_id, contacts, template, vars, {
      keyFor: (c) => `occasion:${occasion.id}:contact:${c.id}:${target}:${before}`,
      codePrefix: occasion.variables?.code_prefix || PREFIX[occasion.kind],
      occasionId: occasion.id,
    });
    skipped += s;
    const inserted = await insertMessages(rows);
    for (const m of inserted) await enqueueMessage(m);
    queued += inserted.length;
  }
  return { queued, skipped };
}

/** The scheduler's tick: runs every enabled occasion. */
export async function runAllOccasions(opts = {}) {
  const { rows } = await query('SELECT * FROM occasions WHERE enabled = true ORDER BY id');
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

/** Greetings coming up in the next `days` days, for the occasions screen. */
export async function upcoming(clientId, occasion, days = 30, now = new Date()) {
  const { date: today } = indiaNow(now);
  const list = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    for (const { before, target, contacts } of await dueGreetings(clientId, occasion, day)) {
      list.push({ sendOn: day, occasionDate: target, before, count: contacts.length, names: contacts.slice(0, 3).map((c) => c.name || c.phone) });
    }
  }
  return list;
}
