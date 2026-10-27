// Owner-only "Connect WhatsApp": the shop adds its own Meta account details here. The key is
// checked with Meta, stored encrypted, and never sent back to the browser.
import express from 'express';
import { config } from '../config.js';
import { query, NOW } from '../db/index.js';
import { seal } from '../lib/secretbox.js';
import { checkMeta, loadConnection, refreshProvider } from '../lib/whatsapp-connection.js';
import { requireLevel } from './auth.js';
import { removeSamples } from '../lib/samples.js';
import { resumeSending } from '../lib/number-status.js';

const router = express.Router();
router.use(requireLevel('owner'));

const digits = (v) => String(v || '').replace(/\D/g, '');

function webhookUrl(req) {
  const base = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}/webhooks/meta`;
}

function view(c, req) {
  return {
    connected: Boolean(c),
    live: Boolean(c?.live),
    phoneNumberId: c?.phone_number_id || '',
    wabaId: c?.waba_id || '',
    phone: c?.display_phone || null,
    name: c?.verified_name || null,
    quality: c?.quality || null,
    tokenHint: c?.token_hint || null,
    tokenExpiresAt: c?.token_expires_at || null,
    dailyLimit: c?.daily_limit ?? null,
    limitTier: c?.limit_tier || null,
    hasAppSecret: Boolean(c?.app_secret_sealed),
    checkedAt: c?.checked_at || null,
    verifyToken: c?.verify_token || null,
    webhookUrl: webhookUrl(req),
  };
}

router.get('/', async (req, res) => {
  const { rows: [c] } = await query('SELECT * FROM whatsapp_connection WHERE client_id = $1', [req.clientId]);
  res.json({ ...view(c, req), ready: await readiness(req.clientId, c) });
});

// For the Go live checklist: templates approved by Meta, and a test sent since connecting.
async function readiness(clientId, c) {
  const { rows: [t] } = await query(
    `SELECT count(*) FILTER (WHERE provider_status = 'APPROVED') AS approved,
            count(*) FILTER (WHERE provider_ref IS NOT NULL AND (provider_status IS NULL OR provider_status = 'PENDING')) AS waiting,
            count(*) AS total
       FROM templates WHERE client_id = $1`,
    [clientId],
  );
  const { rows: [test] } = await query(
    `SELECT max(created_at) AS at FROM campaigns WHERE client_id = $1 AND name LIKE 'Test · %' AND provider = 'meta' AND created_at >= $2`,
    [clientId, c?.checked_at || '9999'],
  );
  return { templates: t, testSentAt: test?.at || null };
}

// Check the details with Meta and save them. The key may be left blank to keep the saved one.
router.post('/connect', async (req, res) => {
  const b = req.body || {};
  const phoneNumberId = digits(b.phoneNumberId);
  const wabaId = digits(b.wabaId);
  const saved = await loadConnection();
  const token = String(b.token || '').trim() || saved?.token || '';
  const appSecret = String(b.appSecret || '').trim() || saved?.appSecret || '';
  if (!phoneNumberId || !wabaId) return res.status(400).json({ error: 'Enter the Phone number ID and the WhatsApp Business account ID (numbers only).' });
  if (!token) return res.status(400).json({ error: 'Paste the permanent access key.' });

  const check = await checkMeta({ phoneNumberId, wabaId, token });
  if (!check.ok) return res.status(400).json({ error: check.error });

  const verifyToken = saved?.verify_token || [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await query(
    `INSERT INTO whatsapp_connection (client_id, phone_number_id, waba_id, token_sealed, app_secret_sealed, verify_token,
       display_phone, verified_name, quality, token_expires_at, token_hint, live, checked_at, updated_by, updated_at,
       daily_limit, limit_tier, limit_checked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, ${NOW}, $12, ${NOW}, $13, $14, ${NOW})
     ON CONFLICT (client_id) DO UPDATE SET phone_number_id = excluded.phone_number_id, waba_id = excluded.waba_id,
       token_sealed = excluded.token_sealed, app_secret_sealed = excluded.app_secret_sealed, display_phone = excluded.display_phone,
       verified_name = excluded.verified_name, quality = excluded.quality, token_expires_at = excluded.token_expires_at,
       token_hint = excluded.token_hint, checked_at = excluded.checked_at, updated_by = excluded.updated_by,
       updated_at = excluded.updated_at, daily_limit = excluded.daily_limit, limit_tier = excluded.limit_tier,
       limit_checked_at = excluded.limit_checked_at, live = CASE WHEN whatsapp_connection.phone_number_id = excluded.phone_number_id THEN whatsapp_connection.live ELSE 0 END`,
    [req.clientId, phoneNumberId, wabaId, await seal(token), await seal(appSecret), verifyToken,
      check.phone, check.name, check.quality, check.expiresAt, `…${token.slice(-4)}`, req.user.id,
      check.dailyLimit, check.limitTier],
  );
  await refreshProvider({ force: true });
  const { rows: [c] } = await query('SELECT * FROM whatsapp_connection WHERE client_id = $1', [req.clientId]);
  res.json({ ...view(c, req), warnings: check.warnings });
});

// Switch real sending on or off. Off means test mode: nothing reaches phones.
// "I've reconnected": carry on sending. If Meta still refuses, the next send pauses again.
router.post('/resume', async (req, res) => {
  res.json({ ok: true, requeued: await resumeSending() });
});

router.post('/live', async (req, res) => {
  const live = Boolean(req.body?.live);
  const { rows: [c] } = await query(
    `UPDATE whatsapp_connection SET live = $2, updated_by = $3, updated_at = ${NOW} WHERE client_id = $1 RETURNING *`,
    [req.clientId, live, req.user.id],
  );
  if (!c) return res.status(400).json({ error: 'Connect the WhatsApp account first.' });
  // Going live: the sample customers from Test mode go away.
  const removedSamples = live ? await removeSamples(req.clientId) : 0;
  await refreshProvider({ force: true });
  res.json({ ...view(c, req), removedSamples });
});

// Remove the saved details; the app goes back to test mode.
router.delete('/', async (req, res) => {
  await query('DELETE FROM whatsapp_connection WHERE client_id = $1', [req.clientId]);
  await refreshProvider({ force: true });
  res.json(view(null, req));
});

export default router;
