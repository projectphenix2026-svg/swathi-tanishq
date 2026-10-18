import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { assertConfig, config } from '../src/config.js';
import { initDb, closeDb, ensureClient, query } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';
import { setProvider } from '../src/providers/index.js';
import { createMockProvider } from '../src/providers/mock.js';
import { drain } from '../src/lib/dispatch.js';
import { applyStatus } from '../src/lib/messages.js';
import { finishEstimate } from '../src/lib/pacing.js';
import '../src/lib/sender.js';

let owner;
let manager;
let provider;
let templateId;

beforeAll(async () => {
  assertConfig();
  config.validateWebhooks = false;
  await initDb({ memory: true });
  const clientId = await ensureClient('Test Store');
  await createUser({ clientId, email: 'owner@example.com', password: 'owner-password-1', name: 'Owner' });
  await createUser({ clientId, email: 'manager@example.com', password: 'manager-password-1', name: 'Manager', role: 'manager' });
  provider = createMockProvider();
  setProvider(provider);
  owner = request.agent(createApp());
  manager = request.agent(createApp());
  await owner.post('/api/auth/login').send({ email: 'owner@example.com', password: 'owner-password-1' });
  await manager.post('/api/auth/login').send({ email: 'manager@example.com', password: 'manager-password-1' });
  for (let i = 1; i <= 5; i++) {
    await owner.post('/api/customers').send({ name: `Customer ${i}`, phone: `90000 4000${i}`, whatsapp_opt_in: true, city: 'Hyderabad' });
  }
  const t = await owner.post('/api/templates').send({ name: 'Offer', body: 'Hi {{name}}, our Diwali offer is here. Visit us this week.' });
  templateId = t.body.template.id;
});
afterEach(() => {
  config.testDailyLimit = 0;
});
afterAll(() => closeDb());

describe('Meta daily limit: pacing', () => {
  it('estimates when a long send finishes', () => {
    const now = new Date('2026-10-18T10:00:00Z');
    expect(finishEstimate(200, { limit: 250, remaining: 250 }, now)).toBeNull();
    expect(finishEstimate(1000, { limit: 250, remaining: 250 }, now)).toBe('2026-10-21T10:00:00.000Z');
  });

  it('sends only up to the daily limit and keeps the rest waiting; replies still go out', async () => {
    config.testDailyLimit = 3;
    const pv = await owner.post('/api/campaigns/preview').send({ audience: { mode: 'all' }, templateId, variables: {} });
    expect(pv.body.pace).toMatchObject({ limit: 3, used: 0, remaining: 3 });
    expect(pv.body.pace.finishBy).toBeTruthy(); // 5 customers, 3 a day
    const c = await owner.post('/api/campaigns').send({ name: 'Paced', templateId, audience: { mode: 'all' }, variables: {}, expectedCount: 5 });
    await drain();
    const r = await owner.get(`/api/campaigns/${c.body.campaign.id}`);
    expect(r.body.report).toMatchObject({ total: 5, sent: 3, pending: 2 });
    expect(r.body.pace).toMatchObject({ limit: 3, remaining: 0 });
    expect(r.body.pace.finishBy).toBeTruthy();

    // A customer reply can always be answered.
    await request(createApp()).post('/webhooks/twilio').type('form').send({ MessageSid: 'SMp1', SmsStatus: 'received', From: 'whatsapp:+919000040001', Body: 'Timings?' });
    const { rows: [ct] } = await query("SELECT id FROM contacts WHERE phone = '+919000040001'");
    await owner.post(`/api/inbox/${ct.id}/reply`).send({ body: '10 am to 9 pm', clientRequestId: 'p1' });
    await drain();
    expect(provider.outbox.some((m) => m.body === '10 am to 9 pm')).toBe(true);

    // With no limit, the rest go out.
    config.testDailyLimit = 0;
    await drain();
    expect((await owner.get(`/api/campaigns/${c.body.campaign.id}`)).body.report).toMatchObject({ sent: 5, pending: 0 });
  });
});

describe("Meta's per-person marketing limit (131049)", () => {
  it('tries again once after 24 hours, then gives up', async () => {
    const { rows: [m] } = await query("SELECT id, provider_message_id FROM messages WHERE campaign_id IS NOT NULL AND status = 'sent' ORDER BY id LIMIT 1");
    expect(await applyStatus({ providerMessageId: m.provider_message_id, status: 'failed', errorCode: 131049, errorMessage: 'limit' })).toBe(true);
    let { rows: [after] } = await query('SELECT status, retried_at, error_message, due_at FROM messages WHERE id = $1', [m.id]);
    expect(after.status).toBe('retrying');
    expect(after.retried_at).toBeTruthy();
    expect(after.error_message).toMatch(/tomorrow/);
    expect(new Date(after.due_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);

    // Tomorrow comes: it is sent again; a second 131049 is final.
    await query("UPDATE messages SET due_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute') WHERE id = $1", [m.id]);
    await drain();
    ({ rows: [after] } = await query('SELECT status, provider_message_id FROM messages WHERE id = $1', [m.id]));
    expect(after.status).toBe('sent');
    await applyStatus({ providerMessageId: after.provider_message_id, status: 'failed', errorCode: 131049, errorMessage: 'limit' });
    ({ rows: [after] } = await query('SELECT status FROM messages WHERE id = $1', [m.id]));
    expect(after.status).toBe('failed');
  });

  it('does not retry other failures', async () => {
    const { rows: [m] } = await query("SELECT id, provider_message_id FROM messages WHERE campaign_id IS NOT NULL AND status = 'sent' ORDER BY id LIMIT 1");
    await applyStatus({ providerMessageId: m.provider_message_id, status: 'failed', errorCode: 131026, errorMessage: 'not on WhatsApp' });
    const { rows: [after] } = await query('SELECT status FROM messages WHERE id = $1', [m.id]);
    expect(after.status).toBe('failed');
  });
});

describe('Download all data (owner only)', () => {
  it('pages through customers, offers and bill codes', async () => {
    const first = await owner.get('/api/export/customers?limit=2');
    expect(first.body.rows).toHaveLength(2);
    expect(first.body.next).toBe(first.body.rows[1].id);
    let all = [...first.body.rows];
    let next = first.body.next;
    while (next) {
      const r = await owner.get(`/api/export/customers?limit=2&after=${next}`);
      all = all.concat(r.body.rows);
      next = r.body.next;
    }
    expect(all.map((c) => c.name).sort()).toEqual(['Customer 1', 'Customer 2', 'Customer 3', 'Customer 4', 'Customer 5']);
    const offers = await owner.get('/api/export/offers');
    expect(offers.body.rows[0]).toMatchObject({ name: 'Paced', total: 5 });
    expect((await owner.get('/api/export/bill-codes')).body.rows).toEqual([]);
  });

  it('is only for the owner, and remembers the last download', async () => {
    expect((await manager.get('/api/export/customers')).status).toBe(403);
    expect((await owner.get('/api/dashboard')).body.lastExportAt).toBeNull();
    await owner.post('/api/export/done');
    expect((await owner.get('/api/dashboard')).body.lastExportAt).toBeTruthy();
  });
});
