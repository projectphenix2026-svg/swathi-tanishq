import express from 'express';
import { query } from '../db/index.js';
import { config } from '../config.js';
import { getProvider, getSmsProvider } from '../providers/index.js';
import { clientSettings } from '../lib/campaigns.js';
import { requireRole } from './auth.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { rows: [customers] } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE whatsapp_opt_in AND opted_out_at IS NULL)::int AS reachable
       FROM contacts WHERE client_id = $1`,
    [req.clientId],
  );
  // This calendar month in India time.
  const { rows: [month] } = await query(
    `SELECT count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read'))::int AS sent,
            count(*) FILTER (WHERE status IN ('delivered', 'read'))::int AS delivered,
            count(*) FILTER (WHERE status = 'read')::int AS read,
            count(*) FILTER (WHERE status = 'failed')::int AS failed,
            COALESCE(sum(cost), 0)::float AS spend
       FROM messages
      WHERE client_id = $1 AND direction = 'outbound'
        AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`,
    [req.clientId],
  );
  const { rows: [inbox] } = await query(
    `SELECT count(*)::int AS unread FROM messages WHERE client_id = $1 AND direction = 'inbound' AND seen_at IS NULL`,
    [req.clientId],
  );
  const { rows: recent } = await query(
    `SELECT c.id, c.name, c.status, c.created_at, c.scheduled_at,
            count(m.id)::int AS total,
            count(m.id) FILTER (WHERE m.status IN ('delivered', 'read'))::int AS delivered,
            count(m.id) FILTER (WHERE m.status = 'read')::int AS read
       FROM campaigns c LEFT JOIN messages m ON m.campaign_id = c.id
      WHERE c.client_id = $1 GROUP BY c.id ORDER BY c.created_at DESC LIMIT 5`,
    [req.clientId],
  );
  const { rows: [t] } = await query('SELECT count(*)::int AS n FROM templates WHERE client_id = $1', [req.clientId]);
  const { rows: [extra] } = await query(
    `SELECT (SELECT count(*)::int FROM leads WHERE client_id = $1 AND status = 'new') AS new_leads,
            (SELECT count(*)::int FROM campaigns WHERE client_id = $1 AND status = 'pending_approval') AS pending_approval,
            (SELECT count(*)::int FROM occasions WHERE client_id = $1 AND enabled) AS occasions_on,
            (SELECT count(*)::int FROM messages WHERE client_id = $1 AND occasion_id IS NOT NULL
               AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS greetings_today,
            (SELECT COALESCE(sum(amount), 0)::float FROM redemptions WHERE client_id = $1
               AND redeemed_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS revenue,
            (SELECT count(*)::int FROM redemptions WHERE client_id = $1
               AND redeemed_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS redeemed`,
    [req.clientId],
  );
  res.json({ customers, month: { ...month, spend: Math.round(month.spend * 100) / 100 }, inbox, recent, templates: t.n, ...extra });
});

// Settings the screens need: which provider, cost per message, sandbox hints, limits.
router.get('/settings', async (req, res) => {
  const p = getProvider();
  const sms = getSmsProvider();
  const limits = await clientSettings(req.clientId);
  res.json({
    businessName: config.businessName,
    provider: { name: p.name, label: p.label, stub: Boolean(p.stub), missing: p.missingConfig() },
    sms: { name: sms.name, label: sms.label, live: sms.live, missing: sms.missingConfig(), costPerSms: config.sms.costPerSms },
    metaTemplatesReady: Boolean(config.meta.wabaId && config.meta.accessToken),
    costPerMessage: config.costPerMessage,
    webhooksReachable: Boolean(config.publicBaseUrl),
    weeklyCap: limits.weekly_cap,
    approvalThreshold: limits.approval_threshold,
    role: req.user.role,
    sandbox:
      p.name === 'twilio'
        ? { number: process.env.TWILIO_SANDBOX_DISPLAY_NUMBER || config.twilio.whatsappFrom, joinCode: process.env.TWILIO_SANDBOX_JOIN_CODE || '' }
        : null,
  });
});

// Admins set the weekly limit and when big sends need approval.
router.put('/settings', requireRole('admin'), async (req, res) => {
  const cap = Number(req.body?.weeklyCap);
  const threshold = Number(req.body?.approvalThreshold);
  if (!Number.isInteger(cap) || cap < 0 || cap > 14) return res.status(400).json({ error: 'Weekly limit: a whole number from 0 (no limit) to 14.' });
  if (!Number.isInteger(threshold) || threshold < 1) return res.status(400).json({ error: 'Approval size: a whole number of customers, 1 or more.' });
  await query('UPDATE clients SET weekly_cap = $2, approval_threshold = $3 WHERE id = $1', [req.clientId, cap, threshold]);
  res.json({ weeklyCap: cap, approvalThreshold: threshold });
});

export default router;
