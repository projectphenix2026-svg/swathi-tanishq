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

  /** Meta's template with this name and language, if it was submitted before: { id, status }. */
  async function findTemplate(name, language) {
    const res = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,language,status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) || {};
    return (data.data || []).find((x) => x.name === name && x.language === language) || null;
  }

  /** The first of name_2 ... name_20 not used yet at Meta (for a new version of a template). */
  async function freeName(name, language) {
    for (let n = 2; n <= 20; n++) {
      if (!(await findTemplate(`${name}_${n}`, language))) return `${name}_${n}`;
    }
    return null;
  }

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
      `https://graph.facebook.com/${graphVersion}/${appId}/uploads?file_name=${mime.startsWith('video/') ? 'offer.mp4' : 'offer.jpg'}&file_length=${bytes.length}&file_type=${encodeURIComponent(mime)}`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
    ).then((r) => r.json()).catch(() => ({}));
    if (!start?.id) throw new ProviderError(`Meta said: ${start?.error?.message || 'the sample photo or video was not accepted.'}`);
    const done = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${start.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${accessToken}`, file_offset: '0' },
      body: bytes,
    }).then((r) => r.json()).catch(() => ({}));
    if (!done?.h) throw new ProviderError(`Meta said: ${done?.error?.message || 'the sample photo or video was not accepted.'}`);
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
    async send({ to, template, values, imageUrl, videoUrl }) {
      if (!template?.provider_ref) {
        throw new ProviderError('This template has not been approved by Meta yet (no Meta template name).', {
          code: 132001,
        });
      }
      const params = extractVariables(template.body).map((k) => ({ type: 'text', text: String(values?.[k] ?? '') }));
      const components = [];
      // Messages approved with a video or photo header carry it every time; the file can be this offer's own.
      const photo = imageUrl || template.image_url;
      if (template.video_url) {
        components.push({ type: 'header', parameters: [{ type: 'video', video: { link: videoUrl || template.video_url } }] });
      } else if (template.image_url && photo) {
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
      // A message with a photo or video is approved with that header; Meta needs a sample of it.
      if (template.video_url || template.image_url) {
        const kind = template.video_url ? 'video' : 'photo';
        if (!sample) throw new ProviderError(`Could not read the message’s ${kind} to send to Meta. Add the ${kind} again and retry.`);
        components.unshift({ type: 'HEADER', format: template.video_url ? 'VIDEO' : 'IMAGE', example: { header_handle: [await uploadSample(sample)] } });
      }
      const buttons = (template.buttons || []).map((b) =>
        b.type === 'url' ? { type: 'URL', text: b.text, url: b.url }
          : b.type === 'phone' ? { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone }
            : { type: 'QUICK_REPLY', text: b.text },
      );
      if (buttons.length) components.push({ type: 'BUTTONS', buttons });
      const language = template.language || 'en';
      const category = template.category === 'utility' ? 'UTILITY' : 'MARKETING';
      const send = (path, body) => fetchImpl(`https://graph.facebook.com/${graphVersion}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (res) => ({ res, data: await res.json().catch(() => ({})) }));
      const refusal = ({ res, data }) => {
        const e = data.error || {};
        return new ProviderError(`Meta said: ${e.error_user_msg || e.message || 'the template was not accepted.'}`, { code: e.code, status: res.status });
      };

      // Submitted before (e.g. a photo was added later): edit Meta's template, which keeps its name.
      const existing = await findTemplate(name, language);
      if (existing) {
        const edited = await send(existing.id, { components });
        if (edited.res.ok) return { name, status: edited.data.status || 'PENDING', id: existing.id };
        // Meta refused the edit (e.g. an approved template can change only once a day): send this
        // version as a new template, dhanteras_2, dhanteras_3..., which Meta reviews like any other.
        const fresh = await freeName(name, language);
        if (!fresh) throw refusal(edited);
        const created = await send(`${wabaId}/message_templates`, { name: fresh, language, category, components });
        if (!created.res.ok) throw refusal(created);
        return { name: fresh, status: created.data.status || 'PENDING', id: created.data.id };
      }
      const created = await send(`${wabaId}/message_templates`, { name, language, category, components });
      if (!created.res.ok) throw refusal(created);
      return { name, status: created.data.status || 'PENDING', id: created.data.id };
    },

    /** Latest approval status for a submitted template. */
    async templateStatus(name) {
      if (!wabaId) return null;
      const url = `https://graph.facebook.com/${graphVersion}/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,rejected_reason,language,components`;
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json().catch(() => ({}));
      const t = (data.data || []).find((x) => x.name === name);
      if (!t) return null;
      const header = (t.components || []).find((c) => c.type === 'HEADER');
      return {
        status: t.status,
        reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
        // IMAGE, VIDEO, TEXT... or null: what kind of header Meta's version has.
        header: header?.format || null,
      };
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
      const templates = [];
      for (const entry of req.body?.entry || []) {
        for (const change of entry.changes || []) {
          const v = change.value || {};
          // A template was reviewed (only sent when this field is ticked in the Meta app's webhooks).
          if (change.field === 'message_template_status_update' && v.message_template_name) {
            templates.push({ name: v.message_template_name, language: v.message_template_language, status: v.event, reason: v.reason || null });
            continue;
          }
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
      return { statuses, inbound, templates };
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
