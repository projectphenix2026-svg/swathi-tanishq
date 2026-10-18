// The shop's own WhatsApp (Meta) account, connected by the owner from Settings.
// - checkMeta(): asks Meta whether the IDs and key work, and subscribes the app to the account.
// - refreshProvider(): when the connection is switched on ("live"), every send uses it;
//   otherwise the app keeps the provider from the environment (test mode).
import { config } from '../config.js';
import { query } from '../db/index.js';
import { buildProvider, setProvider } from '../providers/index.js';
import { createMetaProvider } from '../providers/meta.js';
import { open } from './secretbox.js';
import { TIERS } from './pacing.js';

const CHECK_EVERY_MS = 30_000;
let lastCheck = 0;
let appliedKey = null; // which connection state the current provider was built from
let connectionProvider = null; // Meta provider from the saved connection (live or not)

/** The saved connection with the key and app secret opened (server side only). */
export async function loadConnection() {
  const { rows: [row] } = await query('SELECT * FROM whatsapp_connection ORDER BY client_id LIMIT 1');
  if (!row) return null;
  return { ...row, live: Boolean(row.live), token: await open(row.token_sealed), appSecret: await open(row.app_secret_sealed) };
}

export function metaFromConnection(c) {
  return createMetaProvider({
    accessToken: c.token || '',
    phoneNumberId: c.phone_number_id,
    wabaId: c.waba_id,
    appSecret: c.appSecret || '',
    verifyToken: c.verify_token,
    graphVersion: config.meta.graphVersion,
  });
}

/**
 * Keeps the active provider in step with the saved connection. Cheap: looks at the database at
 * most every 30 seconds per server instance, or at once with { force: true } (after a change).
 * With no saved connection it changes nothing, so the environment's provider stays in use.
 */
export async function refreshProvider({ force = false } = {}) {
  if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = Date.now();
  const { rows: [row] } = await query('SELECT live, updated_at FROM whatsapp_connection ORDER BY client_id LIMIT 1');
  const key = row ? `${row.live}:${row.updated_at}` : null;
  if (key === appliedKey) return;
  const wasConnection = appliedKey !== null;
  appliedKey = key;
  if (!row) {
    connectionProvider = null;
    if (wasConnection) setProvider(buildProvider(config.provider));
    return;
  }
  const c = await loadConnection();
  connectionProvider = c?.token ? metaFromConnection(c) : null;
  if (c?.live && connectionProvider) setProvider(connectionProvider);
  else if (wasConnection) setProvider(buildProvider(config.provider));
}

/** Meta provider for template approval and webhooks: the saved connection if there is one. */
export function savedMetaProvider() {
  return connectionProvider;
}

/** The verify token Meta must echo when the webhook is set up (saved connection or env). */
export async function webhookVerifyToken() {
  const { rows: [row] } = await query('SELECT verify_token FROM whatsapp_connection ORDER BY client_id LIMIT 1');
  return row?.verify_token || config.meta.verifyToken || '';
}

/** Plain-language reason for a Graph API error while connecting. */
function explain(e = {}) {
  const code = Number(e.code);
  if (code === 190) return 'This key has expired or was copied wrongly. Create a permanent key (guide step 5) and paste it again.';
  if (code === 10 || code === 200 || code === 3) return 'This key is missing WhatsApp permissions. When creating it, tick whatsapp_business_messaging and whatsapp_business_management.';
  if (code === 100) return 'Meta could not find this Phone number ID or WhatsApp account ID for this key. Copy both again from WhatsApp Manager → API setup.';
  if (code === 131031) return 'Meta has locked this WhatsApp account until the business is verified. Finish Business Verification in Meta’s Security Centre.';
  return e.message ? `Meta said: ${e.message}` : 'Meta did not accept these details.';
}

/**
 * Checks the details with Meta. Returns { ok, phone, name, quality, expiresAt, warnings[] } or
 * { ok: false, error }. Also subscribes the app to the WhatsApp account so replies and delivery
 * updates reach the webhook.
 */
