import express from 'express';
import { query, NOW } from '../db/index.js';
import { config } from '../config.js';
import { getProvider, getSmsProvider } from '../providers/index.js';
import { previewAudience, launchCampaign, campaignReport, queueMessages, audienceList, TEST_PHONE_TAG } from '../lib/campaigns.js';
import { kick } from '../lib/dispatch.js';
import { normalizePhone } from '../lib/phone.js';
import { pace, finishEstimate } from '../lib/pacing.js';
import { render, valuesFor } from '../lib/template.js';
import { shopValues } from '../lib/shop.js';
import { withButtons } from '../providers/twilio.js';
import { requireLevel } from './auth.js';
import { atLeast } from '../lib/roles.js';
import { refreshProvider, testProvider } from '../lib/whatsapp-connection.js';

const canEdit = requireLevel('manager');

const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, t.name AS template_name,
            count(m.id) AS total,
            count(m.id) FILTER (WHERE m.status IN ('sent', 'delivered', 'read') OR (c.channel = 'sms' AND m.status = 'preview')) AS sent,
            count(m.id) FILTER (WHERE m.status IN ('delivered', 'read')) AS delivered,
            count(m.id) FILTER (WHERE m.status = 'read') AS read,
            count(m.id) FILTER (WHERE m.status = 'failed') AS failed,
            count(m.id) FILTER (WHERE m.status IN ('queued', 'retrying', 'sending')) AS pending
       FROM campaigns c JOIN templates t ON t.id = c.template_id
       LEFT JOIN messages m ON m.campaign_id = c.id
      WHERE c.client_id = $1 AND c.name NOT LIKE 'Order ready ·%' AND c.name NOT LIKE 'Repair ready ·%'
      GROUP BY c.id, t.name ORDER BY c.created_at DESC LIMIT 100`,
    [req.clientId],
  );
  res.json({ campaigns: rows });
});

// Live numbers for steps 1-4 of the builder.
router.post('/preview', async (req, res) => {
  const { audience = { mode: 'all' }, templateId, variables = {} } = req.body || {};
  const channel = req.body?.channel === 'sms' ? 'sms' : 'whatsapp';
  let template = null;
  if (templateId) template = (await query('SELECT * FROM templates WHERE id = $1 AND client_id = $2', [templateId, req.clientId])).rows[0];
  // Wishes (special days) never count towards the weekly limit.
  const ignoreCap = Boolean(req.body?.wish);
  const result = await previewAudience(req.clientId, { audience, template, variables, channel, ignoreCap });
  // Meta's daily limit (WhatsApp only): how many go out now, and when the rest should be done.
  const p = channel === 'sms' ? null : await pace();
  const count = template ? result.sendable : result.eligible;
  res.json({ ...result, pace: p && { ...p, finishBy: finishEstimate(count, p) } });
});

// "Pick customers": the people the filters match, with ticks and the reason anyone is left out.
router.post('/audience-list', async (req, res) => {
  const { audience = { mode: 'all' }, templateId, variables = {}, q = '', limit, offset } = req.body || {};
  const channel = req.body?.channel === 'sms' ? 'sms' : 'whatsapp';
  let template = null;
  if (templateId) template = (await query('SELECT * FROM templates WHERE id = $1 AND client_id = $2', [templateId, req.clientId])).rows[0];
  res.json(await audienceList(req.clientId, { audience, template, variables, channel, q: String(q).slice(0, 60), limit, offset, ignoreCap: Boolean(req.body?.wish) }));
});

// The exact message one customer would receive.
router.post('/render', async (req, res) => {
  const { templateId, contactId, variables = {} } = req.body || {};
  const { rows: [t] } = await query('SELECT * FROM templates WHERE id = $1 AND client_id = $2', [templateId, req.clientId]);
  const { rows: [c] } = await query('SELECT * FROM contacts WHERE id = $1 AND client_id = $2', [contactId, req.clientId]);
  if (!t || !c) return res.status(404).json({ error: 'Template or customer not found.' });
  const { text, missing } = render(t.body, valuesFor(c, { ...variables, ...(await shopValues(req.clientId)) }));
  res.json({
    text,
    missing,
    buttons: t.buttons,
    imageUrl: t.image_url,
    // What the provider actually delivers (the sandbox shows buttons as lines of text).
    deliveredAs: getProvider().name === 'twilio' ? withButtons(text, t.buttons) : null,
  });
});

/** The template, or an error in plain words if it cannot be sent right now. */
async function sendableTemplate(clientId, templateId, channel = 'whatsapp', provider = getProvider()) {
  const { rows: [t] } = await query('SELECT * FROM templates WHERE id = $1 AND client_id = $2', [templateId, clientId]);
  if (!t) return { error: 'Choose a message.' };
  if (t.status !== 'approved') return { error: 'This message is not ready to send yet.' };
  if (channel === 'sms') {
    if (!t.sms_body) return { error: 'This message has no SMS version yet. Add one on its template page (SMS version).' };
    const missing = getSmsProvider().missingConfig();
    if (missing.length) return { error: `SMS sending is not set up yet. Missing: ${missing.join(', ')}.` };
    return { t };
  }
  const missingConfig = provider.missingConfig();
  if (missingConfig.length) return { error: `Sending is not set up yet. Missing: ${missingConfig.join(', ')}.` };
  if (provider.name === 'meta' && (!t.provider_ref || (t.provider_status && t.provider_status !== 'APPROVED'))) {
    return { error: 'WhatsApp (Meta) has not approved this message yet. Submit it from the template page and check back.' };
  }
  return { t };
}

// "Send a test to my phone": the message as one customer would get it, to a staff phone.
// The phone is saved once as a customer tagged test-phone, which normal sends leave out.
// Before Go live it still goes out through the connected WhatsApp, so the check is real.
router.post('/test', canEdit, async (req, res) => {
  const b = req.body || {};
  const ph = normalizePhone(b.phone);
  if (!ph.ok) return res.status(400).json({ error: ph.reason });
  const channel = b.channel === 'sms' ? 'sms' : 'whatsapp';
  await refreshProvider();
  const provider = channel === 'sms' ? getSmsProvider() : testProvider();
  const { t, error } = await sendableTemplate(req.clientId, b.templateId, channel, provider);
  if (error) return res.status(400).json({ error });
  const { rows: [as] } = await query('SELECT * FROM contacts WHERE id = $1 AND client_id = $2', [b.asContactId, req.clientId]);
  const { rows: [existing] } = await query('SELECT * FROM contacts WHERE client_id = $1 AND phone = $2', [req.clientId, ph.e164]);
  const isTestPhone = existing && (existing.tags || []).includes(TEST_PHONE_TAG);
  let contact = existing;
  if (!existing || isTestPhone) {
    // Copy the chosen customer's details, so the test reads exactly like their message.
    const d = as || {};
    ({ rows: [contact] } = await query(
      `INSERT INTO contacts (client_id, name, phone, city, birthday, anniversary, last_purchase, interests, tags,
                             whatsapp_opt_in, opt_in_at, opt_in_source, sms_opt_in)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, ${NOW}, 'staff test phone', 1)
       ON CONFLICT (client_id, phone) DO UPDATE SET name = excluded.name, city = excluded.city, birthday = excluded.birthday,
         anniversary = excluded.anniversary, last_purchase = excluded.last_purchase, interests = excluded.interests,
         whatsapp_opt_in = 1, sms_opt_in = 1, opted_out_at = NULL
       RETURNING *`,
      [req.clientId, d.name || req.user.name, ph.e164, d.city ?? null, d.birthday ?? null, d.anniversary ?? null,
        d.last_purchase ?? null, d.interests ?? null, JSON.stringify([TEST_PHONE_TAG])],
    ));
  } else if (!(channel === 'sms' ? existing.sms_opt_in : existing.whatsapp_opt_in) || existing.opted_out_at) {
    return res.status(400).json({ error: `${ph.display} is saved as a customer who has not agreed to ${channel === 'sms' ? 'SMS' : 'WhatsApp'} messages. Use another number.` });
  }
  const audience = { mode: 'selected', contactIds: [contact.id] };
  const { rows: [campaign] } = await query(
    `INSERT INTO campaigns (client_id, name, template_id, audience, variables, status, started_at, cost_per_message, provider,
                            created_by, expected_count, approved_by, approved_at, channel)
     VALUES ($1, $2, $3, $4, $5, 'sending', ${NOW}, $6, $7, $8, 1, $8, ${NOW}, $9) RETURNING *`,
    [req.clientId, `Test · ${t.name}`, t.id, JSON.stringify(audience), JSON.stringify(b.variables || {}),
      channel === 'sms' ? config.sms.costPerSms : config.costPerMessage, provider.name, req.user.id, channel],
  );
  const queued = await queueMessages(req.clientId, {
    audience, template: t, variables: b.variables || {}, keyPrefix: `campaign:${campaign.id}:contact:`, campaignId: campaign.id, ignoreCap: true, channel,
  });
  if (!queued) {
    await query(`UPDATE campaigns SET status = 'cancelled', completed_at = ${NOW} WHERE id = $1`, [campaign.id]);
    return res.status(400).json({ error: 'The test could not go out: this message needs details the chosen customer does not have, or the offer is blank.' });
  }
  kick();
  res.status(201).json({ campaign, phone: ph.display, as: contact.name });
});

router.post('/', canEdit, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Give the campaign a name.' });
  const channel = b.channel === 'sms' ? 'sms' : 'whatsapp';
  const { t, error } = await sendableTemplate(req.clientId, b.templateId, channel);
  if (error) return res.status(400).json({ error });
  const provider = channel === 'sms' ? getSmsProvider() : getProvider();
  let scheduledAt = null;
  if (b.scheduledAt) {
    scheduledAt = new Date(b.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'Pick a valid date and time.' });
    if (scheduledAt.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'That time has already passed.' });
  } else if (Number(b.undoSeconds) > 0) {
    // "Send now" with a short pause, so staff can still undo (it starts on the next minute's run).
    scheduledAt = new Date(Date.now() + Math.min(60, Number(b.undoSeconds)) * 1000);
  }
  const preview = await previewAudience(req.clientId, { audience: b.audience, template: t, variables: b.variables, channel });
  if (!preview.sendable) return res.status(400).json({ error: 'No customers can receive this offer. Check who gets it and the offer details.' });
  if (b.expectedCount !== undefined && Number(b.expectedCount) !== preview.sendable) {
    return res.status(409).json({
      error: `The audience changed: it is now ${preview.sendable} customers instead of ${b.expectedCount}. Please review again.`,
      preview,
    });
  }
  // Big sends by non-admins wait for an admin's approval.
  const needsApproval = !atLeast(req.user.role, 'owner') && preview.sendable >= preview.approvalThreshold;
  const { rows: [campaign] } = await query(
    `INSERT INTO campaigns (client_id, name, template_id, audience, variables, status, scheduled_at, cost_per_message, provider,
                            created_by, sms_fallback, expected_count, approved_by, approved_at, channel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $13 IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END, $14) RETURNING *`,
    [req.clientId, name, t.id, JSON.stringify(b.audience || { mode: 'all' }), JSON.stringify(b.variables || {}),
      needsApproval ? 'pending_approval' : 'scheduled', scheduledAt, preview.costPerMessage, provider.name, req.user.id,
      channel === 'whatsapp' && Boolean(b.smsFallback), preview.sendable, needsApproval ? null : req.user.id, channel],
  );
  if (needsApproval) return res.status(202).json({ campaign, pendingApproval: true, queued: 0 });
  const result = await launchCampaign(req.clientId, campaign, t);
  res.status(201).json({ campaign, queued: result.queued, skipped: result.skipped });
});

// An admin approves a big send; it then goes out (or waits for its scheduled time).
router.post('/:id/approve', requireLevel('owner'), async (req, res) => {
  const { rows: [c] } = await query(
    `UPDATE campaigns SET status = 'scheduled', approved_by = $3, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = $1 AND client_id = $2 AND status = 'pending_approval' RETURNING *`,
    [req.params.id, req.clientId, req.user.id],
  );
  if (!c) return res.status(409).json({ error: 'This campaign is not waiting for approval.' });
  if (c.scheduled_at && new Date(c.scheduled_at).getTime() < Date.now()) {
    await query('UPDATE campaigns SET scheduled_at = NULL WHERE id = $1', [c.id]);
    c.scheduled_at = null;
  }
  const { rows: [t] } = await query('SELECT * FROM templates WHERE id = $1', [c.template_id]);
  const result = await launchCampaign(req.clientId, c, t);
  res.json({ campaign: c, queued: result.queued, skipped: result.skipped });
});

router.get('/:id', async (req, res) => {
  const { rows: [c] } = await query(
    `SELECT c.*, t.name AS template_name, t.body AS template_body, t.buttons AS template_buttons, u.name AS created_by_name
       FROM campaigns c JOIN templates t ON t.id = c.template_id LEFT JOIN users u ON u.id = c.created_by
      WHERE c.id = $1 AND c.client_id = $2`,
    [req.params.id, req.clientId],
  );
  if (!c) return res.status(404).json({ error: 'Campaign not found.' });
  const report = await campaignReport(c.id, c.channel);
  const p = report.pending > 0 && c.channel !== 'sms' ? await pace() : null;
  res.json({ campaign: c, report, pace: p && { ...p, finishBy: finishEstimate(report.pending, p) } });
});

router.get('/:id/messages', async (req, res) => {
  const status = req.query.status;
  const params = [req.params.id, req.clientId];
  let cond = '';
  if (status === 'failed') cond = ` AND m.status = 'failed'`;
  else if (status === 'read') cond = ` AND m.status = 'read'`;
  else if (status === 'delivered') cond = ` AND m.status IN ('delivered', 'read')`;
  else if (status === 'pending') cond = ` AND m.status IN ('queued', 'retrying', 'sending')`;
  else if (status === 'sms') cond = ` AND m.channel = 'sms'`;
  const { rows } = await query(
    `SELECT m.id, m.channel, m.offer_code, m.body, m.status, m.error_code, m.error_message, m.sent_at, m.delivered_at, m.read_at, m.failed_at, m.attempts,
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
    `UPDATE campaigns SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = $1 AND client_id = $2 AND status IN ('scheduled', 'sending', 'pending_approval') RETURNING *`,
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
