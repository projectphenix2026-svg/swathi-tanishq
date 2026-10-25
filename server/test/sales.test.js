import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { assertConfig, config } from '../src/config.js';
import { initDb, closeDb, ensureClient, query } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';
import { setProvider } from '../src/providers/index.js';
import { createMockProvider } from '../src/providers/mock.js';
import { drain } from '../src/lib/dispatch.js';
import { runOccasion } from '../src/lib/occasions.js';
import '../src/lib/sender.js';

let owner;
let provider;
let priya;

beforeAll(async () => {
  assertConfig();
  config.validateWebhooks = false;
  await initDb({ memory: true });
  const clientId = await ensureClient('Test Store');
  await createUser({ clientId, email: 'owner@example.com', password: 'owner-password-1', name: 'Owner' });
  provider = createMockProvider();
  setProvider(provider);
  owner = request.agent(createApp());
  await owner.post('/api/auth/login').send({ email: 'owner@example.com', password: 'owner-password-1' });
  priya = (await owner.post('/api/customers').send({ city: 'Hyderabad', name: 'Priya', phone: '90000 60001', whatsapp_opt_in: true })).body.customer;
  await owner.post('/api/customers').send({ city: 'Hyderabad', name: 'Ravi', phone: '90000 60002' }); // no consent
});
afterAll(() => closeDb());

describe('After a purchase: thank-you + Google review', () => {
  it('thanks customers the day after they used a bill code, once', async () => {
    const t = await owner.post('/api/templates').send({
      name: 'Thanks', body: 'Thank you for shopping with us, {{name}}! Could you rate us on Google?', buttons: [{ type: 'url', text: 'Rate us on Google', url: 'https://g.page/r/abc/review' }],
    });
    // Priya bought yesterday (India time) with a bill code.
    const offer = await owner.post('/api/templates').send({ name: 'Offer', body: 'Hi {{name}}, your code is {{offer_code}} for this week.' });
    const c = await owner.post('/api/campaigns').send({ name: 'Offer', templateId: offer.body.template.id, audience: { mode: 'selected', contactIds: [priya.id] }, variables: {}, expectedCount: 1 });
    await drain();
    const { rows: [msg] } = await query('SELECT id, offer_code FROM messages WHERE campaign_id = $1', [c.body.campaign.id]);
    await owner.post('/api/offers/redeem').send({ code: msg.offer_code, amount: 52000 });
    await query("UPDATE redemptions SET redeemed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')");

    const occ = await owner.post('/api/occasions').send({ name: 'After a purchase', kind: 'thank_you', days_before: [1], send_hour: 7, template_id: t.body.template.id });
    expect(occ.status).toBe(201);
    const first = await runOccasion(occ.body.occasion, { force: true });
    expect(first.queued).toBe(1);
    expect((await runOccasion(occ.body.occasion, { force: true })).queued).toBe(0); // only once
    await drain();
    expect(provider.outbox.at(-1).body).toBe('Thank you for shopping with us, Priya! Could you rate us on Google?');
    const up = await owner.get(`/api/occasions/${occ.body.occasion.id}/upcoming`);
    expect(up.status).toBe(200);
  });

  it('refuses "0 days after"', async () => {
    const { rows: [t] } = await query("SELECT id FROM templates WHERE name = 'Thanks'");
    const res = await owner.post('/api/occasions').send({ name: 'x', kind: 'thank_you', days_before: [0], template_id: t.id });
    expect(res.status).toBe(400);
  });
});

describe('Call back reminders', () => {
  it('flags customers waiting more than a day and shows who called', async () => {
    await request(createApp()).post('/webhooks/twilio').type('form').send({ MessageSid: 'SMcb1', SmsStatus: 'received', From: 'whatsapp:+919000060001', Body: 'Interested' });
    // A button tap opens the lead; here the customer is put on the list directly.
    await query("INSERT INTO leads (client_id, contact_id, reason) SELECT client_id, id, 'Interested' FROM contacts WHERE phone = '+919000060001'");
    await query("UPDATE leads SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 hours')");
    const list = await owner.get('/api/leads');
    expect(list.body.counts.overdue).toBe(1);
    expect(list.body.leads[0].overdue).toBeTruthy();
    expect((await owner.get('/api/dashboard')).body.overdue_leads).toBe(1);
    await owner.patch(`/api/leads/${list.body.leads[0].id}`).send({ status: 'called' });
    const sum = await owner.get('/api/leads/summary');
    expect(sum.body.staff[0]).toMatchObject({ name: 'Owner', handled: 1, called: 1 });
    expect((await owner.get('/api/leads')).body.counts.overdue).toBe(0);
  });
});

describe('Sales codes switch', () => {
  it('is off at first and only the owner can switch it', async () => {
    expect((await owner.get('/api/dashboard/settings')).body.salesCodes).toBe(false);
    expect((await owner.put('/api/dashboard/settings/sales-codes').send({ on: true })).body.salesCodes).toBe(true);
    expect((await owner.get('/api/dashboard/settings')).body.salesCodes).toBe(true);
    expect((await owner.post('/api/campaigns/updates').send({ kind: 'order' })).status).toBe(404);
  });
});
