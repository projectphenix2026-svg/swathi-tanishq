import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { assertConfig, config } from '../src/config.js';
import { initDb, closeDb, ensureClient } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';
import { setProvider } from '../src/providers/index.js';
import { createMockProvider } from '../src/providers/mock.js';
import { drain } from '../src/lib/dispatch.js';
import '../src/lib/sender.js';
import { parseFile, buildPreview } from '../src/lib/importer.js';

let agent;
let provider;

beforeAll(async () => {
  assertConfig();
  config.validateWebhooks = false;
  await initDb({ memory: true });
  const clientId = await ensureClient('Test Store');
  await createUser({ clientId, email: 'staff@example.com', password: 'test-password-1', name: 'Staff' });
  provider = createMockProvider();
  setProvider(provider);
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

  it('imports a CSV: the browser builds the preview, the server checks and saves', async () => {
    const csv = 'Name,Mobile,City,Last purchase\nPriya,98765 43210,Hyderabad,gold chain\nRavi,91234 56789,Warangal,ring\nBad,123,X,\n';
    const preview = buildPreview(parseFile(Buffer.from(csv), 'list.csv'));
    expect(preview.summary).toMatchObject({ ok: 2, invalid: 1 });
    const existing = await agent.post('/api/customers/import/existing').send({ phones: preview.rows.map((r) => r.phone).filter(Boolean) });
    expect(existing.body.existing).toEqual([]);
    const save = await agent.post('/api/customers/import/commit').send({
      rows: preview.rows.filter((r) => r.status === 'ok'),
      optIn: { confirmed: true, value: true },
      source: 'excel: list.csv',
    });
    expect(save.body).toEqual({ created: 2, updated: 0, skipped: 0 });
    const again = await agent.post('/api/customers/import/existing').send({ phones: ['+919876543210', '+919000000000'] });
    expect(again.body.existing).toEqual(['+919876543210']);
    // Saving the same rows again adds nobody.
    const repeat = await agent.post('/api/customers/import/commit').send({ rows: preview.rows.filter((r) => r.status === 'ok'), optIn: { confirmed: true, value: true } });
    expect(repeat.body).toEqual({ created: 0, updated: 0, skipped: 2 });
  });

  it('refuses imports over 500 rows per request and unconfirmed consent', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ phone: `+9190000${String(10000 + i)}`, status: 'ok' }));
    expect((await agent.post('/api/customers/import/commit').send({ rows, optIn: { confirmed: true } })).status).toBe(400);
    expect((await agent.post('/api/customers/import/commit').send({ rows: rows.slice(0, 1), optIn: { value: true } })).status).toBe(400);
  });

  it('adds one customer by form and refuses a duplicate', async () => {
    const add = await agent.post('/api/customers').send({ city: 'Secunderabad', name: 'Kiran', phone: '99887 76655', whatsapp_opt_in: true, last_purchase: 'anklets' });
    expect(add.status).toBe(201);
    expect(add.body.customer.phone).toBe('+919988776655');
    const dup = await agent.post('/api/customers').send({ city: 'Hyderabad', name: 'Kiran 2', phone: '+91 99887 76655' });
    expect(dup.status).toBe(409);
  });

  it('needs a city, and keeps extra special days', async () => {
    const noCity = await agent.post('/api/customers').send({ name: 'Lata', phone: '99887 11111' });
    expect(noCity.status).toBe(400);
    expect(noCity.body.fields.city).toMatch(/city/);
    const add = await agent.post('/api/customers').send({
      name: 'Lata', phone: '99887 11111', city: 'Warangal', birthday: '1904-03-14',
      dates: [{ kind: 'spouse_birthday', date: '1985-07-02' }, { kind: 'other', label: 'Daughter’s wedding', date: '2027-02-10' }],
    });
    expect(add.status).toBe(201);
    expect(add.body.customer).toMatchObject({ birthday: '1904-03-14', dates: [{ kind: 'spouse_birthday', date: '1985-07-02' }, { kind: 'other', label: 'Daughter’s wedding' }] });
    const id = add.body.customer.id;
    expect((await agent.patch(`/api/customers/${id}`).send({ city: ' ' })).status).toBe(400);
    const edit = await agent.patch(`/api/customers/${id}`).send({ dates: [{ kind: 'child_birthday', date: '2015-12-01' }] });
    expect(edit.body.customer.dates).toEqual([{ kind: 'child_birthday', label: null, date: '2015-12-01' }]);
    const list = await agent.get('/api/customers?q=Lata');
    expect(list.body.customers[0].dates).toHaveLength(1);
    // Imports: rows without a city need one city for all of them.
    const rows = [{ phone: '+919988722222', name: 'No City', status: 'ok' }];
    const refused = await agent.post('/api/customers/import/commit').send({ rows, optIn: {} });
    expect(refused.body).toMatchObject({ noCity: 1 });
    const saved = await agent.post('/api/customers/import/commit').send({ rows, optIn: {}, defaultCity: 'Hyderabad' });
    expect(saved.body.created).toBe(1);
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
    await drain();
    const report = await agent.get(`/api/campaigns/${campaignId}`);
    expect(report.body.report).toMatchObject({ total: 1, sent: 1, failed: 0 });
    expect(report.body.campaign.status).toBe('completed');
    expect(provider.outbox[0].to).toBe('+919876543210');
  });

  it('refuses to send when the audience changed since review', async () => {
    const res = await agent.post('/api/campaigns').send({ name: 'Again', templateId, audience: { mode: 'all' }, variables: { offer: 'x' }, expectedCount: 99 });
    expect(res.status).toBe(409);
  });

  it('sends a test to a staff phone as one customer would see it, and leaves that phone out of normal sends', async () => {
    const before = await agent.post('/api/campaigns/preview').send({ audience: { mode: 'all' }, templateId, variables: { offer: '10% off' } });
    const priya = before.body.sample.find((c) => c.name === 'Priya');
    const res = await agent.post('/api/campaigns/test').send({ templateId, variables: { offer: '10% off' }, phone: '90000 11111', asContactId: priya.id });
    expect(res.status).toBe(201);
    expect(res.body.phone).toBe('+91 90000 11111');
    await drain();
    expect(provider.outbox.at(-1)).toMatchObject({ to: '+919000011111', body: 'Hi Priya, pieces to pair with your gold chain are in. 10% off this week.' });
    const after = await agent.post('/api/campaigns/preview').send({ audience: { mode: 'all' }, templateId, variables: { offer: '10% off' } });
    expect(after.body.eligible).toBe(before.body.eligible);
    expect((await agent.post('/api/campaigns/test').send({ templateId, phone: '123' })).status).toBe(400);
  });

  it('“Send now” waits a few seconds so it can be undone', async () => {
    const res = await agent.post('/api/campaigns').send({
      name: 'Undo me', templateId, audience: { mode: 'filter', cities: ['warangal'] }, variables: { offer: '5% off' }, expectedCount: 1, undoSeconds: 20,
    });
    expect(res.status).toBe(201);
    const id = res.body.campaign.id;
    expect((await agent.get(`/api/campaigns/${id}`)).body.campaign.status).toBe('scheduled');
    const undo = await agent.post(`/api/campaigns/${id}/cancel`);
    expect(undo.body.cancelled).toBe(1);
    await drain();
    expect(provider.outbox.some((m) => m.body?.includes('5% off'))).toBe(false);
  });

  it('deletes a customer: gone from lists, chats and call list, but offer totals stay', async () => {
    const add = await agent.post('/api/customers').send({ city: 'Hyderabad', name: 'Delete Me', phone: '90000 22222', whatsapp_opt_in: true, last_purchase: 'ring' });
    const id = add.body.customer.id;
    const offer = await agent.post('/api/campaigns').send({
      name: 'Before delete', templateId, audience: { mode: 'selected', contactIds: [id] }, variables: { offer: '7% off' }, expectedCount: 1,
    });
    await drain();
    await request(createApp()).post('/webhooks/twilio').type('form').send({ MessageSid: 'SMdel1', SmsStatus: 'received', From: 'whatsapp:+919000022222', Body: 'Interested' });
    const before = (await agent.get('/api/customers/summary')).body.total;

    const del = await agent.delete(`/api/customers/${id}`);
    expect(del.status).toBe(200);
    expect((await agent.get('/api/customers/summary')).body.total).toBe(before - 1);
    expect((await agent.get('/api/customers?q=Delete')).body.customers).toEqual([]);
    expect((await agent.get('/api/inbox')).body.conversations.some((c) => c.contact_id === id)).toBe(false);
    expect((await agent.get('/api/leads')).body.leads.some((l) => l.contact_id === id)).toBe(false);
    const report = (await agent.get(`/api/campaigns/${offer.body.campaign.id}`)).body.report;
    expect(report).toMatchObject({ total: 1, sent: 1 });
    // The same number can be added again as a new customer.
    expect((await agent.post('/api/customers').send({ city: 'Hyderabad', name: 'Back Again', phone: '90000 22222' })).status).toBe(201);
    expect((await agent.delete(`/api/customers/${id}`)).status).toBe(404);
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
    await drain();
    expect(provider.outbox.filter((m) => m.body === 'Yes, all week!')).toHaveLength(1);
    const customers = await agent.get('/api/customers?filter=opted_out');
    expect(customers.body.customers.map((c) => c.phone)).toEqual(['+919123456789']);
  });
});
