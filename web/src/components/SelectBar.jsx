// The bar that appears when rows are ticked in a list: how many, what can be done with them, Clear.
import { X } from 'lucide-react';
import { num } from '../lib/format.js';

export function SelectBar({ count, onClear, children, note }) {
  if (!count) return null;
  return (
    <div className="select-bar" role="region" aria-label="Selected rows">
      <b className="num">{num(count)} selected</b>
      {note && <span className="subtle">{note}</span>}
      <span className="select-actions">{children}</span>
      <button type="button" className="btn ghost sm" onClick={onClear}><X size={15} />Clear</button>
    </div>
  );
}

/** Tick/untick helpers for a Set of ids kept in state. */
export const toggleIn = (set, id) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
};
export const allTicked = (set, ids) => ids.length > 0 && ids.every((id) => set.has(id));
