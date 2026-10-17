import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ClipboardPaste, Copy, Download, FileSpreadsheet, MessageSquareText, RefreshCw, Send, Table, Upload, UserPlus, XCircle,
} from 'lucide-react';
import { normalizePhone } from '@shared/phone.js';
import { api, fileUrl } from '../lib/api.js';
import { Alert, Field, Spinner, useToast } from '../components/ui.jsx';
import { num, plural } from '../lib/format.js';

const TABS = [
  { key: 'file', label: 'Excel, CSV or contacts', icon: FileSpreadsheet },
  { key: 'sheet', label: 'Google Sheet', icon: Table },
  { key: 'paste', label: 'Type or paste numbers', icon: ClipboardPaste },
  { key: 'one', label: 'One customer', icon: UserPlus },
];

export default function AddCustomers() {
  const [tab, setTab] = useState('file');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);

  const reset = () => {
    setPreview(null);
    setDone(null);
  };

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <Link to="/customers" className="back"><ArrowLeft size={16} />Customers</Link>
      <div className="page-head">
        <div>
          <h1>Add customers</h1>
          <p>Bring in your list once; every campaign uses it. Numbers are tidied to +91 format automatically.</p>
        </div>
      </div>

      {done ? (
        <ImportDone result={done} onAgain={reset} />
      ) : preview ? (
        <ImportReview preview={preview} onBack={reset} onDone={setDone} onRemap={setPreview} />
      ) : (
        <div className="stack">
          <div className="tabs" role="tablist">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)} role="tab" aria-selected={tab === key}>
                <Icon size={18} />{label}
              </button>
            ))}
          </div>
          {tab === 'file' && <FileStep onPreview={setPreview} />}
          {tab === 'sheet' && <SheetStep onPreview={setPreview} />}
          {tab === 'paste' && <PasteStep onPreview={setPreview} />}
          {tab === 'one' && <OneCustomer />}
        </div>
      )}
    </div>
  );
}

