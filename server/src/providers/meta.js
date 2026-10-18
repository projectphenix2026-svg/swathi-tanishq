// Meta WhatsApp Cloud API adapter: STUB.
// The request and webhook shapes follow Meta's documentation, but this has not
// been run against a live Meta account yet (the Meta app setup is pending).
// Switching to it later is a config change: MESSAGING_PROVIDER=meta plus the META_* variables.
import crypto from 'node:crypto';
import { extractVariables } from '../lib/template.js';
import { ProviderError, isRetryableHttp, friendlyError } from './errors.js';

export function createMetaProvider(cfg, { fetchImpl = fetch } = {}) {
  const { accessToken, phoneNumberId, appSecret, graphVersion, wabaId } = cfg;
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;

  async function post(payload) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new ProviderError(`Could not reach Meta: ${err.message}`, { retryable: true });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data.error || {};
      throw new ProviderError(friendlyError(e.code, e.message), {
        code: e.code,
        status: res.status,
        retryable: isRetryableHttp(res.status) || e.code === 130429,
      });
    }
    return { providerMessageId: data.messages?.[0]?.id, status: 'sent' };
  }

  /** Meta's resumable upload: sample photo bytes -> a header handle for template approval. */
  async function uploadSample({ bytes, mime }) {
    const dbg = await fetchImpl(`https://graph.facebook.com/${graphVersion}/debug_token?input_token=${encodeURIComponent(accessToken)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((r) => r.json()).catch(() => ({}));
    const appId = dbg?.data?.app_id;
    if (!appId) throw new ProviderError('Could not find the Meta app for this key, so the sample photo could not be uploaded.');
    const start = await fetchImpl(
      `https://graph.facebook.com/${graphVersion}/${appId}/uploads?file_name=offer.jpg&file_length=${bytes.length}&file_type=${encodeURIComponent(mime)}`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
    ).then((r) => r.json());
    if (!start?.id) throw new ProviderError(start?.error?.message || 'Meta did not accept the sample photo.');
    const done = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${start.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${accessToken}`, file_offset: '0' },
      body: bytes,
    }).then((r) => r.json());
    if (!done?.h) throw new ProviderError(done?.error?.message || 'Meta did not accept the sample photo.');
    return done.h;
  }

  return {
    name: 'meta',
    label: 'Meta WhatsApp Cloud API',
    stub: true,

    // Sending needs only the token and number ID; META_APP_SECRET is needed to accept webhooks.
    missingConfig() {
      return [
        !accessToken && 'META_ACCESS_TOKEN',
        !phoneNumberId && 'META_PHONE_NUMBER_ID',
      ].filter(Boolean);
    },

    /**
     * Business-initiated messages must use an approved template (template.provider_ref
     * holds its Meta name). Placeholders become positional {{1}}, {{2}}... in order.
     */
    async send({ to, template, values, imageUrl }) {
      if (!template?.provider_ref) {
        throw new ProviderError('This template has not been approved by Meta yet (no Meta template name).', {
          code: 132001,
        });
      }
      const params = extractVariables(template.body).map((k) => ({ type: 'text', text: String(values?.[k] ?? '') }));
      const components = [];
      // Messages approved with a photo header carry a photo every time: this offer's, or the saved one.
      const photo = imageUrl || template.image_url;
      if (template.image_url && photo) {
        components.push({ type: 'header', parameters: [{ type: 'image', image: { link: photo } }] });
      }
      if (params.length) components.push({ type: 'body', parameters: params });
      return post({
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'template',
        template: { name: template.provider_ref, language: { code: template.language || 'en' }, components },
      });
    },

    async sendText({ to, body }) {
      return post({ messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body } });
    },

    // Meta has no "get message status" endpoint: statuses only arrive by webhook.
    fetchStatus: null,

    /**
     * Submits a template to Meta for approval. Placeholders become {{1}}, {{2}}... in order,
     * with example values Meta's reviewers see. Returns { name, status, id }.
     */
    async submitTemplate(template, examples, { sample } = {}) {
      if (!wabaId) throw new ProviderError('Connect the WhatsApp Business account first (Settings → Connect WhatsApp).');
      const name = metaTemplateName(template.name);
      const keys = extractVariables(template.body);
      let n = 0;
      const text = template.body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, () => `{{${++n}}}`);
      const body = { type: 'BODY', text };
      if (keys.length) body.example = { body_text: [keys.map((k) => String(examples?.[k] ?? k))] };
      const components = [body];
      // A message with a photo is approved with a photo header; Meta needs a sample photo for that.
      if (template.image_url) {
        if (!sample) throw new ProviderError('Could not read the message’s photo to send to Meta. Add the photo again and retry.');
        components.unshift({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [await uploadSample(sample)] } });
      }
      const buttons = (template.buttons || []).map((b) =>
        b.type === 'url' ? { type: 'URL', text: b.text, url: b.url }
          : b.type === 'phone' ? { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone }
            : { type: 'QUICK_REPLY', text: b.text },
      );
      if (buttons.length) components.push({ type: 'BUTTONS', buttons });
      const res = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${wabaId}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          language: template.language || 'en',
          category: template.category === 'utility' ? 'UTILITY' : 'MARKETING',
          components,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = data.error || {};
        throw new ProviderError(e.error_user_msg || e.message || 'Meta rejected the template.', { code: e.code, status: res.status });
      }
      return { name, status: data.status || 'PENDING', id: data.id };
    },

    /** Latest approval status for a submitted template. */
    async templateStatus(name) {
      if (!wabaId) return null;
      const url = `https://graph.facebook.com/${graphVersion}/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,rejected_reason,language`;
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json().catch(() => ({}));
      const t = (data.data || []).find((x) => x.name === name);
      return t ? { status: t.status, reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null } : null;
    },

    /** X-Hub-Signature-256 is an HMAC of the raw body with the app secret. */
    verifyWebhook(req) {
      const sig = req.get('X-Hub-Signature-256') || '';
      if (!appSecret || !req.rawBody) return false;
      const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(sig);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },

    parseWebhook(req) {
      const statuses = [];
      const inbound = [];
      for (const entry of req.body?.entry || []) {
        for (const change of entry.changes || []) {
          const v = change.value || {};
          const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || '']));
          for (const s of v.statuses || []) {
            const status = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' }[s.status];
            if (!status) continue;
            const err = s.errors?.[0];
            statuses.push({
              providerMessageId: s.id,
              status,
              errorCode: err?.code ? String(err.code) : null,
              errorMessage: err ? friendlyError(err.code, err.title) : null,
            });
          }
          for (const m of v.messages || []) {
            inbound.push({
              providerMessageId: m.id,
              from: `+${m.from}`,
              profileName: names[m.from] || '',
              body:
                m.text?.body ||
                m.button?.text ||
                m.interactive?.button_reply?.title ||
                m.interactive?.list_reply?.title ||
                `[${m.type} message]`,
              mediaUrl: null,
            });
          }
        }
      }
      return { statuses, inbound };
    },
  };
}

/** Meta template names: lowercase letters, numbers and underscores. */
export function metaTemplateName(name) {
  return String(name || 'template')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'template';
}
