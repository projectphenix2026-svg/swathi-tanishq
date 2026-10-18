// Template placeholders and personalisation.
// Placeholders are written as {{name}}, {{offer}} and so on.

export const VARIABLES = [
  { key: 'name', label: 'Customer name', source: 'customer', example: 'Priya' },
  { key: 'full_name', label: 'Full name', source: 'customer', example: 'Priya Sharma' },
  { key: 'city', label: 'City', source: 'customer', example: 'Hyderabad' },
  { key: 'last_purchase', label: 'Last purchase', source: 'customer', example: 'gold bangles' },
  { key: 'interests', label: 'Interests', source: 'customer', example: 'bridal jewellery' },
  { key: 'offer', label: 'Offer', source: 'campaign', example: '20% off making charges' },
  { key: 'offer_ends', label: 'Offer ends', source: 'campaign', example: '31 Oct' },
  { key: 'store', label: 'Store', source: 'campaign', example: 'Swathi Tanishq, Kukatpally' },
  { key: 'days_left', label: 'Days to go', source: 'occasion', example: '7' },
  // Made for each customer when the message is created; staff enter it at billing.
  { key: 'offer_code', label: 'Sales code', source: 'generated', example: 'PRIYA-DIWALI-4821' },
];

const KNOWN = new Set(VARIABLES.map((v) => v.key));
const PLACEHOLDER = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

export const MAX_BUTTONS = 2;
export const BUTTON_TYPES = ['url', 'phone', 'quick_reply'];

/** Placeholder keys in order of first appearance. */
export function extractVariables(body) {
  const keys = [];
  for (const m of String(body || '').matchAll(PLACEHOLDER)) {
    const k = m[1].toLowerCase();
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** Values for one customer, merged with campaign-wide values (offer, store...). */
export function valuesFor(contact, campaignVars = {}) {
  const full = String(contact?.name || '').trim();
  const first = full.split(/\s+/)[0] || '';
  return {
    name: titleCase(first),
    full_name: full,
    city: contact?.city || '',
    last_purchase: contact?.last_purchase || '',
    interests: contact?.interests || '',
    offer: campaignVars.offer || '',
    offer_ends: campaignVars.offer_ends || '',
    store: campaignVars.store || '',
    offer_code: campaignVars.offer_code || '',
    days_left: campaignVars.days_left ?? '',
  };
}

/** Fills placeholders. Returns the text and which placeholders had no value. */
export function render(body, values) {
  const missing = [];
  const text = String(body || '').replace(PLACEHOLDER, (_, key) => {
    const k = key.toLowerCase();
    const v = values[k];
    if (v === undefined || v === null || String(v).trim() === '') {
      if (!missing.includes(k)) missing.push(k);
      return `{{${k}}}`;
    }
    return String(v);
  });
  return { text, missing };
}

/** Checks a template before saving. Returns a list of plain-language problems. */
export function validateTemplate({ name, body, buttons = [], image_url }) {
  const errors = [];
  if (!String(name || '').trim()) errors.push('Give the template a name.');
  const text = String(body || '');
  if (!text.trim()) errors.push('Write the message.');
  if (text.length > 1024) errors.push(`The message is ${text.length} characters; WhatsApp allows 1,024.`);
  const unknown = extractVariables(text).filter((k) => !KNOWN.has(k));
  if (unknown.length) errors.push(`Unknown placeholder: ${unknown.map((k) => `{{${k}}}`).join(', ')}.`);
  if (/^\s*\{\{/.test(text) || /\}\}\s*$/.test(text)) {
    errors.push('WhatsApp does not allow a message to start or end with a placeholder. Add a word before or after it.');
  }
  if (image_url && !/^https:\/\/\S+$/i.test(image_url)) errors.push('The image link must start with https://');
  if (!Array.isArray(buttons)) {
    errors.push('Buttons are not valid.');
    return errors;
  }
  if (buttons.length > MAX_BUTTONS) errors.push(`Use at most ${MAX_BUTTONS} buttons.`);
  buttons.forEach((b, i) => {
    const n = i + 1;
    if (!BUTTON_TYPES.includes(b?.type)) errors.push(`Button ${n}: choose a button type.`);
    const label = String(b?.text || '').trim();
    if (!label) errors.push(`Button ${n}: add the button text.`);
    if (label.length > 25) errors.push(`Button ${n}: keep the text to 25 characters.`);
    if (b?.type === 'url' && !/^https?:\/\/\S+\.\S+/i.test(b.url || '')) errors.push(`Button ${n}: add a full website link (https://...).`);
    if (b?.type === 'phone' && !/^\+\d{8,15}$/.test(String(b.phone || '').replace(/[\s-]/g, ''))) {
      errors.push(`Button ${n}: add the phone number with country code, e.g. +91 98765 43210.`);
    }
  });
  return errors;
}

export function cleanButtons(buttons = []) {
  return buttons.slice(0, MAX_BUTTONS).map((b) => {
    const out = { type: b.type, text: String(b.text || '').trim() };
    if (b.type === 'url') out.url = String(b.url || '').trim();
    if (b.type === 'phone') out.phone = String(b.phone || '').replace(/[\s-]/g, '');
    return out;
  });
}

function titleCase(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
