// Meta's approval of templates, kept up to date without anyone pressing "Check status":
// - every few minutes the once-a-minute job asks Meta about templates still waiting;
// - Meta's message_template_status_update webhook (when ticked in the Meta app) updates at once.
import { query } from '../db/index.js';
import { getProvider, buildProvider } from '../providers/index.js';
import { savedMetaProvider } from './whatsapp-connection.js';

const KIND = { IMAGE: 'a photo', VIDEO: 'a video' };
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** SQL for a copy of the template as it is now: what Meta approved, kept as approved_version. */
export const APPROVED_COPY = `json_object('provider_ref', provider_ref, 'language', language, 'body', body,
  'buttons', json(COALESCE(buttons, '[]')), 'image_url', image_url, 'video_url', video_url, 'approved_at', ${NOW})`;

/** Remembers the template as Meta approved it (only while it is approved). */
export async function rememberApproved(where, params) {
  await query(`UPDATE templates SET approved_version = ${APPROVED_COPY} WHERE ${where} AND provider_status = 'APPROVED'`, params);
}

/**
 * The version to send. A template changed after approval keeps sending the version Meta approved
 * until Meta approves the new one (or for good, if Meta rejects it).
 */
export function sendingVersion(t) {
  if (!t || t.provider_status === 'APPROVED' || !t.approved_version?.provider_ref) return t;
  return { ...t, ...t.approved_version, provider_status: 'APPROVED', sending_older: true };
}

/** The Meta provider to ask: the active one, else the saved connection, else from the environment. */
export function metaProvider() {
  const p = getProvider();
  if (p.name === 'meta') return p;
  return savedMetaProvider() || buildProvider('meta');
}

/**
 * Asks Meta for one template's status and saves it. Meta's version must carry the same kind of
 * header (photo, video or none): a template approved with a photo cannot send a video (#132018),
 * so then it is not approved and needs "Submit again". Returns { template, mismatch } or null.
 */
export async function syncTemplate(t, meta = metaProvider()) {
  const s = await meta.templateStatus(t.provider_ref);
  if (!s) return null;
  const want = t.video_url ? 'VIDEO' : t.image_url ? 'IMAGE' : null;
  const has = s.header === 'IMAGE' || s.header === 'VIDEO' ? s.header : null;
  const mismatch = s.status === 'APPROVED' && want !== has;
  const { rows: [u] } = await query(
    `UPDATE templates SET provider_status = $2, provider_reason = $3, updated_at = ${NOW} WHERE id = $1 RETURNING *`,
    [t.id, mismatch ? null : s.status, mismatch
      ? `Meta approved this message with ${KIND[has] || 'no photo or video'}, but it now has ${KIND[want] || 'none'}. Press “Submit again”.`
      : s.reason],
  );
  if (u.provider_status === 'APPROVED') {
    await rememberApproved('id = $1', [u.id]);
    return { template: (await query('SELECT * FROM templates WHERE id = $1', [u.id])).rows[0], mismatch };
  }
  return { template: u, mismatch };
}

/** Called by the once-a-minute job: templates still waiting for Meta get their latest status. */
export async function syncWaitingTemplates({ limit = 20 } = {}) {
  const meta = metaProvider();
  if (meta.missingConfig().length) return 0;
  const { rows } = await query(
    `SELECT * FROM templates WHERE provider_ref IS NOT NULL AND archived_at IS NULL
        AND upper(COALESCE(provider_status, '')) IN ('PENDING', 'IN_APPEAL')
      ORDER BY updated_at LIMIT $1`,
    [limit],
  );
  let changed = 0;
  for (const t of rows) {
    try {
      const r = await syncTemplate(t, meta);
      if (r && r.template.provider_status !== t.provider_status) changed += 1;
    } catch (err) {
      console.warn('[templates] could not check', t.provider_ref, err.message);
    }
  }
  return changed;
}

/** Meta's webhook: { name, language, status, reason } for a template it just reviewed. */
export async function applyTemplateStatus({ name, status, reason }) {
  if (!name || !status) return;
  await query(
    `UPDATE templates SET provider_status = $2, provider_reason = $3, updated_at = ${NOW} WHERE provider_ref = $1`,
    [name, status, reason && reason !== 'NONE' ? reason : null],
  );
  if (status === 'APPROVED') await rememberApproved('provider_ref = $1', [name]);
}
