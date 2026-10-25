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
    const submit = JSON.parse(calls.find((c) => c.url.includes('/message_templates') && c.init.method === 'POST').init.body);
    expect(submit.components[0]).toEqual({ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['HANDLE-1'] } });
    expect(calls.find((c) => c.url.endsWith('/upload:abc')).init.headers.file_offset).toBe('0');
  });

  it('“Submit again” edits Meta’s existing template (same name) instead of making a new one', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const json = (body) => ({ ok: true, status: 200, json: async () => body });
      if (String(url).includes('debug_token')) return json({ data: { app_id: '999' } });
      if (String(url).includes('/999/uploads')) return json({ id: 'upload:abc' });
      if (String(url).endsWith('/upload:abc')) return json({ h: 'HANDLE-1' });
      if (String(url).includes('/message_templates?name=')) return json({ data: [{ id: 'tpl-77', name: 'dhanteras', language: 'en', status: 'APPROVED' }] });
      if (String(url).endsWith('/tpl-77')) return json({ success: true });
      return json({});
    };
    const meta = createMetaProvider({ accessToken: 'EAA-x', phoneNumberId: '1', wabaId: '2', graphVersion: 'v25.0' }, { fetchImpl });
    const r = await meta.submitTemplate({ name: 'Dhanteras', body: 'Hi {{name}}.', image_url: photoUrl, buttons: [], language: 'en' }, { name: 'Priya' }, { sample: { mime: 'image/jpeg', bytes: new Uint8Array([1]) } });
    expect(r).toMatchObject({ name: 'dhanteras', status: 'PENDING', id: 'tpl-77' });
    const edit = calls.find((c) => c.url.endsWith('/tpl-77'));
    expect(JSON.parse(edit.init.body).components[0].format).toBe('IMAGE');
    expect(calls.some((c) => c.url.endsWith('/2/message_templates') && c.init.method === 'POST')).toBe(false);
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

describe('Offer videos', () => {
  // A few bytes are enough: the app checks the type and size, WhatsApp plays the file.
  const MP4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]);

  it('stores an MP4 in the file store and serves it publicly', async () => {
    const res = await owner.post('/api/media/video').set('Content-Type', 'video/mp4').send(MP4);
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/\/media\/[0-9a-f]{32}$/);
    const got = await request(createApp()).get(`/media/${res.body.id}`).buffer(true).parse((r, cb) => { const b = []; r.on('data', (d) => b.push(d)); r.on('end', () => cb(null, Buffer.concat(b))); });
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('video/mp4');
    expect(Buffer.compare(got.body, MP4)).toBe(0);
  });

  it('refuses other files, empty ones and ones over 16 MB', async () => {
    expect((await owner.post('/api/media/video').set('Content-Type', 'video/quicktime').send(MP4)).status).toBe(400);
    expect((await owner.post('/api/media/video').set('Content-Type', 'video/mp4').send(Buffer.alloc(0))).status).toBe(400);
    const big = await owner.post('/api/media/video').set('Content-Type', 'video/mp4').send(Buffer.alloc(16 * 1024 * 1024 + 2048));
    expect([400, 413]).toContain(big.status);
  });

  it('a template has a photo or a video, not both; adding a video resets Meta approval', async () => {
    const both = await owner.post('/api/templates').send({ name: 'Both', body: 'Hi {{name}}, new designs.', image_url: 'https://x/a.jpg', video_url: 'https://x/a.mp4' });
    expect(both.status).toBe(400);
    expect(both.body.error).toMatch(/photo or a video/);
    const t = (await owner.post('/api/templates').send({ name: 'Video later', body: 'Hi {{name}}, new designs.' })).body.template;
    const { query } = await import('../src/db/index.js');
    await query("UPDATE templates SET provider_ref = 'video_later', provider_status = 'APPROVED' WHERE id = $1", [t.id]);
    const put = await owner.put(`/api/templates/${t.id}`).send({ ...t, video_url: 'https://x/v.mp4' });
    expect(put.body).toMatchObject({ approvalReset: true, template: { video_url: 'https://x/v.mp4', provider_status: null } });
  });

  it('asks Meta for a video header with a sample, and sends the video as the header', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const json = (body) => ({ ok: true, status: 200, json: async () => body });
      if (String(url).includes('debug_token')) return json({ data: { app_id: '999' } });
      if (String(url).includes('/999/uploads')) return json({ id: 'upload:vid' });
      if (String(url).endsWith('/upload:vid')) return json({ h: 'HANDLE-V' });
      if (String(url).includes('/message_templates?name=')) return json({ data: [] });
      if (String(url).includes('/message_templates')) return json({ id: 't9', status: 'PENDING' });
      return json({ messages: [{ id: 'wamid.v' }] });
    };
    const meta = createMetaProvider({ accessToken: 'EAA-x', phoneNumberId: '1', wabaId: '2', graphVersion: 'v25.0' }, { fetchImpl });
    await meta.submitTemplate({ name: 'Video offer', body: 'Hi {{name}}, watch our new collection.', video_url: 'https://x/v.mp4', buttons: [] }, { name: 'Priya' }, { sample: { mime: 'video/mp4', bytes: new Uint8Array([1, 2]) } });
    expect(calls.find((c) => c.url.includes('/999/uploads')).url).toMatch(/file_name=offer\.mp4.*file_type=video%2Fmp4/);
    const submit = JSON.parse(calls.find((c) => c.url.endsWith('/2/message_templates')).init.body);
    expect(submit.components[0]).toEqual({ type: 'HEADER', format: 'VIDEO', example: { header_handle: ['HANDLE-V'] } });
    await meta.send({ to: '+919000070001', template: { provider_ref: 'video_offer', body: 'Hi {{name}}.', video_url: 'https://x/v.mp4' }, values: { name: 'Priya' } });
    const sent = JSON.parse(calls.at(-1).init.body);
    expect(sent.template.components[0]).toEqual({ type: 'header', parameters: [{ type: 'video', video: { link: 'https://x/v.mp4' } }] });
  });
});

describe('A different photo or video for one offer (Meta approves the slot, not the file)', () => {
  it('never adds a photo to a template that was approved without one', async () => {
    const t = (await owner.post('/api/templates').send({ name: 'Plain offer', body: 'Hi {{name}}, our new designs are in.' })).body.template;
    const c = await owner.post('/api/campaigns').send({ name: 'Plain', templateId: t.id, audience: { mode: 'all' }, variables: { image_url: 'https://example.com/offer.jpg' }, expectedCount: 1 });
    expect(c.status).toBe(201);
    await drain();
    expect(provider.outbox.at(-1).imageUrl).toBeFalsy();
    const again = (await owner.get(`/api/templates/${t.id}`)).body.template;
    expect(again.image_url).toBeNull();
  });

  it('sends the offer’s own video in an approved video template', async () => {
    let sent;
    const meta = createMetaProvider({ accessToken: 'x', phoneNumberId: '1', graphVersion: 'v25.0' }, {
      fetchImpl: async (url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.2' }] }) }; },
    });
    await meta.send({ to: '+919000070001', template: { provider_ref: 'video_offer', body: 'Hi {{name}}.', video_url: 'https://x/saved.mp4' }, values: { name: 'Priya' }, videoUrl: 'https://x/this-week.mp4' });
    expect(sent.template.components[0].parameters[0].video.link).toBe('https://x/this-week.mp4');
  });
});
