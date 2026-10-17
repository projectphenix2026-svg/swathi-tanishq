import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { assertConfig, config } from '../src/config.js';
import { initDb, closeDb, ensureClient } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';
import { setProvider } from '../src/providers/index.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createMemoryQueue } from '../src/queue/memory.js';
import { setQueue } from '../src/queue/index.js';
import { processSendJob } from '../src/lib/sender.js';

let agent;
let queue;
let provider;

beforeAll(async () => {
  assertConfig();
  config.validateWebhooks = false;
  await initDb({ memory: true });
  const clientId = await ensureClient('Test Store');
  await createUser({ clientId, email: 'staff@example.com', password: 'test-password-1', name: 'Staff' });
  provider = createMockProvider();
  setProvider(provider);
  queue = createMemoryQueue({ handler: processSendJob, ratePerSecond: 0 });
  setQueue(queue);
  agent = request.agent(createApp());
});
afterAll(() => closeDb());

describe('API flow', () => {
  it('requires sign-in', async () => {
    const res = await request(createApp()).get('/api/customers');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong password with a plain message', async () => {
    const res = await agent.post('/api/auth/login').send({ email: 'staff@example.com', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/do not match/);
  });

  it('signs in', async () => {
    const res = await agent.post('/api/auth/login').send({ email: 'STAFF@example.com', password: 'test-password-1' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  });

  it('imports a CSV in two steps: preview, then save', async () => {
    const csv = 'Name,Mobile,City,Last purchase\nPriya,98765 43210,Hyderabad,gold chain\nRavi,91234 56789,Warangal,ring\nBad,123,X,\n';
    const preview = await agent.post('/api/customers/import/preview').attach('file', Buffer.from(csv), 'list.csv');
    expect(preview.status).toBe(200);
    expect(preview.body.summary).toMatchObject({ ok: 2, invalid: 1 });
    const save = await agent.post('/api/customers/import/commit').send({
      rows: preview.body.rows,
      optIn: { confirmed: true, value: true },
      source: 'excel: list.csv',
    });
    expect(save.body).toEqual({ created: 2, updated: 0, skipped: 1 });
  });

  it('adds one customer by form and refuses a duplicate', async () => {
    const add = await agent.post('/api/customers').send({ name: 'Kiran', phone: '99887 76655', whatsapp_opt_in: true, last_purchase: 'anklets' });
    expect(add.status).toBe(201);
    expect(add.body.customer.phone).toBe('+919988776655');
    const dup = await agent.post('/api/customers').send({ name: 'Kiran 2', phone: '+91 99887 76655' });
    expect(dup.status).toBe(409);
  });

  it('validates templates in plain words', async () => {
    const bad = await agent.post('/api/templates').send({ name: 'x', body: '{{name}} hi {{wrong}}', buttons: [{ type: 'url', text: 'Go' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.join(' ')).toMatch(/start or end with a placeholder/);
    expect(bad.body.errors.join(' ')).toMatch(/Unknown placeholder/);
    expect(bad.body.errors.join(' ')).toMatch(/website link/);
  });

  let templateId;
  it('creates a template with two buttons', async () => {
    const res = await agent.post('/api/templates').send({
      name: 'Past buyers',
      body: 'Hi {{name}}, pieces to pair with your {{last_purchase}} are in. {{offer}} this week.',
      buttons: [
        { type: 'url', text: 'See designs', url: 'https://example.com' },
        { type: 'quick_reply', text: 'Not now' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.template.variables).toEqual(['name', 'last_purchase', 'offer']);
    templateId = res.body.template.id;
  });

  it('previews audience, cost and one real customer’s message', async () => {
    const preview = await agent.post('/api/campaigns/preview').send({ audience: { mode: 'all' }, templateId, variables: { offer: '10% off' } });
    expect(preview.body).toMatchObject({ eligible: 3, sendable: 3, estimatedCost: 2.59 });
    const priya = preview.body.sample.find((c) => c.name === 'Priya');
    const msg = await agent.post('/api/campaigns/render').send({ templateId, contactId: priya.id, variables: { offer: '10% off' } });
    expect(msg.body.text).toBe('Hi Priya, pieces to pair with your gold chain are in. 10% off this week.');
  });

  let campaignId;
  it('sends a campaign and reports on it', async () => {
    const res = await agent.post('/api/campaigns').send({
      name: 'Diwali', templateId, audience: { mode: 'filter', cities: ['hyderabad'] }, variables: { offer: '10% off' }, expectedCount: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.queued).toBe(1);
    campaignId = res.body.campaign.id;
    await new Promise((r) => setTimeout(r, 50));
    await queue.onIdle();
    const report = await agent.get(`/api/campaigns/${campaignId}`);
    expect(report.body.report).toMatchObject({ total: 1, sent: 1, failed: 0 });
    expect(report.body.campaign.status).toBe('completed');
    expect(provider.outbox[0].to).toBe('+919876543210');
  });

  it('refuses to send when the audience changed since review', async () => {
    const res = await agent.post('/api/campaigns').send({ name: 'Again', templateId, audience: { mode: 'all' }, variables: { offer: 'x' }, expectedCount: 99 });
    expect(res.status).toBe(409);
  });

  it('puts customer replies in the inbox, and STOP opts them out', async () => {
    await request(createApp()).post('/webhooks/twilio').type('form').send({
      MessageSid: 'SMin1', SmsStatus: 'received', From: 'whatsapp:+919876543210', Body: 'Is the offer valid on Sunday?', ProfileName: 'Priya',
    });
    await request(createApp()).post('/webhooks/twilio').type('form').send({
      MessageSid: 'SMin2', SmsStatus: 'received', From: 'whatsapp:+919123456789', Body: 'STOP',
    });
    const inbox = await agent.get('/api/inbox');
    expect(inbox.body.conversations.map((c) => c.phone).sort()).toEqual(['+919123456789', '+919876543210']);
    const priya = inbox.body.conversations.find((c) => c.phone === '+919876543210');
    expect(priya.unread).toBe(1);
    const thread = await agent.get(`/api/inbox/${priya.contact_id}`);
    expect(thread.body.windowOpen).toBe(true);
    const reply = await agent.post(`/api/inbox/${priya.contact_id}/reply`).send({ body: 'Yes, all week!', clientRequestId: 'abc' });
    await agent.post(`/api/inbox/${priya.contact_id}/reply`).send({ body: 'Yes, all week!', clientRequestId: 'abc' }); // double click
    expect(reply.status).toBe(201);
    await queue.onIdle();
    expect(provider.outbox.filter((m) => m.body === 'Yes, all week!')).toHaveLength(1);
    const customers = await agent.get('/api/customers?filter=opted_out');
    expect(customers.body.customers.map((c) => c.phone)).toEqual(['+919123456789']);
  });
});