export async function checkMeta({ phoneNumberId, wabaId, token }, { fetchImpl = fetch } = {}) {
  const v = config.meta.graphVersion;
  const get = async (path) => {
    const res = await fetchImpl(`https://graph.facebook.com/${v}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  };
  let phone;
  try {
    phone = await get(`${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier`);
  } catch {
    return { ok: false, error: 'Could not reach Meta. Check the internet connection and try again.' };
  }
  if (!phone.ok) return { ok: false, error: explain(phone.data.error) };
  const waba = await get(`${encodeURIComponent(wabaId)}?fields=name,account_review_status`);
  if (!waba.ok) return { ok: false, error: explain(waba.data.error) };

  const warnings = [];
  if (waba.data.account_review_status && waba.data.account_review_status !== 'APPROVED') {
    warnings.push(`Meta’s review of this WhatsApp account is “${waba.data.account_review_status.toLowerCase()}”. Messages may not go out until it is approved.`);
  }
  if (phone.data.code_verification_status && phone.data.code_verification_status !== 'VERIFIED') {
    warnings.push('The phone number is not verified yet. Verify it with the code Meta sends (guide step 2).');
  }
  // Subscribe our app to the account so webhooks arrive (safe to repeat).
  const sub = await fetchImpl(`https://graph.facebook.com/${v}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.ok).catch(() => false);
  if (!sub) warnings.push('Could not switch on replies and delivery updates for this account. Check the webhook step in the guide.');

  let expiresAt = null;
  const dbg = await get(`debug_token?input_token=${encodeURIComponent(token)}`).catch(() => null);
  const exp = dbg?.data?.data?.expires_at;
  if (exp) {
    expiresAt = new Date(exp * 1000).toISOString();
    warnings.push(`This key stops working on ${new Date(exp * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. Use a permanent key (guide step 5) so sending never stops.`);
  }
  return {
    ok: true,
    phone: phone.data.display_phone_number || null,
    name: phone.data.verified_name || null,
    quality: phone.data.quality_rating || null,
    limitTier: phone.data.messaging_limit_tier || null,
    dailyLimit: TIERS[phone.data.messaging_limit_tier] ?? null,
    expiresAt,
    warnings,
  };
}

/**
 * Meta raises (or lowers) the number's daily limit over time; check it every 6 hours while
 * real sending is on, so the queue paces itself to the current limit.
 */
export async function refreshDailyLimit({ fetchImpl = fetch } = {}) {
  const { rows: [row] } = await query(
    `SELECT client_id FROM whatsapp_connection WHERE live = 1
        AND (limit_checked_at IS NULL OR limit_checked_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 hours'))
      ORDER BY client_id LIMIT 1`,
  );
  if (!row) return null;
  const c = await loadConnection();
  let tier = null;
  try {
    const res = await fetchImpl(
      `https://graph.facebook.com/${config.meta.graphVersion}/${encodeURIComponent(c.phone_number_id)}?fields=messaging_limit_tier,quality_rating`,
      { headers: { Authorization: `Bearer ${c.token}` } },
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      tier = data.messaging_limit_tier || null;
      await query(
        `UPDATE whatsapp_connection SET limit_tier = COALESCE($2, limit_tier), daily_limit = COALESCE($3, daily_limit),
                quality = COALESCE($4, quality), limit_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE client_id = $1`,
        [row.client_id, tier, TIERS[tier] ?? null, data.quality_rating || null],
      );
    } else {
      await query(`UPDATE whatsapp_connection SET limit_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE client_id = $1`, [row.client_id]);
    }
  } catch (err) {
    console.warn('[whatsapp] could not check the daily limit:', err.message);
  }
  return tier;
}

/** For tests. */
export function resetConnectionCache() {
  lastCheck = 0;
  appliedKey = null;
  connectionProvider = null;
}

