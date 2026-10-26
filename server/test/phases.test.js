// Phases 2-5: Meta template submission, occasions, SMS backup, offer codes,
// hot leads, weekly limit, imports, roles and approvals.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { assertConfig, config } from '../src/config.js';
import { initDb, closeDb, query, ensureClient } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';
import { setProvider, setSmsProvider } from '../src/providers/index.js';
import { ProviderError } from '../src/providers/errors.js';
import { createMetaProvider, metaTemplateName } from '../src/providers/meta.js';
import { createSmsProvider, smsParts } from '../src/providers/sms.js';
import { drain } from '../src/lib/dispatch.js';
import '../src/lib/sender.js';
import { runOccasion, addDays, indiaNow, upcoming } from '../src/lib/occasions.js';
import { everyMinute } from '../src/runtime.js';
import { vi } from 'vitest';
import { recordInbound } from '../src/lib/messages.js';
import { parseVcard, sheetsCsvUrl, parseFile, buildPreview } from '../src/lib/importer.js';
import { makeOfferCode, cleanPrefix } from '../src/lib/offers.js';

let clientId;
let provider;
let admin;
let manager;
let staff;
const app = () => createApp();

function fakeWhatsApp() {
  const p = {
    name: 'fake', label: 'Fake', sent: [], failNext: [],
    missingConfig: () => [],
    async send(msg) {
      if (p.failNext.length) throw p.failNext.shift();
      const id = `W${p.sent.length + 1}`;
      p.sent.push({ id, ...msg });
      return { providerMessageId: id, status: 'sent' };
    },
    async sendText(msg) { return p.send(msg); },
    fetchStatus: null, verifyWebhook: () => true, parseWebhook: () => ({ statuses: [], inbound: [] }),
  };
  return p;
}

async function login(email) {
  const agent = request.agent(app());
  await agent.post('/api/auth/login').send({ email, password: 'test-password-1' }).expect(200);
  return agent;
}

async function contact(name, phone, extra = {}) {
  const { rows: [c] } = await query(
    `INSERT INTO contacts (client_id, name, phone, city, last_purchase, whatsapp_opt_in, sms_opt_in, birthday, anniversary)
     VALUES ($1, $2, $3, 'Hyderabad', 'gold chain', $4, $5, $6, $7) RETURNING *`,
    [clientId, name, phone, extra.optIn ?? true, extra.sms ?? false, extra.birthday ?? null, extra.anniversary ?? null],
  );
  return c;
}

async function template(body, extra = {}) {
  const { rows: [t] } = await query(
    `INSERT INTO templates (client_id, name, body, buttons, status, category, sms_body)
     VALUES ($1, $2, $3, $4, 'approved', $5, $6) RETURNING *`,
    [clientId, extra.name || 'T', body, JSON.stringify(extra.buttons || []), extra.category || 'marketing', extra.sms_body || null],
  );
  return t;
}

beforeAll(async () => {
  assertConfig();
  config.validateWebhooks = false;
  await initDb({ memory: true });
  clientId = await ensureClient('Test Store');
  admin = await createUser({ clientId, email: 'admin@example.com', password: 'test-password-1', name: 'Owner', role: 'owner' });
  manager = await createUser({ clientId, email: 'manager@example.com', password: 'test-password-1', name: 'Manager', role: 'manager' });
  staff = await createUser({ clientId, email: 'staff@example.com', password: 'test-password-1', name: 'Staff', role: 'staff' });
  await createUser({ clientId, email: 'appowner@example.com', password: 'test-password-1', name: 'App owner', role: 'app_owner' });
});
afterAll(() => closeDb());

beforeEach(async () => {
  for (const t of ['redemptions', 'leads', 'messages', 'campaigns', 'occasions', 'templates', 'contact_dates', 'contacts']) await query(`DELETE FROM ${t}`);
  await query('UPDATE clients SET weekly_cap = 2, approval_threshold = 500');
  provider = fakeWhatsApp();
  setProvider(provider);
  setSmsProvider(createSmsProvider({ mode: 'preview' }));
});

