// Delivery status updates, incoming customer messages, and interest tracking.
import { query, NOW, ago } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { normalizePhone } from './phone.js';
import { fallbackToSms } from './sender.js';

// A status can only move forward (a late "delivered" never overwrites "read").
const RANK = { queued: 0, retrying: 0, sending: 1, sent: 2, delivered: 3, read: 4 };

export async function applyStatus({ providerMessageId, status, errorCode, errorMessage }) {
  if (!providerMessageId || !status) return false;
  const { rows: [msg] } = await query(
    `SELECT id, status FROM messages WHERE provider_message_id = $1 AND direction = 'outbound'`,
    [providerMessageId],
  );
  if (!msg) return false;
  if (status === 'failed') {
    if (['delivered', 'read', 'failed'].includes(msg.status)) return false;
    if (await retryTomorrow(msg.id, errorCode)) return true;
    await query(
      `UPDATE messages SET status = 'failed', failed_at = ${NOW}, error_code = $2, error_message = $3 WHERE id = $1`,
      [msg.id, errorCode, errorMessage || 'Not delivered'],
    );
    await fallbackToSms(msg.id);
    return true;
  }
  if (msg.status === 'failed' || (RANK[status] ?? -1) <= (RANK[msg.status] ?? -1)) return false;
  await query(
    `UPDATE messages SET status = $2,
            delivered_at = CASE WHEN $2 IN ('delivered', 'read') THEN COALESCE(delivered_at, ${NOW}) ELSE delivered_at END,
            read_at = CASE WHEN $2 = 'read' THEN COALESCE(read_at, ${NOW}) ELSE read_at END
      WHERE id = $1`,
    [msg.id, status],
  );
  return true;
}

/**
 * Meta's per-person marketing limit (error 131049): Meta decided this customer has had enough
 * offers from all businesses today. Not the customer's fault, so try once more after 24 hours
 * instead of marking it failed. Returns true when the message was put back in the queue.
 */
export async function retryTomorrow(messageId, errorCode) {
  if (String(errorCode) !== '131049') return false;
  const { rowCount } = await query(
    `UPDATE messages SET status = 'retrying', retried_at = ${NOW}, provider_message_id = NULL, cost = NULL,
            error_code = '131049', error_message = 'Meta limits how many offers one person gets from all businesses. Trying again tomorrow.',
            due_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+24 hours')
      WHERE id = $1 AND retried_at IS NULL AND (campaign_id IS NOT NULL OR occasion_id IS NOT NULL)`,
    [messageId],
  );
  return (rowCount ?? 0) > 0;
}

// Opt-out and opt-in replies in English, Telugu and Hindi (also typed in English letters).
// "వద్దు" / "नहीं" alone mean "not this offer" (see NOT_NOW_WORDS), not "never message me".
const STOP_WORDS = [
  'stop', 'unsubscribe', 'stop all', 'opt out', 'optout', 'stop messages', 'dont send', "don't send",
  'ఆపు', 'ఆపండి', 'ఆపేయండి', 'మెసేజ్‌లు ఆపండి', 'మెసేజ్ లు ఆపండి', 'మెసేజ్‌లు వద్దు', 'మెసేజ్ లు వద్దు', 'పంపకండి', 'బంద్', 'బంద్ చేయండి', 'aapu', 'apandi', 'aapandi',
  'बंद', 'बंद करो', 'बंद करें', 'बंद कीजिए', 'रोको', 'मैसेज बंद करो', 'मैसेज मत भेजो', 'मत भेजो', 'मत भेजिए', 'band karo', 'band',
];
const START_WORDS = [
  'start', 'subscribe', 'opt in', 'unstop',
  'ప్రారంభించు', 'ప్రారంభించండి', 'మళ్ళీ పంపండి', 'మళ్లీ పంపండి', 'మొదలు',
  'शुरू', 'शुरू करो', 'शुरू करें', 'फिर से भेजो', 'फिर से भेजें', 'shuru', 'shuru karo',
];
// Replies that mean "I want this": the customer goes on the hot-lead call list.
const NOT_NOW_WORDS = ['not now', 'no', 'later', 'not interested', 'ఇప్పుడు కాదు', 'వద్దు', 'अभी नहीं', 'नहीं'];

async function addTag(contactId, tag) {
  await query(
    `UPDATE contacts SET tags = (SELECT json_group_array(DISTINCT value) FROM (SELECT value FROM json_each(contacts.tags) UNION SELECT $2)),
            updated_at = ${NOW}
      WHERE id = $1`,
    [contactId, tag],
  );
}

/**
 * Tags the customer from their reply and opens a lead when they tap one of our quick-reply
 * buttons (the button text arrives as the reply). Typed words like "yes" do not count:
 * the Interested list is only for button taps.
 */
