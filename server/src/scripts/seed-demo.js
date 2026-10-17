// Fills the database with made-up customers and two templates, for trying the app.
// All phone numbers use the 99999 xxxxx range and end in made-up digits; use test mode
// (MESSAGING_PROVIDER=mock) with demo data so nothing is sent to real people.
import { config } from '../config.js';
import { initDb, ensureClient, query, closeDb } from '../db/index.js';

await initDb();
const clientId = await ensureClient(config.businessName);

const first = ['Priya', 'Ravi', 'Lakshmi', 'Arjun', 'Divya', 'Kiran', 'Meena', 'Suresh', 'Anitha', 'Vikram', 'Swapna', 'Rahul', 'Kavya', 'Naveen', 'Sravani', 'Harish'];
const last = ['Sharma', 'Reddy', 'Rao', 'Kumar', 'Naidu', 'Varma', 'Goud', 'Iyer'];
const cities = ['Hyderabad', 'Secunderabad', 'Kukatpally', 'Gachibowli', 'Warangal'];
const items = ['gold bangles', 'diamond ring', 'temple necklace', 'silver anklets', 'gold chain', 'bridal set', 'diamond earrings'];
const interests = ['bridal', 'diamonds', 'gold', 'daily wear', 'gifting', 'temple jewellery'];

let added = 0;
for (let i = 0; i < 120; i++) {
  const name = `${first[i % first.length]} ${last[(i * 7) % last.length]}`;
  const phone = `+9199999${String(10000 + i * 37).slice(-5)}`;
  const optIn = i % 9 !== 0;
  const r = await query(
    `INSERT INTO contacts (client_id, name, phone, city, last_purchase, interests, birthday, whatsapp_opt_in, opt_in_at, opt_in_source, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 THEN now() END, CASE WHEN $8 THEN 'demo data' END, $9)
     ON CONFLICT (client_id, phone) DO NOTHING`,
    [
      clientId,
      name,
      phone,
      cities[i % cities.length],
      i % 6 === 0 ? null : items[i % items.length],
      interests[i % interests.length],
      `19${70 + (i % 30)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      optIn,
      ['demo'],
    ],
  );
  added += r.affectedRows ?? r.rowCount ?? 0;
}

const { rows: [{ n }] } = await query('SELECT count(*)::int AS n FROM templates WHERE client_id = $1', [clientId]);
if (!n) {
  await query(
    `INSERT INTO templates (client_id, name, body, buttons, status) VALUES
     ($1, 'New collection for past buyers',
      'Hi {{name}}, thank you for choosing your {{last_purchase}} from us. Our new collection has pieces that pair beautifully with it, and this week you get {{offer}}. Offer ends {{offer_ends}}.',
      '[{"type":"url","text":"See the collection","url":"https://example.com/new-collection"},{"type":"quick_reply","text":"Not now"}]', 'approved'),
     ($1, 'Store visit invite by city',
      'Hello {{name}}, our {{city}} store has just received new designs picked for you. Visit before {{offer_ends}} for {{offer}}.',
      '[{"type":"phone","text":"Call the store","phone":"+919999900000"},{"type":"quick_reply","text":"Interested"}]', 'approved')`,
    [clientId],
  );
}
// Phases 3-5 demo: anniversaries, SMS consent, a few birthdays today and next week, greetings.
await query(
  `UPDATE contacts SET anniversary = make_date(2010 + (id % 12), ((id * 5) % 12) + 1, (id % 27) + 1),
                       sms_opt_in = (id % 3 = 0)
    WHERE client_id = $1 AND tags @> ARRAY['demo'] AND anniversary IS NULL`,
  [clientId],
);
const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
const md = (d) => [d.getMonth() + 1, d.getDate()];
const in7 = new Date(today.getTime() + 7 * 864e5);
await query(
  `UPDATE contacts SET birthday = make_date(1990 + (id % 10), $2, $3)
    WHERE client_id = $1 AND tags @> ARRAY['demo'] AND id IN (SELECT id FROM contacts WHERE client_id = $1 ORDER BY id LIMIT 3)`,
  [clientId, ...md(today)],
);
await query(
  `UPDATE contacts SET anniversary = make_date(2015, $2, $3)
    WHERE client_id = $1 AND tags @> ARRAY['demo'] AND id IN (SELECT id FROM contacts WHERE client_id = $1 ORDER BY id OFFSET 3 LIMIT 4)`,
  [clientId, ...md(in7)],
);
const { rows: [{ n: occ }] } = await query('SELECT count(*)::int AS n FROM occasions WHERE client_id = $1', [clientId]);
if (!occ) {
  const { rows: [bday] } = await query(
    `INSERT INTO templates (client_id, name, category, body, buttons, status, sms_body) VALUES
     ($1, 'Birthday gift', 'utility',
      'Happy birthday {{name}}! To celebrate, here is {{offer}} on anything you pick this month. Show code {{offer_code}} at the counter.',
      '[{"type":"quick_reply","text":"Book a visit"},{"type":"quick_reply","text":"Not now"}]', 'approved',
      'Happy birthday {{name}}! {{offer}} this month at Swathi Tanishq. Code {{offer_code}}. -SWATHI') RETURNING id`,
    [clientId],
  );
  const { rows: [anniv] } = await query(
    `INSERT INTO templates (client_id, name, category, body, buttons, status) VALUES
     ($1, 'Anniversary gift reminder', 'utility',
      'Hi {{name}}, your anniversary is in {{days_left}} days. Surprise your partner: {{offer}} with code {{offer_code}}.',
      '[{"type":"quick_reply","text":"Interested"},{"type":"quick_reply","text":"Not now"}]', 'approved') RETURNING id`,
    [clientId],
  );
  await query(
    `INSERT INTO occasions (client_id, name, kind, days_before, send_hour, template_id, variables, sms_fallback) VALUES
     ($1, 'Birthday', 'birthday', '{0}', 10, $2, '{"offer":"a free silver coin"}', true),
     ($1, 'Anniversary', 'anniversary', '{7}', 11, $3, '{"offer":"15% off making charges"}', false)`,
    [clientId, bday.id, anniv.id],
  );
}
console.log(`Demo data ready (${added} new customers).`);
await closeDb();
