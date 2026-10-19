// Fills the database with made-up customers, templates and occasions, for trying the app.
// Phone numbers are in the 99999 xxxxx range; use test mode (MESSAGING_PROVIDER=mock)
// with demo data so nothing is sent to real people.
import { config } from '../config.js';
import { initDb, ensureClient, query, closeDb } from '../db/index.js';
import { indiaNow, addDays } from '../lib/occasions.js';

await initDb();
const clientId = await ensureClient(config.businessName);

const first = ['Priya', 'Ravi', 'Lakshmi', 'Arjun', 'Divya', 'Kiran', 'Meena', 'Suresh', 'Anitha', 'Vikram', 'Swapna', 'Rahul', 'Kavya', 'Naveen', 'Sravani', 'Harish'];
const last = ['Sharma', 'Reddy', 'Rao', 'Kumar', 'Naidu', 'Varma', 'Goud', 'Iyer'];
const cities = ['Warangal', 'Hanamkonda', 'Kazipet', 'Hyderabad', 'Karimnagar'];
const items = ['gold bangles', 'diamond ring', 'temple necklace', 'silver anklets', 'gold chain', 'bridal set', 'diamond earrings'];
const interests = ['bridal', 'diamonds', 'gold', 'daily wear', 'gifting', 'temple jewellery'];
const pad = (n) => String(n).padStart(2, '0');
const { date: today } = indiaNow();
const in7 = addDays(today, 7);

let added = 0;
for (let i = 0; i < 120; i++) {
  const name = `${first[i % first.length]} ${last[(i * 7) % last.length]}`;
  const phone = `+9199999${String(10000 + i * 37).slice(-5)}`;
  const optIn = i % 9 !== 0;
  // A few birthdays today and anniversaries next week, so the occasion screens have something to show.
  const birthday = i < 3 ? `${1990 + (i % 10)}-${today.slice(5)}` : `19${70 + (i % 30)}-${pad((i % 12) + 1)}-${pad((i % 27) + 1)}`;
  const anniversary = i >= 3 && i < 7 ? `2015-${in7.slice(5)}` : `${2010 + (i % 12)}-${pad(((i * 5) % 12) + 1)}-${pad((i % 27) + 1)}`;
  const r = await query(
    `INSERT INTO contacts (client_id, name, phone, city, last_purchase, interests, birthday, anniversary, whatsapp_opt_in, sms_opt_in, opt_in_at, opt_in_source, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $9 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END, CASE WHEN $9 THEN 'demo data' END, '["demo"]')
     ON CONFLICT (client_id, phone) DO NOTHING`,
    [clientId, name, phone, cities[i % cities.length], i % 6 === 0 ? null : items[i % items.length], interests[i % interests.length], birthday, anniversary, optIn, i % 3 === 0],
  );
  added += r.rowCount;
}

const { rows: [{ n }] } = await query('SELECT count(*) AS n FROM templates WHERE client_id = $1', [clientId]);
if (!n) {
  const t = (name, category, body, buttons, sms = null) =>
    query(`INSERT INTO templates (client_id, name, category, body, buttons, status, sms_body) VALUES ($1, $2, $3, $4, $5, 'approved', $6) RETURNING id`, [clientId, name, category, body, buttons, sms]);
  await t('New collection for past buyers', 'marketing',
    'Hi {{name}}, thank you for choosing your {{last_purchase}} from us. Our new collection has pieces that pair beautifully with it, and this week you get {{offer}}. Offer ends {{offer_ends}}.',
    [{ type: 'url', text: 'See the collection', url: 'https://example.com/new-collection' }, { type: 'quick_reply', text: 'Interested' }]);
  await t('Store visit invite by city', 'marketing',
    'Hello {{name}}, our {{city}} store has just received new designs picked for you. Visit before {{offer_ends}} for {{offer}}.',
    [{ type: 'phone', text: 'Call the store', phone: '+919999900000' }, { type: 'quick_reply', text: 'Interested' }]);
  const { rows: [bday] } = await t('Birthday gift', 'utility',
    'Happy birthday {{name}}! To celebrate, here is {{offer}} on anything you pick this month. Show code {{offer_code}} at the counter.',
    [{ type: 'quick_reply', text: 'Book a visit' }, { type: 'quick_reply', text: 'Not now' }],
    'Happy birthday {{name}}! {{offer}} this month at My Shop. Code {{offer_code}}.');
  const { rows: [anniv] } = await t('Anniversary gift reminder', 'utility',
    'Hi {{name}}, your anniversary is in {{days_left}} days. Surprise your partner: {{offer}} with code {{offer_code}}.',
    [{ type: 'quick_reply', text: 'Interested' }, { type: 'quick_reply', text: 'Not now' }]);
  await query(
    `INSERT INTO occasions (client_id, name, kind, days_before, send_hour, template_id, variables, sms_fallback) VALUES
     ($1, 'Birthday', 'birthday', '[0]', 10, $2, '{"offer":"a free silver coin"}', 1),
     ($1, 'Anniversary', 'anniversary', '[7]', 11, $3, '{"offer":"15% off making charges"}', 0)`,
    [clientId, bday.id, anniv.id],
  );
}
console.log(`Demo data ready (${added} new customers).`);
await closeDb();
