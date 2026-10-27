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

/** Meta's view of the number: { status, platformType, connected }. Throws if Meta cannot be reached. */
async function numberStatus(c, fetchImpl) {
  const res = await fetchImpl(
    `https://graph.facebook.com/${config.meta.graphVersion}/${encodeURIComponent(c.phone_number_id)}?fields=status,platform_type`,
    { headers: { Authorization: `Bearer ${c.token}` } },
  );
  const data = await res.json().catch(() => ({}));
  const status = String(data.status || '').toUpperCase() || null;
  // A number used with both the WhatsApp Business app and the API reports CLOUD_API; one that is
  // off the API reports NOT_APPLICABLE.
  const connected = res.ok && status === 'CONNECTED' && data.platform_type !== 'NOT_APPLICABLE';
  return { status, platformType: data.platform_type || null, connected };
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
    if ((await numberStatus(c, fetchImpl)).connected) {
      const back = await resumeSending();
      console.log(`[whatsapp] number reconnected; sending resumed (${back} message(s) back in the queue)`);
      return true;
    }
  } catch (err) {
    console.warn('[whatsapp] could not check the number:', err.message);
  }
  return false;
}

/**
 * After Meta's "connect your WhatsApp Business app" pop-up finished for the saved number:
 * switch replies and delivery updates back on for our app, ask Meta whether the number is
 * connected, and if it is, carry on sending.
 * Returns { subscribed, status, platformType, connected, requeued }.
 */
export async function afterBusinessAppSignup(c, { fetchImpl = fetch } = {}) {
  const subscribed = await fetchImpl(
    `https://graph.facebook.com/${config.meta.graphVersion}/${encodeURIComponent(c.waba_id)}/subscribed_apps`,
    { method: 'POST', headers: { Authorization: `Bearer ${c.token}` } },
  ).then((r) => r.ok).catch(() => false);
  const s = await numberStatus(c, fetchImpl).catch(() => ({ status: null, platformType: null, connected: false }));
  const requeued = s.connected ? await resumeSending() : 0;
  return { subscribed, ...s, requeued };
}
