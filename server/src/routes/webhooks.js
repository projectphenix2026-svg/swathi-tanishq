// Provider callbacks: delivery statuses and incoming customer messages.
// Each route reads its own provider's format, and checks its signature so
// nobody else can post fake updates.
import express from 'express';
import { config } from '../config.js';
import { buildProvider, getProvider } from '../providers/index.js';
import { applyStatus, recordInbound } from '../lib/messages.js';
import { ensureClient } from '../db/index.js';
import { savedMetaProvider, webhookVerifyToken } from '../lib/whatsapp-connection.js';
import { applyTemplateStatus } from '../lib/template-approval.js';

const router = express.Router();
const adapters = {};

function adapter(name) {
  const active = getProvider();
  if (active.name === name) return active;
  if (name === 'meta' && savedMetaProvider()) return savedMetaProvider();
  adapters[name] ??= buildProvider(name);
  return adapters[name];
}

function handle(name) {
  return async (req, res) => {
    const provider = adapter(name);
    if (config.validateWebhooks && !provider.verifyWebhook(req)) {
      console.warn(`[webhook] rejected ${name} callback: bad signature`);
      return res.status(403).send('Invalid signature');
    }
    const { statuses, inbound, templates = [] } = provider.parseWebhook(req);
    const clientId = await ensureClient(config.businessName);
    for (const s of statuses) await applyStatus(s);
    for (const m of inbound) await recordInbound(clientId, { ...m, provider: name });
    for (const t of templates) await applyTemplateStatus(t);
    // Twilio expects TwiML or an empty 200; an empty response sends no auto-reply.
    res.type('text/xml').send('<Response></Response>');
  };
}

router.post('/twilio', express.urlencoded({ extended: false }), handle('twilio'));

// Meta: GET is the one-time subscription check, POST carries the events.
router.get('/meta', async (req, res) => {
  const expected = await webhookVerifyToken();
  if (req.query['hub.mode'] === 'subscribe' && expected && req.query['hub.verify_token'] === expected) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});
router.post('/meta', handle('meta'));

export default router;
