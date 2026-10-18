import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Pencil, Plus, Send } from 'lucide-react';
import { VARIABLES, extractVariables, valuesFor } from '@shared/template.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Field, Modal, Pic, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { Highlighted, PhonePreview } from '../components/PhonePreview.jsx';
import { dateOnly, num, plural } from '../lib/format.js';
import { READY_WISHES } from '../lib/ready.js';
import { useT } from '../lib/i18n.jsx';
import { TemplateChooser } from '../components/TemplatePicker.jsx';
import { CustomersStep } from '../components/CustomerPicker.jsx';

// Special days: a calendar of who has a birthday, anniversary or family day and which festivals
// fall when, today's list with "Send now", and the automatic wishes (on/off, set up in 3 steps).
const KINDS = {
  birthday: { label: 'Birthdays', one: 'birthday', pic: 'cake', hint: 'Each customer’s birthday.' },
  anniversary: { label: 'Wedding anniversaries', one: 'anniversary', pic: 'ring', hint: 'Each customer’s wedding anniversary.' },
  personal: { label: 'Family days', one: 'family day', pic: 'blossom', hint: 'Spouse’s and child’s birthdays and other days saved on customers.' },
  festival: { label: 'Festivals and shop events', one: 'event', pic: 'sparkles', hint: 'Any date you choose: Diwali, a sale, the shop’s anniversary.' },
  thank_you: { label: 'After a purchase', one: 'purchase', pic: 'handshake', hint: 'A thank-you with a “Rate us on Google” button, after a sales code is used.' },
};
const AFTER = [{ d: 1, label: 'The next day' }, { d: 2, label: '2 days after' }, { d: 3, label: '3 days after' }];
const WHEN = [{ d: 7, label: 'A week before' }, { d: 3, label: '3 days before' }, { d: 1, label: 'The day before' }, { d: 0, label: 'On the day' }];
const HOURS = [8, 9, 10, 11, 12, 16, 17, 18, 19];
const THANK_YOU_NAME = '⭐ Thank you + Google review';
const thankYouMessage = (link) => ({
  name: THANK_YOU_NAME,
  category: 'marketing',
  status: 'approved',
  body: 'Thank you for shopping at {{store}}, {{name}}! We hope you love your new jewellery. Could you spare a minute to rate us on Google? It helps other families find us.',
  buttons: [{ type: 'url', text: 'Rate us on Google', url: link }],
  sms_body: `Thank you for shopping at {{store}}, {{name}}! Please rate us on Google: ${link} -SWATHI`,
});
// Quick ideas for a new festival or event. Festivals that move each year carry this year's date
// (check it before switching on); fixed-date days repeat every year.
const EVENT_IDEAS = [
  { name: 'Dhanteras', date: '2026-11-06' }, { name: 'Diwali', date: '2026-11-08' },
  { name: 'Christmas', md: '12-25' }, { name: 'New Year', md: '01-01' }, { name: 'Sankranti', md: '01-14' },
  { name: 'Republic Day sale', md: '01-26' }, { name: 'Valentine’s Day', md: '02-14' }, { name: 'Women’s Day', md: '03-08' },
  { name: 'Independence Day sale', md: '08-15' }, { name: 'Shop anniversary', md: '' },
  { name: 'Gold exhibition', date: '' }, { name: 'New collection launch', date: '' },
];
const CAMPAIGN_VARS = VARIABLES.filter((v) => v.source === 'campaign');
const EXAMPLE_CUSTOMER = { name: 'Priya Sharma', city: 'Hyderabad', last_purchase: 'gold bangles', interests: 'bridal' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FAMILY = { spouse_birthday: 'spouse’s birthday', child_birthday: 'child’s birthday' };

const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nextOn = (md, today) => (`${today.slice(0, 4)}-${md}` >= today ? `${today.slice(0, 4)}-${md}` : `${Number(today.slice(0, 4)) + 1}-${md}`);
const hourText = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;
function whenText(days, kind) {
  if (kind === 'thank_you') return [...days].sort((a, b) => a - b).map((d) => (d === 1 ? 'the day after a purchase' : `${d} days after a purchase`)).join(' and ');
  return [...days].sort((a, b) => b - a).map((d) => (d === 0 ? 'on the day' : d === 1 ? 'the day before' : `${d} days before`)).join(' and ');
}
/** The Monday on or before the 1st of the month, so the grid starts on a Monday. */
function gridStart(month) {
  const first = new Date(`${month}-01T00:00:00Z`);
  return addDays(`${month}-01`, -((first.getUTCDay() + 6) % 7));
}
const monthName = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (month, n) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

export default function Occasions() {
  const { settings } = useAuth();
  const canEdit = settings?.role !== 'viewer';
  const toast = useToast();
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [month, setMonth] = useState(null);
  const [cal, setCal] = useState(null);
  const [picked, setPicked] = useState(null);

  const load = () => api('/api/occasions').then((r) => {
    setData(r);
    setMonth((m) => m || r.today.date.slice(0, 7));
    setPicked((p) => p || r.today.date);
  }).catch(() => setData({ occasions: [], dates: {}, today: { date: new Date().toISOString().slice(0, 10), hour: 0 } }));
  useEffect(() => {
    load();
    api('/api/templates').then((r) => setTemplates(r.templates.filter((x) => x.status === 'approved'))).catch(() => {});
  }, []);
  useEffect(() => {
    if (!month) return;
    setCal(null);
    api(`/api/occasions/calendar?from=${gridStart(month)}&days=42`).then(setCal).catch(() => setCal({ days: {} }));
  }, [month, data]);

  async function toggle(o) {
    try {
      await api(`/api/occasions/${o.id}/enabled`, { method: 'PATCH', body: { enabled: !o.enabled } });
      toast(o.enabled ? `${o.name} switched off` : `${o.name} switched on`);
      load();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
  async function runNow(o) {
    try {
      const r = await api(`/api/occasions/${o.id}/run`, { method: 'POST' });
      toast(r.queued ? `${plural(r.queued, 'wish', 'wishes')} on the way` : 'Nobody new to wish: they already got today’s wish.');
      load();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  const occ = data?.occasions || [];
  const first = (kind) => occ.find((o) => o.kind === kind);
  const kinds = ['birthday', 'anniversary', 'personal', ...(settings?.salesCodes ? ['thank_you'] : [])];

  return (
    <div className="page">
      <div className="page-head compact">
        <div>
          <h1>Special days</h1>
          <p>Birthdays, anniversaries, family days and festivals. Wishes go out by themselves, or send them yourself on the day.</p>
        </div>
        {canEdit && <button className="btn primary" onClick={() => setEditing({ kind: 'festival' })}><Plus size={18} />Add festival or event</button>}
      </div>

      {!data ? (
        <div className="card card-pad"><Skeleton h={260} /></div>
      ) : (
        <div className="stack">
          <div className="days-top">
            <CalendarCard month={month} setMonth={setMonth} cal={cal} today={data.today.date} picked={picked} setPicked={setPicked} />
            <DayPanel
              date={picked} today={data.today} cal={cal} first={first} canEdit={canEdit}
              onSetUp={(kind) => setEditing({ kind })} onRun={runNow}
            />
          </div>

          <h2 style={{ marginTop: 6 }}>Automatic wishes</h2>
          <div className="wish-grid">
            {kinds.map((k) => (
              <KindCard key={k} kind={k} o={first(k)} data={data} canEdit={canEdit} onToggle={toggle} onEdit={(o) => setEditing(o || { kind: k })} />
            ))}
            <EventsCard events={occ.filter((o) => o.kind === 'festival')} canEdit={canEdit} onToggle={toggle} onEdit={(o) => setEditing(o)} onAdd={() => setEditing({ kind: 'festival' })} />
          </div>
        </div>
      )}

      {editing && (
        <OccasionEditor
          initial={editing}
          templates={templates}
          setTemplates={setTemplates}
          businessName={settings?.businessName}
          smsOn={settings?.sms?.live}
          today={data?.today?.date}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CalendarCard({ month, setMonth, cal, today, picked, setPicked }) {
  if (!month) return null;
  const start = gridStart(month);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <div className="card card-pad cal-card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2>{monthName(month)}</h2>
        <span className="row" style={{ gap: 4 }}>
          <button className="btn ghost sm" onClick={() => { setMonth(today.slice(0, 7)); setPicked(today); }}>Today</button>
          <button className="icon-btn sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
          <button className="icon-btn sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight size={18} /></button>
        </span>
      </div>
      <div className="cal-grid" role="grid" aria-label={monthName(month)}>
        {WEEKDAYS.map((w) => <span key={w} className="cal-head">{w}</span>)}
        {cells.map((d) => {
          const day = cal?.days?.[d];
          const out = d.slice(0, 7) !== month;
          const people = day ? day.birthday.length + day.anniversary.length + day.personal.length : 0;
          return (
            <button
              key={d}
              type="button"
              className={`cal-cell ${out ? 'out' : ''} ${d === today ? 'today' : ''} ${d === picked ? 'on' : ''}`}
              onClick={() => setPicked(d)}
              aria-label={`${dateOnly(d)}${people ? `, ${plural(people, 'special day')}` : ''}`}
            >
              <span className="cal-num">{Number(d.slice(8))}</span>
              {day?.events.map((e) => <em key={e.id} className="ev">{e.name}</em>)}
              {day?.birthday.length > 0 && <em className="b">{plural(day.birthday.length, 'birthday')}</em>}
              {day?.anniversary.length > 0 && <em className="a">{plural(day.anniversary.length, 'anniversary', 'anniversaries')}</em>}
              {day?.personal.length > 0 && <em className="p">{plural(day.personal.length, 'family day')}</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The chosen day: who has what, and whether their wish goes by itself, has gone, or can be sent now. */
function DayPanel({ date, today, cal, first, canEdit, onSetUp, onRun }) {
  const day = cal?.days?.[date];
  const isToday = date === today.date;
  const groups = day ? [
    ['birthday', day.birthday],
    ['anniversary', day.anniversary],
    ['personal', day.personal],
  ].filter(([, list]) => list.length) : [];
  return (
    <div className="card card-pad day-panel">
      <h2>{isToday ? 'Today' : dateOnly(date)}</h2>
      {!cal ? <Spinner /> : !groups.length && !day?.events.length ? (
        <p className="subtle">No birthdays, anniversaries or events{isToday ? ' today' : ' on this day'}.</p>
      ) : (
        <div className="stack-sm">
          {day.events.map((e) => <div key={e.id} className="day-group"><Pic name="sparkles" size={26} /><b>{e.name}</b></div>)}
          {groups.map(([kind, list]) => {
            const o = first(kind);
            const at = o && o.enabled ? (isToday && today.hour >= o.send_hour ? 'Sent this morning' : `Goes out at ${hourText(o.send_hour)}`) : null;
            return (
              <div key={kind} className="day-group">
                <Pic name={KINDS[kind].pic} size={26} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{plural(list.length, KINDS[kind].one, kind === 'anniversary' ? 'anniversaries' : undefined)}</b>
                  <div className="subtle">{list.slice(0, 6).map((p) => `${p.name}${p.kind ? ` (${p.label || FAMILY[p.kind] || 'special day'})` : ''}`).join(', ')}{list.length > 6 ? ` and ${num(list.length - 6)} more` : ''}</div>
                  {at && <div className="subtle" style={{ color: 'var(--ok)' }}>{at}</div>}
                </div>
                {canEdit && (o ? (o.enabled && isToday && today.hour < o.send_hour && <button className="btn sm" onClick={() => onRun(o)}><Send size={14} />Send now</button>) : (
                  <button className="btn sm" onClick={() => onSetUp(kind)}>Set up wishes</button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KindCard({ kind, o, data, canEdit, onToggle, onEdit }) {
  const K = KINDS[kind];
  const saved = kind === 'birthday' ? data.dates?.with_birthday : kind === 'anniversary' ? data.dates?.with_anniversary : null;
  return (
    <div className={`card card-pad wish-card ${o?.enabled ? '' : 'off'}`}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Pic name={K.pic} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{K.label}</b>
          <div className="subtle">{o ? `${whenText(o.days_before, kind)}, ${hourText(o.send_hour)} · ${o.template_name}` : K.hint}</div>
          {saved !== null && saved !== undefined && <div className="subtle">{plural(saved, 'customer')} {saved === 1 ? 'has' : 'have'} this date saved</div>}
          {o && <div className="subtle">{num(o.sent_30d)} sent in 30 days</div>}
        </div>
        {o && canEdit && (
          <label className="switch" title={o.enabled ? 'Switch off' : 'Switch on'}>
            <input type="checkbox" checked={o.enabled} onChange={() => onToggle(o)} aria-label={`${K.label} on`} />
            <span />
          </label>
        )}
      </div>
      {canEdit && (
        <button className={`btn sm ${o ? 'ghost' : 'primary'}`} style={{ alignSelf: 'flex-start' }} onClick={() => onEdit(o)}>
          {o ? <><Pencil size={14} />Change</> : <><Plus size={14} />Set up</>}
        </button>
      )}
    </div>
  );
}

function EventsCard({ events, canEdit, onToggle, onEdit, onAdd }) {
  return (
    <div className="card card-pad wish-card">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Pic name="sparkles" size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{KINDS.festival.label}</b>
          <div className="subtle">{events.length ? `${plural(events.length, 'event')}` : KINDS.festival.hint}</div>
        </div>
      </div>
      {events.map((o) => (
        <div key={o.id} className="row" style={{ gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: '0.9rem' }}>{o.name}</b>
            <span className="subtle"> · {o.repeat_yearly ? `every year, ${dateOnly(o.festival_date).replace(/ \d{4}$/, '')}` : dateOnly(o.festival_date)}</span>
          </span>
          {canEdit && <button className="icon-btn sm" onClick={() => onEdit(o)} aria-label={`Change ${o.name}`}><Pencil size={14} /></button>}
          {canEdit && (
            <label className="switch"><input type="checkbox" checked={o.enabled} onChange={() => onToggle(o)} aria-label={`${o.name} on`} /><span /></label>
          )}
        </div>
      ))}
      {canEdit && <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} onClick={onAdd}><Plus size={14} />Add festival or event</button>}
    </div>
  );
}

/* ---------- Setting up a wish: event, template (and its blanks), customers, when ---------- */
function audienceToPick(a = {}) {
  if (a.mode === 'selected') return { filters: { cities: [], tags: [], search: '' }, pick: { only: true, ids: a.contactIds || [] } };
  return { filters: { cities: a.cities || [], tags: a.tags || [], search: a.search || '' }, pick: { only: false, ids: a.excludeIds || [] } };
}

function OccasionEditor({ initial, templates, setTemplates, businessName, smsOn, today, onClose, onSaved }) {
  const toast = useToast();
  const { t } = useT();
  const isNew = !initial.id;
  const kind = initial.kind;
  const steps = kind === 'festival' ? ['Event', 'Template', 'Customers', 'When'] : ['Template', 'Customers', 'When'];
  const [step, setStep] = useState(0);
  const [o, setO] = useState({
    name: initial.name || (kind === 'festival' ? '' : KINDS[kind].label),
    kind,
    festival_date: initial.festival_date ? String(initial.festival_date).slice(0, 10) : '',
    repeat_yearly: Boolean(initial.repeat_yearly),
    days_before: initial.days_before || (kind === 'festival' ? [3, 0] : kind === 'thank_you' ? [1] : [0]),
    send_hour: initial.send_hour ?? 10,
    template_id: initial.template_id || '',
    variables: { store: businessName || '', ...(initial.variables || {}) },
    sms_fallback: Boolean(initial.sms_fallback),
    enabled: initial.enabled ?? true,
  });
  const start = audienceToPick(initial.audience);
  const [filters, setFilters] = useState(start.filters);
  const [pick, setPick] = useState(start.pick);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [reviewLink, setReviewLink] = useState('');
  const set = (patch) => setO((x) => ({ ...x, ...patch }));
  const template = templates.find((x) => x.id === Number(o.template_id));
  const needed = useMemo(() => (template ? CAMPAIGN_VARS.filter((v) => v.key !== 'store' && extractVariables(template.body).includes(v.key)) : []), [template]);
  const values = { ...valuesFor(EXAMPLE_CUSTOMER, o.variables), days_left: String(Math.max(...o.days_before)) };
  const stepName = steps[step];
  const audience = useMemo(() => (pick.only ? { mode: 'selected', contactIds: pick.ids } : { mode: 'filter', ...filters, excludeIds: pick.ids }), [pick, filters]);

  // Who these wishes can go to (wishes never count towards the weekly limit).
  useEffect(() => {
    const timer = setTimeout(() => {
      api('/api/campaigns/preview', { method: 'POST', body: { audience, templateId: o.template_id || null, variables: o.variables, wish: true } }).then(setPreview).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [audience, o.template_id, o.variables]);

  // Every template in one searchable list: the ready-made wishes (this kind's first) and the shop's own.
  const wishNames = new Set(Object.values(READY_WISHES).map((w) => w.name));
  const wishes = Object.entries(READY_WISHES).sort(([a], [b]) => (a === kind ? -1 : b === kind ? 1 : 0));
  const items = [
    ...wishes.map(([k, w]) => ({ key: `wish:${k}`, ready: true, wish: w, name: w.name, title: w.name.replace(/^\W+\s*/u, ''), body: w.body, pic: w.pic })),
    ...templates.filter((x) => !wishNames.has(x.name)).map((x) => ({ key: `t:${x.id}`, id: x.id, name: x.name, body: x.body, pic: 'memo' })),
  ];
  const wishKey = template && Object.keys(READY_WISHES).find((k) => READY_WISHES[k].name === template.name);
  const chosenKey = !template ? null : wishKey ? `wish:${wishKey}` : `t:${template.id}`;

  async function choose(i) {
    if (!i.wish) return set({ template_id: i.id });
    setBusyKey(i.key);
    try {
      let saved = templates.find((x) => x.name === i.wish.name);
      if (!saved) {
        ({ template: saved } = await api('/api/templates', { method: 'POST', body: { name: i.wish.name, body: i.wish.body, sms_body: i.wish.sms, buttons: [], category: 'marketing', status: 'approved' } }));
        setTemplates((list) => [saved, ...list]);
      }
      set({ template_id: saved.id, variables: { ...o.variables, offer: o.variables.offer || i.wish.offer || '' } });
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusyKey(null);
    }
    return undefined;
  }
  async function createThankYou() {
    if (!/^https?:\/\/\S+\.\S+/.test(reviewLink.trim())) return toast('Paste your Google review link (it starts with https://).', 'bad');
    try {
      const r = await api('/api/templates', { method: 'POST', body: thankYouMessage(reviewLink.trim()) });
      setTemplates((list) => [r.template, ...list]);
      set({ template_id: r.template.id });
    } catch (e) {
      toast(e.message, 'bad');
    }
    return undefined;
  }

  const blank = needed.find((v) => !String(o.variables[v.key] || '').trim());
  const error = {
    Event: !o.name.trim() ? 'Give the event a name.' : null,
    Template: !o.template_id ? 'Pick a template.' : blank ? `Fill in the ${blank.label.toLowerCase()}.` : null,
    Customers: pick.only && !pick.ids.length ? 'Tick at least one customer.' : null,
    When: kind === 'festival' && !o.festival_date ? 'Pick the date.' : !o.days_before.length ? 'Pick when to send.' : null,
  }[stepName];

  async function save() {
    setBusy(true);
    try {
      await api(isNew ? '/api/occasions' : `/api/occasions/${initial.id}`, { method: isNew ? 'POST' : 'PUT', body: { ...o, audience } });
      toast(isNew ? `${o.name} switched on` : 'Saved');
      onSaved();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  const toggleDay = (d) => set({ days_before: o.days_before.includes(d) ? o.days_before.filter((x) => x !== d) : [...o.days_before, d] });

  return (
    <Modal
      title={isNew ? (kind === 'festival' ? 'New festival or event' : `Set up ${KINDS[kind].label.toLowerCase()}`) : `Change ${o.name}`}
      onClose={onClose}
      width={960}
      footer={(
        <div className="row between" style={{ width: '100%', gap: 8 }}>
          <span className="subtle" style={{ color: error ? 'var(--warn)' : undefined }}>{error || `Step ${step + 1} of ${steps.length}`}</span>
          <span className="row" style={{ gap: 8 }}>
            {step > 0 ? <button className="btn ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={16} />Back</button> : <button className="btn ghost" onClick={onClose}>Cancel</button>}
            {step < steps.length - 1 ? (
              <button className="btn primary" disabled={Boolean(error)} onClick={() => setStep(step + 1)}>Next<ArrowRight size={16} /></button>
            ) : (
              <button className="btn primary" disabled={Boolean(error) || busy} onClick={save}>{busy ? <Spinner /> : <><Check size={16} />{isNew ? 'Switch on' : 'Save'}</>}</button>
            )}
          </span>
        </div>
      )}
    >
      <div className="stepper" style={{ marginBottom: 14 }}>
        {steps.map((s, i) => (
          <button key={s} className={`step ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick={() => i < step && setStep(i)} disabled={i >= step}>
            <span className="bar" /><span className="lbl">{i < step ? <Check size={14} strokeWidth={3} /> : `${i + 1}.`} {s}</span>
          </button>
        ))}
      </div>
      <div className="two-col" style={{ gridTemplateColumns: stepName === 'Customers' ? 'minmax(0,1fr)' : 'minmax(0,1fr) 280px' }}>
        <div className="stack" style={{ minWidth: 0 }}>
          {stepName === 'Event' && (
            <>
              <Field label="Event name">
                <input id="ev-name" className="input" value={o.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Shop anniversary sale" />
              </Field>
              {isNew && (
                <Field label="Or pick an idea">
                  <div className="chips">
                    {EVENT_IDEAS.map((e) => (
                      <button key={e.name} type="button" className={`chip ${o.name === e.name ? 'on' : ''}`}
                        onClick={() => set({ name: e.name, festival_date: e.md ? nextOn(e.md, today) : e.date || o.festival_date, repeat_yearly: e.md !== undefined })}>
                        {e.name}
                      </button>
                    ))}
                  </div>
                </Field>
              )}
            </>
          )}

          {stepName === 'Template' && (
            <>
              <TemplateChooser items={items} chosenKey={chosenKey} busyKey={busyKey} t={t} onPick={choose} />
              {needed.length > 0 && (
                <div className="fill-in">
                  <b>Fill in</b>
                  <div className="form-grid two">
                    {needed.map((v) => (
                      <Field key={v.key} label={v.label} hint={`e.g. ${v.example}`}>
                        <input id={`occ-${v.key}`} className="input" value={o.variables[v.key] || ''} onChange={(e) => set({ variables: { ...o.variables, [v.key]: e.target.value } })} />
                      </Field>
                    ))}
                  </div>
                </div>
              )}
              {kind === 'thank_you' && !templates.some((x) => x.name === THANK_YOU_NAME) && (
                <div className="card card-pad stack-sm" style={{ background: 'var(--surface-2)' }}>
                  <b>Ready-made thank-you with a Google review button</b>
                  <span className="subtle">Paste the shop’s Google review link (Google Business Profile → Ask for reviews → copy link).</span>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <input id="review-link" className="input" style={{ flex: '1 1 240px' }} placeholder="https://g.page/r/..." value={reviewLink} onChange={(e) => setReviewLink(e.target.value)} inputMode="url" />
                    <button type="button" className="btn primary" onClick={createThankYou}>Create it</button>
                  </div>
                </div>
              )}
            </>
          )}

          {stepName === 'Customers' && (
            <>
              <p className="subtle" style={{ margin: 0 }}>
                {kind === 'festival' ? 'Everyone ticked gets this wish.' : `Each customer ticked gets the wish on their ${KINDS[kind].one}.`} Narrow it with the filters, or untick people.
              </p>
              <CustomersStep t={t} title="Who gets these wishes" filters={filters} setFilters={setFilters} pick={pick} setPick={setPick}
                templateId={o.template_id || null} variables={o.variables} channel="whatsapp" preview={preview} wish />
            </>
          )}

          {stepName === 'When' && (
            <>
              {kind === 'festival' && (
                <div className="form-grid two">
                  <Field label="Date of the event" hint={o.repeat_yearly ? 'Sent on this date every year.' : 'Festival dates change each year; please check.'}>
                    <input id="ev-date" className="input" type="date" value={o.festival_date} onChange={(e) => set({ festival_date: e.target.value })} />
                  </Field>
                  <label className="check consent" style={{ alignSelf: 'end' }}>
                    <span className="switch"><input type="checkbox" checked={o.repeat_yearly} onChange={(e) => set({ repeat_yearly: e.target.checked })} /><span /></span>
                    <span><b>Same date every year</b></span>
                  </label>
                </div>
              )}
              <Field label={kind === 'thank_you' ? 'When after the purchase' : 'Send it'} hint={kind === 'thank_you' ? 'Counted from the day the sales code was used.' : 'Pick one or more. A week before is good for gift reminders.'}>
                <div className="chips">
                  {(kind === 'thank_you' ? AFTER : WHEN).map((w) => (
                    <button key={w.d} type="button" className={`chip ${o.days_before.includes(w.d) ? 'on' : ''}`} onClick={() => toggleDay(w.d)}>{w.label}</button>
                  ))}
                </div>
              </Field>
              <Field label="Time (India)">
                <div className="chips">
                  {HOURS.map((h) => <button key={h} type="button" className={`chip ${o.send_hour === h ? 'on' : ''}`} onClick={() => set({ send_hour: h })}>{hourText(h)}</button>)}
                </div>
              </Field>
              {smsOn && (
                <label className="check consent">
                  <span className="switch"><input type="checkbox" checked={o.sms_fallback} onChange={(e) => set({ sms_fallback: e.target.checked })} /><span /></span>
                  <span><b>SMS if not on WhatsApp</b></span>
                </label>
              )}
              <Alert tone="info">
                {preview ? `${plural(preview.sendable, 'customer')} in the list. ` : ''}
                Each customer gets this wish once per {kind === 'festival' ? 'event' : 'year'}. It does not count towards the weekly message limit.
              </Alert>
            </>
          )}
        </div>
        {stepName !== 'Customers' && (
          <div className="hide-mobile">
            <PhonePreview body={template?.body} values={values} buttons={template?.buttons || []} imageUrl={template?.image_url} businessName={businessName} caption={template ? 'Example: Priya' : 'Pick a template to see it here'} />
          </div>
        )}
      </div>
    </Modal>
  );
}
