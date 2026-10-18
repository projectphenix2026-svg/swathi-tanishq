import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Field } from './ui.jsx';

// The customer form, one column (required fields first), shared by Add customer and the
// customer page. Special days are added with buttons; the year is optional (stored as 1904).
export const NO_YEAR = '1904';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAY_KINDS = [
  { kind: 'birthday', label: 'Birthday' },
  { kind: 'anniversary', label: 'Wedding anniversary' },
  { kind: 'spouse_birthday', label: 'Spouse’s birthday' },
  { kind: 'child_birthday', label: 'Child’s birthday' },
  { kind: 'other', label: 'Other day' },
];
const LIKES = ['Gold', 'Diamond', 'Bridal', 'Silver', 'Platinum', 'Polki', 'Coins', 'Antique'];

/** "14 March" or "14 March 1990". */
export function dayText(date) {
  if (!date) return '';
  const [y, m, d] = String(date).slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}${y && y !== NO_YEAR ? ` ${y}` : ''}`;
}

/** Form values from a saved customer (or empty for a new one). */
export function customerForm(c = {}) {
  return {
    name: c.name || '',
    phone: c.phone || '',
    city: c.city || '',
    last_purchase: c.last_purchase || '',
    interests: c.interests || '',
    birthday: c.birthday ? String(c.birthday).slice(0, 10) : '',
    anniversary: c.anniversary ? String(c.anniversary).slice(0, 10) : '',
    dates: Array.isArray(c.dates) ? c.dates.map((d) => ({ kind: d.kind, label: d.label || '', date: d.date })) : [],
    whatsapp_opt_in: c.id ? Boolean(c.whatsapp_opt_in && !c.opted_out_at) : true,
    sms_opt_in: Boolean(c.sms_opt_in),
  };
}

/** The special days as one list for the form: birthday and anniversary first, then the rest. */
function daysOf(f) {
  return [
    ...(f.birthday ? [{ kind: 'birthday', date: f.birthday, key: 'birthday' }] : []),
    ...(f.anniversary ? [{ kind: 'anniversary', date: f.anniversary, key: 'anniversary' }] : []),
    ...f.dates.map((d, i) => ({ ...d, key: `d${i}`, index: i })),
  ];
}

export function CustomerFields({ f, setF, errors = {}, phoneField, smsOn }) {
  const [cities, setCities] = useState([]);
  useEffect(() => {
    api('/api/customers/summary').then((s) => setCities(s.cities.map((c) => c.city))).catch(() => {});
  }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const likes = f.interests.split(',').map((s) => s.trim()).filter(Boolean);
  const toggleLike = (w) => {
    const has = likes.some((x) => x.toLowerCase() === w.toLowerCase());
    setF((x) => ({ ...x, interests: (has ? likes.filter((l) => l.toLowerCase() !== w.toLowerCase()) : [...likes, w]).join(', ') }));
  };

  const addDay = (kind) => {
    const blank = `${NO_YEAR}-01-01`;
    if (kind === 'birthday' || kind === 'anniversary') setF((x) => ({ ...x, [kind]: x[kind] || blank }));
    else setF((x) => ({ ...x, dates: [...x.dates, { kind, label: '', date: blank }] }));
  };
  const setDay = (d, date) => {
    if (d.index === undefined) setF((x) => ({ ...x, [d.kind]: date }));
    else setF((x) => ({ ...x, dates: x.dates.map((y, i) => (i === d.index ? { ...y, date } : y)) }));
  };
  const setLabel = (d, label) => setF((x) => ({ ...x, dates: x.dates.map((y, i) => (i === d.index ? { ...y, label } : y)) }));
  const removeDay = (d) => {
    if (d.index === undefined) setF((x) => ({ ...x, [d.kind]: '' }));
    else setF((x) => ({ ...x, dates: x.dates.filter((_, i) => i !== d.index) }));
  };
  const days = daysOf(f);

  return (
    <div className="cust-form">
      <Field label={<>Name <span className="req">*</span></>} htmlFor="cust-name" error={errors.name}>
        <input id="cust-name" name="customer-name" autoComplete="off" className={`input ${errors.name ? 'invalid' : ''}`} value={f.name} onChange={set('name')} placeholder="Priya Sharma" />
      </Field>
      {phoneField}
      <Field label={<>City <span className="req">*</span></>} htmlFor="cust-city" error={errors.city} hint="Used to send messages to one city at a time.">
        <input id="cust-city" name="customer-city" autoComplete="off" list="cust-cities" className={`input ${errors.city ? 'invalid' : ''}`} value={f.city} onChange={set('city')} placeholder="Hyderabad" />
        <datalist id="cust-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
        {cities.length > 0 && !f.city && (
          <div className="chips" style={{ marginTop: 6 }}>
            {cities.slice(0, 6).map((c) => <button key={c} type="button" className="chip" onClick={() => setF((x) => ({ ...x, city: c }))}>{c}</button>)}
          </div>
        )}
      </Field>

      <Field label="Special days" error={errors.dates} hint="Wishes go out on these days by themselves (see Special days). The year is optional.">
        <div className="stack-sm">
          {days.map((d) => (
            <div key={d.key} className="day-row">
              <span className="day-kind">{DAY_KINDS.find((k) => k.kind === d.kind)?.label}</span>
              {d.kind === 'other' && (
                <input className="input day-label" placeholder="e.g. Daughter’s wedding" value={d.label} onChange={(e) => setLabel(d, e.target.value)} aria-label="Name of the day" />
              )}
              <DayPicker value={d.date} onChange={(v) => setDay(d, v)} />
              <button type="button" className="icon-btn sm" onClick={() => removeDay(d)} aria-label="Remove this day"><X size={16} /></button>
            </div>
          ))}
          <div className="chips">
            {DAY_KINDS.filter((k) => (k.kind === 'birthday' ? !f.birthday : k.kind === 'anniversary' ? !f.anniversary : true)).map((k) => (
              <button key={k.kind} type="button" className="chip" onClick={() => addDay(k.kind)}><Plus size={14} />{k.label}</button>
            ))}
          </div>
        </div>
      </Field>

      <Field label="Likes">
        <div className="chips">
          {LIKES.map((w) => (
            <button key={w} type="button" className={`chip ${likes.some((x) => x.toLowerCase() === w.toLowerCase()) ? 'on' : ''}`} onClick={() => toggleLike(w)}>{w}</button>
          ))}
        </div>
        <input id="cust-likes" className="input" style={{ marginTop: 6 }} value={f.interests} onChange={set('interests')} placeholder="Or type, e.g. bangles, temple jewellery" />
      </Field>
      <Field label="Last purchase" hint="Shown in messages as “your …”, e.g. “your gold bangles”.">
        <input id="cust-purchase" className="input" value={f.last_purchase} onChange={set('last_purchase')} placeholder="Gold bangles" />
      </Field>

      <label className="check consent">
        <span className="switch"><input type="checkbox" checked={f.whatsapp_opt_in} onChange={set('whatsapp_opt_in')} /><span /></span>
        <span><b>Customer agreed to get WhatsApp messages from the shop</b><span className="hint" style={{ display: 'block' }}>Without this, the customer is saved but gets no messages.</span></span>
      </label>
      {smsOn && (
        <label className="check consent">
          <span className="switch"><input type="checkbox" checked={f.sms_opt_in} onChange={set('sms_opt_in')} /><span /></span>
          <span><b>Customer agreed to get SMS</b></span>
        </label>
      )}
    </div>
  );
}

/** Day and month (and an optional year) for a special day. Stores YYYY-MM-DD; year 1904 = not known. */
function DayPicker({ value, onChange }) {
  const [y, m, d] = String(value || `${NO_YEAR}-01-01`).split('-');
  const [yearText, setYearText] = useState(y === NO_YEAR ? '' : y);
  const put = (yy, mm, dd) => {
    const max = new Date(Date.UTC(Number(yy) || 1904, Number(mm), 0)).getUTCDate();
    onChange(`${yy || NO_YEAR}-${mm}-${String(Math.min(Number(dd), max)).padStart(2, '0')}`);
  };
  return (
    <span className="day-picker">
      <select className="select" value={d} onChange={(e) => put(y, m, e.target.value)} aria-label="Day">
        {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((v) => <option key={v} value={v}>{Number(v)}</option>)}
      </select>
      <select className="select" value={m} onChange={(e) => put(y, e.target.value, d)} aria-label="Month">
        {MONTHS.map((name, i) => <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>)}
      </select>
      <input
        className="input" inputMode="numeric" maxLength={4} placeholder="Year" aria-label="Year (optional)"
        value={yearText}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 4);
          setYearText(v);
          if (v.length === 4 && Number(v) >= 1900 && Number(v) <= 2100) put(v, m, d);
          else if (y !== NO_YEAR) put(NO_YEAR, m, d);
        }}
      />
    </span>
  );
}

/** The body the server expects from the form. */
export function customerBody(f) {
  return {
    name: f.name,
    city: f.city,
    last_purchase: f.last_purchase,
    interests: f.interests,
    birthday: f.birthday || null,
    anniversary: f.anniversary || null,
    dates: f.dates.map((d) => ({ kind: d.kind, label: d.label, date: d.date })),
    sms_opt_in: f.sms_opt_in,
  };
}
