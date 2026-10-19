// "Pick customers": one list with filters (city, group, bought or likes), tick or untick single
// people, and the reason anyone is left out. Used by Send a message and by Special days.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Avatar, Spinner } from './ui.jsx';
import { ago, num, phone, plural } from '../lib/format.js';

const REASON = {
  stop: 'Said STOP',
  consent: 'Has not agreed to messages',
  details: 'Missing details this template needs',
};
export function CustomersStep({ t, filters, setFilters, pick, setPick, templateId, variables, channel, preview, wish = false, title = 'Pick customers' }) {
  const [summary, setSummary] = useState(null);
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [limit, setLimit] = useState(50);
  const [showWhy, setShowWhy] = useState(false);

  useEffect(() => {
    api('/api/customers/summary').then(setSummary).catch(() => {});
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      api('/api/campaigns/audience-list', { method: 'POST', body: { audience: { mode: 'filter', ...filters }, templateId, variables, channel, q, limit, wish } })
        .then(setList)
        .catch(() => setList({ customers: [], total: 0 }));
    }, 250);
    return () => clearTimeout(timer);
  }, [filters, templateId, variables, channel, q, limit, wish]);

  const set = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPick({ only: false, ids: [] });
  };
  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const ticked = (id) => (pick.only ? pick.ids.includes(id) : !pick.ids.includes(id));
  const tick = (id) => setPick((p) => ({ ...p, ids: toggleIn(p.ids, id) }));
  const anyFilter = filters.cities.length || filters.tags.length || filters.search;
  const leftOut = preview ? preview.matched - preview.sendable : 0;

  return (
    <div className="card card-pad stack" style={{ gap: 12 }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <h2>{t(title)}</h2>
        <span className="row" style={{ gap: 6 }}>
          <button className="btn ghost sm" onClick={() => setPick({ only: false, ids: [] })}>Tick all</button>
          <button className="btn ghost sm" onClick={() => setPick({ only: true, ids: [] })}>Untick all</button>
        </span>
      </div>

      <div className="filter-row">
        {summary?.cities.map((c) => (
          <button key={c.city} type="button" className={`chip ${filters.cities.includes(c.city.toLowerCase()) ? 'on' : ''}`} onClick={() => set({ cities: toggleIn(filters.cities, c.city.toLowerCase()) })}>
            {c.city} <span className="n">{num(c.count)}</span>
          </button>
        ))}
        {summary?.tags.filter((x) => !['live-check', 'test-phone'].includes(x.tag)).map((x) => (
          <button key={x.tag} type="button" className={`chip ${filters.tags.includes(x.tag) ? 'on' : ''}`} onClick={() => set({ tags: toggleIn(filters.tags, x.tag) })}>
            {x.tag} <span className="n">{num(x.count)}</span>
          </button>
        ))}
        <div className="input-icon filter-search">
          <Search size={15} />
          <input id="likes" className="input" placeholder="Bought or likes, e.g. bridal" value={filters.search} onChange={(e) => set({ search: e.target.value })} />
        </div>
        {anyFilter ? <button className="btn ghost sm" onClick={() => set({ cities: [], tags: [], search: '' })}><X size={14} />Clear filters</button> : null}
      </div>

      {preview && (
        <div className={`send-sum ${preview.sendable ? 'ok' : 'warn'}`}>
          <b>{plural(preview.sendable, 'customer')} will get it</b>
          {leftOut > 0 && (
            <>
              <span> · {num(leftOut)} left out </span>
              <button className="link-btn" onClick={() => setShowWhy((x) => !x)}>{showWhy ? 'Hide why' : 'See why'}</button>
            </>
          )}
          {showWhy && <LeftOut preview={preview} isSms={channel === 'sms'} />}
        </div>
      )}

      <div className="input-icon">
        <Search size={15} />
        <input id="find" className="input" placeholder="Find a customer by name or number" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="pick-list">
        {!list ? (
          <div style={{ padding: 16 }}><Spinner /></div>
        ) : list.customers.length === 0 ? (
          <p className="subtle" style={{ padding: 14 }}>No customers match.</p>
        ) : (
          list.customers.map((c) => {
            const can = !c.reason;
            const on = can && ticked(c.id);
            return (
              <label key={c.id} className={`pick-row ${can ? '' : 'off'}`}>
                <input type="checkbox" checked={on} disabled={!can} onChange={() => tick(c.id)} />
                <Avatar name={c.name} seed={c.phone} size={30} />
                <span style={{ minWidth: 0 }}>
                  <b>{c.name || phone(c.phone)}</b>
                  <span className="subtle"> · {[c.city, c.interests || c.last_purchase].filter(Boolean).join(' · ') || phone(c.phone)}</span>
                </span>
                {!can && <span className="tag-warn">{c.reason === 'cap' ? `Already got ${plural(c.offers, 'message')} this week` : REASON[c.reason]}</span>}
              </label>
            );
          })
        )}
        {list && list.total > list.customers.length && (
          <button className="btn ghost sm" style={{ margin: 8 }} onClick={() => setLimit((n) => n + 100)}>Show more ({num(list.total - list.customers.length)})</button>
        )}
      </div>
    </div>
  );
}

/** Who already got this week's messages: named, with their last one, so nobody wonders where they went. */
export function AlreadyGot({ preview }) {
  const people = preview.atCapPeople || [];
  const many = preview.weeklyCap === 1 ? 'a message' : `${preview.weeklyCap} messages`;
  return (
    <div className="stack-sm" style={{ marginTop: 8 }}>
      <b>{preview.atCap === 1 ? '1 customer already got' : `${num(preview.atCap)} customers already got`} {many} this week</b>
      {people.map((c) => (
        <span key={c.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Avatar name={c.name} seed={c.phone} size={22} />
          <span><b>{c.name || phone(c.phone)}</b>{c.lastOffer && <span className="subtle"> · last: “{c.lastOffer}”, {ago(c.lastAt)}</span>}</span>
        </span>
      ))}
      {preview.atCap > people.length && <span className="subtle">and {num(preview.atCap - people.length)} more</span>}
      <span className="subtle">WhatsApp can block shops that send too often, so each customer gets at most {many} in 7 days. The owner can change this in <Link to="/settings">Settings</Link>.</span>
    </div>
  );
}

/** Why some customers will not get this message, one line per reason. */
export function LeftOut({ preview, isSms }) {
  const details = preview.eligible - preview.sendable - (preview.atCap || 0);
  const lines = [
    preview.no_opt_in > 0 && `${plural(preview.no_opt_in, 'customer')} ${preview.no_opt_in === 1 ? 'has' : 'have'} not agreed to ${isSms ? 'SMS' : 'WhatsApp'} messages.`,
    preview.opted_out > 0 && `${plural(preview.opted_out, 'customer')} said STOP.`,
    details > 0 && `${plural(details, 'customer')} ${details === 1 ? 'is' : 'are'} missing details this template needs, or unticked.`,
  ].filter(Boolean);
  return (
    <div className="stack-sm">
      {preview.atCap > 0 && <AlreadyGot preview={preview} />}
      {lines.map((l) => <span key={l} className="subtle">• {l}</span>)}
    </div>
  );
}
