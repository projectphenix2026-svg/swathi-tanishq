// Sample customers for Test mode, so a new shop sees full screens before adding its own list.
// They carry the tag "sample", use numbers that are not real, and are removed on going live.
import { query, batch, NOW } from '../db/index.js';

export const SAMPLE_TAG = 'sample';

const SAMPLES = [
  { name: 'Priya Sharma', phone: '+919000000101', city: 'Hyderabad', last_purchase: 'gold bangles', interests: 'Bridal, Gold', birthday: 0, anniversary: 40 },
  { name: 'Kavya Reddy', phone: '+919000000102', city: 'Hyderabad', last_purchase: 'diamond earrings', interests: 'Diamond', birthday: 3, anniversary: null },
  { name: 'Lakshmi Rao', phone: '+919000000103', city: 'Warangal', last_purchase: 'temple necklace', interests: 'Antique, Gold', birthday: 21, anniversary: 1 },
  { name: 'Anil Kumar', phone: '+919000000104', city: 'Vijayawada', last_purchase: 'gold chain', interests: 'Gold, Coins', birthday: 58, anniversary: null },
  { name: 'Meena Iyer', phone: '+919000000105', city: 'Secunderabad', last_purchase: 'silver anklets', interests: 'Silver', birthday: null, anniversary: 6 },
];

/** A date `days` from today (India), so the sample birthdays show on the calendar soon. */
function soon(days) {
  // Year 1904 means "year not known" (see CustomerFields), so no made-up year shows.
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 + days * 86400000);
  return `1904-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function addSamples(clientId) {
  await batch(SAMPLES.map((s) => ({
    sql: `INSERT INTO contacts (client_id, name, phone, city, birthday, anniversary, last_purchase, interests, tags,
                                whatsapp_opt_in, opt_in_at, opt_in_source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, ${NOW}, 'Sample customer (test mode)')
          ON CONFLICT (client_id, phone) DO NOTHING`,
    params: [clientId, s.name, s.phone, s.city, s.birthday === null ? null : soon(s.birthday), s.anniversary === null ? null : soon(s.anniversary),
      s.last_purchase, s.interests, [SAMPLE_TAG]],
  })));
  return countSamples(clientId);
}

export async function countSamples(clientId) {
  const { rows: [r] } = await query(
    `SELECT count(*) AS n FROM contacts c WHERE c.client_id = $1 AND EXISTS (SELECT 1 FROM json_each(c.tags) t WHERE t.value = '${SAMPLE_TAG}')`,
    [clientId],
  );
  return r.n;
}

/** Removes the sample customers and everything about them (test messages, replies, call backs). */
export async function removeSamples(clientId) {
  const ids = `(SELECT c.id FROM contacts c WHERE c.client_id = $1 AND EXISTS (SELECT 1 FROM json_each(c.tags) t WHERE t.value = '${SAMPLE_TAG}'))`;
  const removed = await countSamples(clientId);
  await batch([
    { sql: `DELETE FROM leads WHERE contact_id IN ${ids}`, params: [clientId] },
    { sql: `DELETE FROM redemptions WHERE contact_id IN ${ids}`, params: [clientId] },
    { sql: `DELETE FROM contact_dates WHERE contact_id IN ${ids}`, params: [clientId] },
    { sql: `DELETE FROM messages WHERE contact_id IN ${ids}`, params: [clientId] },
    { sql: `DELETE FROM contacts WHERE id IN ${ids}`, params: [clientId] },
  ]);
  return removed;
}
