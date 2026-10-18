import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { assertConfig } from '../src/config.js';
import { initDb, closeDb, ensureClient } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';
import { setProvider } from '../src/providers/index.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createMetaProvider } from '../src/providers/meta.js';
import { drain } from '../src/lib/dispatch.js';
import '../src/lib/sender.js';

// A 1x1 white JPEG.
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

let owner;
let provider;
let photoUrl;

beforeAll(async () => {
  assertConfig();
  await initDb({ memory: true });
  const clientId = await ensureClient('Test Store');
  await createUser({ clientId, email: 'owner@example.com', password: 'owner-password-1', name: 'Owner' });
  provider = createMockProvider();
  setProvider(provider);
  owner = request.agent(createApp());
  await owner.post('/api/auth/login').send({ email: 'owner@example.com', password: 'owner-password-1' });
  await owner.post('/api/customers').send({ city: 'Hyderabad', name: 'Priya', phone: '90000 70001', whatsapp_opt_in: true });
});
afterAll(() => closeDb());

describe('Offer photos', () => {
  it('stores a photo and serves it publicly from an unguessable link', async () => {
    const res = await owner.post('/api/media').send({ dataUrl: JPEG });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/\/media\/[0-9a-f]{32}$/);
    photoUrl = res.body.url;
    const got = await request(createApp()).get(`/media/${res.body.id}`);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect((await request(createApp()).get('/media/0123456789abcdef0123456789abcdef')).status).toBe(404);
    expect((await owner.post('/api/media').send({ dataUrl: 'data:text/html;base64,PGh0bWw+' })).status).toBe(400);
  });

  it('sends the offer’s own photo instead of the saved one', async () => {
    const t = (await owner.post('/api/templates').send({ name: 'Photo offer', body: 'Hi {{name}}, see our new designs this week.', image_url: 'https://example.com/saved.jpg' })).body.template;
    const c = await owner.post('/api/campaigns').send({ name: 'P', templateId: t.id, audience: { mode: 'all' }, variables: { image_url: photoUrl }, expectedCount: 1 });
    expect(c.status).toBe(201);
    await drain();
    expect(provider.outbox.at(-1).imageUrl).toBe(photoUrl);
  });
});

describe('Meta approval with a photo', () => {
  it('uploads the sample photo and asks for a photo header', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const json = (body) => ({ ok: true, status: 200, json: async () => body });
      if (String(url).includes('debug_token')) return json({ data: { app_id: '999' } });
      if (String(url).includes('/999/uploads')) return json({ id: 'upload:abc' });
      if (String(url).endsWith('/upload:abc')) return json({ h: 'HANDLE-1' });
      if (String(url).includes('/message_templates')) return json({ id: 't1', status: 'PENDING' });
      return json({});
    };
    const meta = createMetaProvider({ accessToken: 'EAA-x', phoneNumberId: '1', wabaId: '2', graphVersion: 'v25.0' }, { fetchImpl });
    const r = await meta.submitTemplate({ name: 'Photo offer', body: 'Hi {{name}}, see our new designs.', image_url: photoUrl, buttons: [] }, { name: 'Priya' }, { sample: { mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) } });
    expect(r.status).toBe('PENDING');
    const submit = JSON.parse(calls.find((c) => c.url.includes('/message_templates')).init.body);
    expect(submit.components[0]).toEqual({ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['HANDLE-1'] } });
    expect(calls.find((c) => c.url.endsWith('/upload:abc')).init.headers.file_offset).toBe('0');
  });

  it('sends the photo as the header when the message has one', async () => {
    let sent;
    const meta = createMetaProvider({ accessToken: 'x', phoneNumberId: '1', graphVersion: 'v25.0' }, {
      fetchImpl: async (url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }; },
    });
    await meta.send({ to: '+919000070001', template: { provider_ref: 'photo_offer', body: 'Hi {{name}}.', image_url: 'https://x/saved.jpg' }, values: { name: 'Priya' }, imageUrl: 'https://x/offer.jpg' });
    expect(sent.template.components[0]).toEqual({ type: 'header', parameters: [{ type: 'image', image: { link: 'https://x/offer.jpg' } }] });
  });
});
