// Meta's approval of a template, in plain words. Once WhatsApp is connected, only templates
// Meta has approved can be sent, so this is what the Templates page and the pickers show.
const WAITING = new Set(['PENDING', 'IN_APPEAL', 'PENDING_DELETION', 'LIMIT_EXCEEDED']);

/** 'approved' | 'waiting' | 'rejected' | 'not_sent' for a saved template (null if none). */
export function metaState(t) {
  const s = String(t?.provider_status || '').toUpperCase();
  if (!t || !s) return 'not_sent';
  if (s === 'APPROVED') return 'approved';
  if (WAITING.has(s)) return 'waiting';
  return 'rejected';
}

/** Badge tone and label for each state. */
export const META_BADGE = {
  approved: ['ok', 'Approved by Meta'],
  waiting: ['warn', 'Waiting for Meta'],
  rejected: ['bad', 'Rejected by Meta'],
  not_sent: ['neutral', 'Not sent to Meta'],
};

export const isApproved = (t) => metaState(t) === 'approved';

/** Can go to customers now: approved, or changed after approval (the approved version keeps sending). */
export const canSend = (t) => isApproved(t) || Boolean(t?.approved_version?.provider_ref);

/** The state a template picker shows: 'approved' while an approved version still sends. */
export const pickState = (t) => (canSend(t) ? 'approved' : metaState(t));
