import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { downloadSample } from '../lib/sample.js';
import { Avatar, Empty, Modal, OptInBadge, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { CustomerFields, customerBody, customerForm, dayText } from '../components/CustomerFields.jsx';
import { dateOnly, num, phone } from '../lib/format.js';

const FILTERS = [
  { key: 'all', label: 'All', count: 'total' },
  { key: 'opted_in', label: 'Can receive WhatsApp', count: 'opted_in' },
  { key: 'no_opt_in', label: 'Not agreed yet', count: 'no_opt_in' },
  { key: 'opted_out', label: 'Said STOP', count: 'opted_out' },
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
                    <tr><th>Customer</th><th>Phone</th><th>City</th><th>Special days</th><th>WhatsApp</th><th>Added</th></tr>
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
                        <td className="subtle">{specialDays(c) || '—'}</td>
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

/** "Birthday 14 March · Anniversary 2 May" for the list. */
function specialDays(c) {
  return [
    c.birthday && `Birthday ${dayText(c.birthday)}`,
    c.anniversary && `Anniversary ${dayText(c.anniversary)}`,
    (c.dates || []).length ? `+${c.dates.length} more` : null,
  ].filter(Boolean).join(' · ');
}

function EditCustomer({ c, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(customerForm(c));
  const [errors, setErrors] = useState({});
  // A field's error goes away as soon as it is filled in.
  useEffect(() => {
    setErrors((er) => Object.fromEntries(Object.entries(er).filter(([k]) => !String(f[k] ?? '').trim())));
  }, [f]);
  const [busy, setBusy] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const { user, settings } = useAuth();
  const canDelete = user?.role !== 'viewer';
  const changedOpt = f.whatsapp_opt_in !== (c.whatsapp_opt_in && !c.opted_out_at);

  const save = async () => {
    if (!f.name.trim() || !f.city.trim()) {
      setErrors({ name: f.name.trim() ? null : 'Add the customer’s name.', city: f.city.trim() ? null : 'Add the customer’s city or town.' });
      return;
    }
    setBusy(true);
    try {
      const body = customerBody(f);
      if (changedOpt) body.whatsapp_opt_in = f.whatsapp_opt_in;
      await api(`/api/customers/${c.id}`, { method: 'PATCH', body });
      toast('Customer saved');
      onSaved();
    } catch (e) {
      setErrors(e.data?.fields || {});
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/customers/${c.id}`, { method: 'DELETE' });
      toast(`${c.name || 'Customer'} deleted`);
      onSaved();
    } catch (e) {
      toast(e.message, 'bad');
      setBusy(false);
    }
  };

  const footer = askDelete ? (
    <div className="row wrap" style={{ gap: 10, width: '100%', justifyContent: 'space-between' }}>
      <span style={{ flex: '1 1 220px', fontSize: '0.9rem' }}>
        <b>Delete {c.name || 'this customer'}?</b> Their number, details and chats are removed for good. Past offer totals and sales stay in reports.
      </span>
      <span className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={() => setAskDelete(false)} disabled={busy}>Keep</button>
        <button className="btn danger" onClick={remove} disabled={busy}>{busy ? <Spinner /> : <><Trash2 size={16} />Yes, delete</>}</button>
      </span>
    </div>
  ) : (
    <div className="row" style={{ gap: 8, width: '100%', justifyContent: 'space-between' }}>
      <span className="row" style={{ gap: 8 }}>
        {canDelete ? <button className="btn ghost danger" onClick={() => setAskDelete(true)}><Trash2 size={16} />Delete customer</button> : null}
      </span>
      <span className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save'}</button>
      </span>
    </div>
  );

  const consentLine = useMemo(() => {
    if (c.opted_out_at) return `Said STOP on ${dateOnly(c.opted_out_at)}`;
    if (c.whatsapp_opt_in) return `Agreed on ${dateOnly(c.opt_in_at)}${c.opt_in_source ? ` · ${c.opt_in_source}` : ''}`;
    return 'No WhatsApp consent recorded';
  }, [c]);

  return (
    <Modal
      title={c.name || phone(c.phone)}
      onClose={onClose}
      footer={footer}
    >
      <div className="stack">
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={c.name} seed={c.phone} size={48} />
          <div>
            <b className="num">{phone(c.phone)}</b>
            <div className="subtle">{consentLine}</div>
          </div>
        </div>
        <CustomerFields f={f} setF={setF} errors={errors} smsOn={settings?.sms?.live} />
        {c.tags?.length > 0 && <div className="pill-list">{c.tags.map((t) => <span key={t} className="badge neutral">{t}</span>)}</div>}
      </div>
    </Modal>
  );
}