export async function trackInterest(clientId, contactId, inboundId, body) {
  const text = String(body || '').trim();
  const word = text.toLowerCase().replace(/[!.?]+$/, '');
  if (!word) return null;
  const { rows: [last] } = await query(
    `SELECT id, campaign_id, buttons FROM messages
      WHERE contact_id = $1 AND direction = 'outbound' AND (campaign_id IS NOT NULL OR occasion_id IS NOT NULL)
        AND created_at > ${ago('30 days')}
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [contactId],
  );
  const quickReplies = (last?.buttons || []).filter((b) => b.type === 'quick_reply').map((b) => b.text.toLowerCase());
  const isNotNow = NOT_NOW_WORDS.includes(word);
  const isInterest = !isNotNow && quickReplies.includes(word);
  if (isNotNow) {
    await addTag(contactId, 'not-now');
    return null;
  }
  if (!isInterest) return null;
  await addTag(contactId, 'interested');
  const { rows: [open] } = await query(`SELECT id FROM leads WHERE contact_id = $1 AND status IN ('new', 'called')`, [contactId]);
  if (open) {
    await query(`UPDATE leads SET updated_at = ${NOW}, reason = $2 WHERE id = $1`, [open.id, text.slice(0, 60)]);
    return open.id;
  }
  const { rows: [lead] } = await query(
    `INSERT INTO leads (client_id, contact_id, message_id, campaign_id, reason) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [clientId, contactId, inboundId, last?.campaign_id || null, text.slice(0, 60)],
  );
  return lead.id;
}

/** Saves a customer's message to the shared inbox, honours STOP / START, and tracks interest. */
export async function recordInbound(clientId, { providerMessageId, from, profileName, body, mediaUrl, media, provider }) {
  const phone = normalizePhone(from);
  if (!phone.ok) return null;
  let { rows: [contact] } = await query('SELECT * FROM contacts WHERE client_id = $1 AND phone = $2', [clientId, phone.e164]);
  if (!contact) {
    // Someone new wrote to us: add them, but without marketing opt-in.
    ({ rows: [contact] } = await query(
      `INSERT INTO contacts (client_id, name, phone, tags) VALUES ($1, $2, $3, '["wrote-in"]')
       ON CONFLICT (client_id, phone) DO UPDATE SET updated_at = ${NOW} RETURNING *`,
      [clientId, profileName || null, phone.e164],
    ));
  }
  const inserted = await query(
    `INSERT INTO messages (client_id, contact_id, direction, provider, idempotency_key, body, image_url, status, provider_message_id,
                           media_type, media_ref, media_mime, media_name)
     VALUES ($1, $2, 'inbound', $3, $4, $5, $6, 'received', $7, $8, $9, $10, $11)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [clientId, contact.id, provider || getProvider().name, `in:${providerMessageId}`, body, mediaUrl, providerMessageId,
      media?.type || null, media?.ref || null, media?.mime || null, media?.name || null],
  );
  const word = String(body || '').trim().toLowerCase().replace(/[!.?।]+$/, '').replace(/\s+/g, ' ');
  if (STOP_WORDS.includes(word)) {
    await query(`UPDATE contacts SET whatsapp_opt_in = 0, sms_opt_in = 0, opted_out_at = ${NOW}, updated_at = ${NOW} WHERE id = $1`, [contact.id]);
  } else if (START_WORDS.includes(word)) {
    await query(
      `UPDATE contacts SET whatsapp_opt_in = 1, opted_out_at = NULL, opt_in_at = ${NOW},
              opt_in_source = 'WhatsApp reply: START', updated_at = ${NOW} WHERE id = $1`,
      [contact.id],
    );
  } else if (inserted.rows[0]) {
    await trackInterest(clientId, contact.id, inserted.rows[0].id, body);
  }
  return inserted.rows[0] ? { contactId: contact.id, messageId: inserted.rows[0].id } : null;
}

/**
 * Asks the provider for the status of recent messages. Only needed when the provider
 * cannot reach our webhook (Twilio without a public address).
 */
export async function pollStatuses(limit = 50) {
  const provider = getProvider();
  if (!provider.fetchStatus) return 0;
  const { rows } = await query(
    `SELECT provider_message_id FROM messages
      WHERE direction = 'outbound' AND provider = $1 AND status IN ('sent', 'delivered') AND sent_at > ${ago('2 days')}
      ORDER BY sent_at DESC LIMIT $2`,
    [provider.name, limit],
  );
  let changed = 0;
  for (const r of rows) {
    try {
      const s = await provider.fetchStatus(r.provider_message_id);
      if (s?.status && (await applyStatus(s))) changed += 1;
    } catch (err) {
      console.warn('[status-poll]', err.message);
    }
  }
  return changed;
}
