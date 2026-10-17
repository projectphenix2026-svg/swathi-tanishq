// Delivery status updates and incoming customer messages.
import { query } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { normalizePhone } from './phone.js';
import { fallbackToSms } from './sender.js';

// Replies that mean "I want this": the customer goes on the hot-lead call list.
const INTEREST_WORDS = ['interested', 'i am interested', 'im interested', 'book a visit', 'book visit', 'book', 'call me', 'yes', 'want to visit', 'see designs', 'see the designs'];
const NOT_NOW_WORDS = ['not now', 'no', 'later', 'not interested'];

/**
 * Tags the customer from their reply and opens a lead when it shows interest.
 * A tap on one of our quick-reply buttons counts too (the button text arrives as the reply).
 */
export async function trackInterest(clientId, contactId, inboundId, body) {
  const text = String(body || '').trim();
  const word = text.toLowerCase().replace(/[!.?]+$/, '');
  if (!word) return null;
  const { rows: [last] } = await query(
    `SELECT id, campaign_id, buttons FROM messages
      WHERE contact_id = $1 AND direction = 'outbound' AND (campaign_id IS NOT NULL OR occasion_id IS NOT NULL)
        AND created_at > now() - interval '30 days'
      ORDER BY created_at DESC LIMIT 1`,
    [contactId],
  );
  const quickReplies = (last?.buttons || []).filter((b) => b.type === 'quick_reply').map((b) => b.text.toLowerCase());
  const isNotNow = NOT_NOW_WORDS.includes(word);
  const isInterest = !isNotNow && (INTEREST_WORDS.includes(word) || quickReplies.includes(word));
  if (isNotNow) {
    await addTag(contactId, 'not-now');
    return null;
  }
  if (!isInterest) return null;
  await addTag(contactId, 'interested');
  const { rows: [open] } = await query(
    `SELECT id FROM leads WHERE contact_id = $1 AND status IN ('new', 'called')`,
    [contactId],
  );
  if (open) {
    await query(`UPDATE leads SET updated_at = now(), reason = $2 WHERE id = $1`, [open.id, text.slice(0, 60)]);
    return open.id;
  }
  const { rows: [lead] } = await query(
    `INSERT INTO leads (client_id, contact_id, message_id, campaign_id, reason) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [clientId, contactId, inboundId, last?.campaign_id || null, text.slice(0, 60)],
  );
  return lead.id;
}

async function addTag(contactId, tag) {
  await query(
    `UPDATE contacts SET tags = ARRAY(SELECT DISTINCT unnest(tags || ARRAY[$2::text])), updated_at = now() WHERE id = $1`,
    [contactId, tag],
  );
}

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
    await query(
      `UPDATE messages SET status = 'failed', failed_at = now(), error_code = $2, error_message = $3 WHERE id = $1`,
      [msg.id, errorCode, errorMessage || 'Not delivered'],
    );
    await fallbackToSms(msg.id);
    return true;
  }
  if (msg.status === 'failed' || (RANK[status] ?? -1) <= (RANK[msg.status] ?? -1)) return false;
  await query(
    `UPDATE messages SET status = $2,
            delivered_at = CASE WHEN $2 IN ('delivered', 'read') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
            read_at = CASE WHEN $2 = 'read' THEN COALESCE(read_at, now()) ELSE read_at END
      WHERE id = $1`,
    [msg.id, status],
  );
  return true;
}

const STOP_WORDS = ['stop', 'unsubscribe', 'stop all', 'opt out', 'optout'];
const START_WORDS = ['start', 'subscribe', 'opt in', 'unstop'];

/** Saves a customer's message to the shared inbox, and honours STOP / START. */
export async function recordInbound(clientId, { providerMessageId, from, profileName, body, mediaUrl, provider }) {
  const phone = normalizePhone(from);
  if (!phone.ok) return null;
  let { rows: [contact] } = await query('SELECT * FROM contacts WHERE client_id = $1 AND phone = $2', [
    clientId,
    phone.e164,
  ]);
  if (!contact) {
    // Someone new wrote to us: add them, but without marketing opt-in.
    ({ rows: [contact] } = await query(
      `INSERT INTO contacts (client_id, name, phone, tags) VALUES ($1, $2, $3, ARRAY['wrote-in'])
       ON CONFLICT (client_id, phone) DO UPDATE SET updated_at = now() RETURNING *`,
      [clientId, profileName || null, phone.e164],
    ));
  }
  const inserted = await query(
    `INSERT INTO messages (client_id, contact_id, direction, provider, idempotency_key, body, image_url, status, provider_message_id)
     VALUES ($1, $2, 'inbound', $3, $4, $5, $6, 'received', $7)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [clientId, contact.id, provider || getProvider().name, `in:${providerMessageId}`, body, mediaUrl, providerMessageId],
  );
  const word = String(body || '').trim().toLowerCase();
  if (STOP_WORDS.includes(word)) {
    await query(
      `UPDATE contacts SET whatsapp_opt_in = false, opted_out_at = now(), updated_at = now() WHERE id = $1`,
      [contact.id],
    );
  } else if (START_WORDS.includes(word)) {
    await query(
      `UPDATE contacts SET whatsapp_opt_in = true, opted_out_at = NULL, opt_in_at = now(),
              opt_in_source = 'WhatsApp reply: START', updated_at = now() WHERE id = $1`,
      [contact.id],
    );
  } else if (inserted.rows[0]) {
    await trackInterest(clientId, contact.id, inserted.rows[0].id, body);
  }
  return inserted.rows[0] ? { contactId: contact.id, messageId: inserted.rows[0].id } : null;
}

/**
 * Asks the provider for the status of recent messages. Only needed when the
 * provider cannot reach our webhook (e.g. running on a laptop without a tunnel).
 */
export async function pollStatuses(limit = 200) {
  const provider = getProvider();
  if (!provider.fetchStatus) return 0;
  const { rows } = await query(
    `SELECT provider_message_id FROM messages
      WHERE direction = 'outbound' AND provider = $1 AND status IN ('sent', 'delivered')
        AND sent_at > now() - interval '2 days'
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
