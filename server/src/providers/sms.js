// SMS backup channel.
// preview: records the exact SMS that would be sent, sends nothing (until DLT is approved).
// msg91:   sends through MSG91 with the DLT template ID. Written to MSG91's documented
//          send API but not yet run live (needs the client's DLT registration).
import crypto from 'node:crypto';
import { ProviderError, isRetryableHttp } from './errors.js';

export function createSmsProvider(cfg, { fetchImpl = fetch } = {}) {
  const live = cfg.mode === 'msg91';
  return {
    name: live ? 'msg91' : 'sms-preview',
    label: live ? 'MSG91 SMS' : 'SMS preview (nothing is sent until DLT is approved)',
    live,

    missingConfig() {
      if (!live) return [];
      return [!cfg.msg91AuthKey && 'MSG91_AUTH_KEY', !cfg.senderId && 'MSG91_SENDER_ID'].filter(Boolean);
    },

    /** text = the final SMS; dltTemplateId = the DLT "TE ID" this wording is registered under. */
    async send({ to, text, dltTemplateId }) {
      if (!live) return { providerMessageId: `SMSPREVIEW${crypto.randomUUID().slice(0, 18)}`, status: 'preview' };
      if (!dltTemplateId) throw new ProviderError('This template has no DLT template ID, so operators would block the SMS.');
      const params = new URLSearchParams({
        authkey: cfg.msg91AuthKey,
        mobiles: to.replace(/^\+/, ''),
        message: text,
        sender: cfg.senderId,
        route: '4', // transactional/service-implicit route; promotional uses the DLT category of the template
        country: '91',
        DLT_TE_ID: dltTemplateId,
        response: 'json',
      });
      let res;
      try {
        res = await fetchImpl(`https://api.msg91.com/api/sendhttp.php?${params}`);
      } catch (err) {
        throw new ProviderError(`Could not reach MSG91: ${err.message}`, { retryable: true });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.type === 'error') {
        throw new ProviderError(data.message || 'MSG91 did not accept the SMS.', { status: res.status, retryable: isRetryableHttp(res.status) });
      }
      return { providerMessageId: String(data.message || data.request_id || ''), status: 'sent' };
    },
  };
}

/** SMS parts: 160 characters for plain text, 70 if it has non-GSM characters (e.g. ₹, Telugu). */
export function smsParts(text) {
  const unicode = /[^\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}
