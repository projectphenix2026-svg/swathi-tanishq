import express from 'express';
import { query } from '../db/index.js';
import { config } from '../config.js';
import { getProvider } from '../providers/index.js';
import { previewAudience, launchCampaign, campaignReport } from '../lib/campaigns.js';
import { render, valuesFor } from '../lib/template.js';
import { withButtons } from '../providers/twilio.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, t.name AS template_name,
            count(m.id)::int AS total,
            count(m.id) FILTER (WHERE m.status IN ('sent', 'delivered', 'read'))::int AS sent,
            count(m.id) FILTER (WHERE m.status IN ('delivered', 'read'))::int AS delivered,
            count(m.id) FILTER (WHERE m.status = 'read')::int AS read,
            count(m.id) FILTER (WHERE m.status = 'failed')::int AS failed,
            count(m.id) FILTER (WHERE m.status IN ('queued', 'retrying', 'sending'))::int AS pending
       FROM campaigns c JOIN templates t ON t.id = c.template_id
       LEFT JOIN messages m ON m.campaign_id = c.id
      WHERE c.client_id = $1
      GROUP BY c.id, t.name ORDER BY c.created_at DESC LIMIT 100`,
    [req.clientId],
  );
  res.json({ campaigns: rows });
});

// Live numbers for steps 1-4 of the builder.
router.post('/preview', async (req, res) => {
  const { audience = { mode: 'all' }, templateId, variables = {} } = req.body || {};
  let template = null;
  if (templateId) template = (await query('SELECT * FROM templates WHERE id = $1 AND client_id = $2', [templateId, req.clientId])).rows[0];
  const result = await previewAudience(req.clientId, { audience, templateBody: template?.body, variables });
  res.json(result);
});

// The exact message one customer would receive.
router.post('/render', async (req, res) => {
  const { templateId, contactId, variables = {} } = req.body || {};
  const { rows: [t] } = await query('SELECT * FROM templates WHERE id = $1 AND client_id = $2', [templateId, req.clientId]);
  const { rows: [c] } = await query('SELECT * FROM contacts WHERE id = $1 AND client_id = $2', [contactId, req.clientId]);
  if (!t || !c) return res.status(404).json({ error: 'Template or customer not found.' });
  const { text, missing } = render(t.body, valuesFor(c, variables));
  res.json({
    text,
    missing,
    buttons: t.buttons,
    imageUrl: t.image_url,
    // What the provider actually delivers (the sandbox shows buttons as lines of text).
    deliveredAs: getProvider().name === 'twilio' ? withButtons(text, t.buttons) : null,
  });
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Give the campaign a name.' });
  const { rows: [t] } = await query('SELECT * FROM templates WHERE id = $1 AND client_id = $2', [b.templateId, req.clientId]);
  if (!t) return res.status(400).json({ error: 'Choose a message template.' });
  if (t.status !== 'approved') return res.status(400).json({ error: 'This template is not approved for sending yet.' });
  const provider = getProvider();
  const missingConfig = provider.missingConfig();
  if (missingConfig.length) {
    return res.status(400).json({ error: `Sending is not set up yet. Missing: ${missingConfig.join(', ')}.` });
  }
  let scheduledAt = null;
  if (b.scheduledAt) {
    scheduledAt = new Date(b.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'Pick a valid date and time.' });
    if (scheduledAt.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'That time has already passed.' });
  }
  const preview = await previewAudience(req.clientId, { audience: b.audience, templateBody: t.body, variables: b.variables });
  if (!preview.sendable) return res.status(400).json({ error: 'No customers can receive this campaign. Check the audience and offer.' });
  if (b.expectedCount !== undefined && Number(b.expectedCount) !== preview.sendable) {
    return res.status(409).json({
      error: `The audience changed: it is now ${preview.sendable} customers instead of ${b.expectedCount}. Please review again.`,
      preview,
    });
  }
  const { rows: [campaign] } = await query(
    `INSERT INTO campaigns (client_id, name, template_id, audience, variables, status, scheduled_at, cost_per_message, provider, created_by)
     VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7, $8, $9) RETURNING *`,
    [req.clientId, name, t.id, JSON.stringify(b.audience || { mode: 'all' }), JSON.stringify(b.variables || {}), scheduledAt, config.costPerMessage, provider.name, req.user.id],
  );
  const result = await launchCampaign(req.clientId, campaign, t);
  res.status(201).json({ campaign, queued: result.queued, skipped: result.skipped });
});

router.get('/:id', async (req, res) => {
  const { rows: [c] } = await query(
    `SELECT c.*, t.name AS template_name, t.body AS template_body, t.buttons AS template_buttons, u.name AS created_by_name
       FROM campaigns c JOIN templates t ON t.id = c.template_id LEFT JOIN users u ON u.id = c.created_by
      WHERE c.id = $1 AND c.client_id = $2`,
    [req.params.id, req.clientId],
  );
  if (!c) return res.status(404).json({ error: 'Campaign not found.' });
  const report = await campaignReport(c.id);
  res.json({ campaign: c, report });
});

router.get('/:id/messages', async (req, res) => {
  const status = req.query.status;
  const params = [req.params.id, req.clientId];
  let cond = '';
  if (status === 'failed') cond = ` AND m.status = 'failed'`;
  else if (status === 'read') cond = ` AND m.status = 'read'`;
  else if (status === 'delivered') cond = ` AND m.status IN ('delivered', 'read')`;
  else if (status === 'pending') cond = ` AND m.status IN ('queued', 'retrying', 'sending')`;
  const { rows } = await query(
    `SELECT m.id, m.status, m.error_message, m.sent_at, m.delivered_at, m.read_at, m.failed_at, m.attempts,
            ct.id AS contact_id, ct.name, ct.phone
       FROM messages m JOIN contacts ct ON ct.id = m.contact_id
      WHERE m.campaign_id = $1 AND m.client_id = $2${cond}
      ORDER BY m.id LIMIT 500`,
    params,
  );
  res.json({ messages: rows });
});

// Scheduled sends can be cancelled until they start; a running send stops the rest.
router.post('/:id/cancel', async (req, res) => {
  const { rows: [c] } = await query(
    `UPDATE campaigns SET status = 'cancelled', completed_at = now()
      WHERE id = $1 AND client_id = $2 AND status IN ('scheduled', 'sending') RETURNING *`,
    [req.params.id, req.clientId],
  );
  if (!c) return res.status(409).json({ error: 'This campaign has already finished.' });
  const { rowCount } = await query(
    `UPDATE messages SET status = 'cancelled', error_message = 'Campaign was cancelled'
      WHERE campaign_id = $1 AND status IN ('queued', 'retrying')`,
    [c.id],
  );
  res.json({ campaign: c, cancelled: rowCount ?? 0 });
});

export default router;
