// The shop's own details (from Settings → Shop details) as the placeholders messages use.
export function shopVars(settings) {
  const s = settings?.shop || {};
  return { store: s.name || '', address: s.address || '', shop_phone: s.phone || '' };
}

/** The placeholders that come from the shop's details, not from the customer or the offer. */
export const SHOP_KEYS = ['store', 'address', 'shop_phone'];
