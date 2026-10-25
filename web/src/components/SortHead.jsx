// Sortable columns: click a heading to sort by it, click again to flip the order.
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

/**
 * rows: the list; by: { key: (row) => value } for each sortable column.
 * Returns the sorted rows and a <SortTh> for headings.
 */
export function useSort(rows, by, start = { key: null, dir: 'asc' }) {
  const [sort, setSort] = useState(start);
  const sorted = useMemo(() => {
    if (!rows || !sort.key || !by[sort.key]) return rows;
    const get = by[sort.key];
    const out = [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' });
    });
    return sort.dir === 'desc' ? out.reverse() : out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return { sorted, sort, setSort, toggle };
}

/** A heading button that shows which way the column is sorted. */
export function SortTh({ label, k, sort, toggle, as: Tag = 'th', className = '' }) {
  const on = sort.key === k;
  const Icon = !on ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <Tag className={className} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`sort-btn ${on ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(k); }}>
        {label}<Icon size={13} aria-hidden="true" />
      </button>
    </Tag>
  );
}
