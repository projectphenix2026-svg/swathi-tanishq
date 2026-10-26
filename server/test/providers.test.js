import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createTwilioProvider, withButtons } from '../src/providers/twilio.js';
import { createMetaProvider, readInbound } from '../src/providers/meta.js';
import { createMockProvider } from '../src/providers/mock.js';

const cfg = { accountSid: 'ACtest', authToken: 'test-token', whatsappFrom: '+17372508034' };

function fakeFetch(status, json) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}

function fakeReq({ url, body, headers = {}, rawBody }) {
  return { originalUrl: url, body, rawBody, get: (h) => headers[h] ?? headers[h.toLowerCase()] };
}

describe('Twilio adapter', () => {
  it('posts a WhatsApp message with buttons as text lines and a status callback', async () => {
    const fetchImpl = fakeFetch(201, { sid: 'SM123', status: 'queued' });
    const p = createTwilioProvider(cfg, { publicBaseUrl: 'https://api.example.com', fetchImpl });
    const r = await p.send({ to: '+919876543210', body: 'Hi Priya', buttons: [{ type: 'url', text: 'See designs', url: 'https://x.com' }] });
    expect(r).toEqual({ providerMessageId: 'SM123', status: 'sent' });
    const form = new URLSearchParams(fetchImpl.calls[0].init.body);
    expect(form.get('To')).toBe('whatsapp:+919876543210');
    expect(form.get('From')).toBe('whatsapp:+17372508034');
    expect(form.get('Body')).toBe('Hi Priya\n\nSee designs: https://x.com');
    expect(form.get('StatusCallback')).toBe('https://api.example.com/webhooks/twilio');
  });

  it('sends a Content template with placeholders as numbered variables', async () => {
    const fetchImpl = fakeFetch(201, { sid: 'SM9', status: 'queued' });
    const p = createTwilioProvider(cfg, { fetchImpl });
    const template = { body: 'Hi {{name}}, {{offer}} till {{offer_ends}}.', provider_ref: 'HX' + 'a'.repeat(32) };
    await p.send({ to: '+919876543210', body: 'ignored', template, values: { name: 'Priya', offer: '20% off', offer_ends: '31 Oct' } });
    const form = new URLSearchParams(fetchImpl.calls[0].init.body);
    expect(form.get('ContentSid')).toBe(template.provider_ref);
    expect(JSON.parse(form.get('ContentVariables'))).toEqual({ 1: 'Priya', 2: '20% off', 3: '31 Oct' });
    expect(form.get('Body')).toBeNull();
  });

  it('turns errors into plain reasons and marks only temporary ones for retry', async () => {
    const perm = createTwilioProvider(cfg, { fetchImpl: fakeFetch(400, { code: 21211, message: 'Invalid To' }) });
    await expect(perm.send({ to: '+91', body: 'x' })).rejects.toMatchObject({ retryable: false, message: 'The phone number is not valid.' });
    const temp = createTwilioProvider(cfg, { fetchImpl: fakeFetch(503, {}) });
    await expect(temp.send({ to: '+919876543210', body: 'x' })).rejects.toMatchObject({ retryable: true });
  });

  it('accepts only correctly signed webhooks', () => {
    const p = createTwilioProvider(cfg, { publicBaseUrl: 'https://api.example.com' });
    const body = { MessageSid: 'SM1', MessageStatus: 'delivered' };
    // Twilio signs the full URL followed by each parameter name+value, sorted by name.
    const signed = 'https://api.example.com/webhooks/twilio' + 'MessageSidSM1' + 'MessageStatusdelivered';
    const sig = crypto.createHmac('sha1', 'test-token').update(signed).digest('base64');
    expect(p.verifyWebhook(fakeReq({ url: '/webhooks/twilio', body, headers: { 'X-Twilio-Signature': sig } }))).toBe(true);
    expect(p.verifyWebhook(fakeReq({ url: '/webhooks/twilio', body, headers: { 'X-Twilio-Signature': 'forged' } }))).toBe(false);
  });

  it('reads status callbacks and incoming messages', () => {
    const p = createTwilioProvider(cfg, {});
    expect(p.parseWebhook({ body: { MessageSid: 'SM1', MessageStatus: 'undelivered', ErrorCode: '63015' } }).statuses[0]).toMatchObject({
      status: 'failed',
      errorCode: '63015',
      errorMessage: expect.stringMatching(/joined the Twilio sandbox/),
    });
    expect(p.parseWebhook({ body: { MessageSid: 'SM2', SmsStatus: 'received', From: 'whatsapp:+919876543210', Body: 'Hi' } }).inbound[0]).toMatchObject({
      from: '+919876543210',
      body: 'Hi',
    });
  });

  it('writes each button type as a readable line', () => {
    expect(withButtons('Hi', [{ type: 'phone', text: 'Call us', phone: '+919999900000' }, { type: 'quick_reply', text: 'Interested' }])).toBe(
      'Hi\n\nCall us: +919999900000\nReply "Interested"',
    );
  });
});

