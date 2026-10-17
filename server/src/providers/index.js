// The one place that decides which messaging provider is used.
// Every provider has the same shape:
//   name, label, missingConfig(), send(), sendText(), fetchStatus() | null,
//   verifyWebhook(req), parseWebhook(req) -> { statuses[], inbound[] }
// Changing MESSAGING_PROVIDER in .env is all it takes to switch.
import { config } from '../config.js';
import { createTwilioProvider } from './twilio.js';
import { createMetaProvider } from './meta.js';
import { createMockProvider } from './mock.js';

let current = null;

export function getProvider() {
  if (!current) current = buildProvider(config.provider);
  return current;
}

/** Tests can swap in their own provider. */
export function setProvider(p) {
  current = p;
}

export function buildProvider(name) {
  switch (name) {
    case 'twilio':
      return createTwilioProvider(config.twilio, { publicBaseUrl: config.publicBaseUrl });
    case 'meta':
      return createMetaProvider(config.meta);
    case 'mock':
      return createMockProvider();
    default:
      throw new Error(`Unknown MESSAGING_PROVIDER "${name}". Use mock, twilio or meta.`);
  }
}
