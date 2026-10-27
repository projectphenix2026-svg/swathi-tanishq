// When Meta says the shop's number is no longer on the WhatsApp Business API (#133010 "Account not
// registered", for example after WhatsApp Business was reinstalled or unlinked on the shop phone),
// every WhatsApp send would fail. Sending pauses instead: messages wait in the queue, a red banner
// says what happened, and sending carries on once the number is reconnected.
import { query, NOW } from '../db/index.js';
import { config } from '../config.js';
import { loadConnection } from './whatsapp-connection.js';

/** Meta errors that mean the number itself cannot send: not registered, deregistered, account locked. */
export const DISCONNECTED_CODES = new Set(['133010', '133000', '131031']);

export const isDisconnectError = (err) => DISCONNECTED_CODES.has(String(err?.code ?? ''));

/** { since, code } while WhatsApp sending is paused, else null. */
export async function sendingPaused() {
  const { rows: [r] } = await query(
    'SELECT disconnected_at, disconnect_code FROM whatsapp_connection WHERE disconnected_at IS NOT NULL ORDER BY client_id LIMIT 1',
  );
  return r ? { since: r.disconnected_at, code: r.disconnect_code } : null;
}

/** Pauses WhatsApp sending (keeps the first time it happened). */
export async function markDisconnected(code) {
  await query(
    `UPDATE whatsapp_connection SET disconnected_at = COALESCE(disconnected_at, ${NOW}), disconnect_code = $1`,
    [String(code)],
  );
}

/**
 * Sending carries on: the pause is lifted and messages that failed because the number was
 * disconnected (in the last 3 days) go back in the queue. Returns how many were put back.
 */
export async function resumeSending() {
  await query('UPDATE whatsapp_connection SET disconnected_at = NULL, disconnect_code = NULL');
  const codes = JSON.stringify([...DISCONNECTED_CODES]);
  const { rowCount } = await query(
    `UPDATE messages SET status = 'queued', error_code = NULL, error_message = NULL, attempts = 0, due_at = ${NOW}
      WHERE direction = 'outbound' AND channel = 'whatsapp' AND status = 'failed'
        AND error_code IN (SELECT value FROM json_each($1))
        AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days')`,
    [codes],
  );
  await query(
    `UPDATE campaigns SET status = 'sending', completed_at = NULL
      WHERE status = 'completed' AND id IN (SELECT campaign_id FROM messages WHERE status = 'queued' AND campaign_id IS NOT NULL)`,
  );
  return rowCount ?? 0;
}

/**
 * While paused, asks Meta every few minutes whether the number is back on the API; if it is,
 * sending carries on by itself. Returns true when it resumed.
 */
export async function checkReconnected({ fetchImpl = fetch } = {}) {
  if (!(await sendingPaused())) return false;
  const c = await loadConnection();
  if (!c?.token || !c.phone_number_id) return false;
  try {
    const res = await fetchImpl(
      `https://graph.facebook.com/${config.meta.graphVersion}/${encodeURIComponent(c.phone_number_id)}?fields=status,platform_type`,
      { headers: { Authorization: `Bearer ${c.token}` } },
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.platform_type === 'CLOUD_API' && String(data.status).toUpperCase() === 'CONNECTED') {
      const back = await resumeSending();
      console.log(`[whatsapp] number reconnected; sending resumed (${back} message(s) back in the queue)`);
      return true;
    }
  } catch (err) {
    console.warn('[whatsapp] could not check the number:', err.message);
  }
  return false;
}
