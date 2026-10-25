// Indian formats everywhere: 1,24,000 and ₹1,070.50, times in India time.
const nf = new Intl.NumberFormat('en-IN');
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });

export const num = (n) => nf.format(Number(n) || 0);
export const inr = (n) => money.format(Number(n) || 0);
// Per-message rates keep all four decimals (₹0.8631).
export const rate = (n) => `₹${Number(n || 0).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
export const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

export function plural(n, one, many = `${one}s`) {
  return `${num(n)} ${Number(n) === 1 ? one : many}`;
}

const TZ = 'Asia/Kolkata';
export function dateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
export function dateOnly(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
}
export function timeOnly(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

export function ago(d) {
  if (!d) return '';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return dateOnly(d);
}

export function phone(e164) {
  if (typeof e164 === 'string' && /^\+91\d{10}$/.test(e164)) return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
  return e164 || '';
}

export function initials(name, fallback = '#') {
  // First letter (or digit) of the first two words; emoji and symbols are skipped.
  const letters = String(name || '').trim().split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0]).filter(Boolean);
  if (!letters.length) return fallback;
  return (letters[0] + (letters[1] || '')).toUpperCase();
}

const PALETTE = [
  ['#fbe9ef', '#8a1f45'], ['#e8f3ee', '#1c6b45'], ['#fdf2dc', '#8a5a00'], ['#e9effc', '#2448a8'],
  ['#f3eafc', '#6b2fa8'], ['#e6f6f7', '#11676e'], ['#fdeee8', '#a33d16'],
];
export function avatarColors(seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALETTE[h % PALETTE.length];
  return { background: bg, color: fg };
}

export function greeting() {
  const h = Number(new Date().toLocaleString('en-IN', { timeZone: TZ, hour: 'numeric', hour12: false }));
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
