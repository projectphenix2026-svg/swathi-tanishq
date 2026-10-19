import { Search, X } from 'lucide-react';

/** A search field with a clear button, used above every list in the app. */
export function SearchBox({ value, onChange, placeholder = 'Search', label, style }) {
  return (
    <div className="input-icon search-box" style={style}>
      <Search size={16} />
      <input className="input" type="search" placeholder={placeholder} aria-label={label || placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && <button type="button" className="search-clear" onClick={() => onChange('')} aria-label="Clear search"><X size={15} /></button>}
    </div>
  );
}

/** True when every word typed appears somewhere in the given fields (any order, any case). */
export function matches(q, ...fields) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}
