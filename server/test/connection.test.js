import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { assertConfig } from '../src/config.js';
import { initDb, closeDb, ensureClient } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';
import { getProvider } from '../src/providers/index.js';
import { seal, open } from '../src/lib/secretbox.js';
import { resetConnectionCache } from '../src/lib/whatsapp-connection.js';

const realFetch = globalThis.fetch;
let owner;
let manager;

// Fake Meta Graph API: answers like Meta for good details, or with an error.
function fakeMeta({ fail } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (fail) return json(401, { error: { code: 190, message: 'Session has expired' } });
    if (String(url).includes('/subscribed_apps')) return json(200, { success: true });
    if (String(url).includes('debug_token')) return json(200, { data: { is_valid: true, expires_at: 0 } });
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

  it('switches real sending on and off', async () => {
    expect(getProvider().name).toBe('mock');
    const on = await owner.post('/api/whatsapp/live').send({ live: true });
    expect(on.body.live).toBe(true);
    expect(getProvider().name).toBe('meta');
    const settings = await owner.get('/api/dashboard/settings');
    expect(settings.body.provider.name).toBe('meta');
    await owner.post('/api/whatsapp/live').send({ live: false });
    expect(getProvider().name).toBe('mock');
  });

  it('disconnects and goes back to test mode', async () => {
    await owner.post('/api/whatsapp/live').send({ live: true });
    const res = await owner.delete('/api/whatsapp');
    expect(res.body.connected).toBe(false);
    expect(getProvider().name).toBe('mock');
  });
});
