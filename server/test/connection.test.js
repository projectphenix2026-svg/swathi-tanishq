import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { assertConfig } from '../src/config.js';
import { initDb, closeDb, ensureClient, query } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';
import { getProvider } from '../src/providers/index.js';
import { seal, open } from '../src/lib/secretbox.js';
import { resetConnectionCache } from '../src/lib/whatsapp-connection.js';
import { syncWaitingTemplates } from '../src/lib/template-approval.js';
import { drain } from '../src/lib/dispatch.js';
import '../src/lib/sender.js';

const realFetch = globalThis.fetch;
let owner;
let manager;

// Fake Meta Graph API: answers like Meta for good details, or with an error.
function fakeMeta({ fail, refuseTemplates, notRegistered, numberStatus } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (fail) return json(401, { error: { code: 190, message: 'Session has expired' } });
    if (String(url).endsWith('/media-photo-1')) return json(200, { url: 'https://lookaside.fbsbx.com/photo-1', mime_type: 'image/jpeg' });
    if (String(url) === 'https://lookaside.fbsbx.com/photo-1') {
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([255, 216, 255]).buffer };
    }
    if (String(url).includes('/subscribed_apps')) return json(200, { success: true });
    if (String(url).endsWith('/555000111/messages')) {
      if (notRegistered?.on) return json(400, { error: { code: 133010, message: '(#133010) Account not registered' } });
      return json(200, { messages: [{ id: 'wamid.TEST1' }] });
    }
    if (refuseTemplates && String(url).endsWith('/message_templates') && init.method === 'POST') {
      return json(400, { error: { code: 100, message: 'Invalid parameter', error_user_msg: 'The video header sample could not be read.' } });
    }
    if (String(url).includes('message_templates?name=photo_tpl')) {
      return json(200, { data: [{ name: 'photo_tpl', language: 'en', status: 'APPROVED', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi' }] }] });
    }
    if (String(url).includes('debug_token')) return json(200, { data: { is_valid: true, expires_at: 0 } });
    if (String(url).includes('/555000111?fields=status')) return json(200, numberStatus || { status: 'PENDING', platform_type: 'NOT_APPLICABLE' });
    if (String(url).includes('/555000111')) return json(200, { display_phone_number: '+91 90000 33333', verified_name: 'Swathi Tanishq', quality_rating: 'GREEN', code_verification_status: 'VERIFIED', messaging_limit_tier: 'TIER_2K' });
    if (String(url).includes('/777000222')) return json(200, { name: 'Swathi Tanishq', account_review_status: 'APPROVED' });
    return json(404, { error: { code: 100, message: 'Unsupported get request' } });
  };
  return calls;
}

beforeAll(async () => {
  assertConfig();
  await initDb({ memory: true });
  const clientId = await ensureClient('Test Store');
  await createUser({ clientId, email: 'owner@example.com', password: 'owner-password-1', name: 'Owner' });
  await createUser({ clientId, email: 'manager@example.com', password: 'manager-password-1', name: 'Manager', role: 'manager' });
  owner = request.agent(createApp());
  manager = request.agent(createApp());
  await owner.post('/api/auth/login').send({ email: 'owner@example.com', password: 'owner-password-1' });
  await manager.post('/api/auth/login').send({ email: 'manager@example.com', password: 'manager-password-1' });
  resetConnectionCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => closeDb());

describe('secretbox', () => {
  it('seals and opens text, and refuses anything tampered with', async () => {
    const sealed = await seal('EAAG-secret-key-1234');
    expect(sealed).not.toContain('secret');
    expect(await open(sealed)).toBe('EAAG-secret-key-1234');
    const [iv, data] = sealed.split('.');
    expect(await open(`${iv}.${data.slice(0, -4)}AAAA`)).toBeNull();
    expect(await open(null)).toBeNull();
  });
});

describe('Connect WhatsApp (owner only)', () => {
  it('is only for the owner', async () => {
    expect((await manager.get('/api/whatsapp')).status).toBe(403);
    expect((await manager.post('/api/whatsapp/connect').send({})).status).toBe(403);
  });

  it('explains a bad key in plain words and saves nothing', async () => {
    fakeMeta({ fail: true });
    const res = await owner.post('/api/whatsapp/connect').send({ phoneNumberId: '555000111', wabaId: '777000222', token: 'EAAG-old' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/);
    expect((await owner.get('/api/whatsapp')).body.connected).toBe(false);
  });

  it('checks the details with Meta, stores the key encrypted and never shows it again', async () => {
    const calls = fakeMeta();
    const res = await owner.post('/api/whatsapp/connect').send({ phoneNumberId: '555 000 111', wabaId: '777000222', token: 'EAAG-permanent-key-9876', appSecret: 'app-secret' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, live: false, phone: '+91 90000 33333', name: 'Swathi Tanishq', tokenHint: '…9876', hasAppSecret: true, dailyLimit: 2000, limitTier: 'TIER_2K' });
    expect(res.body.webhookUrl).toMatch(/\/webhooks\/meta$/);
    expect(res.body.verifyToken).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(res.body)).not.toContain('EAAG-permanent');
    expect(calls.some((c) => c.url.includes('/777000222/subscribed_apps') && c.method === 'POST')).toBe(true);
    // Saving again without a key keeps the saved one.
    fakeMeta();
    const again = await owner.post('/api/whatsapp/connect').send({ phoneNumberId: '555000111', wabaId: '777000222' });
    expect(again.body.tokenHint).toBe('…9876');
  });

  it('answers Meta’s webhook check with the saved verify token', async () => {
    const { verifyToken } = (await owner.get('/api/whatsapp')).body;
    const ok = await request(createApp()).get('/webhooks/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': '42' });
    expect(ok.text).toBe('42');
    const bad = await request(createApp()).get('/webhooks/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' });
    expect(bad.status).toBe(403);
  });

  it('switches real sending on and off; going live removes the sample customers', async () => {
    expect(getProvider().name).toBe('mock');
    expect((await owner.post('/api/customers/samples')).body.samples).toBe(5);
    expect((await owner.get('/api/customers?q=Priya')).body.customers[0].tags).toContain('sample');
    expect((await owner.get('/api/whatsapp')).body.ready).toMatchObject({ testSentAt: null });
    const on = await owner.post('/api/whatsapp/live').send({ live: true });
    expect(on.body).toMatchObject({ live: true, removedSamples: 5 });
    expect((await owner.get('/api/customers/samples')).body.samples).toBe(0);
    expect((await owner.post('/api/customers/samples')).status).toBe(400);
    expect(getProvider().name).toBe('meta');
    const settings = await owner.get('/api/dashboard/settings');
    expect(settings.body.provider.name).toBe('meta');
    await owner.post('/api/whatsapp/live').send({ live: false });
    expect(getProvider().name).toBe('mock');
  });

  it('sends “Send a test to my phone” through the connected WhatsApp while still in Test mode', async () => {
    const clientId = await ensureClient('Test Store');
    const { rows: [t] } = await query(
      `INSERT INTO templates (client_id, name, body, status, category, provider_ref, provider_status)
       VALUES ($1, 'Hello', 'Hello from the shop', 'approved', 'utility', 'hello_world', 'APPROVED') RETURNING *`,
      [clientId],
    );
    const calls = fakeMeta();
    resetConnectionCache(); // rebuilt with this fake Meta
    expect(getProvider().name).toBe('mock');
    const res = await owner.post('/api/campaigns/test').send({ templateId: t.id, phone: '90000 44444' });
    expect(res.status).toBe(201);
    expect(res.body.campaign.provider).toBe('meta');
    await drain();
    expect(calls.some((c) => c.url.endsWith('/555000111/messages') && c.method === 'POST')).toBe(true);
    const { rows: [m] } = await query('SELECT status, provider, provider_message_id FROM messages WHERE campaign_id = $1', [res.body.campaign.id]);
    expect(m).toMatchObject({ status: 'sent', provider: 'meta', provider_message_id: 'wamid.TEST1' });
    expect((await owner.get('/api/whatsapp')).body.ready.testSentAt).toBeTruthy();
    // Normal sends stay pretend until Go live.
    expect(getProvider().name).toBe('mock');
  });

  it('refuses a test with a template changed after Meta approved it (photo added)', async () => {
    const clientId = await ensureClient('Test Store');
    const { rows: [t] } = await query(
      `INSERT INTO templates (client_id, name, body, status, category, provider_ref, provider_status, image_url)
       VALUES ($1, 'Changed', 'Hello again', 'approved', 'marketing', 'changed', NULL, 'https://x/p.jpg') RETURNING *`,
      [clientId],
    );
    fakeMeta();
    resetConnectionCache();
    const res = await owner.post('/api/campaigns/test').send({ templateId: t.id, phone: '90000 44444' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/changed after Meta approved/);
  });

  it('keeps sending the approved version while a changed one waits for Meta; undo makes it approved again', async () => {
    const clientId = await ensureClient('Test Store');
    const { rows: [t] } = await query(
      `INSERT INTO templates (client_id, name, body, status, category, provider_ref, provider_status, buttons)
       VALUES ($1, 'Kept', 'Old approved words', 'approved', 'utility', 'kept', 'APPROVED', '[]') RETURNING *`,
      [clientId],
    );
    const calls = fakeMeta();
    resetConnectionCache();
    const edited = await owner.put(`/api/templates/${t.id}`).send({ ...t, buttons: [], body: 'New words, not approved yet' });
    expect(edited.body.template.provider_status).toBeNull();
    expect(edited.body.template.approved_version).toMatchObject({ provider_ref: 'kept', body: 'Old approved words' });

    const res = await owner.post('/api/campaigns/test').send({ templateId: t.id, phone: '90000 44444' });
    expect(res.status).toBe(201);
    await drain();
    const sent = calls.filter((c) => c.url.endsWith('/555000111/messages') && c.method === 'POST').pop();
    expect(JSON.parse(sent.body).template.name).toBe('kept');

    const undone = await owner.put(`/api/templates/${t.id}`).send({ ...t, buttons: [], body: 'Old approved words' });
    expect(undone.body.template).toMatchObject({ provider_ref: 'kept', provider_status: 'APPROVED' });
  });

  it('shows a photo a customer sent: fetched from Meta once, then kept', async () => {
    const clientId = await ensureClient('Test Store');
    const { recordInbound } = await import('../src/lib/messages.js');
    const r = await recordInbound(clientId, { providerMessageId: 'wamid.PHOTO1', from: '+919000066666', body: '', media: { type: 'image', ref: 'media-photo-1', mime: 'image/jpeg' }, provider: 'meta' });
    const calls = fakeMeta();
    resetConnectionCache();
    await owner.get('/api/whatsapp'); // loads the saved connection
    const thread = await owner.get(`/api/inbox/${r.contactId}`);
    expect(thread.body.messages[0]).toMatchObject({ media_type: 'image' });
    expect(thread.body.messages[0].has_file).toBeTruthy();
    const first = await owner.get(`/api/inbox/media/${r.messageId}`).buffer(true);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toMatch(/image\/jpeg/);
    expect([...first.body]).toEqual([255, 216, 255]);
    const before = calls.length;
    expect((await owner.get(`/api/inbox/media/${r.messageId}`)).status).toBe(200);
    expect(calls.length).toBe(before); // kept: not fetched from Meta again
    expect((await request(createApp()).get(`/api/inbox/media/${r.messageId}`)).status).toBe(401); // staff only
  });

  it('pauses WhatsApp sending when Meta says the number is not registered (#133010), and resumes', async () => {
    const clientId = await ensureClient('Test Store');
    const { rows: [t] } = await query(
      `INSERT INTO templates (client_id, name, body, status, category, provider_ref, provider_status)
       VALUES ($1, 'Paused', 'Hello from the shop', 'approved', 'utility', 'paused_t', 'APPROVED') RETURNING *`,
      [clientId],
    );
    const notRegistered = { on: true };
    const calls = fakeMeta({ notRegistered });
    resetConnectionCache();
    const res = await owner.post('/api/campaigns/test').send({ templateId: t.id, phone: '90000 46464' });
    expect(res.status).toBe(201);
    await drain();
    const { rows: [m] } = await query('SELECT id, status, error_code FROM messages WHERE campaign_id = $1', [res.body.campaign.id]);
    expect(m).toMatchObject({ status: 'queued', error_code: '133010' }); // waiting, not lost
    const paused = (await owner.get('/api/dashboard/sending')).body.paused;
    expect(paused).toMatchObject({ code: '133010' });
    const sendsBefore = calls.filter((c) => c.url.endsWith('/555000111/messages')).length;
    await drain(); // paused: nothing is tried
    expect(calls.filter((c) => c.url.endsWith('/555000111/messages')).length).toBe(sendsBefore);
    const blocked = await owner.post('/api/campaigns/test').send({ templateId: t.id, phone: '90000 46464' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/disconnected from Meta/);

    notRegistered.on = false; // the shop reconnected the number
    expect((await owner.post('/api/whatsapp/resume')).status).toBe(200);
    expect((await owner.get('/api/dashboard/sending')).body.paused).toBeNull();
    await drain();
    expect((await query('SELECT status FROM messages WHERE id = $1', [m.id])).rows[0].status).toBe('sent');
  });

  it('after Meta’s WhatsApp Business app pop-up: re-subscribes, and resumes once Meta says connected', async () => {
    const setup = (await owner.get('/api/whatsapp/signup')).body;
    expect(setup).toMatchObject({ phoneNumberId: '555000111', wabaId: '777000222' });
    expect((await manager.get('/api/whatsapp/signup')).status).toBe(403);

    const clientId = await ensureClient('Test Store');
    const { rows: [c] } = await query(`INSERT INTO contacts (client_id, name, phone, whatsapp_opt_in) VALUES ($1, 'Waiting', '+919000077777', 1) RETURNING id`, [clientId]);
    const { rows: [m] } = await query(
      `INSERT INTO messages (client_id, contact_id, direction, channel, provider, status, body, error_code, idempotency_key)
       VALUES ($1, $2, 'outbound', 'whatsapp', 'meta', 'failed', 'Hi', '133010', 'coex-wait-1') RETURNING id`, [clientId, c.id]);
    await query(`UPDATE whatsapp_connection SET disconnected_at = '2026-10-27T15:16:56.678Z', disconnect_code = '133010'`);

    // A different number from the saved one: nothing changes.
    fakeMeta();
    const other = await owner.post('/api/whatsapp/business-app').send({ phoneNumberId: '999', wabaId: '777000222' });
    expect(other.status).toBe(409);

    // Meta has not switched the number on yet: stays paused, the message keeps waiting.
    let calls = fakeMeta();
    let r = await owner.post('/api/whatsapp/business-app').send({ phoneNumberId: '555000111', wabaId: '777000222' });
    expect(r.body).toMatchObject({ subscribed: true, connected: false, requeued: 0 });
    expect(calls.some((x) => x.url.includes('/777000222/subscribed_apps') && x.method === 'POST')).toBe(true);
    expect((await owner.get('/api/dashboard/sending')).body.paused).toMatchObject({ code: '133010' });

    // Connected (a number on both the app and the API reports CLOUD_API): sending carries on.
    calls = fakeMeta({ numberStatus: { status: 'CONNECTED', platform_type: 'CLOUD_API' } });
    r = await owner.post('/api/whatsapp/business-app').send({ phoneNumberId: '555000111', wabaId: '777000222' });
    expect(r.body).toMatchObject({ connected: true, requeued: 1 });
    expect((await owner.get('/api/dashboard/sending')).body.paused).toBeNull();
    expect((await query('SELECT status FROM messages WHERE id = $1', [m.id])).rows[0].status).toBe('queued');
  });

  it('sends a reply to someone who wrote in on the real WhatsApp for real, even in Test mode', async () => {
    const clientId = await ensureClient('Test Store');
    const { rows: [c] } = await query(
      `INSERT INTO contacts (client_id, name, phone, whatsapp_opt_in) VALUES ($1, 'Real Chat', '+919000055555', 1) RETURNING *`, [clientId]);
    await query(
      `INSERT INTO messages (client_id, contact_id, direction, provider, status, body, idempotency_key) VALUES ($1, $2, 'inbound', 'meta', 'received', 'Hi', 'in:test-real-1')`,
      [clientId, c.id]);
    const calls = fakeMeta();
    resetConnectionCache();
    expect(getProvider().name).toBe('mock');
    const res = await owner.post(`/api/inbox/${c.id}/reply`).send({ body: 'Thank you!' });
    expect(res.status).toBeLessThan(300);
    await drain();
    expect(calls.some((x) => x.url.endsWith('/555000111/messages') && x.method === 'POST')).toBe(true);
    const { rows: [m] } = await query(`SELECT provider, status FROM messages WHERE contact_id = $1 AND direction = 'outbound'`, [c.id]);
    expect(m).toMatchObject({ provider: 'meta', status: 'sent' });
  });

  it('shows Meta’s own reason when a template is refused (not “something went wrong”)', async () => {
    const clientId = await ensureClient('Test Store');
    const { rows: [t] } = await query(
      `INSERT INTO templates (client_id, name, body, status, category) VALUES ($1, 'Refused one', 'Hello there', 'approved', 'marketing') RETURNING *`, [clientId]);
    fakeMeta({ refuseTemplates: true });
    resetConnectionCache();
    const res = await owner.post(`/api/templates/${t.id}/submit-meta`);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Meta said: The video header sample could not be read.');
  });

  it('Check status notices when Meta approved a photo version but the template now has a video', async () => {
    const clientId = await ensureClient('Test Store');
    const { rows: [t] } = await query(
      `INSERT INTO templates (client_id, name, body, status, category, provider_ref, provider_status, video_url)
       VALUES ($1, 'Photo tpl', 'Hi there', 'approved', 'marketing', 'photo_tpl', NULL, 'https://x/v.mp4') RETURNING *`, [clientId]);
    fakeMeta();
    resetConnectionCache();
    const res = await owner.post(`/api/templates/${t.id}/sync-meta`);
    expect(res.status).toBe(200);
    expect(res.body.mismatch).toBe(true);
    expect(res.body.template.provider_status).toBeNull();
    expect(res.body.template.provider_reason).toMatch(/with a photo, but it now has a video/);
  });

  it('updates templates waiting for Meta by itself (no Check status needed)', async () => {
    const clientId = await ensureClient('Test Store');
    const { rows: [t] } = await query(
      `INSERT INTO templates (client_id, name, body, status, category, provider_ref, provider_status, image_url)
       VALUES ($1, 'Waiting photo', 'Hi there', 'approved', 'marketing', 'photo_tpl', 'PENDING', 'https://x/p.jpg') RETURNING *`, [clientId]);
    fakeMeta();
    resetConnectionCache();
    await owner.get('/api/whatsapp'); // loads the saved connection
    expect(await syncWaitingTemplates()).toBeGreaterThan(0);
    const { rows: [u] } = await query('SELECT provider_status FROM templates WHERE id = $1', [t.id]);
    expect(u.provider_status).toBe('APPROVED');
  });

  it('takes Meta’s template review from the webhook at once', async () => {
    const clientId = await ensureClient('Test Store');
    const { rows: [t] } = await query(
      `INSERT INTO templates (client_id, name, body, status, category, provider_ref, provider_status)
       VALUES ($1, 'Hooked', 'Hi there', 'approved', 'marketing', 'hooked_tpl', 'PENDING') RETURNING *`, [clientId]);
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'message_template_status_update', value: { event: 'REJECTED', message_template_name: 'hooked_tpl', message_template_language: 'en', reason: 'INVALID_FORMAT' } }] }],
    });
    // Signed like Meta does, with the app secret saved when connecting.
    const { createHmac } = await import('node:crypto');
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
    const res = await request(createApp()).post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body);
    expect(res.status).toBeLessThan(400);
    const { rows: [u] } = await query('SELECT provider_status, provider_reason FROM templates WHERE id = $1', [t.id]);
    expect(u).toMatchObject({ provider_status: 'REJECTED', provider_reason: 'INVALID_FORMAT' });
  });

  it('disconnects and goes back to test mode', async () => {
    await owner.post('/api/whatsapp/live').send({ live: true });
    const res = await owner.delete('/api/whatsapp');
    expect(res.body.connected).toBe(false);
    expect(getProvider().name).toBe('mock');
  });
});
