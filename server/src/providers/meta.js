// Meta WhatsApp Cloud API adapter: STUB.
// The request and webhook shapes follow Meta's documentation, but this has not
// been run against a live Meta account yet (the Meta app setup is pending).
// Switching to it later is a config change: MESSAGING_PROVIDER=meta plus the META_* variables.
import crypto from 'node:crypto';
import { extractVariables } from '../lib/template.js';
import { ProviderError, isRetryableHttp, friendlyError } from './errors.js';

export function createMetaProvider(cfg, { fetchImpl = fetch } = {}) {
  const { accessToken, phoneNumberId, appSecret, graphVersion } = cfg;
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
    async send({ to, template, values }) {
      if (!template?.provider_ref) {
        throw new ProviderError('This template has not been approved by Meta yet (no Meta template name).', {
          code: 132001,
        });
      }
      const params = extractVariables(template.body).map((k) => ({ type: 'text', text: String(values?.[k] ?? '') }));
      const components = [];
      if (template.image_url) {
        components.push({ type: 'header', parameters: [{ type: 'image', image: { link: template.image_url } }] });
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
