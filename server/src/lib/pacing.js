// Meta's daily limit: a WhatsApp number may start conversations with only so many different
// customers in any 24 hours (250 for a new number, 2,000 after business verification, then
// 10,000, 1,00,000, unlimited). Offers and wishes beyond the limit simply wait in the queue
// and go out as the 24-hour window frees up, instead of failing.
import { config } from '../config.js';
import { query, ago } from '../db/index.js';
import { getProvider } from '../providers/index.js';

/** Meta's tier names -> customers a day (-1 = no limit). */
export const TIERS = { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: -1 };

/** Customers a day for the active channel, or null when there is no limit (test mode). */
export async function dailyLimit() {
  const provider = getProvider();
  if (provider.name === 'mock') return config.testDailyLimit > 0 ? config.testDailyLimit : null;
  const { rows: [c] } = await query('SELECT daily_limit FROM whatsapp_connection WHERE live = 1 ORDER BY client_id LIMIT 1');
  const n = c?.daily_limit ?? config.dailyLimit;
  return n === -1 || n == null ? null : Number(n);
}

/** Different customers who got an offer or wish (not a reply) in the last 24 hours. */
export async function usedLast24h() {
  const { rows: [r] } = await query(
    `SELECT count(DISTINCT contact_id) AS n FROM messages
      WHERE direction = 'outbound' AND channel = 'whatsapp' AND (campaign_id IS NOT NULL OR occasion_id IS NOT NULL)
        AND sent_at > ${ago('24 hours')}`,
  );
  return Number(r?.n || 0);
}

/** { limit, used, remaining } or null when there is no limit. */
export async function pace() {
  const limit = await dailyLimit();
  if (limit == null) return null;
  const used = await usedLast24h();
  return { limit, used, remaining: Math.max(0, limit - used) };
}

/**
 * When `count` more messages would be finished, given the pace (rough: assumes the next day's
 * full limit is free). Returns an ISO date, or null when they all fit in the next 24 hours.
 */
export function finishEstimate(count, p, now = new Date()) {
  if (!p || count <= p.remaining) return null;
  const days = Math.ceil((count - p.remaining) / p.limit);
  return new Date(now.getTime() + days * 24 * 3600 * 1000).toISOString();
}
