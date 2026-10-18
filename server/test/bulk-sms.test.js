import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { assertConfig, config } from '../src/config.js';
import { initDb, closeDb, ensureClient, query } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';
import { setProvider } from '../src/providers/index.js';
import { createMockProvider } from '../src/providers/mock.js';
import { drain } from '../src/lib/dispatch.js';
import '../src/lib/sender.js';

let agent;
let provider;

beforeAll(async () => {
  assertConfig();
  await initDb({ memory: true });
  const clientId = await ensureClient('Test Store');
  await createUser({ clientId, email: 'owner@example.com', password: 'owner-password-1', name: 'Owner' });
  provider = createMockProvider();
  setProvider(provider);
  agent = request.agent(createApp());
  await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'owner-password-1' });
  // Two agreed to SMS, one only to WhatsApp, one said STOP.
  await agent.post('/api/customers').send({ city: 'Hyderabad', name: 'Priya', phone: '90000 50001', whatsapp_opt_in: true, sms_opt_in: true });
  await agent.post('/api/customers').send({ city: 'Hyderabad', name: 'Ravi', phone: '90000 50002', sms_opt_in: true });
  await agent.post('/api/customers').send({ city: 'Hyderabad', name: 'Kiran', phone: '90000 50003', whatsapp_opt_in: true });
  await query("UPDATE contacts SET sms_opt_in = 1 WHERE phone IN ('+919000050001', '+919000050002')");
});
afterAll(() => closeDb());

describe('Bulk SMS offers', () => {
  let withSms;
  let withoutSms;

  it('needs an SMS version of the message', async () => {
    withoutSms = (await agent.post('/api/templates').send({ name: 'WA only', body: 'Hi {{name}}, new designs are here. Visit us this week.' })).body.template;
    const res = await agent.post('/api/campaigns').send({ name: 'x', templateId: withoutSms.id, audience: { mode: 'all' }, variables: {}, channel: 'sms' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no SMS version/);
  });

  it('counts customers who agreed to SMS and prices at the SMS rate', async () => {
    withSms = (await agent.post('/api/templates').send({
      name: 'Diwali', body: 'Hi {{name}}, Diwali offer: {{offer}}. Visit us this week.',
      sms_body: 'Hi {{name}}, Diwali offer at Swathi Tanishq: {{offer}}. Code {{offer_code}} -SWATHI',
    })).body.template;
    const pv = await agent.post('/api/campaigns/preview').send({ audience: { mode: 'all' }, templateId: withSms.id, variables: { offer: '20% off' }, channel: 'sms' });
    expect(pv.body).toMatchObject({ channel: 'sms', eligible: 2, sendable: 2, costPerMessage: config.sms.costPerSms, smsReady: true });
    expect(pv.body.pace).toBeNull();
  });

  it('sends a personalised SMS to each, with its own bill code (trial mode until DLT)', async () => {
    const res = await agent.post('/api/campaigns').send({
      name: 'Diwali SMS', templateId: withSms.id, audience: { mode: 'all' }, variables: { offer: '20% off', code_prefix: 'DIWALI' }, channel: 'sms', expectedCount: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.campaign.channel).toBe('sms');
    await drain();
    const { rows } = await query("SELECT m.channel, m.status, m.body, m.offer_code, c.name FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.campaign_id = $1 ORDER BY c.name", [res.body.campaign.id]);
    expect(rows.map((r) => r.name)).toEqual(['Priya', 'Ravi']);
    expect(rows.every((r) => r.channel === 'sms' && r.status === 'preview')).toBe(true);
    expect(rows[0].body).toMatch(/^Hi Priya, Diwali offer at Swathi Tanishq: 20% off\. Code PRIYA-DIWALI-\d{4} -SWATHI$/);
    expect(rows[0].offer_code).toMatch(/^PRIYA-DIWALI-/);
    expect(provider.outbox).toHaveLength(0); // nothing went over WhatsApp
    const report = await agent.get(`/api/campaigns/${res.body.campaign.id}`);
    expect(report.body.report).toMatchObject({ total: 2, sent: 2, sms_preview: 2 });
  });
});
