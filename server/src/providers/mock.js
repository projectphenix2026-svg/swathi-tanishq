// Mock provider for local development and demos: sends nothing.
// Messages move sent -> delivered -> read (checked by the once-a-minute job), so reports can be tried out.
// Numbers ending in 0000 fail, to show how failures look.
import crypto from 'node:crypto';
import { ProviderError } from './errors.js';

// The send time is kept inside the message ID (MOCK<time in base 36>x<random>), not in memory,
// so statuses still move on Cloudflare, where each request may run in a fresh Worker.
export function createMockProvider({ deliverAfterMs = 2000, readAfterMs = 6000 } = {}) {
  const outbox = [];

  return {
    name: 'mock',
    label: 'Test mode (nothing is really sent)',
    outbox,

    missingConfig() {
      return [];
    },

    async send({ to, body, buttons, imageUrl }) {
      if (to.endsWith('0000')) {
        throw new ProviderError('This number is not on WhatsApp. (test mode)', { code: 63003 });
      }
      const id = `MOCK${Date.now().toString(36)}x${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      outbox.push({ id, to, body, buttons, imageUrl });
      return { providerMessageId: id, status: 'sent' };
    },

    async sendText({ to, body }) {
      return this.send({ to, body });
    },

    async fetchStatus(id) {
      const match = /^MOCK([0-9a-z]+)x/.exec(id || '');
      if (!match) return null;
      const at = parseInt(match[1], 36);
      const age = Date.now() - at;
      const status = age >= readAfterMs ? 'read' : age >= deliverAfterMs ? 'delivered' : 'sent';
      return { providerMessageId: id, status, errorCode: null, errorMessage: null };
    },

    verifyWebhook() {
      return true;
    },

    parseWebhook() {
      return { statuses: [], inbound: [] };
    },
  };
}