describe('Phase 2: Meta template submission', () => {
  it('turns our placeholders and buttons into Meta’s format', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ id: '99', status: 'PENDING' }) };
    };
    const meta = createMetaProvider({ accessToken: 't', phoneNumberId: '1', wabaId: '555', graphVersion: 'v25.0' }, { fetchImpl });
    const r = await meta.submitTemplate(
      { name: 'Diwali offer – past buyers!', body: 'Hi {{name}}, {{offer}} on {{last_purchase}}. Ends {{offer_ends}}.', category: 'marketing', language: 'en', buttons: [{ type: 'url', text: 'See designs', url: 'https://x.in' }, { type: 'quick_reply', text: 'Interested' }] },
      { name: 'Priya', offer: '20% off', last_purchase: 'gold chain', offer_ends: '31 Oct' },
    );
    expect(r).toEqual({ name: 'diwali_offer_past_buyers', status: 'PENDING', id: '99' });
    expect(calls[0].url).toBe('https://graph.facebook.com/v25.0/555/message_templates');
    const [body, buttons] = calls[0].body.components;
    expect(body.text).toBe('Hi {{1}}, {{2}} on {{3}}. Ends {{4}}.');
    expect(body.example.body_text[0]).toEqual(['Priya', '20% off', 'gold chain', '31 Oct']);
    expect(buttons.buttons).toEqual([{ type: 'URL', text: 'See designs', url: 'https://x.in' }, { type: 'QUICK_REPLY', text: 'Interested' }]);
    expect(calls[0].body.category).toBe('MARKETING');
  });

  it('makes valid Meta template names', () => {
    expect(metaTemplateName('New collection: Bridal 2026')).toBe('new_collection_bridal_2026');
    expect(metaTemplateName('!!!')).toBe('template');
  });
});

