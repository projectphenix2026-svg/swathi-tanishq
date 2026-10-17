// Mock provider for local development and demos: sends nothing.
// Messages move sent -> delivered -> read over a few seconds, so reports can be tried out.
// Numbers ending in 0000 fail, to show how failures look.
import crypto from 'node:crypto';
import { ProviderError } from './errors.js';

export function createMockProvider({ deliverAfterMs = 2000, readAfterMs = 6000 } = {}) {
  const sentAt = new Map();
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
      const id = `MOCK${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      sentAt.set(id, Date.now());
      outbox.push({ id, to, body, buttons, imageUrl });
      return { providerMessageId: id, status: 'sent' };
    },

    async sendText({ to, body }) {
      return this.send({ to, body });
    },

    async fetchStatus(id) {
      const at = sentAt.get(id);
      if (!at) return null;
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
