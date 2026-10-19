// The shop's own details (name, address, phone): saved in the database and edited by the owner in
// Settings. Messages take them from here when they are sent, so a change applies everywhere and
// no copy of the old name is left in saved messages or past settings.
import { query } from '../db/index.js';

const cache = new Map(); // clientId -> { at, shop }
const TTL = 30 * 1000;

export async function getShop(clientId) {
  const hit = cache.get(clientId);
  if (hit && Date.now() - hit.at < TTL) return hit.shop;
  const { rows: [c] } = await query('SELECT name, address, shop_phone, google_review_link FROM clients WHERE id = $1', [clientId]);
  const shop = {
    name: c?.name || '',
    address: c?.address || '',
    phone: c?.shop_phone || '',
    googleReviewLink: c?.google_review_link || '',
  };
  cache.set(clientId, { at: Date.now(), shop });
  return shop;
}

export function forgetShop(clientId) {
  cache.delete(clientId);
}

/** The {{store}}, {{address}} and {{shop_phone}} placeholders for this shop. */
export async function shopValues(clientId) {
  const s = await getShop(clientId);
  return { store: s.name, address: s.address, shop_phone: s.phone };
}

/** Placeholders filled from the shop's details, never from the customer or the offer. */
export const SHOP_KEYS = new Set(['store', 'address', 'shop_phone']);
