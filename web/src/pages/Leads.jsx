import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { SelectBar, allTicked, toggleIn } from '../components/SelectBar.jsx';
import { downloadCsv } from '../lib/csv.js';
import { Check, Download, Flame, MessageCircle, Phone, ShoppingBag, ThumbsDown, X } from 'lucide-react';
import { SearchBox, matches } from '../components/SearchBox.jsx';
import { SortTh, useSort } from '../components/SortHead.jsx';
import { api } from '../lib/api.js';
import { Avatar, Empty, Pic, SectionTabs, Skeleton, useToast } from '../components/ui.jsx';
import { useT } from '../lib/i18n.jsx';
import { ago, num, phone } from '../lib/format.js';

const TABS = [
  { key: '', label: 'To call' },
  { key: 'won', label: 'Bought' },
  { key: 'lost', label: 'Not interested' },
  { key: 'all', label: 'All' },
];
const STATUS_ORDER = { new: 0, called: 1, won: 2, lost: 3 };

export default function Leads() {
  const toast = useToast();
  const { counts, refreshCounts } = useOutletContext() || {};
  // Ticked customers: mark them all at once, or download a call list.
  const [sel, setSel] = useState(new Set());
  const [tab, setTab] = useState('');
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [offer, setOffer] = useState('');
  const [city, setCity] = useState('');
  const [waiting, setWaiting] = useState(false);
  const { t } = useT();

  const load = useCallback(() => {
    api(`/api/leads${tab ? `?status=${tab}` : ''}`).then(setData).catch(() => setData({ leads: [], counts: {} }));
  }, [tab]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function update(lead, status) {
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: { status } });
      toast(status === 'called' ? `Marked ${lead.name || 'customer'} as called` : status === 'won' ? 'Marked as bought' : status === 'lost' ? 'Marked as not interested' : 'Updated');
      load();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  async function bulk(status) {
    try {
      const r = await api('/api/leads/bulk', { method: 'POST', body: { ids: [...sel], status } });
      toast(`${r.done} marked ${({ called: 'called', won: 'bought', lost: 'not interested' })[status]}`);
      setSel(new Set());
      setData(null);
      load();
      refreshCounts?.();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
  function downloadCalls() {
    downloadCsv(`call-list-${new Date().toISOString().slice(0, 10)}.csv`, [
      { label: 'Name', value: (l) => l.name },
      { label: 'Phone', value: (l) => l.phone },
      { label: 'City', value: (l) => l.city },
      { label: 'Replied', value: (l) => l.reply || l.reason },
      { label: 'To offer', value: (l) => l.campaign_name },
      { label: 'Bought before', value: (l) => l.last_purchase },
      { label: 'Status', value: (l) => l.status },
    ], (data?.leads || []).filter((l) => sel.has(l.id)));
  }

  const c = data?.counts || {};
  const leads = data?.leads || [];
  // Filters: words, offer, city and "waiting more than a day"; then the chosen column order.
  const offers = useMemo(() => [...new Set(leads.map((l) => l.campaign_name).filter(Boolean))].sort(), [leads]);
  const cities = useMemo(() => [...new Set(leads.map((l) => (l.city || '').trim()).filter(Boolean))].sort(), [leads]);
  const shown = leads.filter((l) => matches(q, l.name, l.phone, l.city, l.campaign_name, l.reply)
    && (!offer || l.campaign_name === offer) && (!city || (l.city || '').trim() === city) && (!waiting || l.overdue));
  const { sorted, sort, toggle } = useSort(shown, {
    name: (l) => (l.name || '').toLowerCase(),
    city: (l) => (l.city || '').toLowerCase() || null,
    offer: (l) => (l.campaign_name || '').toLowerCase() || null,
    when: (l) => Date.parse(l.created_at),
    status: (l) => STATUS_ORDER[l.status] ?? 9,
  });
  const ids = sorted.map((l) => l.id);
  const filtered = Boolean(q || offer || city || waiting);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('Replies')}</h1>
          <p>{t('Customers who tapped “Interested”. Call them today, while they’re keen.')}</p>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}><SectionTabs tabs={[{ to: '/inbox', label: t('Chats'), count: counts?.unread }, { to: '/leads', label: t('Interested'), count: counts?.leads }]} /></div>
      {c.overdue > 0 && !tab && (
        <div className="alert bad" style={{ marginBottom: 12 }}>
          <Pic name="phone" size={30} />
          <div style={{ flex: 1 }}><b>{num(c.overdue)} {c.overdue === 1 ? 'customer has' : 'customers have'} waited more than a day.</b> Call them first: interest fades fast.</div>
          <button className="btn sm" onClick={() => setWaiting(true)}>Show them</button>
        </div>
      )}
      <div className="card list-tools" style={{ marginBottom: 12 }}>
        <SearchBox value={q} onChange={setQ} placeholder={t('Search name, phone, city or message')} style={{ flex: '1 1 220px' }} />
        <div className="chips">
          {TABS.map((x) => (
            <button key={x.key} className={`chip ${tab === x.key ? 'on' : ''}`} onClick={() => { setTab(x.key); setData(null); setSel(new Set()); }}>
              {t(x.label)} <span className="n">{num(x.key === 'all' ? Object.entries(c).filter(([k]) => k !== 'overdue').reduce((n, [, v]) => n + Number(v || 0), 0) : x.key ? c[x.key] || 0 : (c.new || 0) + (c.called || 0))}</span>
            </button>
          ))}
        </div>
        <select className="select sm" value={offer} onChange={(e) => setOffer(e.target.value)} aria-label="Offer">
          <option value="">All offers</option>
          {offers.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className="select sm" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
          <option value="">All cities</option>
          {cities.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <label className="row tick" style={{ gap: 6, fontSize: '0.88rem' }}>
          <input type="checkbox" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} />Waiting more than a day
        </label>
        {filtered && <button className="btn ghost sm" onClick={() => { setQ(''); setOffer(''); setCity(''); setWaiting(false); }}><X size={14} />Clear filters</button>}
      </div>
      <SelectBar count={sel.size} onClear={() => setSel(new Set())}>
        <button className="btn sm primary" onClick={() => bulk('called')}><Check size={15} />Called</button>
        <button className="btn sm" onClick={() => bulk('won')}><ShoppingBag size={15} />Bought</button>
        <button className="btn sm ghost" onClick={() => bulk('lost')}><ThumbsDown size={15} />Not interested</button>
        <button className="btn sm" onClick={downloadCalls}><Download size={15} />Download call list</button>
      </SelectBar>
      <div className="card">
        {!data ? (
          <div className="stack" style={{ padding: 20 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={44} />)}</div>
        ) : leads.length === 0 ? (
          <Empty icon={Flame} title={tab ? 'Nobody here yet' : 'No one to call right now'}>
            {tab ? 'Customers move here when you mark them.' : 'Customers who tap “Interested” on a message show up here, so you can call them.'}
          </Empty>
        ) : sorted.length === 0 ? (
          <p className="subtle" style={{ padding: 20 }}>{t('Nobody matches.')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table lead-table">
              <thead>
                <tr>
                  <th className="tick-col"><input type="checkbox" aria-label="Select all shown" checked={allTicked(sel, ids)} onChange={(e) => setSel(e.target.checked ? new Set(ids) : new Set())} /></th>
                  <SortTh label="Customer" k="name" sort={sort} toggle={toggle} />
                  <SortTh label="City" k="city" sort={sort} toggle={toggle} />
                  <th>Replied</th>
                  <SortTh label="To offer" k="offer" sort={sort} toggle={toggle} />
                  <SortTh label="When" k="when" sort={sort} toggle={toggle} />
                  <SortTh label="Status" k="status" sort={sort} toggle={toggle} />
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((l) => (
                  <tr key={l.id} className={sel.has(l.id) ? 'ticked' : ''}>
                    <td className="tick-col"><input type="checkbox" aria-label={`Select ${l.name || phone(l.phone)}`} checked={sel.has(l.id)} onChange={() => setSel((x) => toggleIn(x, l.id))} /></td>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Avatar name={l.name} seed={l.phone} size={32} />
                        <div style={{ minWidth: 0 }}><b>{l.name || phone(l.phone)}</b><div className="subtle num">{phone(l.phone)}</div></div>
                      </div>
                    </td>
                    <td>{l.city || <span className="subtle">—</span>}</td>
                    <td><span className="lead-reply">“{l.reply || l.reason}”</span>{l.last_purchase && <div className="subtle"><ShoppingBag size={12} style={{ verticalAlign: -1 }} /> bought {l.last_purchase}</div>}</td>
                    <td className="subtle">{l.campaign_name || '—'}</td>
                    <td className="subtle">{ago(l.created_at)}</td>
                    <td>
                      {l.status === 'new' && (l.overdue ? <span className="badge bad">Waiting {waited(l.created_at)}</span> : <span className="badge warn">New</span>)}
                      {l.status === 'called' && <span className="badge info">Called</span>}
                      {l.status === 'won' && <span className="badge ok">Bought</span>}
                      {l.status === 'lost' && <span className="badge neutral">Not interested</span>}
                      {l.updated_by_name && l.status !== 'new' && <div className="subtle" style={{ fontSize: '0.78rem' }}>by {l.updated_by_name} {ago(l.updated_at)}</div>}
                    </td>
                    <td>
                      <div className="lead-actions">
                        <a className="btn sm wa" href={`tel:${l.phone}`}><Phone size={14} />{t('Call')}</a>
                        <Link className="btn sm" to={`/inbox/${l.contact_id}`} aria-label="Chat"><MessageCircle size={14} /></Link>
                        {l.status === 'new' && <button className="btn sm" onClick={() => update(l, 'called')}><Check size={14} />{t('Called')}</button>}
                        {['new', 'called'].includes(l.status) && (
                          <>
                            <button className="btn sm" onClick={() => update(l, 'won')}><ShoppingBag size={14} />{t('Bought')}</button>
                            <button className="btn sm ghost" onClick={() => update(l, 'lost')} title="Not interested" aria-label="Not interested"><ThumbsDown size={14} /></button>
                          </>
                        )}
                        {['won', 'lost'].includes(l.status) && <button className="btn sm ghost" onClick={() => update(l, 'called')}><X size={14} />Reopen</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** "2 days" / "30 hours" since the customer said Interested. */
function waited(iso) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3600000);
  return h >= 48 ? `${Math.floor(h / 24)} days` : `${h} hours`;
}
