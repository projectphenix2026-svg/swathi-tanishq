import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { Pic, Skeleton } from './ui.jsx';
import { num, plural } from '../lib/format.js';

const SECTIONS = {
  birthday: { id: 'birthdays', title: 'Birthdays', pic: 'cake', one: 'birthday', turning: 'turns' },
  anniversary: { id: 'anniversaries', title: 'Anniversaries', pic: 'ring', one: 'anniversary', turning: 'years married' },
};
const STATUS = {
  yes: ['ok', 'Gets the wish'],
  off: ['neutral', 'Wish is off'],
  not_chosen: ['neutral', 'Not chosen'],
  no_whatsapp: ['warn', 'No WhatsApp'],
};
const FILTERS = [['all', 'All'], ['30', 'Next 30 days'], ['month', 'This month'], ['no', 'Won’t get it']];
const SHOW = 8;

const shortDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const inDays = (n) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${num(n)} days`);
const hourText = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;

/**
 * One section of Special days for birthdays or anniversaries: they are set up automatically,
 * so this shows how many customers have the date saved, who will get the wish (and who will
 * not, and why), with search and quick filters.
 */
export function WishPeople({ kind, canEdit, today, reloadKey, onToggle, onEdit }) {
  const S = SECTIONS[kind];
  const [d, setD] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [all, setAll] = useState(false);
  useEffect(() => {
    api(`/api/occasions/people/${kind}`).then(setD).catch(() => setD({ people: [], counts: {}, occasion: null }));
  }, [kind, reloadKey]);

  const list = useMemo(() => {
    if (!d) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const month = today?.slice(5, 7);
    return d.people.filter((p) => (
      (filter === 'all'
        || (filter === '30' && p.days < 30)
        || (filter === 'month' && p.next.slice(5, 7) === month && p.next.slice(0, 4) === today.slice(0, 4))
        || (filter === 'no' && p.status !== 'yes'))
      && words.every((w) => `${p.name} ${p.city || ''}`.toLowerCase().includes(w))
    ));
  }, [d, q, filter, today]);

  if (!d) return <div id={S.id} className="card card-pad"><Skeleton h={120} /></div>;
  const o = d.occasion;
  const c = d.counts;
  const shown = all ? list : list.slice(0, SHOW);
  return (
    <section id={S.id} className="card wish-people" aria-label={S.title}>
      <div className="wp-head">
        <Pic name={S.pic} size={40} />
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h2>{S.title}</h2>
          <div className="subtle">
            {o ? <>Automatic · on the day, {hourText(o.send_hour)} · {o.template_name || 'wish'}</> : 'Switched off: no wish is set up.'}
          </div>
        </div>
        {o && canEdit && (
          <label className="switch" title={o.enabled ? 'Switch off' : 'Switch on'}>
            <input type="checkbox" checked={Boolean(o.enabled)} onChange={() => onToggle(o)} aria-label={`${S.title} wishes on`} />
            <span />
          </label>
        )}
        {canEdit && <button className="btn sm ghost" onClick={() => onEdit(o || { kind })}><Pencil size={14} />{o ? 'Change message' : 'Set up'}</button>}
      </div>

      <div className="wp-stats">
        <div><b className="num">{num(c.saved)}</b><span>{c.saved === 1 ? 'customer has' : 'customers have'} {kind === 'anniversary' ? 'an' : 'a'} {S.one} saved</span></div>
        <div><b className="num" style={{ color: 'var(--ok)' }}>{num(c.yes)}</b><span>will get the wish</span></div>
        <div><b className="num">{num(c.next30)}</b><span>in the next 30 days</span></div>
        {c.saved - c.yes > 0 && <div><b className="num" style={{ color: 'var(--text-3)' }}>{num(c.saved - c.yes)}</b><span>won’t get it</span></div>}
      </div>

      {c.saved === 0 ? (
        <p className="subtle wp-empty">
          No customer has {kind === 'anniversary' ? 'an' : 'a'} {S.one} saved yet. Add it on a customer (<Link to="/customers">Customers</Link> → open a customer) and the wish goes out by itself.
        </p>
      ) : (
        <>
          <div className="wp-tools">
            <div className="input-icon" style={{ flex: '1 1 200px' }}>
              <Search size={16} />
              <input className="input" placeholder="Search by name or city" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${S.title.toLowerCase()}`} />
            </div>
            <div className="chips">
              {FILTERS.map(([k, label]) => <button key={k} type="button" className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</button>)}
            </div>
          </div>
          {list.length === 0 ? <p className="subtle wp-empty">Nobody matches.</p> : (
            <ul className="wp-list">
              {shown.map((p) => {
                const [tone, label] = STATUS[p.status];
                return (
                  <li key={p.id}>
                    <span className="wp-date"><b>{shortDate(p.next)}</b><span>{inDays(p.days)}</span></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>{p.name}</b>
                      <span className="subtle"> {[p.city, p.years ? `${kind === 'birthday' ? 'turns' : ''} ${p.years}${kind === 'birthday' ? '' : ' years'}`.trim() : null].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className={`badge ${tone}`}>{label}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {list.length > SHOW && (
            <button className="btn ghost sm wp-more" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${plural(list.length, 'customer')}`}
            </button>
          )}
          {c.no_whatsapp > 0 && <p className="subtle wp-note">“No WhatsApp”: the customer has not agreed to WhatsApp messages, or replied STOP.</p>}
        </>
      )}
    </section>
  );
}
