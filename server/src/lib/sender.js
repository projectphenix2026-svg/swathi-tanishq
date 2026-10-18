// Sends one message (WhatsApp or SMS). Called by the outbox runner (dispatch.js).
// "Exactly once" comes from the database: a message can only be claimed while it is
// queued or retrying, so a repeated or overlapping run finds nothing to do.
// Campaign and occasion messages are personalised here, at send time.
import { query, NOW } from '../db/index.js';
import { config } from '../config.js';
import { getProvider, getSmsProvider } from '../providers/index.js';
import { extractVariables, render, valuesFor, VARIABLES } from './template.js';
import { cleanPrefix, makeOfferCode } from './offers.js';
import { setRunner, kick } from './dispatch.js';

// WhatsApp errors meaning "this number cannot get WhatsApp": SMS backup is worth trying.
export const NOT_ON_WHATSAPP = new Set(['63003', '63024', '131026']);
const LABEL = Object.fromEntries(VARIABLES.map((v) => [v.key, v.label.toLowerCase()]));
const CODE_PREFIX = { birthday: 'BDAY', anniversary: 'ANNIV', festival: 'FEST' };

/** Back-off before retry n: 30 s, 1 min, 2 min, 4 min... */
export const backoffSeconds = (attempt) => 30 * 2 ** (attempt - 1);

export async function processSendJob(messageId) {
  const claimed = await query(
    `UPDATE messages SET status = 'sending', attempts = attempts + 1
       WHERE id = $1 AND status IN ('queued', 'retrying')
     RETURNING *`,
    [messageId],
  );
  const msg = claimed.rows[0];
  if (!msg) return { skipped: 'already handled' };

  const { rows: [contact] } = await query('SELECT * FROM contacts WHERE id = $1', [msg.contact_id]);
  const campaign = msg.campaign_id ? (await query('SELECT * FROM campaigns WHERE id = $1', [msg.campaign_id])).rows[0] : null;
  const occasion = msg.occasion_id ? (await query('SELECT * FROM occasions WHERE id = $1', [msg.occasion_id])).rows[0] : null;
  const template = msg.template_id ? (await query('SELECT * FROM templates WHERE id = $1', [msg.template_id])).rows[0] : null;
  const isReply = !campaign && !occasion;

  if (campaign?.status === 'cancelled') return skip(msg, 'Campaign was cancelled');
  if (occasion && !occasion.enabled) return skip(msg, 'Occasion was switched off');
  if (!isReply && contact.opted_out_at) return skip(msg, 'Customer opted out before sending');
  if (msg.channel === 'sms' && !contact.sms_opt_in) return skip(msg, 'Customer has no SMS consent');
  if (campaign?.status === 'scheduled') {
    await query(`UPDATE campaigns SET status = 'sending', started_at = COALESCE(started_at, ${NOW}) WHERE id = $1 AND status = 'scheduled'`, [campaign.id]);
  }

  // Personalise now: customer details, campaign values and a unique offer code.
  let values = msg.template_values;
  let body = msg.body;
  if (msg.channel === 'whatsapp' && template && !body) {
    values = valuesFor(contact, msg.variables || {});
    if (extractVariables(template.body).includes('offer_code')) {
      const prefix = cleanPrefix(msg.variables?.code_prefix, CODE_PREFIX[occasion?.kind] || 'OFFER');
      values.offer_code = await reserveCode(msg, contact, prefix);
    }
    const { text, missing } = render(template.body, values);
    if (missing.length) return skip(msg, `Missing details: ${missing.map((k) => LABEL[k] || k).join(', ')}`);
    body = text;
    await query(`UPDATE messages SET body = $2, template_values = $3 WHERE id = $1`, [msg.id, body, values]);
  }

  try {
    let result;
    let providerName;
    let cost = null;
    if (msg.channel === 'sms') {
      const sms = getSmsProvider();
      providerName = sms.name;
      result = await sms.send({ to: contact.phone, text: body, dltTemplateId: template?.sms_dlt_template_id });
      if (sms.live) cost = config.sms.costPerSms;
    } else {
      const provider = getProvider();
      providerName = provider.name;
      const payload = { to: contact.phone, body, buttons: msg.buttons || [], imageUrl: msg.image_url, template, values, idempotencyKey: msg.idempotency_key };
      result = isReply ? await provider.sendText(payload) : await provider.send(payload);
      if (!isReply) cost = campaign ? campaign.cost_per_message : config.costPerMessage;
    }
    await query(
      `UPDATE messages SET status = $5, provider = $2, provider_message_id = $3, sent_at = ${NOW},
              cost = $4, error_code = NULL, error_message = NULL
        WHERE id = $1`,
      [msg.id, providerName, result.providerMessageId, cost, result.status === 'preview' ? 'preview' : 'sent'],
    );
  } catch (err) {
    if (err.retryable && msg.attempts < config.maxAttempts) {
      await query(
        `UPDATE messages SET status = 'retrying', error_code = $2, error_message = $3,
                due_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || $4 || ' seconds')
          WHERE id = $1`,
        [msg.id, err.code || null, err.message, backoffSeconds(msg.attempts)],
      );
      return { retrying: true };
    }
    await setFinal(msg.id, 'failed', err.code || null, err.message);
    await fallbackToSms(msg.id);
  }
  if (msg.campaign_id) await finishCampaignIfDone(msg.campaign_id);
  return { sent: true };
}
setRunner(processSendJob);

