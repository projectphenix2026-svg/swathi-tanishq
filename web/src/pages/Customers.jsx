import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, Download, Search, Send, Tag, Trash2, UserPlus, Users } from 'lucide-react';
import { SelectBar, allTicked, toggleIn } from '../components/SelectBar.jsx';
import { SortTh, useSort } from '../components/SortHead.jsx';
import { downloadCsv } from '../lib/csv.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { atLeast } from '@shared/roles.js';
import { downloadSample } from '../lib/sample.js';
import { Avatar, Empty, Modal, OptInBadge, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { CustomerFields, customerBody, customerForm, dayText } from '../components/CustomerFields.jsx';
import { dateOnly, num, phone } from '../lib/format.js';

const FILTERS = [
  { key: 'all', label: 'All', count: 'total' },
  { key: 'opted_in', label: 'Can receive WhatsApp', count: 'opted_in' },
  { key: 'no_opt_in', label: 'Not agreed yet', count: 'no_opt_in' },
  { key: 'opted_out', label: 'Said STOP', count: 'opted_out' },
  { key: 'no_birthday', label: 'No birthday saved', count: 'no_birthday' },
  { key: 'sleeping', label: 'Not reading (90 days)', count: 'sleeping' },
];
const PAGE = 50;

export default function Customers() {
  const [summary, setSummary] = useState(null);
  // Home links straight to a filter (?filter=no_birthday or ?filter=sleeping).
  const [urlParams] = useSearchParams();
  const [filter, setFilter] = useState(() => (FILTERS.some((f) => f.key === urlParams.get('filter')) ? urlParams.get('filter') : 'all'));
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null);
  const [samples, setSamples] = useState(0);
  const { settings: appSettings } = useAuth();
  const testMode = appSettings?.provider?.name === 'mock';
  const toastList = useToast();
  const navigate = useNavigate();
  // Column order: the server sorts (the list comes in pages of 50).
  const { sort, toggle } = useSort(null, {}, { key: 'added', dir: 'desc' });
  const sortParam = { name: ['name', 'name_desc'], city: ['city', 'city_desc'], added: ['oldest', 'recent'] }[sort.key]?.[sort.dir === 'asc' ? 0 : 1] || 'recent';
  // Ticked customers (on this page) and what to do with them.
  const [sel, setSel] = useState(new Set());
  const [groupName, setGroupName] = useState('');
  const [askBulk, setAskBulk] = useState(null);
  const canDelete = atLeast(appSettings?.role, 'manager');
  const pageIds = (data?.customers || []).map((c) => c.id);
  const ticked = (data?.customers || []).filter((c) => sel.has(c.id));
  async function bulk(action, extra = {}) {
    try {
      const r = await api('/api/customers/bulk', { method: 'POST', body: { action, ids: [...sel], ...extra } });
      const what = { delete: 'deleted', tag: `added to “${extra.tag}”`, untag: `removed from “${extra.tag}”`, 'no-consent': 'marked as not agreed' }[action];
      toastList(`${num(r.done)} customer${r.done === 1 ? '' : 's'} ${what}`);
      setSel(new Set());
      setAskBulk(null);
      setGroupName('');
      reload();
    } catch (e) {
      toastList(e.message, 'bad');
    }
  }
  function download() {
    downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, [
      { label: 'Name', value: (c) => c.name },
      { label: 'Phone', value: (c) => c.phone },
      { label: 'City', value: (c) => c.city },
      { label: 'Bought or likes', value: (c) => c.last_purchase || c.interests },
      { label: 'Birthday', value: (c) => c.birthday },
      { label: 'Anniversary', value: (c) => c.anniversary },
      { label: 'WhatsApp', value: (c) => (c.opted_out_at ? 'Said STOP' : c.whatsapp_opt_in ? 'Agreed' : 'Not agreed') },
    ], ticked);
  }

  const reload = () => {
    api('/api/customers/summary').then(setSummary).catch(() => {});
    api('/api/customers/samples').then((r) => setSamples(r.samples)).catch(() => {});
    const params = new URLSearchParams({ filter, q, limit: PAGE, offset: page * PAGE, sort: sortParam });
    api(`/api/customers?${params}`).then(setData).catch(() => setData({ customers: [], total: 0 }));
  };

  useEffect(() => {
    const t = setTimeout(reload, q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, q, page, sortParam]);

  useEffect(() => setPage(0), [filter, q, sortParam]);
  useEffect(() => setSel(new Set()), [filter, q, page]);

  async function samplesAction(add) {
    try {
      await api('/api/customers/samples', { method: add ? 'POST' : 'DELETE' });
      toastList(add ? '5 sample customers added' : 'Sample customers removed');
      reload();
    } catch (e) {
      toastList(e.message, 'bad');
    }
  }

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
                {testMode && <button className="btn" onClick={() => samplesAction(true)}>Try with 5 sample customers</button>}
                <button className="btn ghost" onClick={downloadSample}><Download size={18} />Sample Excel file</button>
              </>
            }
          >
            Every message and wish goes to this list. Bring in your Excel list, or add people one by one.
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
          <p>{summary ? `${num(summary.opted_in)} of ${num(summary.total)} can receive WhatsApp messages` : ' '}</p>
        </div>
        <Link to="/customers/add" className="btn primary"><UserPlus size={18} />Add customers</Link>
      </div>

      <div className="stack">
        {samples > 0 && (
          <div className="alert info row wrap" style={{ gap: 8 }}>
            <span style={{ flex: '1 1 260px' }}><b>{samples} sample customers</b> are here to try things out. They are removed when you go live.</span>
            <button className="btn sm" onClick={() => samplesAction(false)}>Remove them now</button>
          </div>
        )}
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

        <SelectBar count={sel.size} onClear={() => setSel(new Set())} note={askBulk === 'delete' ? null : undefined}>
          {askBulk === 'delete' ? (
            <>
              <span>Delete {num(sel.size)} customer{sel.size === 1 ? '' : 's'}? Their details and chats are removed; reports keep the numbers.</span>
              <button className="btn sm" onClick={() => setAskBulk(null)}>Keep</button>
              <button className="btn sm danger" onClick={() => bulk('delete')}>Yes, delete</button>
            </>
          ) : askBulk === 'group' ? (
            <>
              <input className="input sm" style={{ width: 170 }} placeholder="Group, e.g. bridal-2026" value={groupName} onChange={(e) => setGroupName(e.target.value)} autoFocus aria-label="Group name" />
              <button className="btn sm primary" disabled={!groupName.trim()} onClick={() => bulk('tag', { tag: groupName })}>Add to group</button>
              <button className="btn sm ghost" disabled={!groupName.trim()} onClick={() => bulk('untag', { tag: groupName })}>Remove from group</button>
              <button className="btn sm ghost" onClick={() => setAskBulk(null)}>Back</button>
            </>
          ) : askBulk === 'no-consent' ? (
            <>
              <span>Mark as not agreed to WhatsApp? They will not get offers until they agree again.</span>
              <button className="btn sm" onClick={() => setAskBulk(null)}>Keep</button>
              <button className="btn sm danger" onClick={() => bulk('no-consent')}>Yes, mark</button>
            </>
          ) : (
            <>
              <button className="btn sm primary" onClick={() => navigate(`/campaigns/new?ids=${[...sel].join(',')}`)}><Send size={15} />Send a message</button>
              <button className="btn sm" onClick={() => setAskBulk('group')}><Tag size={15} />Group</button>
              <button className="btn sm" onClick={download}><Download size={15} />Download</button>
              <button className="btn sm ghost" onClick={() => setAskBulk('no-consent')}><Ban size={15} />Not agreed</button>
              {canDelete && <button className="btn sm ghost danger" onClick={() => setAskBulk('delete')}><Trash2 size={15} />Delete</button>}
            </>
          )}
        </SelectBar>

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
                    <tr>
                      <th className="tick-col"><input type="checkbox" aria-label="Select all on this page" checked={allTicked(sel, pageIds)} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...pageIds]) : new Set([...sel].filter((id) => !pageIds.includes(id))))} /></th>
                      <SortTh label="Customer" k="name" sort={sort} toggle={toggle} /><th>Phone</th><SortTh label="City" k="city" sort={sort} toggle={toggle} />
                      <th>Special days</th><th>WhatsApp</th><SortTh label="Added" k="added" sort={sort} toggle={toggle} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.customers.map((c) => (
                      <tr key={c.id} className={`clickable ${sel.has(c.id) ? 'ticked' : ''}`} onClick={() => setEditing(c)}>
                        <td className="tick-col" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${c.name || phone(c.phone)}`} checked={sel.has(c.id)} onChange={() => setSel((s) => toggleIn(s, c.id))} /></td>
                        <td>
                          <div className="row" style={{ gap: 10 }}>
                            <Avatar name={c.name} seed={c.phone} size={34} />
                            <div>
                              <b>{c.name || <span className="muted">No name</span>}</b>{c.tags?.includes('sample') && <span className="badge neutral" style={{ marginLeft: 6 }}>Sample</span>}
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
                    <input type="checkbox" className="tick-mob" aria-label={`Select ${c.name || phone(c.phone)}`} checked={sel.has(c.id)} onClick={(e) => e.stopPropagation()} onChange={() => setSel((s) => toggleIn(s, c.id))} />
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
  const canDelete = atLeast(user?.role, 'manager');
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
