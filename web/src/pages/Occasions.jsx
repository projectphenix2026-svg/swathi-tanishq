import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CakeSlice, CalendarHeart, Gift, Heart, Pencil, Plus, Send, Sparkles, Star } from 'lucide-react';
import { VARIABLES, extractVariables, valuesFor } from '@shared/template.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Empty, Field, Modal, SectionTabs, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { PhonePreview } from '../components/PhonePreview.jsx';
import { dateOnly, inr, num, pct, plural } from '../lib/format.js';

const KINDS = {
  birthday: { label: 'Birthday', icon: CakeSlice, tone: 'tone-gold', hint: 'Uses each customer’s birthday from your list.' },
  anniversary: { label: 'Anniversary', icon: Heart, tone: 'tone-brand', hint: 'Uses each customer’s wedding anniversary.' },
  festival: { label: 'Festival', icon: Sparkles, tone: 'tone-wa', hint: 'One date for everyone, e.g. Diwali or Akshaya Tritiya.' },
  thank_you: { label: 'After a purchase', icon: Star, tone: 'tone-gold', hint: 'A thank-you with a “Rate us on Google” button, the day after a bill code is used.' },
};
// "After a purchase": how many days after the bill code was used.
const AFTER = [
  { d: 1, label: 'The next day' },
  { d: 2, label: '2 days after' },
  { d: 3, label: '3 days after' },
];
const THANK_YOU_NAME = '⭐ Thank you + Google review';
const thankYouMessage = (link) => ({
  name: THANK_YOU_NAME,
  category: 'marketing',
  status: 'approved',
  body: 'Thank you for shopping at {{store}}, {{name}}! We hope you love your new jewellery. Could you spare a minute to rate us on Google? It helps other families find us.',
  buttons: [{ type: 'url', text: 'Rate us on Google', url: link }],
  sms_body: `Thank you for shopping at {{store}}, {{name}}! Please rate us on Google: ${link} -SWATHI`,
});
const WHEN = [
  { d: 7, label: 'A week before' },
  { d: 3, label: '3 days before' },
  { d: 1, label: 'The day before' },
  { d: 0, label: 'On the day' },
];
const HOURS = [8, 9, 10, 11, 12, 16, 17, 18, 19];
const CAMPAIGN_VARS = VARIABLES.filter((v) => v.source === 'campaign');
const EXAMPLE_CUSTOMER = { name: 'Priya Sharma', city: 'Hyderabad', last_purchase: 'gold bangles', interests: 'bridal' };