/** Saves a unique offer code on the message; a clash with an existing code just picks another. */
async function reserveCode(msg, contact, prefix) {
  if (msg.offer_code) return msg.offer_code;
  for (let i = 0; i < 8; i++) {
    const code = makeOfferCode(contact.name, prefix, new Set());
    try {
      await query('UPDATE messages SET offer_code = $2 WHERE id = $1', [msg.id, code]);
      return code;
    } catch (err) {
      if (!/UNIQUE/i.test(err.message)) throw err;
    }
  }
  throw new Error('Could not make a unique offer code');
}

async function skip(msg, reason) {
  await setFinal(msg.id, 'cancelled', null, reason);
  if (msg.campaign_id) await finishCampaignIfDone(msg.campaign_id);
  return { skipped: reason };
}

async function setFinal(id, status, code, message) {
  await query(
    `UPDATE messages SET status = $2, error_code = $3, error_message = $4,
            failed_at = CASE WHEN $2 = 'failed' THEN ${NOW} ELSE failed_at END
      WHERE id = $1`,
    [id, status, code, message],
  );
}

/**
 * When a WhatsApp message failed because the number is not on WhatsApp, and SMS backup is on
 * for its campaign or occasion, queue the SMS version once (its own unique key).
 * Called after a send failure and after a "failed" status webhook.
 */
export async function fallbackToSms(messageId) {
  const { rows: [m] } = await query(
    `SELECT m.*, c.sms_fallback AS c_fb, o.sms_fallback AS o_fb, ct.sms_opt_in, ct.opted_out_at, ct.name, ct.city,
            ct.last_purchase, ct.interests, t.sms_body
       FROM messages m
       JOIN contacts ct ON ct.id = m.contact_id
       LEFT JOIN campaigns c ON c.id = m.campaign_id
       LEFT JOIN occasions o ON o.id = m.occasion_id
       LEFT JOIN templates t ON t.id = m.template_id
      WHERE m.id = $1`,
    [messageId],
  );
  if (!m || m.channel !== 'whatsapp' || m.status !== 'failed' || !NOT_ON_WHATSAPP.has(String(m.error_code))) return null;
  if (!(m.c_fb || m.o_fb) || !m.sms_opt_in || m.opted_out_at || !m.sms_body) return null;
  const values = { ...valuesFor(m, m.variables || {}), ...(m.template_values || {}) };
  const { text, missing } = render(m.sms_body, values);
  if (missing.length) return null;
  const { rows: [sms] } = await query(
    `INSERT INTO messages (client_id, campaign_id, occasion_id, contact_id, channel, template_id, template_values,
                           idempotency_key, body, status, fallback_of)
     VALUES ($1, $2, $3, $4, 'sms', $5, $6, $7, $8, 'queued', $9)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [m.client_id, m.campaign_id, m.occasion_id, m.contact_id, m.template_id, values, `${m.idempotency_key}:sms`, text, m.id],
  );
  if (sms) kick();
  return sms || null;
}

export async function finishCampaignIfDone(campaignId) {
  await query(
    `UPDATE campaigns SET status = 'completed', completed_at = ${NOW}
      WHERE id = $1 AND status IN ('sending', 'scheduled')
        AND NOT EXISTS (SELECT 1 FROM messages WHERE campaign_id = $1 AND status IN ('queued', 'retrying', 'sending'))`,
    [campaignId],
  );
}

/**
 * Messages left in "sending" for over 10 minutes (the process stopped mid-send) are marked
 * failed with a clear reason rather than resent: they may already have gone out.
 */
export async function releaseStuck() {
  await query(
    `UPDATE messages SET status = 'failed', failed_at = ${NOW},
            error_message = 'Interrupted while sending; check with the customer before resending.'
      WHERE status = 'sending' AND direction = 'outbound'
        AND due_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
        AND provider_message_id IS NULL`,
  );
}