describe('Meta adapter (stub)', () => {
  it('sends approved templates with placeholders in order', async () => {
    const fetchImpl = fakeFetch(200, { messages: [{ id: 'wamid.1' }] });
    const p = createMetaProvider({ accessToken: 't', phoneNumberId: '123', appSecret: 's', graphVersion: 'v21.0' }, { fetchImpl });
    const template = { body: 'Hi {{name}}, {{offer}}!', provider_ref: 'past_buyers', language: 'en' };
    await p.send({ to: '+919876543210', template, values: { name: 'Priya', offer: '10% off' } });
    const payload = JSON.parse(fetchImpl.calls[0].init.body);
    expect(payload).toMatchObject({ to: '919876543210', type: 'template', template: { name: 'past_buyers' } });
    expect(payload.template.components[0].parameters.map((x) => x.text)).toEqual(['Priya', '10% off']);
  });

  it('refuses templates Meta has not approved', async () => {
    const p = createMetaProvider({ accessToken: 't', phoneNumberId: '1', appSecret: 's', graphVersion: 'v21.0' }, { fetchImpl: fakeFetch(200, {}) });
    await expect(p.send({ to: '+91', template: { body: 'x' } })).rejects.toMatchObject({ retryable: false });
  });

  it('checks the X-Hub-Signature-256 header and parses webhook events', () => {
    const p = createMetaProvider({ appSecret: 'secret', graphVersion: 'v21.0' });
    const body = {
      entry: [{ changes: [{ value: {
        statuses: [{ id: 'wamid.1', status: 'read' }],
        contacts: [{ wa_id: '919876543210', profile: { name: 'Priya' } }],
        messages: [{ id: 'wamid.2', from: '919876543210', type: 'button', button: { text: 'Interested' } }],
      } }] }],
    };
    const raw = Buffer.from(JSON.stringify(body));
    const sig = 'sha256=' + crypto.createHmac('sha256', 'secret').update(raw).digest('hex');
    expect(p.verifyWebhook(fakeReq({ rawBody: raw, headers: { 'X-Hub-Signature-256': sig } }))).toBe(true);
    expect(p.verifyWebhook(fakeReq({ rawBody: raw, headers: { 'X-Hub-Signature-256': 'sha256=bad' } }))).toBe(false);
    const parsed = p.parseWebhook({ body });
    expect(parsed.statuses[0]).toMatchObject({ providerMessageId: 'wamid.1', status: 'read' });
    expect(parsed.inbound[0]).toMatchObject({ from: '+919876543210', body: 'Interested', profileName: 'Priya' });
  });

  it('reads photos, voice notes, documents, locations and unsupported messages', () => {
    expect(readInbound({ type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'This design?' } }))
      .toEqual({ body: 'This design?', media: { type: 'image', ref: 'm1', mime: 'image/jpeg', name: null } });
    expect(readInbound({ type: 'audio', audio: { id: 'm2', mime_type: 'audio/ogg' } }).media).toMatchObject({ type: 'audio', ref: 'm2' });
    expect(readInbound({ type: 'document', document: { id: 'm3', filename: 'bill.pdf' } }).media).toMatchObject({ type: 'document', name: 'bill.pdf' });
    expect(readInbound({ type: 'location', location: { latitude: 17.97, longitude: 79.59, name: 'Hanamkonda' } }).body)
      .toBe('Location: Hanamkonda\nhttps://maps.google.com/?q=17.97,79.59');
    expect(readInbound({ type: 'unsupported', errors: [{ code: 131051 }] })).toEqual({ body: '', media: { type: 'unsupported', ref: null, mime: null, name: null } });
    expect(readInbound({ type: 'text', text: { body: 'Hi' } })).toEqual({ body: 'Hi', media: null });
  });
});

describe('Test mode provider', () => {
  it('moves sent -> delivered -> read even when a fresh copy answers (as on Cloudflare)', async () => {
    const { providerMessageId: id } = await createMockProvider().send({ to: '+919876543210', body: 'Hi' });
    const fresh = () => createMockProvider({ deliverAfterMs: 0, readAfterMs: 60_000 });
    expect((await fresh().fetchStatus(id)).status).toBe('delivered');
    expect((await createMockProvider({ deliverAfterMs: 0, readAfterMs: 0 }).fetchStatus(id)).status).toBe('read');
    expect(await createMockProvider().fetchStatus('SMother')).toBeNull();
  });
});
