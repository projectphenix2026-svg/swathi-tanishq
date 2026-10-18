import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Flame, MessageCircle, Phone, ShoppingBag, ThumbsDown, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Avatar, Empty, SectionTabs, Skeleton, useToast } from '../components/ui.jsx';
import { ago, num, phone } from '../lib/format.js';

const TABS = [
  { key: '', label: 'To call' },
  { key: 'won', label: 'Bought' },
  { key: 'lost', label: 'Not interested' },
];

export default function Leads() {
  const toast = useToast();
  const [tab, setTab] = useState('');
  const [data, setData] = useState(null);

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

  const c = data?.counts || {};
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1>Replies</h1>
          <p>Customers who tapped “Interested” or asked for a call. Call them today, while they’re keen.</p>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}><SectionTabs tabs={[{ to: '/inbox', label: 'Messages' }, { to: '/leads', label: 'Call back list' }]} /></div>
      <div className="chips" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} className={`chip ${tab === t.key ? 'on' : ''}`} onClick={() => { setTab(t.key); setData(null); }}>
            {t.label} <span className="n">{num(t.key ? c[t.key] || 0 : (c.new || 0) + (c.called || 0))}</span>
          </button>
        ))}
      </div>
      <div className="card">
        {!data ? (
          <div className="stack" style={{ padding: 20 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={56} />)}</div>
        ) : data.leads.length === 0 ? (
          <Empty icon={Flame} title={tab ? 'Nobody here yet' : 'No one to call right now'}>
            {tab ? 'Leads move here when you mark them.' : 'Add a quick-reply button like “Interested” or “Call me back” to a saved message. Everyone who taps it shows up here.'}
          </Empty>
        ) : (
          data.leads.map((l) => (
            <div key={l.id} className="lead-card">
              <Avatar name={l.name} seed={l.phone} size={44} />
              <div style={{ minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <b>{l.name || phone(l.phone)}</b>
                  {l.status === 'new' && <span className="badge bad">New</span>}
                  {l.status === 'called' && <span className="badge info">Called</span>}
                  {l.status === 'won' && <span className="badge ok">Bought</span>}
                  {l.status === 'lost' && <span className="badge neutral">Not interested</span>}
                </div>
                <div className="subtle num">{phone(l.phone)}{l.city ? ` · ${l.city}` : ''}</div>
                <div className="muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                  Replied <b>“{l.reply || l.reason}”</b> {ago(l.created_at)}{l.campaign_name ? ` to ${l.campaign_name}` : ''}
                  {l.last_purchase && <span> · <ShoppingBag size={13} style={{ verticalAlign: -2 }} /> bought {l.last_purchase}</span>}
                </div>
                {l.updated_by_name && l.status !== 'new' && <div className="subtle">Updated by {l.updated_by_name} {ago(l.updated_at)}</div>}
              </div>
              <div className="lead-actions">
                <a className="btn sm wa" href={`tel:${l.phone}`}><Phone size={15} />Call</a>
                <Link className="btn sm" to={`/inbox/${l.contact_id}`}><MessageCircle size={15} />Chat</Link>
                {l.status === 'new' && <button className="btn sm" onClick={() => update(l, 'called')}><Check size={15} />Called</button>}
                {['new', 'called'].includes(l.status) && (
                  <>
                    <button className="btn sm" onClick={() => update(l, 'won')}><ShoppingBag size={15} />Bought</button>
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
