import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, MapPin, Search, ShoppingBag, UserPlus, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { downloadSample } from '../lib/sample.js';
import { Avatar, Empty, Field, Modal, OptInBadge, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { dateOnly, num, phone } from '../lib/format.js';

const FILTERS = [
  { key: 'all', label: 'All', count: 'total' },
  { key: 'opted_in', label: 'Can receive WhatsApp', count: 'opted_in' },
  { key: 'no_opt_in', label: 'No opt-in', count: 'no_opt_in' },
  { key: 'opted_out', label: 'Opted out', count: 'opted_out' },
];
const PAGE = 50;

export default function Customers() {
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null);

  const reload = () => {
    api('/api/customers/summary').then(setSummary).catch(() => {});
    const params = new URLSearchParams({ filter, q, limit: PAGE, offset: page * PAGE });
    api(`/api/customers?${params}`).then(setData).catch(() => setData({ customers: [], total: 0 }));
  };

  useEffect(() => {
    const t = setTimeout(reload, q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, q, page]);

  useEffect(() => setPage(0), [filter, q]);

  if (summary && summary.total === 0) {
    return (
      <div className="page">
        <div className="page-head"><h1>Customers</h1></div>
        <div className="card">
          <Empty
            icon={Users}
            title="Add your first customers"
            actions={
              <>
                <Link to="/customers/add" className="btn primary"><UserPlus size={18} />Add customers</Link>
                <button className="btn" onClick={downloadSample}><Download size={18} />Sample Excel file</button>
              </>
            }
          >
            Upload the customer list you already have (Excel or CSV), or add people one by one. Download the sample file to see which columns help personalise messages.
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p>{summary ? `${num(summary.opted_in)} of ${num(summary.total)} can receive WhatsApp offers` : ' '}</p>
        </div>
        <Link to="/customers/add" className="btn primary"><UserPlus size={18} />Add customers</Link>
      </div>

      <div className="stack">
        <div className="input-icon">
          <Search size={18} />
          <input className="input" placeholder="Search by name, phone, city or purchase" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
        </div>
        <div className="chips" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip ${filter === f.key ? 'on' : ''}`} onClick={() => setFilter(f.key)} role="tab" aria-selected={filter === f.key}>
              {f.label} {summary && <span className="n">{num(summary[f.count])}</span>}
            </button>
          ))}
        </div>

        <div className="card">
          {!data ? (
            <div className="stack" style={{ padding: 20 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={36} />)}</div>
          ) : data.customers.length === 0 ? (
            <p className="muted" style={{ padding: 24, textAlign: 'center' }}>No customers match. Try another search or filter.</p>
          ) : (
            <>
              <div className="table-wrap hide-mobile">
                <table className="table">
                  <thead>
                    <tr><th>Customer</th><th>Phone</th><th>City</th><th>Last purchase</th><th>WhatsApp</th><th>Added</th></tr>
                  </thead>
                  <tbody>
                    {data.customers.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => setEditing(c)}>
                        <td>
                          <div className="row" style={{ gap: 10 }}>
                            <Avatar name={c.name} seed={c.phone} size={34} />
                            <div>
                              <b>{c.name || <span className="muted">No name</span>}</b>
                              {c.interests && <div className="subtle">{c.interests}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="num">{phone(c.phone)}</td>
                        <td>{c.city || <span className="subtle">—</span>}</td>
                        <td>{c.last_purchase || <span className="subtle">—</span>}</td>
                        <td><OptInBadge c={c} /></td>
                        <td className="subtle">{dateOnly(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="show-mobile">
                {data.customers.map((c) => (
                  <button key={c.id} className="list-item" onClick={() => setEditing(c)} style={{ width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer' }}>
                    <Avatar name={c.name} seed={c.phone} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{c.name || 'No name'}</b>
                      <div className="subtle num">{phone(c.phone)}{c.city ? ` · ${c.city}` : ''}</div>
                    </div>
                    <OptInBadge c={c} />
                  </button>
                ))}
              </div>
              {data.total > PAGE && (
                <div className="row between" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                  <span className="subtle">{num(page * PAGE + 1)}–{num(Math.min((page + 1) * PAGE, data.total))} of {num(data.total)}</span>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
                    <button className="btn sm" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage((p) => p + 1)}>Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {editing && <EditCustomer c={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function EditCustomer({ c, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: c.name || '', city: c.city || '', last_purchase: c.last_purchase || '', interests: c.interests || '',
    birthday: c.birthday ? String(c.birthday).slice(0, 10) : '', anniversary: c.anniversary ? String(c.anniversary).slice(0, 10) : '',
    whatsapp_opt_in: c.whatsapp_opt_in && !c.opted_out_at,
    sms_opt_in: Boolean(c.sms_opt_in),
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const changedOpt = f.whatsapp_opt_in !== (c.whatsapp_opt_in && !c.opted_out_at);

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: f.name, city: f.city, last_purchase: f.last_purchase, interests: f.interests, birthday: f.birthday || null, anniversary: f.anniversary || null, sms_opt_in: f.sms_opt_in };
      if (changedOpt) body.whatsapp_opt_in = f.whatsapp_opt_in;
      await api(`/api/customers/${c.id}`, { method: 'PATCH', body });
      toast('Customer saved');
      onSaved();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const consentLine = useMemo(() => {
    if (c.opted_out_at) return `Opted out on ${dateOnly(c.opted_out_at)}`;
    if (c.whatsapp_opt_in) return `Agreed on ${dateOnly(c.opt_in_at)}${c.opt_in_source ? ` · ${c.opt_in_source}` : ''}`;
    return 'No WhatsApp consent recorded';
  }, [c]);

  return (
    <Modal
      title={c.name || phone(c.phone)}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save'}</button></>}
    >
      <div className="stack">
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={c.name} seed={c.phone} size={48} />
          <div>
            <b className="num">{phone(c.phone)}</b>
            <div className="subtle">{consentLine}</div>
          </div>
        </div>
        <div className="form-grid two">
          <Field label="Name"><input className="input" value={f.name} onChange={set('name')} /></Field>
          <Field label="City"><div className="input-icon"><MapPin size={16} /><input className="input" value={f.city} onChange={set('city')} /></div></Field>
          <Field label="Last purchase"><div className="input-icon"><ShoppingBag size={16} /><input className="input" value={f.last_purchase} onChange={set('last_purchase')} /></div></Field>
          <Field label="Interests"><input className="input" value={f.interests} onChange={set('interests')} placeholder="e.g. bridal, diamonds" /></Field>
          <Field label="Birthday"><input className="input" type="date" value={f.birthday} onChange={set('birthday')} /></Field>
          <Field label="Anniversary"><input className="input" type="date" value={f.anniversary} onChange={set('anniversary')} /></Field>
        </div>
        <label className="check card card-pad" style={{ padding: 14 }}>
          <span className="switch"><input type="checkbox" checked={f.whatsapp_opt_in} onChange={set('whatsapp_opt_in')} /><span /></span>
          <span>
            <b>Can receive WhatsApp offers</b>
            <span className="hint" style={{ display: 'block' }}>Only switch on if the customer agreed. Customers who reply STOP are switched off automatically.</span>
          </span>
        </label>
        <label className="check card card-pad" style={{ padding: 14 }}>
          <span className="switch"><input type="checkbox" checked={f.sms_opt_in} onChange={set('sms_opt_in')} /><span /></span>
          <span>
            <b>Can receive SMS (backup)</b>
            <span className="hint" style={{ display: 'block' }}>Used only when WhatsApp can’t reach them.</span>
          </span>
        </label>
        {c.tags?.length > 0 && <div className="pill-list">{c.tags.map((t) => <span key={t} className="badge neutral">{t}</span>)}</div>}
      </div>
    </Modal>
  );
}