function whenText(days, kind) {
  if (kind === 'thank_you') return [...days].sort((a, b) => a - b).map((d) => (d === 1 ? 'the day after a purchase' : `${d} days after a purchase`)).join(' and ');
  return [...days].sort((a, b) => b - a).map((d) => (d === 0 ? 'on the day' : d === 1 ? 'the day before' : `${d} days before`)).join(' and ');
}
function hourText(h) {
  return `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;
}

export default function Occasions() {
  const { settings } = useAuth();
  const canEdit = settings?.role !== 'viewer';
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const toast = useToast();

  const load = () => api('/api/occasions').then(setData).catch(() => setData({ occasions: [], dates: {} }));
  useEffect(() => {
    load();
    api('/api/templates').then((r) => setTemplates(r.templates.filter((t) => t.status === 'approved'))).catch(() => {});
  }, []);

  async function toggle(o) {
    try {
      await api(`/api/occasions/${o.id}/enabled`, { method: 'PATCH', body: { enabled: !o.enabled } });
      toast(o.enabled ? `${o.name} greetings paused` : `${o.name} greetings switched on`);
      load();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  const missingKinds = data ? ['birthday', 'anniversary', 'thank_you'].filter((k) => !data.occasions.some((o) => o.kind === k)) : [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Send offer</h1>
          <p>Birthday, anniversary and festival wishes go out every morning on their own. Nobody has to press anything.</p>
        </div>
        {canEdit && <button className="btn primary" onClick={() => setEditing({ kind: 'festival' })}><Plus size={18} />Add festival</button>}
      </div>
      <div style={{ marginBottom: 16 }}><SectionTabs tabs={[{ to: '/campaigns', label: 'Offers sent' }, { to: '/occasions', label: 'Automatic wishes' }]} /></div>

      {!data ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>{[0, 1].map((i) => <div key={i} className="card card-pad"><Skeleton h={18} w="40%" /><Skeleton h={60} style={{ marginTop: 12 }} /></div>)}</div>
      ) : (
        <div className="stack">
          {data.dates.total > 0 && (data.dates.with_birthday === 0 || data.dates.with_anniversary === 0) && (
            <Alert tone="warn" icon={CalendarHeart}>
              {num(data.dates.with_birthday)} of {num(data.dates.total)} customers have a birthday saved and {num(data.dates.with_anniversary)} an anniversary.
              Add these dates (Excel import or customer form) so they get greetings.
            </Alert>
          )}

          {canEdit && missingKinds.length > 0 && (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {missingKinds.map((k) => {
                const K = KINDS[k];
                return (
                  <button key={k} className="card card-pad option" style={{ alignItems: 'center' }} onClick={() => setEditing({ kind: k })}>
                    <span className={`kpi-icon ${K.tone}`} style={{ width: 44, height: 44, borderRadius: 12 }}><K.icon size={22} /></span>
                    <span style={{ flex: 1 }}>
                      <span className="option-title">{k === 'thank_you' ? 'Set up thank-you + Google review' : `Set up ${K.label.toLowerCase()} greetings`}</span>
                      <span className="subtle" style={{ display: 'block' }}>{K.hint}</span>
                    </span>
                    <Plus size={18} />
                  </button>
                );
              })}
            </div>
          )}

          {data.occasions.length === 0 && missingKinds.length === 0 && (
            <div className="card"><Empty icon={Gift} title="No wishes set up yet">Set up birthday, anniversary or festival greetings once; the app sends them every day.</Empty></div>
          )}

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {data.occasions.map((o) => (
              <OccasionCard key={o.id} o={o} canEdit={canEdit} onToggle={() => toggle(o)} onEdit={() => setEditing(o)} />
            ))}
          </div>
        </div>
      )}

      {editing && (
        <OccasionEditor
          initial={editing}
          templates={templates}
          businessName={settings?.businessName}
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

function OccasionCard({ o, canEdit, onToggle, onEdit }) {
  const K = KINDS[o.kind];
  const [next, setNext] = useState(null);
  useEffect(() => {
    api(`/api/occasions/${o.id}/upcoming?days=30`).then((r) => setNext(r.upcoming)).catch(() => setNext([]));
  }, [o.id, o.updated_at]);
  const total = next?.reduce((n, u) => n + u.count, 0) || 0;
  return (
    <div className="card card-pad occasion-card" style={{ opacity: o.enabled ? 1 : 0.75 }}>
      <div className="head">
        <span className={`glyph ${K.tone}`}><K.icon size={24} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{o.name}</h3>
          <p className="subtle">
            {o.kind === 'festival' ? `${dateOnly(o.festival_date)} · ` : ''}Sends {whenText(o.days_before, o.kind)}, at {hourText(o.send_hour)}
          </p>
        </div>
        {canEdit && (
          <label className="switch" title={o.enabled ? 'Switch off' : 'Switch on'}>
            <input type="checkbox" checked={o.enabled} onChange={onToggle} aria-label={`${o.name} greetings on`} />
            <span />
          </label>
        )}
      </div>
      <div className="stat-row">
        <span><b>{num(o.sent_30d)}</b> sent in 30 days</span>
        <span><b>{pct(o.read_30d, o.sent_30d)}%</b> read</span>
        <span><b>{num(o.redeemed)}</b> used in store · <b>{inr(o.revenue)}</b></span>
      </div>
      <div>
        <div className="label" style={{ marginBottom: 6 }}>Next 30 days {next && <span className="subtle">· {plural(total, 'greeting')}</span>}</div>
        {!next ? (
          <Skeleton h={40} />
        ) : next.length === 0 ? (
          <p className="subtle">Nobody in the next 30 days.</p>
        ) : (
          <div className="timeline-mini">
            {next.slice(0, 4).map((u) => (
              <div className="item" key={`${u.sendOn}-${u.before}`}>
                <span className="date">{dateOnly(u.sendOn).replace(/ \d{4}$/, '')}</span>
                <span className="badge neutral">{u.before === 0 ? 'on the day' : `${u.before} d before`}</span>
                <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.names.join(', ')}{u.count > u.names.length ? ` +${u.count - u.names.length}` : ''}
                </span>
              </div>
            ))}
            {next.length > 4 && <span className="subtle">and {plural(next.length - 4, 'more day')}</span>}
          </div>
        )}
      </div>
      <div className="row between">
        <span className="subtle">Message: {o.template_name}{o.sms_fallback ? ' · SMS backup on' : ''}</span>
        {canEdit && <button className="btn sm" onClick={onEdit}><Pencil size={15} />Edit</button>}
      </div>
    </div>
  );
}

function OccasionEditor({ initial, templates, businessName, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !initial.id;
  const [o, setO] = useState({
    name: initial.name || KINDS[initial.kind].label,
    kind: initial.kind,
    festival_date: initial.festival_date ? String(initial.festival_date).slice(0, 10) : '',
    days_before: initial.days_before || (initial.kind === 'festival' ? [3, 0] : initial.kind === 'thank_you' ? [1] : [0]),
    send_hour: initial.send_hour ?? 10,
    template_id: initial.template_id || (initial.kind === 'thank_you' ? templates.find((t) => t.name === THANK_YOU_NAME)?.id : templates[0]?.id) || '',
    variables: initial.variables || {},
    sms_fallback: Boolean(initial.sms_fallback),
    enabled: initial.enabled ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(templates);
  const [reviewLink, setReviewLink] = useState('');
  const set = (patch) => setO((x) => ({ ...x, ...patch }));
  const template = list.find((t) => t.id === Number(o.template_id));
  const isThanks = o.kind === 'thank_you';
  const hasThanksMessage = list.some((t) => t.name === THANK_YOU_NAME);

  async function createThankYou() {
    if (!/^https?:\/\/\S+\.\S+/.test(reviewLink.trim())) return toast('Paste your Google review link (it starts with https://).', 'bad');
    try {
      const r = await api('/api/templates', { method: 'POST', body: thankYouMessage(reviewLink.trim()) });
      setList((x) => [...x, r.template]);
      set({ template_id: r.template.id, variables: { store: businessName || '', ...o.variables } });
      toast('Thank-you message created');
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
  const needed = useMemo(() => (template ? CAMPAIGN_VARS.filter((v) => extractVariables(template.body).includes(v.key)) : []), [template]);
  const values = { ...valuesFor(EXAMPLE_CUSTOMER, o.variables), days_left: String(Math.max(...o.days_before)), offer_code: `PRIYA-${o.kind === 'birthday' ? 'BDAY' : o.kind === 'anniversary' ? 'ANNIV' : o.kind === 'thank_you' ? 'THANKS' : 'FEST'}-4821` };

  const toggleDay = (d) => set({ days_before: o.days_before.includes(d) ? o.days_before.filter((x) => x !== d) : [...o.days_before, d] });

  async function save() {
    setBusy(true);
    try {
      await api(isNew ? '/api/occasions' : `/api/occasions/${initial.id}`, { method: isNew ? 'POST' : 'PUT', body: o });
      toast(isNew ? `${o.name} greetings switched on` : 'Saved');
      onSaved();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? `New ${KINDS[o.kind].label.toLowerCase()} greeting` : `Edit ${o.name}`}
      onClose={onClose}
      width={880}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy || !o.days_before.length || !o.template_id}>{busy ? <Spinner /> : isNew ? 'Switch on' : 'Save'}</button></>}
    >
      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
        <div className="stack">
          <div className="form-grid two">
            <Field label="Name"><input className="input" value={o.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            {o.kind === 'festival' && (
              <Field label="Festival date"><input className="input" type="date" value={o.festival_date} onChange={(e) => set({ festival_date: e.target.value })} /></Field>
            )}
          </div>
          {isThanks && !hasThanksMessage && (
            <div className="card card-pad stack-sm" style={{ background: 'var(--surface-2)' }}>
              <b>Ready-made thank-you message</b>
              <span className="subtle">Paste the shop’s Google review link (Google Business Profile → Ask for reviews → copy link). It becomes a “Rate us on Google” button.</span>
              <div className="row wrap" style={{ gap: 8 }}>
                <input className="input" style={{ flex: '1 1 240px' }} placeholder="https://g.page/r/..." value={reviewLink} onChange={(e) => setReviewLink(e.target.value)} inputMode="url" />
                <button type="button" className="btn primary" onClick={createThankYou}>Create the message</button>
              </div>
            </div>
          )}
          <Field label="When to send" hint={isThanks ? 'Counted from the day the bill code was used at the counter.' : 'Pick one or more. A week before is the best time for gift reminders.'}>
            <div className="chips">
              {(isThanks ? AFTER : WHEN).map((w) => (
                <button key={w.d} type="button" className={`chip ${o.days_before.includes(w.d) ? 'on' : ''}`} onClick={() => toggleDay(w.d)}>{w.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Time (India)">
            <div className="chips">
              {HOURS.map((h) => <button key={h} type="button" className={`chip ${o.send_hour === h ? 'on' : ''}`} onClick={() => set({ send_hour: h })}>{hourText(h)}</button>)}
            </div>
          </Field>
          <Field label="Message" hint={templates.length ? 'Tip: use {{days_left}} for “in 7 days” and {{offer_code}} for a code they show at billing.' : undefined}>
            {list.length ? (
              <select className="select" value={o.template_id} onChange={(e) => set({ template_id: Number(e.target.value) })}>
                {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : (
              <Alert>No saved messages yet. <Link to="/templates/new">Write one first.</Link></Alert>
            )}
          </Field>
          {needed.length > 0 && (
            <div className="form-grid two">
              {needed.map((v) => (
                <Field key={v.key} label={v.label} hint={`e.g. ${v.example}`}>
                  <input className="input" value={o.variables[v.key] || ''} onChange={(e) => set({ variables: { ...o.variables, [v.key]: e.target.value } })} />
                </Field>
              ))}
            </div>
          )}
          <label className="check">
            <span className="switch"><input type="checkbox" checked={o.sms_fallback} onChange={(e) => set({ sms_fallback: e.target.checked })} /><span /></span>
            <span><b>SMS backup</b><span className="hint" style={{ display: 'block' }}>If a customer is not on WhatsApp and agreed to SMS, send the SMS version.</span></span>
          </label>
        </div>
        <div className="stack">
          <PhonePreview body={template?.body} values={values} buttons={template?.buttons || []} businessName={businessName} caption="Example: Priya" />
        </div>
      </div>
    </Modal>
  );
}
