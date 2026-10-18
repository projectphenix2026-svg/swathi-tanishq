// Unique offer codes: PRIYA-DIWALI-4821. One per message, so a code entered at
// billing ties a sale back to the exact campaign or greeting that brought the customer in.
import crypto from 'node:crypto';
import { query } from '../db/index.js';

export function cleanPrefix(prefix, fallback = 'OFFER') {
  const p = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return p || fallback;
}

/** Makes a code not in `taken` (a Set, updated in place). */
export function makeOfferCode(name, prefix, taken) {
  const first = String(name || '').trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'GUEST';
  for (let i = 0; i < 50; i++) {
    const code = `${first}-${prefix}-${crypto.randomInt(1000, 10000)}`;
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  const code = `${first}-${prefix}-${crypto.randomInt(100000, 1000000)}`;
  taken.add(code);
  return code;
}

/** Codes already used with this prefix, so new ones never clash. */
export async function takenCodes(clientId, prefix) {
  const { rows } = await query(`SELECT offer_code FROM messages WHERE client_id = $1 AND offer_code LIKE $2`, [
    clientId,
    `%-${prefix}-%`,
  ]);
  return new Set(rows.map((r) => r.offer_code));
}

export function normaliseCode(code) {
  return String(code || '').toUpperCase().replace(/\s+/g, '').trim();
}
