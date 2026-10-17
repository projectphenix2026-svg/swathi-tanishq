// The queue worker: sends one message.
// "Exactly once" comes from the database, not the queue: a message can only be
// claimed while it is queued or retrying, so a repeated job finds nothing to do.
import { query } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { getQueue } from '../queue/index.js';

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
  let campaign = null;
  let template = null;
  if (msg.campaign_id) {
    campaign = (await query('SELECT * FROM campaigns WHERE id = $1', [msg.campaign_id])).rows[0];
    if (campaign.status === 'cancelled') {
      await setFinal(msg.id, 'cancelled', null, 'Campaign was cancelled');
      return { skipped: 'cancelled' };
    }
    if (contact.opted_out_at) {
      await setFinal(msg.id, 'cancelled', null, 'Customer opted out before sending');
      await finishCampaignIfDone(msg.campaign_id);
      return { skipped: 'opted out' };
    }
    if (campaign.status === 'scheduled') {
      await query(
        `UPDATE campaigns SET status = 'sending', started_at = COALESCE(started_at, now())
          WHERE id = $1 AND status = 'scheduled'`,
        [campaign.id],
      );
    }
  }
  if (msg.template_id) {
    template = (await query('SELECT * FROM templates WHERE id = $1', [msg.template_id])).rows[0];
  }

  const provider = getProvider();
  try {
    const payload = {
      to: contact.phone,
      body: msg.body,
      buttons: msg.buttons || [],
      imageUrl: msg.image_url,
      template,
      values: msg.template_values,
      idempotencyKey: msg.idempotency_key,
    };
    const result = campaign ? await provider.send(payload) : await provider.sendText(payload);
    await query(
      `UPDATE messages
          SET status = 'sent', provider = $2, provider_message_id = $3, sent_at = now(),
              cost = $4, error_code = NULL, error_message = NULL
        WHERE id = $1`,
      [msg.id, provider.name, result.providerMessageId, campaign ? campaign.cost_per_message : null],
    );
  } catch (err) {
    const willRetry = Boolean(err.retryable) && attempt < maxAttempts;
    if (willRetry) {
      await query(
        `UPDATE messages SET status = 'retrying', error_code = $2, error_message = $3 WHERE id = $1`,
        [msg.id, err.code || null, err.message],
      );
      throw err; // the queue tries again after a back-off
    }
    await setFinal(msg.id, 'failed', err.code || null, err.message);
  }
  if (msg.campaign_id) await finishCampaignIfDone(msg.campaign_id);
  return { sent: true };
}

async function setFinal(id, status, code, message) {
  await query(
    `UPDATE messages SET status = $2, error_code = $3, error_message = $4,
            failed_at = CASE WHEN $2 = 'failed' THEN now() ELSE failed_at END
      WHERE id = $1`,
    [id, status, code, message],
  );
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
        AND (c.id IS NULL OR c.status <> 'cancelled')
      ORDER BY m.id`,
  );
  for (const r of rows) {
    const delay = r.scheduled_at ? new Date(r.scheduled_at).getTime() - Date.now() : 0;
    await enqueueMessage(r, delay);
  }
  return rows.length;
}