describe('Phase 3: occasions', () => {
  const today = indiaNow().date;

  it('the once-a-minute job sends birthday wishes even when every run starts fresh (as on Cloudflare)', async () => {
    // 26 Oct 2026, 11:30 in India: a quarter hour, after the 10:00 send time.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
    try {
      await contact('Vijay', '+919440900044', { birthday: '1968-10-26' });
      const t = await template('Happy birthday {{name}}!', { category: 'utility' });
      await query(
        `INSERT INTO occasions (client_id, name, kind, days_before, template_id, send_hour, enabled) VALUES ($1, 'Birthday', 'birthday', '[0]', $2, 10, 1)`,
        [clientId, t.id],
      );
      await everyMinute({ send: false });
      const { rows } = await query("SELECT count(*) AS n FROM messages WHERE occasion_id IS NOT NULL");
      expect(Number(rows[0].n)).toBe(1);
      await everyMinute({ send: false }); // the same quarter hour again: nothing new
      expect(Number((await query("SELECT count(*) AS n FROM messages WHERE occasion_id IS NOT NULL")).rows[0].n)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a birthday greeting on the day, once only', async () => {
    const md = today.slice(5);
    await contact('Priya Sharma', '+919876543210', { birthday: `1990-${md}` });
    await contact('Ravi', '+919123456789', { birthday: '1990-01-01' === `1990-${md}` ? '1991-06-15' : '1990-01-01' });
    const t = await template('Happy birthday {{name}}! Enjoy {{offer}} with code {{offer_code}}.', { category: 'utility' });
    const { rows: [o] } = await query(
      `INSERT INTO occasions (client_id, name, kind, days_before, template_id, variables) VALUES ($1, 'Birthday', 'birthday', '[0]', $2, $3) RETURNING *`,
      [clientId, t.id, JSON.stringify({ offer: 'a free gift' })],
    );
    expect((await runOccasion(o, { force: true })).queued).toBe(1);
    expect((await runOccasion(o, { force: true })).queued).toBe(0); // same day again: nothing new
    await drain();
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].body).toMatch(/^Happy birthday Priya! Enjoy a free gift with code PRIYA-BDAY-\d{4}\.$/);
  });

  it('sends a reminder N days before an anniversary', async () => {
    const in7 = addDays(today, 7);
    await contact('Lakshmi', '+919988776655', { anniversary: `2015-${in7.slice(5)}` });
    const t = await template('Hi {{name}}, your anniversary is in {{days_left}} days. Gift ideas inside!', { category: 'utility' });
    const { rows: [o] } = await query(
      `INSERT INTO occasions (client_id, name, kind, days_before, template_id) VALUES ($1, 'Anniversary', 'anniversary', '[7,0]', $2) RETURNING *`,
      [clientId, t.id],
    );
    expect((await runOccasion(o, { force: true })).queued).toBe(1);
    await drain();
    expect(provider.sent[0].body).toBe('Hi Lakshmi, your anniversary is in 7 days. Gift ideas inside!');
    const list = await upcoming(clientId, o, 10);
    expect(list.find((u) => u.before === 0)).toMatchObject({ occasionDate: in7, count: 1 });
  });

  it('waits for the send time unless forced', async () => {
    const t = await template('Hi {{name}}, happy festival from us, see you soon.');
    const { rows: [o] } = await query(
      `INSERT INTO occasions (client_id, name, kind, festival_date, days_before, send_hour, template_id) VALUES ($1, 'Diwali', 'festival', $2, '[0]', 23, $3) RETURNING *`,
      [clientId, today, t.id],
    );
    await contact('Kiran', '+919000011111');
    const at = new Date(`${today}T05:00:00+05:30`);
    expect(await runOccasion(o, { now: at })).toMatchObject({ queued: 0, reason: 'before send time' });
    expect((await runOccasion(o, { force: true })).queued).toBe(1);
  });

  it('sends a yearly shop event on the same date every year, and a one-off event only once', async () => {
    await contact('Event', '+919000022222');
    const t = await template('Hi {{name}}, it is our shop anniversary, come and celebrate.');
    const { rows: [yearly] } = await query(
      `INSERT INTO occasions (client_id, name, kind, festival_date, days_before, template_id, repeat_yearly) VALUES ($1, 'Shop anniversary', 'festival', '2025-12-01', '[0]', $2, 1) RETURNING *`,
      [clientId, t.id],
    );
    const { rows: [once] } = await query(
      `INSERT INTO occasions (client_id, name, kind, festival_date, days_before, template_id) VALUES ($1, 'Sale', 'festival', '2025-12-01', '[0]', $2) RETURNING *`,
      [clientId, t.id],
    );
    const dec1 = new Date('2027-12-01T12:00:00+05:30');
    expect((await runOccasion(yearly, { now: dec1, force: true })).queued).toBeGreaterThan(0);
    expect((await runOccasion(once, { now: dec1, force: true })).queued).toBe(0);
    expect((await runOccasion(yearly, { now: new Date('2027-12-02T12:00:00+05:30'), force: true })).queued).toBe(0);
    const list = await upcoming(clientId, yearly, 10, new Date('2027-11-25T12:00:00+05:30'));
    expect(list[0]).toMatchObject({ occasionDate: '2027-12-01', before: 0 });
    // Saved through the API, the switch is kept.
    const agent = await login('admin@example.com');
    const r = await agent.post('/api/occasions').send({ name: 'New Year', kind: 'festival', festival_date: '2027-01-01', days_before: [0], template_id: t.id, repeat_yearly: true });
    expect(r.body.occasion.repeat_yearly).toBe(true);
  });

  it('sends family-day wishes and shows every special day on the calendar', async () => {
    const c = await contact('Family', '+919000033333', { birthday: '1904-12-05' });
    await query(`INSERT INTO contact_dates (client_id, contact_id, kind, label, date) VALUES ($1, $2, 'spouse_birthday', NULL, '1980-12-06')`, [clientId, c.id]);
    const t = await template('Hi {{name}}, warm wishes to your family on this special day.');
    const { rows: [o] } = await query(
      `INSERT INTO occasions (client_id, name, kind, days_before, template_id) VALUES ($1, 'Family days', 'personal', '[0]', $2) RETURNING *`,
      [clientId, t.id],
    );
    const dec6 = new Date('2027-12-06T12:00:00+05:30');
    expect((await runOccasion(o, { now: dec6, force: true })).queued).toBe(1);
    expect((await runOccasion(o, { now: new Date('2027-12-07T12:00:00+05:30'), force: true })).queued).toBe(0);
    expect((await upcoming(clientId, o, 10, new Date('2027-12-01T12:00:00+05:30')))[0]).toMatchObject({ occasionDate: '2027-12-06', count: 1 });
    const agent = await login('admin@example.com');
    const cal = await agent.get('/api/occasions/calendar?from=2027-12-04&days=4');
    expect(cal.body.days['2027-12-05'].birthday.map((x) => x.name)).toContain('Family');
    expect(cal.body.days['2027-12-06'].personal).toMatchObject([{ name: 'Family', kind: 'spouse_birthday' }]);
  });

  it('greets 29 February birthdays on 28 February in other years', async () => {
    await contact('Leap', '+919811122233', { birthday: '2000-02-29' });
    const t = await template('Hi {{name}}, happy birthday, here is a little gift.', { category: 'utility' });
    const { rows: [o] } = await query(
      `INSERT INTO occasions (client_id, name, kind, days_before, template_id) VALUES ($1, 'B', 'birthday', '[0]', $2) RETURNING *`,
      [clientId, t.id],
    );
    const feb28 = new Date('2027-02-28T12:00:00+05:30');
    expect((await runOccasion(o, { now: feb28, force: true })).queued).toBe(1);
  });
});

