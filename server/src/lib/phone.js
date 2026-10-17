// Phone numbers are stored in E.164 form (+919876543210).
// Indian numbers are the default; a number that already carries another
// country code (e.g. +1 for a test phone) is kept as it is.

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Normalises one phone value from a spreadsheet cell, a form or pasted text.
 * @returns {{ ok: true, e164: string, display: string, international: boolean } | { ok: false, reason: string }}
 */
export function normalizePhone(input) {
  if (input === null || input === undefined) return fail('Phone number is empty');

  let raw;
  if (typeof input === 'number') {
    // Excel stores numbers as floats; 9876543210 arrives as a number.
    if (!Number.isFinite(input) || !Number.isInteger(input)) return fail('Not a whole number');
    raw = String(input);
  } else {
    raw = String(input).trim();
  }
  if (!raw) return fail('Phone number is empty');

  // "9.87654321E+09" — a number Excel turned into scientific notation, then text.
  if (/^\d(\.\d+)?e\+?\d+$/i.test(raw)) {
    const n = Number(raw);
    if (Number.isInteger(n)) raw = String(n);
  }

  // Drop a trailing ".0" left by some spreadsheet exports.
  raw = raw.replace(/\.0+$/, '');

  if (/[a-z]/i.test(raw.replace(/^tel:|^whatsapp:/i, ''))) return fail('Contains letters');
  raw = raw.replace(/^tel:|^whatsapp:/i, '');

  let hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return fail('Phone number is empty');

  if (!hasPlus && digits.startsWith('00')) {
    hasPlus = true;
    digits = digits.slice(2);
  }

  if (hasPlus) {
    if (digits.startsWith('91')) return indian(digits.slice(2));
    if (digits.length < 8) return fail('Too short');
    if (digits.length > 15) return fail('Too long');
    return { ok: true, e164: `+${digits}`, display: `+${digits}`, international: true };
  }

  if (digits.length === 10) return indian(digits);
  if (digits.length === 11 && digits.startsWith('0')) return indian(digits.slice(1));
  if (digits.length === 12 && digits.startsWith('91')) return indian(digits.slice(2));
  if (digits.length === 13 && digits.startsWith('091')) return indian(digits.slice(3));
  if (digits.length < 10) return fail('Too short (need 10 digits)');
  return fail('Too long for an Indian mobile number');
}

function indian(ten) {
  if (ten.length < 10) return fail('Too short (need 10 digits)');
  if (ten.length > 10) return fail('Too long for an Indian mobile number');
  if (!INDIAN_MOBILE.test(ten)) return fail('Not a mobile number (Indian mobiles start with 6, 7, 8 or 9)');
  return {
    ok: true,
    e164: `+91${ten}`,
    display: `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`,
    international: false,
  };
}

function fail(reason) {
  return { ok: false, reason };
}

/** Pretty form for screens: +91 98765 43210. */
export function formatPhone(e164) {
  if (typeof e164 === 'string' && /^\+91\d{10}$/.test(e164)) {
    return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
  }
  return e164;
}