/* ---------- Upload a file ---------- */
function FileStep({ onPreview }) {
  const toast = useToast();
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function upload(file) {
    if (!file) return;
    if (!/\.(xlsx|xls|csv|vcf)$/i.test(file.name)) {
      toast('Please choose an Excel (.xlsx, .xls), CSV or phone contacts (.vcf) file.', 'bad');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api('/api/customers/import/preview', { method: 'POST', form });
      onPreview({ ...r, file, source: `${file.name.split('.').pop().toUpperCase()} upload: ${file.name}` });
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div
        className={`drop ${over ? 'over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <div className="icon">{busy ? <Spinner size={26} /> : <Upload size={26} />}</div>
        <h2>{busy ? 'Reading your file…' : 'Drop your customer file here'}</h2>
        <p className="muted">or <b style={{ color: 'var(--brand)' }}>choose a file</b> · Excel (.xlsx, .xls), CSV or phone contacts (.vcf) · up to 50,000 rows</p>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv,.vcf" hidden onChange={(e) => upload(e.target.files[0])} />
      </div>
      <div className="card card-pad row between wrap">
        <div className="row">
          <span className="kpi-icon tone-wa" style={{ width: 40, height: 40, borderRadius: 12 }}><FileSpreadsheet size={20} /></span>
          <div>
            <b>Not sure about the columns?</b>
            <p className="muted" style={{ fontSize: '0.9rem' }}>Only a phone column is required. Name, city, last purchase and interests make messages personal.</p>
          </div>
        </div>
        <a className="btn" href={fileUrl('/api/customers/sample.xlsx')}><Download size={18} />Sample Excel file</a>
      </div>
    </div>
  );
}

/* ---------- Google Sheet link ---------- */
function SheetStep({ onPreview }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  async function check(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/api/customers/import/preview', { method: 'POST', body: { sheetUrl: url } });
      onPreview({ ...r, source: 'Google Sheet' });
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card card-pad stack" onSubmit={check}>
      <Field label="Google Sheets link" hint="In Google Sheets, click Share and choose “Anyone with the link can view”, then copy the link. The first row should have column names.">
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" inputMode="url" autoFocus />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" disabled={!url.trim() || busy}>{busy ? <Spinner /> : 'Read the sheet'}</button>
      </div>
    </form>
  );
}

/* ---------- Paste numbers ---------- */
function PasteStep({ onPreview }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const lines = text.split(/\n/).filter((l) => l.trim()).length;

  async function check() {
    setBusy(true);
    try {
      const r = await api('/api/customers/import/preview', { method: 'POST', body: { text } });
      onPreview({ ...r, source: 'Typed or pasted by staff' });
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad stack">
      <Field label="Phone numbers" hint="One customer per line. Add a name before the number if you have it, e.g. “Priya, 98765 43210”. Several numbers on one line can be separated by commas.">
        <textarea
          className="textarea"
          rows={9}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Priya Sharma, 98765 43210\nRavi Kumar, +91 91234 56789\n9988776655'}
          style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}
          autoFocus
        />
      </Field>
      <div className="row between wrap">
        <span className="subtle">{lines ? plural(lines, 'line') : 'Nothing pasted yet'}</span>
        <button className="btn primary" onClick={check} disabled={!text.trim() || busy}>{busy ? <Spinner /> : 'Check numbers'}</button>
      </div>
    </div>
  );
}

/* ---------- Review before saving (shared by file and paste) ---------- */
const STATUS = {
  ok: { label: 'Ready to add', tone: 'ok', icon: CheckCircle2 },
  exists: { label: 'Already saved', tone: 'info', icon: Copy },
  duplicate: { label: 'Repeated in list', tone: 'warn', icon: Copy },
  invalid: { label: 'Number problem', tone: 'bad', icon: XCircle },
};

function ImportReview({ preview, onBack, onDone, onRemap }) {
  const toast = useToast();
  const [show, setShow] = useState(preview.summary.invalid ? 'invalid' : 'all');
  const [optIn, setOptIn] = useState(true);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [source, setSource] = useState(preview.source);
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [remapping, setRemapping] = useState(false);
  const s = preview.summary;
  const willAdd = s.ok + (updateExisting ? s.exists : 0);
  const optInColumn = preview.mapping.opt_in !== undefined;

  const rows = useMemo(() => (show === 'all' ? preview.rows : preview.rows.filter((r) => r.status === show)).slice(0, 300), [show, preview.rows]);

  async function remap(field, value) {
    if (!preview.file) return;
    setRemapping(true);
    try {
      const mapping = { ...preview.mapping, [field]: value === '' ? null : Number(value) };
      const form = new FormData();
      form.append('file', preview.file);
      form.append('mapping', JSON.stringify(mapping));
      const r = await api('/api/customers/import/preview', { method: 'POST', form });
      onRemap({ ...preview, ...r });
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setRemapping(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const r = await api('/api/customers/import/commit', {
        method: 'POST',
        body: { rows: preview.rows, optIn: { confirmed: optIn || smsOptIn ? confirmed : true, value: optIn, sms: smsOptIn }, updateExisting, source, tags: tags.split(',') },
      });
      onDone(r);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const fields = [
    ['phone', 'Phone number', true], ['name', 'Name'], ['city', 'City'], ['last_purchase', 'Last purchase'],
    ['interests', 'Interests'], ['birthday', 'Birthday'], ['anniversary', 'Anniversary'], ['opt_in', 'WhatsApp opt-in'],
  ];

  return (
    <div className="stack">
      <div className="grid kpis">
        {Object.entries(STATUS).map(([key, st]) => (
          <button key={key} className="card kpi" onClick={() => setShow(show === key ? 'all' : key)} style={{ textAlign: 'left', cursor: 'pointer', outline: show === key ? '2px solid var(--brand)' : 'none' }}>
            <div className="kpi-label"><span className={`kpi-icon tone-${st.tone === 'warn' ? 'gold' : st.tone}`}><st.icon size={16} /></span>{st.label}</div>
            <div className="kpi-value">{num(s[key])}</div>
          </button>
        ))}
      </div>

      {preview.file && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Check the columns</h2>
              <p className="subtle">We matched your columns automatically. Change any that look wrong.</p>
            </div>
            {remapping && <Spinner />}
          </div>
          <div className="form-grid two" style={{ padding: 20, gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
            {fields.map(([key, label, required]) => (
              <Field key={key} label={`${label}${required ? ' *' : ''}`} hint={preview.mapping[key] !== undefined && preview.sampleRaw?.[0] ? `e.g. ${String(preview.sampleRaw[0][preview.mapping[key]] ?? '').slice(0, 30) || '—'}` : 'Not in this file'}>
                <select className="select" value={preview.mapping[key] ?? ''} onChange={(e) => remap(key, e.target.value)} disabled={remapping}>
                  <option value="">{required ? 'Choose a column' : 'Not in this file'}</option>
                  {preview.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
                </select>
              </Field>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>{show === 'all' ? `All ${plural(s.total, 'row')}` : `${STATUS[show].label}: ${num(s[show])}`}</h2>
          {show !== 'all' && <button className="btn ghost sm" onClick={() => setShow('all')}>Show all</button>}
        </div>
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th className="hide-mobile">City</th><th className="hide-mobile">Last purchase</th><th>Result</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS[r.status];
                return (
                  <tr key={r.row}>
                    <td className="subtle num">{r.row}</td>
                    <td>{r.name || <span className="subtle">—</span>}</td>
                    <td className="num">
                      {r.phoneDisplay || <span style={{ color: 'var(--bad)' }}>{r.phoneRaw || 'empty'}</span>}
                      {r.phoneDisplay && r.phoneRaw && r.phoneRaw.replace(/\s/g, '') !== r.phone && <div className="subtle">was {r.phoneRaw}</div>}
                    </td>
                    <td className="hide-mobile">{r.city || <span className="subtle">—</span>}</td>
                    <td className="hide-mobile">{r.last_purchase || <span className="subtle">—</span>}</td>
                    <td>
                      <span className={`badge ${st.tone}`}>{st.label}</span>
                      {r.reason && r.status !== 'ok' && <div className="subtle" style={{ marginTop: 4 }}>{r.reason}</div>}
                      {r.warnings?.map((w) => <div key={w} className="subtle" style={{ color: 'var(--warn)', marginTop: 4 }}>{w}</div>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(show === 'all' ? s.total : s[show]) > 300 && <p className="subtle" style={{ padding: 12, textAlign: 'center' }}>Showing the first 300 rows.</p>}
        </div>
      </div>

      <div className="card card-pad stack">
        <h2>WhatsApp permission</h2>
        <label className="check">
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
          <span>
            <b>These customers agreed to get WhatsApp messages from us</b>
            <span className="hint" style={{ display: 'block' }}>
              {optInColumn ? 'Your file has an opt-in column; it is used where filled in, and this choice applies to the empty cells.' : 'WhatsApp requires consent. Sending to people who did not agree can get the business number blocked.'}
            </span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={smsOptIn} onChange={(e) => setSmsOptIn(e.target.checked)} />
          <span>
            <b>They also agreed to get SMS</b>
            <span className="hint" style={{ display: 'block' }}>Used only as a backup for customers who are not on WhatsApp.</span>
          </span>
        </label>
        {(optIn || smsOptIn) && (
          <>
            <Field label="Where did they agree?" hint="Saved with each customer as proof of consent.">
              <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Billing counter form, Diwali 2026" />
            </Field>
            <label className="check alert warn" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>I confirm these customers gave permission to receive {optIn && smsOptIn ? 'WhatsApp and SMS' : smsOptIn ? 'SMS' : 'WhatsApp'} offers.</span>
            </label>
          </>
        )}
        <div className="form-grid two">
          <Field label="Add a tag (optional)" hint="Helps you pick this group later, e.g. “diwali-2026”.">
            <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          {s.exists > 0 && (
            <label className="check" style={{ alignSelf: 'center' }}>
              <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
              <span>
                <b>Update the {plural(s.exists, 'customer')} already saved</b>
                <span className="hint" style={{ display: 'block' }}>Fills in new details; their consent is not changed.</span>
              </span>
            </label>
          )}
        </div>
      </div>

      <div className="action-bar">
        <button className="btn ghost" onClick={onBack}><ArrowLeft size={18} />Start over</button>
        <button className="btn primary lg" onClick={save} disabled={busy || !willAdd || ((optIn || smsOptIn) && !confirmed)}>
          {busy ? <Spinner /> : willAdd ? `Add ${plural(willAdd, 'customer')}` : 'Nothing to add'}
        </button>
      </div>
      {s.invalid > 0 && <p className="subtle" style={{ textAlign: 'center' }}>{plural(s.invalid, 'row')} with number problems will be skipped. Fix them in your file and upload again any time; nobody is added twice.</p>}
    </div>
  );
}

function ImportDone({ result, onAgain }) {
  const navigate = useNavigate();
  return (
    <div className="card">
      <div className="empty">
        <div className="empty-art" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><CheckCircle2 size={36} /></div>
        <h2>{plural(result.created, 'customer')} added</h2>
        <p>
          {result.updated ? `${plural(result.updated, 'customer')} updated. ` : ''}
          {result.skipped ? `${plural(result.skipped, 'row')} skipped (number problems or already saved).` : 'Nothing was skipped.'}
        </p>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={onAgain}><RefreshCw size={18} />Add more</button>
          <button className="btn" onClick={() => navigate('/customers')}>View customers</button>
          <button className="btn primary" onClick={() => navigate('/campaigns/new')}><Send size={18} />Create a campaign</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- One customer ---------- */
const EMPTY = { name: '', phone: '', city: '', last_purchase: '', interests: '', birthday: '', anniversary: '', whatsapp_opt_in: true, sms_opt_in: false, opt_in_source: 'Agreed at the store' };

function OneCustomer() {
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const phone = f.phone ? normalizePhone(f.phone) : null;

  async function save(e) {
    e.preventDefault();
    setTouched(true);
    setBusy(true);
    setErrors({});
    try {
      const r = await api('/api/customers', { method: 'POST', body: f });
      toast(`${r.customer.name} added`);
      setF({ ...EMPTY, opt_in_source: f.opt_in_source });
      setTouched(false);
      document.getElementById('one-name')?.focus();
    } catch (err) {
      setErrors(err.data?.fields || {});
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card card-pad stack" onSubmit={save} noValidate>
      <div className="form-grid two">
        <Field label="Name *" htmlFor="one-name" error={errors.name}>
          <input id="one-name" className={`input ${errors.name ? 'invalid' : ''}`} value={f.name} onChange={set('name')} autoFocus placeholder="Priya Sharma" />
        </Field>
        <Field
          label="WhatsApp number *"
          htmlFor="one-phone"
          error={errors.phone || (touched || (f.phone.replace(/\D/g, '').length >= 10) ? (phone && !phone.ok ? phone.reason : null) : null)}
          hint={phone?.ok ? `Will be saved as ${phone.display}` : '10-digit mobile number; +91 is added for you'}
        >
          <input id="one-phone" className={`input ${errors.phone ? 'invalid' : ''}`} value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="98765 43210" />
        </Field>
        <Field label="City"><input className="input" value={f.city} onChange={set('city')} placeholder="Hyderabad" /></Field>
        <Field label="Last purchase" hint="Used as {{last_purchase}} in messages."><input className="input" value={f.last_purchase} onChange={set('last_purchase')} placeholder="Gold bangles" /></Field>
        <Field label="Interests"><input className="input" value={f.interests} onChange={set('interests')} placeholder="Bridal, diamonds" /></Field>
        <div />
        <Field label="Birthday" error={errors.birthday}><input className="input" type="date" value={f.birthday} onChange={set('birthday')} /></Field>
        <Field label="Anniversary" error={errors.anniversary}><input className="input" type="date" value={f.anniversary} onChange={set('anniversary')} /></Field>
      </div>
      <div className="divider" />
      <label className="check">
        <span className="switch"><input type="checkbox" checked={f.whatsapp_opt_in} onChange={set('whatsapp_opt_in')} /><span /></span>
        <span><b>Customer agreed to receive WhatsApp offers</b><span className="hint" style={{ display: 'block' }}>Without this, they are saved but never sent campaigns.</span></span>
      </label>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={f.sms_opt_in} onChange={set('sms_opt_in')} /><span /></span>
        <span><b>Customer agreed to receive SMS</b><span className="hint" style={{ display: 'block' }}>Only used as a backup if they are not on WhatsApp.</span></span>
      </label>
      {(f.whatsapp_opt_in || f.sms_opt_in) && (
        <Field label="How did they agree?"><input className="input" value={f.opt_in_source} onChange={set('opt_in_source')} /></Field>
      )}
      {!f.name.trim() && touched && <Alert tone="warn" icon={AlertTriangle}>A name lets every message start with “Hi Priya”, not a generic greeting.</Alert>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary lg" disabled={busy}>{busy ? <Spinner /> : <><UserPlus size={18} />Save customer</>}</button>
      </div>
    </form>
  );
}
