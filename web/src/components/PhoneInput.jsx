import { useEffect, useState } from 'react';

// One phone field everywhere in the app: the country code on the left (+91 unless changed), the
// number on the right. The value given and returned is one string, "+91 98765 43210", which the
// server turns into the saved form (+919876543210).
export const COUNTRY_CODES = [
  ['91', 'IN', 'India'],
  ['971', 'AE', 'UAE'],
  ['966', 'SA', 'Saudi Arabia'],
  ['974', 'QA', 'Qatar'],
  ['968', 'OM', 'Oman'],
  ['965', 'KW', 'Kuwait'],
  ['973', 'BH', 'Bahrain'],
  ['1', 'US', 'USA / Canada'],
  ['44', 'UK', 'United Kingdom'],
  ['61', 'AU', 'Australia'],
  ['64', 'NZ', 'New Zealand'],
  ['65', 'SG', 'Singapore'],
  ['60', 'MY', 'Malaysia'],
  ['977', 'NP', 'Nepal'],
];
const LONGEST_FIRST = COUNTRY_CODES.map(([c]) => c).sort((a, b) => b.length - a.length);

/** "+91 98765 43210" → { code: '91', number: '98765 43210' }; a number without + is Indian. */
export function splitPhone(value) {
  const s = String(value || '').trim();
  if (s.startsWith('+') || s.startsWith('00')) {
    const digits = s.replace(/\D/g, '').replace(/^00/, '');
    const code = LONGEST_FIRST.find((c) => digits.startsWith(c));
    if (code) return { code, number: s.replace(/^(\+|00)\s*/, '').replace(new RegExp(`^${code}[\\s-]*`), '') };
  }
  return { code: '91', number: s };
}

export const joinPhone = (code, number) => (String(number).trim() ? `+${code} ${String(number).trim()}` : '');

export function PhoneInput({ value, onChange, id, invalid, placeholder = '98765 43210', ...rest }) {
  const parts = splitPhone(value);
  // The code is kept here too, so it stays picked while the number is still empty.
  const [code, setCode] = useState(parts.code);
  useEffect(() => {
    if (value) setCode(splitPhone(value).code);
  }, [value]);
  return (
    <span className="phone-input">
      <select className="select" aria-label="Country code" value={code} onChange={(e) => { setCode(e.target.value); onChange(joinPhone(e.target.value, parts.number)); }}>
        {COUNTRY_CODES.map(([c, short, name]) => <option key={c} value={c} title={name}>+{c} {short}</option>)}
      </select>
      <input
        id={id}
        className={`input ${invalid ? 'invalid' : ''}`}
        inputMode="tel"
        value={parts.number}
        // A whole number pasted with its own +code replaces the code too.
        onChange={(e) => onChange(/^\s*(\+|00)/.test(e.target.value) ? e.target.value.trim() : joinPhone(code, e.target.value))}
        placeholder={placeholder}
        {...rest}
      />
    </span>
  );
}
