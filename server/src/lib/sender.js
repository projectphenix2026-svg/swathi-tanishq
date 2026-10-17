// The queue worker: sends one message (WhatsApp or SMS).
// "Exactly once" comes from the database, not the queue: a message can only be
// claimed while it is queued or retrying, so a repeated job finds nothing to do.
import { query } from '../db/index.js';
import { config } from '../config.js';
import { getProvider, getSmsProvider } from '../providers/index.js';
import { getQueue } from '../queue/index.js';
import { render, valuesFor } from './template.js';

// WhatsApp errors meaning "this number cannot get WhatsApp": SMS backup is worth trying.
export const NOT_ON_WHATSAPP = new Set(['63003', '63024', '131026']);

export async function processSendJob({ messageId }, { attempt = 1, maxAttempts = 4 } = {}) {
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
    await query(
      `UPDATE campaigns SET status = 'sending', started_at = COALESCE(started_at, now()) WHERE id = $1 AND status = 'scheduled'`,
      [campaign.id],
    );
  }

  try {
    let result;
    let providerName;
    let cost = null;
    if (msg.channel === 'sms') {
      const sms = getSmsProvider();
      providerName = sms.name;
      result = await sms.send({ to: contact.phone, text: msg.body, dltTemplateId: template?.sms_dlt_template_id });
      if (sms.live) cost = config.sms.costPerSms;
    } else {
      const provider = getProvider();
      providerName = provider.name;
      const payload = {
        to: contact.phone,
        body: msg.body,
        buttons: msg.buttons || [],
        imageUrl: msg.image_url,
        template,
        values: msg.template_values,
        idempotencyKey: msg.idempotency_key,
      };
      result = isReply ? await provider.sendText(payload) : await provider.send(payload);
      if (!isReply) cost = campaign ? campaign.cost_per_message : config.costPerMessage;
    }
    await query(
      `UPDATE messages
          SET status = $5, provider = $2, provider_message_id = $3, sent_at = now(),
              cost = $4, error_code = NULL, error_message = NULL
        WHERE id = $1`,
      [msg.id, providerName, result.providerMessageId, cost, result.status === 'preview' ? 'preview' : 'sent'],
    );
  } catch (err) {
    const willRetry = Boolean(err.retryable) && attempt < maxAttempts;
    if (willRetry) {
      await query(`UPDATE messages SET status = 'retrying', error_code = $2, error_message = $3 WHERE id = $1`, [
        msg.id,
        err.code || null,
        err.message,
      ]);
      throw err; // the queue tries again after a back-off
    }
    await setFinal(msg.id, 'failed', err.code || null, err.message);
    await fallbackToSms(msg.id);
  }
  if (msg.campaign_id) await finishCampaignIfDone(msg.campaign_id);
  return { sent: true };
}

async function skip(msg, reason) {
  await setFinal(msg.id, 'cancelled', null, reason);
  if (msg.campaign_id) await finishCampaignIfDone(msg.campaign_id);
  return { skipped: reason };
}

async function setFinal(id, status, code, message) {
  await query(
    `UPDATE messages SET status = $2, error_code = $3, error_message = $4,
            failed_at = CASE WHEN $2 = 'failed' THEN now() ELSE failed_at END
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
  const values = { ...valuesFor(m, {}), ...(m.template_values || {}) };
  const { text, missing } = render(m.sms_body, values);
  if (missing.length) return null;
  const { rows: [sms] } = await query(
    `INSERT INTO messages (client_id, campaign_id, occasion_id, contact_id, channel, template_id, template_values,
                           idempotency_key, body, status, fallback_of, offer_code)
     VALUES ($1, $2, $3, $4, 'sms', $5, $6, $7, $8, 'queued', $9, NULL)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, idempotency_key`,
    [m.client_id, m.campaign_id, m.occasion_id, m.contact_id, m.template_id, JSON.stringify(values), `${m.idempotency_key}:sms`, text, m.id],
  );
  if (sms) await enqueueMessage(sms);
  return sms || null;
}

export async function finishCampaignIfDone(campaignId) {
  await query(
    `UPDATE campaigns SET status = 'completed', completed_at = now()
      WHERE id = $1 AND status IN ('sending', 'scheduled')
        AND NOT EXISTS (SELECT 1 FROM messages
                         WHERE campaign_id = $1 AND status IN ('queued', 'retrying', 'sending'))`,
    [campaignId],
  );
}

/** Puts a message on the queue. The job id is the message's idempotency key. */
export async function enqueueMessage(message, delayMs = 0) {
  return getQueue().add(message.idempotency_key, { messageId: Number(message.id) }, { delay: Math.max(0, delayMs) });
}

/**
 * On start-up, re-queue messages that were waiting when the app stopped.
 * Messages stuck in "sending" are left alone: they may already have gone out.
 */
export async function requeuePending() {
  const { rows } = await query(
    `SELECT m.id, m.idempotency_key, c.scheduled_at
       FROM messages m LEFT JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.direction = 'outbound' AND m.status IN ('queued', 'retrying')
        AND (c.id IS NULL OR c.status NOT IN ('cancelled', 'pending_approval'))
      ORDER BY m.id`,
  );
  for (const r of rows) {
    const delay = r.scheduled_at ? new Date(r.scheduled_at).getTime() - Date.now() : 0;
    await enqueueMessage(r, delay);
  }
  return rows.length;
}
