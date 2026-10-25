import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { SelectBar, allTicked, toggleIn } from '../components/SelectBar.jsx';
import { downloadCsv } from '../lib/csv.js';
import { Check, Download, Flame, MessageCircle, Phone, ShoppingBag, ThumbsDown, X } from 'lucide-react';
import { SearchBox, matches } from '../components/SearchBox.jsx';
import { api } from '../lib/api.js';
import { Avatar, Empty, Pic, SectionTabs, Skeleton, useToast } from '../components/ui.jsx';
import { useT } from '../lib/i18n.jsx';
import { ago, num, phone } from '../lib/format.js';

const TABS = [
  { key: '', label: 'To call' },
  { key: 'won', label: 'Bought' },
  { key: 'lost', label: 'Not interested' },
];

export default function Leads() {
  const toast = useToast();
  const { counts, refreshCounts } = useOutletContext() || {};
  // Ticked customers: mark them all at once, or download a call list.
  const [sel, setSel] = useState(new Set());
  const [tab, setTab] = useState('');
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
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
  return (
    <div className="page" style={{ maxWidth: 980 }}>
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
        </div>
      )}
      <div className="row wrap" style={{ gap: 10, marginBottom: 16, alignItems: 'center' }}>
      <SearchBox value={q} onChange={setQ} placeholder={t('Search name, phone, city or message')} style={{ flex: '1 1 240px', maxWidth: 360 }} />
      <div className="chips">
        {TABS.map((x) => (
          <button key={x.key} className={`chip ${tab === x.key ? 'on' : ''}`} onClick={() => { setTab(x.key); setData(null); }}>
            {t(x.label)} <span className="n">{num(x.key ? c[x.key] || 0 : (c.new || 0) + (c.called || 0))}</span>
          </button>
        ))}
      </div>
      </div>
      <SelectBar count={sel.size} onClear={() => setSel(new Set())}>
        <button className="btn sm primary" onClick={() => bulk('called')}><Check size={15} />Called</button>
        <button className="btn sm" onClick={() => bulk('won')}><ShoppingBag size={15} />Bought</button>
        <button className="btn sm ghost" onClick={() => bulk('lost')}><ThumbsDown size={15} />Not interested</button>
        <button className="btn sm" onClick={downloadCalls}><Download size={15} />Download call list</button>
      </SelectBar>
      {data?.leads?.length > 0 && (
        <label className="row tick" style={{ gap: 8, margin: '0 0 8px 4px', fontSize: '0.88rem' }}>
          <input type="checkbox" checked={allTicked(sel, data.leads.map((l) => l.id))} onChange={(e) => setSel(e.target.checked ? new Set(data.leads.map((l) => l.id)) : new Set())} />
          <span className="subtle">Select all shown</span>
        </label>
      )}
      <div className="card">
        {!data ? (
          <div className="stack" style={{ padding: 20 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={56} />)}</div>
        ) : data.leads.length === 0 ? (
          <Empty icon={Flame} title={tab ? 'Nobody here yet' : 'No one to call right now'}>
            {tab ? 'Customers move here when you mark them.' : 'Customers who tap “Interested” on a message show up here, so you can call them.'}
          </Empty>
        ) : !data.leads.some((l) => matches(q, l.name, l.phone, l.city, l.campaign_name, l.reply)) ? (
          <p className="subtle" style={{ padding: 20 }}>{t('Nobody matches.')}</p>
        ) : (
          data.leads.filter((l) => matches(q, l.name, l.phone, l.city, l.campaign_name, l.reply)).map((l) => (
            <div key={l.id} className={`lead-card ${sel.has(l.id) ? 'ticked' : ''}`}>
              <span className="row tick" style={{ gap: 10 }}>
                <input type="checkbox" aria-label={`Select ${l.name || phone(l.phone)}`} checked={sel.has(l.id)} onChange={() => setSel((x) => toggleIn(x, l.id))} />
                <Avatar name={l.name} seed={l.phone} size={44} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <b>{l.name || phone(l.phone)}</b>
                  {l.status === 'new' && (l.overdue ? <span className="badge bad">Waiting {waited(l.created_at)}</span> : <span className="badge warn">New</span>)}
                  {l.status === 'called' && <span className="badge info">Called</span>}
                  {l.status === 'won' && <span className="badge ok">Bought</span>}
                  {l.status === 'lost' && <span className="badge neutral">Not interested</span>}
                </div>
                <div className="subtle num">{phone(l.phone)}{l.city ? ` · ${l.city}` : ''}</div>
                <div className="muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                  Replied <b>“{l.reply || l.reason}”</b> {ago(l.created_at)}{l.campaign_name ? ` to ${l.campaign_name}` : ''}
                  {l.last_purchase && <span> · <ShoppingBag size={13} style={{ verticalAlign: -2 }} /> bought {l.last_purchase}</span>}
                </div>
                {l.updated_by_name && l.status !== 'new' && <div className="subtle">{l.status === 'won' ? 'Bought' : l.status === 'lost' ? 'Marked not interested' : 'Called'} by {l.updated_by_name} {ago(l.updated_at)}</div>}
              </div>
              <div className="lead-actions">
                <a className="btn sm wa" href={`tel:${l.phone}`}><Phone size={15} />{t('Call')}</a>
                <Link className="btn sm" to={`/inbox/${l.contact_id}`}><MessageCircle size={15} />{t('Chat')}</Link>
                {l.status === 'new' && <button className="btn sm" onClick={() => update(l, 'called')}><Check size={15} />{t('Called')}</button>}
                {['new', 'called'].includes(l.status) && (
                  <>
                    <button className="btn sm" onClick={() => update(l, 'won')}><ShoppingBag size={15} />{t('Bought')}</button>
                    <button className="btn sm ghost" onClick={() => update(l, 'lost')} title="Not interested"><ThumbsDown size={15} /></button>
                  </>
                )}
                {['won', 'lost'].includes(l.status) && <button className="btn sm ghost" onClick={() => update(l, 'called')}><X size={15} />Reopen</button>}
              </div>
            </div>
          ))
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