describe('Phase 4: SMS backup', () => {
  it('sends the SMS version when the number is not on WhatsApp (preview until DLT)', async () => {
    const c = await contact('Priya Sharma', '+919876543210', { sms: true });
    const t = await template('Hi {{name}}, 20% off on {{last_purchase}} designs this week.', {
      sms_body: 'Hi {{name}}, 20% off on {{last_purchase}} at Swathi Tanishq this week. -SWATHI',
    });
    const { rows: [cp] } = await query(
      `INSERT INTO campaigns (client_id, name, template_id, cost_per_message, provider, sms_fallback) VALUES ($1, 'C', $2, 0.8631, 'fake', true) RETURNING *`,
      [clientId, t.id],
    );
    provider.failNext = [new ProviderError('This number is not on WhatsApp.', { code: 63003 })];
    const { launchCampaign } = await import('../src/lib/campaigns.js');
    await launchCampaign(clientId, cp, t);
    await drain();
    const { rows } = await query('SELECT channel, status, body, fallback_of FROM messages WHERE contact_id = $1 ORDER BY id', [c.id]);
    expect(rows.map((r) => [r.channel, r.status])).toEqual([['whatsapp', 'failed'], ['sms', 'preview']]);
    expect(rows[1].body).toBe('Hi Priya, 20% off on gold chain at Swathi Tanishq this week. -SWATHI');
  });

  it('does not send SMS without SMS consent', async () => {
    const c = await contact('NoSms', '+919876543211', { sms: false });
    const t = await template('Hi {{name}}, new designs are in, come and see them.', { sms_body: 'Hi {{name}}, new designs are in.' });
    const { rows: [cp] } = await query(
      `INSERT INTO campaigns (client_id, name, template_id, cost_per_message, provider, sms_fallback) VALUES ($1, 'C', $2, 0.8631, 'fake', true) RETURNING *`,
      [clientId, t.id],
    );
    provider.failNext = [new ProviderError('Not on WhatsApp', { code: 131026 })];
    const { launchCampaign } = await import('../src/lib/campaigns.js');
    await launchCampaign(clientId, cp, t);
    await drain();
    const { rows } = await query('SELECT channel FROM messages WHERE contact_id = $1', [c.id]);
    expect(rows.map((r) => r.channel)).toEqual(['whatsapp']);
  });

  it('counts SMS parts', () => {
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
    expect(smsParts('₹'.repeat(71))).toBe(2);
  });
});

