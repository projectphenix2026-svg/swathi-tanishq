// Twilio WhatsApp adapter (works with the free Twilio WhatsApp sandbox).
// The sandbox cannot show real WhatsApp buttons for free-form messages,
// so buttons are written as tappable lines under the message.
import crypto from 'node:crypto';
import { ProviderError, isRetryableHttp, friendlyError } from './errors.js';
import { extractVariables } from '../lib/template.js';

const API = 'https://api.twilio.com/2010-04-01';

export function createTwilioProvider(cfg, { publicBaseUrl, fetchImpl = fetch } = {}) {
  const { accountSid, authToken, whatsappFrom } = cfg;
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const from = whatsappFrom.startsWith('whatsapp:') ? whatsappFrom : `whatsapp:${whatsappFrom}`;

  return {
    name: 'twilio',
    label: 'Twilio WhatsApp',

    missingConfig() {
      return [
        !accountSid && 'TWILIO_ACCOUNT_SID',
        !authToken && 'TWILIO_AUTH_TOKEN',
        !whatsappFrom && 'TWILIO_WHATSAPP_FROM',
      ].filter(Boolean);
    },

    /**
     * With a Twilio Content template (template.provider_ref = "HX..."), sends ContentSid and the
     * placeholder values as {{1}}, {{2}}... in order; real WhatsApp buttons come from the template.
     * Otherwise sends free text, which WhatsApp only allows inside a 24-hour chat window.
     */
    async send({ to, body, buttons = [], imageUrl, template, values }) {
      const form = new URLSearchParams();
      form.set('To', `whatsapp:${to}`);
      form.set('From', from);
      if (/^HX[0-9a-f]{32}$/i.test(template?.provider_ref || '')) {
        form.set('ContentSid', template.provider_ref);
        const vars = Object.fromEntries(extractVariables(template.body).map((k, i) => [String(i + 1), String(values?.[k] ?? '')]));
        if (Object.keys(vars).length) form.set('ContentVariables', JSON.stringify(vars));
      } else {
        form.set('Body', withButtons(body, buttons));
        if (imageUrl) form.set('MediaUrl', imageUrl);
      }
      if (publicBaseUrl) form.set('StatusCallback', `${publicBaseUrl}/webhooks/twilio`);

      let res;
      try {
        res = await fetchImpl(`${API}/Accounts/${accountSid}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form,
        });
      } catch (err) {
        throw new ProviderError(`Could not reach Twilio: ${err.message}`, { retryable: true });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ProviderError(friendlyError(data.code, data.message), {
          code: data.code,
          status: res.status,
          retryable: isRetryableHttp(res.status),
        });
      }
      return { providerMessageId: data.sid, status: mapStatus(data.status) || 'sent' };
    },

    /** Asks Twilio for the latest status (used when webhooks cannot reach us). */
    async fetchStatus(sid) {
      const res = await fetchImpl(`${API}/Accounts/${accountSid}/Messages/${sid}.json`, {
        headers: { Authorization: auth },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        providerMessageId: sid,
        status: mapStatus(data.status),
        errorCode: data.error_code ? String(data.error_code) : null,
        errorMessage: data.error_code ? friendlyError(data.error_code, data.error_message) : null,
      };
    },

    /** Checks X-Twilio-Signature so nobody else can fake status updates. */
    verifyWebhook(req) {
      const signature = req.get('X-Twilio-Signature');
      if (!signature || !publicBaseUrl) return false;
      const url = publicBaseUrl + req.originalUrl;
      const params = req.body || {};
      const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
      const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
      return safeEqual(expected, signature);
    },

    /** One endpoint receives both status callbacks and incoming customer messages. */
    parseWebhook(req) {
      const p = req.body || {};
      const statuses = [];
      const inbound = [];
      const isInbound = (p.SmsStatus === 'received' || p.MessageStatus === 'received') && p.From;
      if (isInbound) {
        inbound.push({
          providerMessageId: p.MessageSid,
          from: String(p.From).replace(/^whatsapp:/, ''),
          profileName: p.ProfileName || '',
          body: p.ButtonText || p.Body || '',
          mediaUrl: p.MediaUrl0 || null,
        });
      } else if (p.MessageSid && p.MessageStatus) {
        const status = mapStatus(p.MessageStatus);
        if (status) {
          statuses.push({
            providerMessageId: p.MessageSid,
            status,
            errorCode: p.ErrorCode || null,
            errorMessage: p.ErrorCode ? friendlyError(p.ErrorCode, p.ErrorMessage) : null,
          });
        }
      }
      return { statuses, inbound };
    },

    /** Free-form text (allowed for 24 hours after the customer last wrote). */
    async sendText({ to, body }) {
      return this.send({ to, body });
    },
  };
}

export function withButtons(body, buttons = []) {
  if (!buttons.length) return body;
  const lines = buttons.map((b) => {
    if (b.type === 'url') return `👉 ${b.text}: ${b.url}`;
    if (b.type === 'phone') return `📞 ${b.text}: ${b.phone}`;
    return `💬 Reply "${b.text}"`;
  });
  return `${body}\n\n${lines.join('\n')}`;
}

function mapStatus(s) {
  switch (s) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
    case 'undelivered':
      return 'failed';
    default:
      return null; // queued / accepted / sending: nothing new to record
  }
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
