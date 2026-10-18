// Order and repair updates: tell one customer their order or repair is ready.
// Sent at once as a WhatsApp service (utility) message, much cheaper than an offer.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Avatar, Field, MessageStatus, Pic, Spinner, useToast } from '../components/ui.jsx';
import { dateTime, phone, rate } from '../lib/format.js';

const KINDS = [
  { key: 'order', pic: 'bag', title: 'Order ready', text: 'A new piece is ready to collect' },
  { key: 'repair', pic: 'gear', title: 'Repair ready', text: 'A repair or polish is done' },
];

export default function Updates() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [kind, setKind] = useState('order');
  const [item, setItem] = useState('');
  const [customer, setCustomer] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState(null);

  const loadRecent = () => api('/api/campaigns/updates').then(setRecent).catch(() => setRecent({ updates: [] }));
  useEffect(() => {
    loadRecent();
    const id = params.get('contact');
    if (id) api(`/api/customers?${new URLSearchParams({ q: '', limit: 200 })}`).then((r) => setCustomer(r.customers.find((c) => String(c.id) === id) || null)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => {
      api(`/api/customers?${new URLSearchParams({ q, limit: 8, sort: 'name' })}`).then((r) => setResults(r.customers)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function send() {
    setBusy(true);
    try {
      const r = await api('/api/campaigns/updates', { method: 'POST', body: { kind, item, contactId: customer.id } });
      toast(`Sent to ${r.to}`);
      setItem('');
      setCustomer(null);
      loadRecent();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const k = KINDS.find((x) => x.key === kind);
  const example = customer
    ? kind === 'order'
      ? `Hi ${customer.name || 'there'}, good news: your ${item || '…'} is ready for pickup at Swathi Tanishq. Please bring your bill or receipt. See you soon!`
      : `Hi ${customer.name || 'there'}, your ${item || '…'} has been repaired and is ready for pickup at Swathi Tanishq. Thank you for your patience!`
    : null;

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1>Order updates</h1>
          <p>Tell a customer their order or repair is ready. It goes at once, as a WhatsApp service message ({rate(recent?.costPerMessage ?? 0.115)} each).</p>
        </div>
      </div>
      <div className="two-col">
        <div className="stack">
          <div className="card card-pad stack">
            <h2>What is ready?</h2>
            <div className="ready-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {KINDS.map((x) => (
                <button key={x.key} type="button" className={`ready-card ${kind === x.key ? 'on' : ''}`} onClick={() => setKind(x.key)} aria-pressed={kind === x.key}>
                  <Pic name={x.pic} size={40} /><b>{x.title}</b><span>{x.text}</span>
                </button>
              ))}
            </div>
            <Field label="Item" hint="Shown in the message, e.g. “gold chain”, “diamond ring”, “bangles”.">
              <input className="input" value={item} onChange={(e) => setItem(e.target.value)} maxLength={60} placeholder="gold chain" />
            </Field>
          </div>

          <div className="card card-pad stack">
            <h2>Which customer?</h2>
            {customer ? (
              <div className="row between">
                <span className="row" style={{ gap: 10 }}><Avatar name={customer.name} seed={customer.phone} size={40} /><span><b>{customer.name || 'No name'}</b><span className="subtle num" style={{ display: 'block' }}>{phone(customer.phone)}</span></span></span>
                <button className="btn sm" onClick={() => setCustomer(null)}>Change</button>
              </div>
            ) : (
              <>
                <div className="input-icon"><Search size={16} /><input className="input" placeholder="Search by name or number" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                {results.map((c) => (
                  <button key={c.id} className="list-item" style={{ width: '100%', background: 'none', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', textAlign: 'left' }} onClick={() => { setCustomer(c); setQ(''); }}>
                    <Avatar name={c.name} seed={c.phone} size={34} />
                    <span><b>{c.name || 'No name'}</b><span className="subtle num" style={{ display: 'block' }}>{phone(c.phone)}</span></span>
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="action-bar">
            <span className="subtle">{customer && item ? `${k.title} → ${customer.name || phone(customer.phone)}` : 'Choose what is ready, the item and the customer.'}</span>
            <button className="btn wa lg" onClick={send} disabled={busy || !customer || !item.trim()}>{busy ? <Spinner /> : <><Send size={18} />Send now</>}</button>
          </div>
        </div>

        <aside className="stack sticky">
          {example && (
            <div className="card card-pad stack-sm">
              <b>The customer gets</b>
              <div className="bubble" style={{ maxWidth: '100%' }}>{example}</div>
            </div>
          )}
          <div className="card">
            <div className="card-head"><h3>Recently sent</h3></div>
            {!recent ? <div style={{ padding: 16 }}><Spinner /></div> : recent.updates.length === 0 ? (
              <p className="subtle" style={{ padding: 16 }}>Nothing sent yet.</p>
            ) : recent.updates.map((u) => (
              <div key={u.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{u.name}</b>
                  <div className="subtle">{dateTime(u.created_at)}{u.sent_by ? ` · by ${u.sent_by}` : ''}</div>
                  {u.error_message && <div className="subtle" style={{ color: 'var(--bad)' }}>{u.error_message}</div>}
                </div>
                <MessageStatus status={u.status} />
              </div>
            ))}
          </div>
          <Alert tone="info">Order updates don’t count towards the 2-offers-a-week limit, and only go to customers who agreed to WhatsApp.</Alert>
        </aside>
      </div>
    </div>
  );
}