describe('Phase 5: offer codes, leads, weekly limit, roles', () => {
  it('makes unique, readable codes', () => {
    const taken = new Set();
    const codes = Array.from({ length: 300 }, () => makeOfferCode('Priya Sharma', cleanPrefix('diwali 26'), taken));
    expect(new Set(codes).size).toBe(300);
    expect(codes[0]).toMatch(/^PRIYA-DIWALI26-\d{4,6}$/);
    expect(cleanPrefix('')).toBe('OFFER');
  });

  it('gives each customer a code, and records a sale once at billing', async () => {
    const c = await contact('Priya Sharma', '+919876543210');
    const t = await template('Hi {{name}}, show code {{offer_code}} for {{offer}}.');
    const agent = await login('admin@example.com');
    const res = await agent.post('/api/campaigns').send({ name: 'Diwali', templateId: t.id, audience: { mode: 'all' }, variables: { offer: '10% off', code_prefix: 'diwali' } });
    expect(res.status).toBe(201);
    await drain();
    const { rows: [m] } = await query('SELECT offer_code, body FROM messages WHERE contact_id = $1', [c.id]);
    expect(m.offer_code).toMatch(/^PRIYA-DIWALI-\d{4}$/);
    expect(m.body).toContain(m.offer_code);

    const look = await agent.get(`/api/offers/lookup?code=${m.offer_code.toLowerCase()}`);
    expect(look.body.offer).toMatchObject({ name: 'Priya Sharma', campaign_name: 'Diwali', offer: '10% off' });
    expect((await agent.post('/api/offers/redeem').send({ code: m.offer_code, amount: 45000 })).status).toBe(201);
    expect((await agent.post('/api/offers/redeem').send({ code: m.offer_code, amount: 45000 })).status).toBe(409);
    const report = await agent.get(`/api/campaigns/${res.body.campaign.id}`);
    expect(report.body.report).toMatchObject({ redeemed: 1, revenue: 45000 });
  });

  it('puts customers who tap Interested on the call list and tags them', async () => {
    const c = await contact('Priya Sharma', '+919876543210');
    const t = await template('Hi {{name}}, new bridal sets are here. Want a call?', { buttons: [{ type: 'quick_reply', text: 'Call me back' }, { type: 'quick_reply', text: 'Not now' }] });
    const { rows: [cp] } = await query(`INSERT INTO campaigns (client_id, name, template_id, cost_per_message, provider) VALUES ($1, 'Bridal', $2, 0.8631, 'fake') RETURNING *`, [clientId, t.id]);
    const { launchCampaign } = await import('../src/lib/campaigns.js');
    await launchCampaign(clientId, cp, t);
    await drain();
    await recordInbound(clientId, { providerMessageId: 'in1', from: '+919876543210', body: 'Call me back', provider: 'fake' });
    await recordInbound(clientId, { providerMessageId: 'in2', from: '+919876543210', body: 'Call me back', provider: 'fake' }); // tapped twice
    const { rows: leads } = await query('SELECT reason, status, campaign_id FROM leads WHERE contact_id = $1', [c.id]);
    expect(leads).toEqual([{ reason: 'Call me back', status: 'new', campaign_id: cp.id }]);
    const { rows: [after] } = await query('SELECT tags FROM contacts WHERE id = $1', [c.id]);
    expect(after.tags).toContain('interested');
  });

  it('does not put customers on the call list for typed words, only for a button tap', async () => {
    const c = await contact('Priya Sharma', '+919876543210');
    const t = await template('Hi {{name}}, new bridal sets are here.', { buttons: [{ type: 'quick_reply', text: 'Interested' }] });
    const { rows: [cp] } = await query(`INSERT INTO campaigns (client_id, name, template_id, cost_per_message, provider) VALUES ($1, 'Bridal', $2, 0.8631, 'fake') RETURNING *`, [clientId, t.id]);
    const { launchCampaign } = await import('../src/lib/campaigns.js');
    await launchCampaign(clientId, cp, t);
    await drain();
    await recordInbound(clientId, { providerMessageId: 'in1', from: '+919876543210', body: 'yes', provider: 'fake' });
    expect((await query('SELECT id FROM leads WHERE contact_id = $1', [c.id])).rows).toEqual([]);
    await recordInbound(clientId, { providerMessageId: 'in2', from: '+919876543210', body: 'Interested', provider: 'fake' });
    expect((await query('SELECT id FROM leads WHERE contact_id = $1', [c.id])).rows).toHaveLength(1);
  });

  it('skips customers who already got the weekly number of offers', async () => {
    const busy = await contact('Busy', '+919876543210');
    await contact('Fresh', '+919876543299');
    const t = await template('Hi {{name}}, a new offer for you this week only.');
    const { rows: [old] } = await query(`INSERT INTO campaigns (client_id, name, template_id, cost_per_message, provider) VALUES ($1, 'Old', $2, 0.8631, 'fake') RETURNING *`, [clientId, t.id]);
    for (const k of [1, 2]) {
      await query(`INSERT INTO messages (client_id, campaign_id, contact_id, template_id, idempotency_key, status, channel) VALUES ($1, $2, $3, $4, $5, 'read', 'whatsapp')`, [clientId, old.id, busy.id, t.id, `old${k}`]);
    }
    const agent = await login('admin@example.com');
    const p = await agent.post('/api/campaigns/preview').send({ audience: { mode: 'all' }, templateId: t.id });
    expect(p.body).toMatchObject({ eligible: 2, atCap: 1, sendable: 1, weeklyCap: 2 });
    // Step 1 (no message picked yet) already shows the real number, not everyone in the group.
    const p0 = await agent.post('/api/campaigns/preview').send({ audience: { mode: 'all' } });
    expect(p0.body).toMatchObject({ eligible: 2, atCap: 1, sendable: 1 });
    expect(p0.body.atCapPeople).toMatchObject([{ name: 'Busy', offers: 2, lastOffer: 'Old' }]);
    const list = await agent.get('/api/customers?offers=1&sort=name');
    expect(list.body.customers.find((x) => x.name === 'Busy')).toMatchObject({ offers_this_week: 2 });
    expect(list.body.customers.find((x) => x.name === 'Fresh')).toMatchObject({ offers_this_week: 0 });
    // "Pick customers": everyone matched, sendable first, with the reason others are left out.
    const l = await agent.post('/api/campaigns/audience-list').send({ audience: { mode: 'all' }, templateId: t.id });
    expect(l.body.customers.find((x) => x.name === 'Fresh').reason).toBe(null);
    expect(l.body.customers.find((x) => x.name === 'Busy')).toMatchObject({ reason: 'cap', offers: 2 });
    expect((await agent.post('/api/campaigns/audience-list').send({ audience: { mode: 'all' }, q: 'fre' })).body.customers.map((x) => x.name)).toEqual(['Fresh']);
    // Unticking a customer leaves them out.
    const fresh = l.body.customers.find((x) => x.name === 'Fresh');
    const px = await agent.post('/api/campaigns/preview').send({ audience: { mode: 'filter', excludeIds: [fresh.id] }, templateId: t.id });
    expect(px.body.sendable).toBe(0);
    await query('UPDATE clients SET weekly_cap = 0');
    const p2 = await agent.post('/api/campaigns/preview').send({ audience: { mode: 'all' }, templateId: t.id });
    expect(p2.body.sendable).toBe(2);
  });

  it('gives each of the four roles its own access', async () => {
    const staffLogin = await login('staff@example.com');
    const mgr = await login('manager@example.com');
    const owner = await login('admin@example.com');
    // Staff: the counter. Reads everything, adds customers, answers replies and call backs, records sales codes.
    expect((await staffLogin.get('/api/customers')).status).toBe(200);
    expect((await staffLogin.post('/api/customers').send({ city: 'Warangal', name: 'Counter Add', phone: '9876500001' })).status).toBe(201);
    expect((await staffLogin.post('/api/inbox/1/reply').send({ body: 'Hello' })).status).not.toBe(403);
    expect((await staffLogin.patch('/api/leads/1').send({ status: 'called' })).status).not.toBe(403);
    expect((await staffLogin.post('/api/offers/redeem').send({ code: 'X-1', amount: 100 })).status).not.toBe(403);
    // ...but does not send messages, write templates, run wishes, import or delete customers, or change settings.
    expect((await staffLogin.post('/api/campaigns').send({ name: 'x' })).status).toBe(403);
    expect((await staffLogin.post('/api/templates').send({ name: 'x', body: 'Hello there {{name}} and welcome.' })).status).toBe(403);
    expect((await staffLogin.post('/api/occasions').send({ name: 'x', kind: 'festival' })).status).toBe(403);
    expect((await staffLogin.post('/api/customers/import/commit').send({ rows: [] })).status).toBe(403);
    expect((await staffLogin.delete('/api/customers/1')).status).toBe(403);
    expect((await staffLogin.put('/api/dashboard/shop').send({ name: 'X' })).status).toBe(403);
    expect((await staffLogin.get('/api/auth/users')).status).toBe(403);

    // Store manager: runs the day. Sends messages, writes templates, imports and deletes customers.
    expect((await mgr.post('/api/templates').send({ name: 'Mgr template', body: 'Hello there {{name}} and welcome.' })).status).toBe(201);
    expect((await mgr.post('/api/customers/import/commit').send({ rows: [], optIn: {} })).status).not.toBe(403);
    // ...but not the shop's settings, WhatsApp connection, data download, or logins.
    expect((await mgr.put('/api/dashboard/shop').send({ name: 'X' })).status).toBe(403);
    expect((await mgr.get('/api/whatsapp')).status).toBe(403);
    expect((await mgr.get('/api/export/customers')).status).toBe(403);
    expect((await mgr.get('/api/auth/users')).status).toBe(403);

    // Store owner: the shop's settings, WhatsApp, data and logins.
    expect((await owner.get('/api/whatsapp')).status).toBe(200);
    expect((await owner.get('/api/auth/users')).status).toBe(200);
  });

  it('deletes templates: removed when never used, hidden but kept when used, refused while a wish uses it', async () => {
    const mgr = await login('manager@example.com');
    const st = await login('staff@example.com');
    const unused = await template('Hello {{name}}, this one is never sent anywhere.', { name: 'Unused' });
    expect((await st.delete(`/api/templates/${unused.id}`)).status).toBe(403);
    expect((await mgr.delete(`/api/templates/${unused.id}`)).body).toMatchObject({ ok: true, kept: false });
    expect((await query('SELECT count(*) AS n FROM templates WHERE id = $1', [unused.id])).rows[0].n).toBe(0);

    // A template past messages used is hidden from the lists but kept for the reports.
    await contact('Del Test', '+919000055555');
    const used = await template('Hello {{name}}, thanks for visiting us.', { name: 'Used before' });
    const admin = await login('admin@example.com');
    expect((await admin.post('/api/campaigns').send({ name: 'Old send', templateId: used.id, audience: { mode: 'all' }, variables: {}, expectedCount: 1 })).status).toBe(201);
    await drain();
    expect((await mgr.delete(`/api/templates/${used.id}`)).body).toMatchObject({ ok: true, kept: true });
    expect((await mgr.get('/api/templates')).body.templates.some((x) => x.id === used.id)).toBe(false);
    expect((await mgr.get('/api/campaigns')).body.campaigns.some((c) => c.template_name === 'Used before')).toBe(true);
    expect((await mgr.delete(`/api/templates/${used.id}`)).status).toBe(404);

    // A switched-on wish still using it blocks the delete, and says which wish.
    const wishTpl = await template('Hello {{name}}, happy birthday from us.', { name: 'Wish text' });
    await query(`INSERT INTO occasions (client_id, name, kind, days_before, template_id, enabled) VALUES ($1, 'Birthday wishes', 'birthday', '[0]', $2, 1)`, [clientId, wishTpl.id]);
    const refused = await mgr.delete(`/api/templates/${wishTpl.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Birthday wishes still uses this template/);
  });

  it('lets only the owner edit the shop details, and messages use the current ones', async () => {
    const admin = await login('admin@example.com');
    const m = await login('manager@example.com');
    const details = { name: 'Tanishq Warangal', address: 'Hanamkonda Main Road, Warangal', phone: '98765 43210', googleReviewLink: 'https://g.page/r/abc/review' };
    expect((await m.put('/api/dashboard/shop').send(details)).status).toBe(403);
    expect((await admin.put('/api/dashboard/shop').send({ ...details, name: '  ' })).body.fields.name).toMatch(/shop name/);
    expect((await admin.put('/api/dashboard/shop').send({ ...details, phone: '123' })).body.fields.phone).toBeTruthy();
    expect((await admin.put('/api/dashboard/shop').send({ ...details, googleReviewLink: 'g.page/x' })).body.fields.googleReviewLink).toMatch(/https/);
    const saved = await admin.put('/api/dashboard/shop').send(details);
    expect(saved.status).toBe(200);
    const settings = (await m.get('/api/dashboard/settings')).body;
    expect(settings.businessName).toBe('Tanishq Warangal');
    expect(settings.shop).toMatchObject({ name: 'Tanishq Warangal', address: 'Hanamkonda Main Road, Warangal', googleReviewLink: 'https://g.page/r/abc/review' });
    expect((await request(createApp()).get('/api/auth/shop-name')).body.name).toBe('Tanishq Warangal');

    // A saved copy of an old shop name in the campaign is ignored: the current details are used.
    await contact('Shop Test', '+919000044444');
    const t = await template('Hi {{name}}, visit {{store}} at {{address}}. Call {{shop_phone}}.');
    const sent = await admin.post('/api/campaigns').send({ name: 'Rename check', templateId: t.id, audience: { mode: 'all' }, variables: { store: 'Old Shop Name' }, expectedCount: 1 });
    expect(sent.status).toBe(201);
    await drain();
    expect(provider.sent.at(-1).body).toBe('Hi Shop, visit Tanishq Warangal at Hanamkonda Main Road, Warangal. Call +91 98765 43210.');

    // An address left blank holds the message back instead of sending a gap.
    await admin.put('/api/dashboard/shop').send({ ...details, address: '' });
    const p = await admin.post('/api/campaigns/preview').send({ audience: { mode: 'all' }, templateId: t.id });
    expect(p.body.sendable).toBe(0);
    expect(p.body.missing.address).toBeGreaterThan(0);
  });

  it('holds big sends by managers for the store owner to approve', async () => {
    await query('UPDATE clients SET approval_threshold = 2');
    await contact('A', '+919876543210');
    await contact('B', '+919876543211');
    const t = await template('Hi {{name}}, our new collection is here for you.');
    const m = await login('manager@example.com');
    const res = await m.post('/api/campaigns').send({ name: 'Big', templateId: t.id, audience: { mode: 'all' }, variables: {} });
    expect(res.status).toBe(202);
    expect(res.body.campaign.status).toBe('pending_approval');
    expect((await m.post(`/api/campaigns/${res.body.campaign.id}/approve`)).status).toBe(403);
    const a = await login('admin@example.com');
    const ok = await a.post(`/api/campaigns/${res.body.campaign.id}/approve`);
    expect(ok.body.queued).toBe(2);
    await drain();
    expect(provider.sent).toHaveLength(2);
  });

  it('lets each role manage only the logins below it', async () => {
    const owner = await login('admin@example.com');
    const appOwner = await login('appowner@example.com');
    // The store owner makes managers and staff, never another owner or an app owner.
    const mgr = await owner.post('/api/auth/users').send({ email: 'newmgr@example.com', name: 'New Manager', password: 'manager-pass-1', role: 'manager' });
    expect(mgr.status).toBe(201);
    expect((await owner.post('/api/auth/users').send({ email: 'x1@example.com', name: 'X', password: 'password-123', role: 'owner' })).status).toBe(400);
    expect((await owner.post('/api/auth/users').send({ email: 'x2@example.com', name: 'X', password: 'password-123', role: 'app_owner' })).status).toBe(400);
    const list = (await owner.get('/api/auth/users')).body;
    expect(list.assignable).toEqual(['manager', 'staff']);
    expect(list.users.find((u) => u.email === 'appowner@example.com').canManage).toBe(false);
    expect(list.users.find((u) => u.email === 'newmgr@example.com').canManage).toBe(true);
    // ...and cannot touch the app owner's login or its own.
    const appId = list.users.find((u) => u.email === 'appowner@example.com').id;
    expect((await owner.patch('/api/auth/users/' + appId).send({ password: 'new-password-9' })).status).toBe(403);
    expect((await owner.delete('/api/auth/users/' + appId)).status).toBe(403);
    // Changing a login's email and role works below your own role.
    expect((await owner.patch('/api/auth/users/' + mgr.body.user.id).send({ email: 'renamed.mgr@example.com', role: 'staff' })).status).toBe(200);
    expect((await owner.get('/api/auth/users')).body.users.find((u) => u.id === mgr.body.user.id)).toMatchObject({ email: 'renamed.mgr@example.com', role: 'staff' });
    // The app owner can also make store owners.
    const created = await appOwner.post('/api/auth/users').send({ email: 'second.owner@example.com', name: 'Second owner', password: 'owner-pass-12', role: 'owner' });
    expect(created.status).toBe(201);
    expect((await appOwner.get('/api/auth/users')).body.assignable).toEqual(['owner', 'manager', 'staff']);
    // Managers cannot manage logins at all.
    const m = await login('manager@example.com');
    expect((await m.get('/api/auth/users')).status).toBe(403);
  });
});

describe('Phase 5: more ways to add customers', () => {
  it('reads phone contacts (.vcf)', () => {
    const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Priya Sharma\r\nTEL;TYPE=HOME:040 2345 6789\r\nTEL;TYPE=CELL:+91 98765 43210\r\nBDAY:1992-02-14\r\nEND:VCARD\r\nBEGIN:VCARD\r\nN:Kumar;Ravi;;;\r\nTEL:9123456789\r\nEND:VCARD\r\n';
    expect(parseVcard(vcf)).toEqual([['Name', 'Phone', 'Birthday'], ['Priya Sharma', '+91 98765 43210', '1992-02-14'], ['Ravi Kumar', '9123456789', '']]);
    const { rows } = buildPreview(parseFile(Buffer.from(vcf), 'contacts.vcf'));
    expect(rows.map((r) => [r.name, r.phone, r.birthday])).toEqual([['Priya Sharma', '+919876543210', '1992-02-14'], ['Ravi Kumar', '+919123456789', null]]);
  });

  it('accepts only real Google Sheets links', () => {
    expect(sheetsCsvUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=42'))
      .toBe('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=csv&gid=42');
    expect(() => sheetsCsvUrl('https://evil.example.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')).toThrow(/Google Sheets link/);
    expect(() => sheetsCsvUrl('http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')).toThrow();
  });
});
