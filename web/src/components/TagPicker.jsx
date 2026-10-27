// Tags: a searchable dropdown to pick one or more, with how many customers have each. Where
// new tags are allowed (customer form, import, bulk), typing a new name offers "Add “…”".
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Tag, X } from 'lucide-react';
import { normalizeTag } from '@shared/tags.js';
import { api } from '../lib/api.js';
import { num } from '../lib/format.js';

/** Every tag in use: [{ tag, count, auto }] (Sandesh's hidden tags left out). */
export function useTagOptions() {
  const [tags, setTags] = useState([]);
  const load = () => api('/api/customers/summary').then((s) => setTags(s.tags || [])).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  return [tags, load];
}

export function TagPicker({ value = [], onChange, options = [], allowNew = false, placeholder = 'Tags', label = 'Tags', compact = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const input = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const wanted = normalizeTag(q);
  const list = useMemo(() => {
    const known = new Map(options.map((o) => [o.tag, o]));
    for (const t of value) if (!known.has(t)) known.set(t, { tag: t, count: 0 });
    const all = [...known.values()].filter((o) => !q || o.tag.includes(wanted) || o.tag.includes(q.toLowerCase()));
    return { mine: all.filter((o) => !o.auto), auto: all.filter((o) => o.auto) };
  }, [options, value, q, wanted]);
  const exists = options.some((o) => o.tag === wanted) || value.includes(wanted);

  const toggle = (t) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  const add = () => {
    if (!wanted) return;
    if (!value.includes(wanted)) onChange([...value, wanted]);
    setQ('');
    input.current?.focus();
  };
  const row = (o) => (
    <button key={o.tag} type="button" role="option" aria-selected={value.includes(o.tag)} className={`tp-opt ${value.includes(o.tag) ? 'on' : ''}`}
      onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(o.tag)}>
      <span className="tp-box">{value.includes(o.tag) && <Check size={13} strokeWidth={3} />}</span>
      <span className="tp-name">{o.tag}</span>
      {o.count > 0 && <span className="subtle num">{num(o.count)}</span>}
    </button>
  );

  return (
    <div className={`tp ${compact ? 'compact' : ''}`} ref={ref}>
      <div className={`tp-field ${open ? 'open' : ''}`} onClick={() => { setOpen(true); input.current?.focus(); }}>
        <Tag size={15} className="tp-ic" />
        {value.map((t) => (
          <span key={t} className="tp-chip">{t}<button type="button" aria-label={`Remove ${t}`} onClick={(e) => { e.stopPropagation(); toggle(t); }}><X size={12} /></button></span>
        ))}
        <input
          ref={input}
          className="tp-input"
          value={q}
          placeholder={value.length ? '' : placeholder}
          aria-label={label}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || (allowNew && e.key === ',')) {
              e.preventDefault();
              const first = [...list.mine, ...list.auto][0];
              if (allowNew && wanted && !exists) add();
              else if (first && q) { toggle(first.tag); setQ(''); }
            } else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
        <ChevronDown size={15} className="tp-ic" />
      </div>
      {open && (
        <div className="tp-menu" role="listbox" aria-multiselectable="true">
          {allowNew && wanted && !exists && (
            <button type="button" className="tp-opt tp-new" onMouseDown={(e) => e.preventDefault()} onClick={add}><Plus size={14} />Add “{wanted}”</button>
          )}
          {list.mine.length > 0 && <div className="tp-group">Your tags</div>}
          {list.mine.map(row)}
          {list.auto.length > 0 && <div className="tp-group">Automatic (added by Sandesh)</div>}
          {list.auto.map(row)}
          {!list.mine.length && !list.auto.length && !(allowNew && wanted) && (
            <div className="tp-empty subtle">{q ? 'No tag matches.' : allowNew ? 'Type a tag, e.g. vip, then Enter.' : 'No tags yet. Add them on customers or in the Excel file.'}</div>
          )}
        </div>
      )}
    </div>
  );
}
