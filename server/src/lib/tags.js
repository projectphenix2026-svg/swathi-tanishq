// Customer tags, used by the server and the browser (as @shared/tags.js).
// A tag is lower case with dashes for spaces, so "Bridal 2026" and "bridal-2026" are one tag.

/** Tags Sandesh adds by itself (shown as "Automatic"; staff can still pick them). */
export const AUTO_TAGS = ['interested', 'not-now', 'wrote-in'];
/** Tags only Sandesh uses (staff test phones, sample customers); never shown or picked. */
export const HIDDEN_TAGS = ['test-phone', 'sample', 'live-check'];

export function normalizeTag(t) {
  return String(t ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}

/** A list or comma-separated text ("bridal, gold; vip") to clean, unique tags (at most 20). */
export function tagsFrom(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[,;|\n]/);
  return [...new Set(list.map(normalizeTag).filter(Boolean))].slice(0, 20);
}

export const isHiddenTag = (t) => HIDDEN_TAGS.includes(t);
export const isAutoTag = (t) => AUTO_TAGS.includes(t);
