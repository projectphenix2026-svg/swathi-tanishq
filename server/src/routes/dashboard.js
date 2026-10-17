import express from 'express';
import { query } from '../db/index.js';
import { config } from '../config.js';
import { getProvider } from '../providers/index.js';

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
  res.json({ customers, month: { ...month, spend: Math.round(month.spend * 100) / 100 }, inbox, recent, templates: t.n });
});

// Settings the screens need: which provider, cost per message, sandbox hints.
router.get('/settings', (req, res) => {
  const p = getProvider();
  res.json({
    businessName: config.businessName,
    provider: { name: p.name, label: p.label, stub: Boolean(p.stub), missing: p.missingConfig() },
    costPerMessage: config.costPerMessage,
    webhooksReachable: Boolean(config.publicBaseUrl),
    sandbox:
      p.name === 'twilio'
        ? { number: process.env.TWILIO_SANDBOX_DISPLAY_NUMBER || config.twilio.whatsappFrom, joinCode: process.env.TWILIO_SANDBOX_JOIN_CODE || '' }
        : null,
  });
});

export default router;
