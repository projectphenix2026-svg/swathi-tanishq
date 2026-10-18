// The sending queue is the messages table itself (an "outbox"):
// processDue() sends messages that are due, a few at a time. It runs every minute
// (Cloudflare Cron, or a timer when running in Node) and is also kicked right after a
// campaign launch or a reply so those go out at once. A message can only be claimed while
// queued or retrying, so overlapping runs never send anything twice.
import { query, NOW } from '../db/index.js';
import { config } from '../config.js';
import { pace } from './pacing.js';

let runner = null;
let scheduleBackground = (promise) => promise.catch((err) => console.error('[dispatch]', err));
let running = null;

/** Registered by the sender (avoids a circular import). */
export function setRunner(fn) {
  runner = fn;
}

/** Cloudflare passes its waitUntil here so background work finishes after the response. */
export function setBackground(fn) {
  scheduleBackground = fn;
}

/**
 * Sends up to `limit` due messages, `concurrency` at a time. Returns how many it handled.
 * Kept small per run so a Cloudflare invocation stays within its CPU budget.
 */
export async function processDue({ limit = config.sendBatchSize, concurrency = 3 } = {}) {
  if (!runner) throw new Error('No sender registered');
  const due = `direction = 'outbound' AND status IN ('queued', 'retrying') AND due_at <= ${NOW}`;
  const p = await pace();
  let rows;
  if (!p) {
    ({ rows } = await query(`SELECT id FROM messages WHERE ${due} ORDER BY due_at, id LIMIT $1`, [limit]));
  } else {
    // Replies and SMS are not limited; offers and wishes stop at Meta's daily limit and wait.
    const free = await query(
      `SELECT id FROM messages WHERE ${due} AND (channel = 'sms' OR (campaign_id IS NULL AND occasion_id IS NULL))
        ORDER BY due_at, id LIMIT $1`,
      [limit],
    );
    const room = Math.min(limit - free.rows.length, p.remaining);
    const paced = room > 0
      ? await query(
        `SELECT id FROM messages WHERE ${due} AND channel = 'whatsapp' AND (campaign_id IS NOT NULL OR occasion_id IS NOT NULL)
          ORDER BY due_at, id LIMIT $1`,
        [room],
      )
      : { rows: [] };
    rows = [...free.rows, ...paced.rows];
  }
  let next = 0;
  let handled = 0;
  const worker = async () => {
    while (next < rows.length) {
      const { id } = rows[next++];
      try {
        await runner(id);
      } catch (err) {
        console.error('[dispatch] message', id, err.message);
      }
      handled += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return handled;
}

/** Runs processDue soon, without blocking the caller; one run at a time per process. */
export function kick() {
  if (running) return running;
  running = processDue()
    .catch((err) => console.error('[dispatch]', err))
    .finally(() => {
      running = null;
    });
  scheduleBackground(running);
  return running;
}

/** Drains everything due (tests and the local timer use this). */
export async function drain(max = 1000) {
  let total = 0;
  for (let i = 0; i < max; i++) {
    if (running) await running; // let a kicked run finish first
    // Replies and fallbacks can kick a new run while we wait; loop until nothing is due.
    const n = await processDue();
    total += n;
    if (!n) break;
  }
  return total;
}
