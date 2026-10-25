import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, Pencil, Plus, Send, Users } from 'lucide-react';
import { VARIABLES, extractVariables, valuesFor } from '@shared/template.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Field, Modal, Pic, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { Highlighted, PhonePreview } from '../components/PhonePreview.jsx';
import { dateOnly, num, plural } from '../lib/format.js';
import { READY_WISHES } from '../lib/ready.js';
import { useT } from '../lib/i18n.jsx';
import { shopVars } from '../lib/shop.js';
import { atLeast } from '@shared/roles.js';
import { TemplateChooser } from '../components/TemplatePicker.jsx';
import { META_BADGE, metaState } from '../lib/approval.js';
import { CustomersStep } from '../components/CustomerPicker.jsx';

// Special days: automatic wishes, one line each with an on/off switch. Each goes to every customer
// who has that date saved (or, for a festival, everyone who agreed to messages), so customers
// added later are included without coming back here. One simple panel to change a wish.
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
const THANK_YOU_NAME = 'Thank you + Google review';
const thankYouMessage = (link) => ({
  name: THANK_YOU_NAME,
  category: 'marketing',
  status: 'approved',
  body: 'Thank you for shopping at {{store}}, {{name}}! We hope you love your new jewellery. Could you spare a minute to rate us on Google? It helps other families find us.',
  buttons: [{ type: 'url', text: 'Rate us on Google', url: link }],
  sms_body: `Thank you for shopping at {{store}}, {{name}}! Please rate us on Google: ${link}`,
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
const FAMILY = { spouse_birthday: 'spouse’s birthday', child_birthday: 'child’s birthday' };

const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nextOn = (md, today) => (`${today.slice(0, 4)}-${md}` >= today ? `${today.slice(0, 4)}-${md}` : `${Number(today.slice(0, 4)) + 1}-${md}`);
const an = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
const hourText = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;
function whenText(days, kind) {
  if (kind === 'thank_you') return [...days].sort((a, b) => a - b).map((d) => (d === 1 ? 'the day after a purchase' : `${d} days after a purchase`)).join(' and ');
  return [...days].sort((a, b) => b - a).map((d) => (d === 0 ? 'on the day' : d === 1 ? 'the day before' : `${d} days before`)).join(' and ');
}
export default function Occasions() {
  const { settings } = useAuth();
  const canEdit = atLeast(settings?.role, 'manager');
  const needsMeta = Boolean(settings?.metaTemplatesReady);
  const toast = useToast();
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [allTemplates, setAllTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [soon, setSoon] = useState(null);

  const load = () => api('/api/occasions').then((r) => {
    setData(r);
    api(`/api/occasions/calendar?from=${r.today.date}&days=8`).then(setSoon).catch(() => setSoon({ days: {} }));
  }).catch(() => setData({ occasions: [], dates: {}, today: { date: new Date().toISOString().slice(0, 10), hour: 0 } }));
  useEffect(() => {
    load();
    api('/api/templates').then((r) => {
      setAllTemplates(r.templates);
      setTemplates(r.templates.filter((x) => x.status === 'approved'));
    }).catch(() => {});
  }, []);

  async function toggle(o) {
    try {
      await api(`/api/occasions/${o.id}/enabled`, { method: 'PATCH', body: { enabled: !o.enabled } });
      toast(o.enabled ? `${o.name} switched off` : `${o.name} switched on`);
      load();
    } catch (e) {
      toast(e.message, 'bad');
      if (e.data?.missing?.length) setEditing(o);
    }
  }

  const occ = data?.occasions || [];
  const first = (kind) => occ.find((o) => o.kind === kind);
  const own = ['birthday', 'anniversary', 'personal', ...(settings?.salesCodes ? ['thank_you'] : [])];
  const events = occ.filter((o) => o.kind === 'festival');
  const meta = (o) => (needsMeta && o ? metaState(allTemplates.find((x) => x.id === o.template_id)) : null);
  // The next person (or event) for each kind, from the coming week.
  const upcoming = useMemo(() => {
    const out = [];
    for (const [date, d] of Object.entries(soon?.days || {}).sort(([a], [b]) => a.localeCompare(b))) {
      for (const k of ['birthday', 'anniversary', 'personal']) if (d[k]?.length) out.push({ date, kind: k, names: d[k].map((x) => x.name) });
      for (const e of d.events || []) out.push({ date, kind: 'festival', names: [e.name] });
    }
    return out;
  }, [soon]);
  const whenLabel = (date) => (date === data?.today.date ? 'Today' : date === addDays(data?.today.date || date, 1) ? 'Tomorrow' : dateOnly(date).replace(/ \d{4}$/, ''));
  const nextFor = (kind) => upcoming.find((u) => u.kind === kind);
  const reach = (kind) => (kind === 'birthday' ? data?.dates?.with_birthday : kind === 'anniversary' ? data?.dates?.with_anniversary : null);

  const Row = ({ o, kind }) => {
    const K = KINDS[kind];
    const st = meta(o);
    const n = reach(kind);
    const next = nextFor(kind);
    return (
      <div className={`sd-row ${o?.enabled ? '' : 'off'}`}>
        {canEdit && o ? (
          <label className="switch" title={o.enabled ? 'Switch off' : 'Switch on'}>
            <input type="checkbox" checked={o.enabled} onChange={() => toggle(o)} aria-label={`${o.name} on`} /><span />
          </label>
        ) : <span />}
        <div className="sd-main">
          <b className="row" style={{ gap: 8 }}><Pic name={K.pic} size={22} />{kind === 'festival' ? o.name : K.label}
            {kind === 'festival' && o.festival_date && <span className="subtle" style={{ fontWeight: 400 }}> · {o.repeat_yearly ? `every year, ${dateOnly(o.festival_date).replace(/ \d{4}$/, '')}` : dateOnly(o.festival_date)}</span>}
          </b>
          <span className="subtle">
            {o ? <>{o.enabled ? '' : 'Off · '}{whenText(o.days_before, kind)}, {hourText(o.send_hour)} · {o.template_name}</> : K.hint}
            {st && <span className={`badge ${META_BADGE[st][0]}`} style={{ marginLeft: 6 }}>{META_BADGE[st][1]}</span>}
          </span>
          <span className="subtle">
            <Users size={13} style={{ verticalAlign: '-2px' }} />{' '}
            {kind === 'festival' ? `Goes to all ${num(data.dates?.total || 0)} customers who agreed to messages`
              : kind === 'thank_you' ? 'Goes to each customer after they use a sales code'
                : n != null ? `Goes to every customer with ${an(K.one)} saved (${num(n)} now)` : `Goes to every customer with ${an(K.one)} saved`}
            {next && kind !== 'festival' ? ` · next: ${next.names.slice(0, 2).join(', ')}${next.names.length > 2 ? ` +${next.names.length - 2}` : ''}, ${whenLabel(next.date)}` : ''}
          </span>
        </div>
        <span className="subtle sd-gift">{o?.variables?.offer ? `${kind === 'festival' ? 'Offer' : 'Gift'}: ${o.variables.offer}` : ''}</span>
        {canEdit ? (
          <button className={`btn sm ${o ? 'ghost' : 'primary'}`} onClick={() => setEditing(o || { kind })}>{o ? <><Pencil size={14} />Change</> : <><Plus size={14} />Set up</>}</button>
        ) : <span />}
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-head compact">
        <div>
          <h1>Special days</h1>
          <p>Wishes go out by themselves, every year. New customers are included automatically.</p>
        </div>
        {canEdit && <button className="btn primary" onClick={() => setEditing({ kind: 'festival' })}><Plus size={18} />Add festival or event</button>}
      </div>

      {!data ? (
        <div className="card card-pad"><Skeleton h={260} /></div>
      ) : (
        <div className="stack">
          <div className="card sd-card" id="birthdays">
            <div className="sd-head">Every customer’s own dates</div>
            {own.map((k) => <Row key={k} kind={k} o={first(k)} />)}
          </div>
          <div className="card sd-card" id="events">
            <div className="sd-head">Festivals and shop events (same date for everyone)</div>
            {events.length === 0 && <p className="subtle" style={{ padding: '12px 16px', margin: 0 }}>None yet. Add Dhanteras, Diwali, a sale or the shop’s anniversary.</p>}
            {events.map((o) => <Row key={o.id} kind="festival" o={o} />)}
            {canEdit && <div style={{ padding: '10px 16px' }}><button className="btn sm" onClick={() => setEditing({ kind: 'festival' })}><Plus size={14} />Add a festival or shop event</button></div>}
          </div>
          <div className="card card-pad">
            <h2 style={{ marginBottom: 6 }}>Coming up (next 7 days)</h2>
            {!soon ? <Spinner /> : upcoming.length === 0 ? <p className="subtle" style={{ margin: 0 }}>No birthdays, anniversaries or events in the next 7 days.</p> : (
              <div className="sd-soon">
                {upcoming.slice(0, 12).map((u, i) => (
                  <div key={i}><b>{whenLabel(u.date)}</b><span className="subtle"> · {u.kind === 'festival' ? 'Event' : KINDS[u.kind].one[0].toUpperCase() + KINDS[u.kind].one.slice(1)} · {u.names.slice(0, 4).join(', ')}{u.names.length > 4 ? ` and ${u.names.length - 4} more` : ''}</span></div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {editing && (
        <OccasionEditor
          initial={editing}
          templates={templates}
          setTemplates={setTemplates}
          businessName={settings?.businessName}
          shop={settings?.shop}
          smsOn={settings?.sms?.live}
          today={data?.today?.date}
          reach={editing.kind === 'festival' ? data?.dates?.total : reach(editing.kind)}
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

/* ---------- Setting up a wish: event, template (and its blanks), customers, when ---------- */
function audienceToPick(a = {}) {
  if (a.mode === 'selected') return { filters: { cities: [], tags: [], search: '' }, pick: { only: true, ids: a.contactIds || [] } };
  return { filters: { cities: a.cities || [], tags: a.tags || [], search: a.search || '' }, pick: { only: false, ids: a.excludeIds || [] } };
}

function OccasionEditor({ initial, templates, setTemplates, businessName, shop, smsOn, today, reach, onClose, onSaved }) {
  // With WhatsApp connected, only templates Meta approved can be sent.
  const needsMeta = Boolean(useAuth().settings?.metaTemplatesReady);
  const toast = useToast();
  const { t } = useT();
  const isNew = !initial.id;
  const kind = initial.kind;
  // Leaving some customers out is optional and rare; it opens only on request (or if already used).
  const [o, setO] = useState({
    name: initial.name || (kind === 'festival' ? '' : KINDS[kind].label),
    kind,
    festival_date: initial.festival_date ? String(initial.festival_date).slice(0, 10) : '',
    repeat_yearly: Boolean(initial.repeat_yearly),
    days_before: initial.days_before || (kind === 'festival' ? [3, 0] : kind === 'thank_you' ? [1] : [0]),
    send_hour: initial.send_hour ?? 10,
    template_id: initial.template_id || '',
    variables: { ...(initial.variables || {}) },
    sms_fallback: Boolean(initial.sms_fallback),
    enabled: initial.enabled ?? true,
  });
  const start = audienceToPick(initial.audience);
  const [filters, setFilters] = useState(start.filters);
  const [pick, setPick] = useState(start.pick);
  const narrowed = Boolean(start.pick.only || start.pick.ids.length || start.filters.cities.length || start.filters.tags.length || start.filters.search);
  const [showPick, setShowPick] = useState(narrowed);
  const [testPhone, setTestPhone] = useState(() => { try { return localStorage.getItem('st_test_phone') || ''; } catch { return ''; } });
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [reviewLink, setReviewLink] = useState(shop?.googleReviewLink || '');
  const set = (patch) => setO((x) => ({ ...x, ...patch }));
  const template = templates.find((x) => x.id === Number(o.template_id));
  const needed = useMemo(() => (template ? CAMPAIGN_VARS.filter((v) => v.key !== 'store' && extractVariables(template.body).includes(v.key)) : []), [template]);
  const values = { ...valuesFor(EXAMPLE_CUSTOMER, { ...o.variables, ...shopVars({ shop }) }), days_left: String(Math.max(...o.days_before)) };
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
    ...wishes.map(([k, w]) => ({ key: `wish:${k}`, ready: true, wish: w, name: w.name, title: w.name.replace(/^\W+\s*/u, ''), body: w.body, pic: w.pic, meta: needsMeta ? metaState(templates.find((x) => x.name === w.name)) : null })),
    ...templates.filter((x) => !wishNames.has(x.name)).map((x) => ({ key: `t:${x.id}`, id: x.id, name: x.name, body: x.body, pic: 'memo', meta: needsMeta ? metaState(x) : null })),
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
      set({ template_id: saved.id, variables: { ...o.variables, offer: o.variables.offer || '' } });
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
  const error = [
    kind === 'festival' && !o.name.trim() ? 'Give the event a name.' : null,
    kind === 'festival' && !o.festival_date ? 'Pick the date.' : null,
    !o.template_id ? 'Pick a template.' : needsMeta && template && metaState(template) !== 'approved' ? 'Meta has not approved this template yet. Pick an approved one.' : blank ? `Fill in the ${blank.label.toLowerCase()}.` : null,
    !o.days_before.length ? 'Pick when to send.' : null,
    showPick && pick.only && !pick.ids.length ? 'Tick at least one customer, or include everyone.' : null,
  ].find(Boolean) || null;

  // "Send me a test": exactly this wish, to the staff member's own phone.
  async function sendTest() {
    if (!o.template_id) return toast('Pick a template first.', 'bad');
    setTesting(true);
    try {
      try { localStorage.setItem('st_test_phone', testPhone); } catch { /* private window */ }
      const r = await api('/api/campaigns/test', { method: 'POST', body: { templateId: Number(o.template_id), variables: o.variables, phone: testPhone } });
      toast(`Test going to ${r.phone}. Check WhatsApp on that phone.`);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setTesting(false);
    }
    return undefined;
  }

  async function save() {
    setBusy(true);
    try {
      await api(isNew ? '/api/occasions' : `/api/occasions/${initial.id}`, { method: isNew ? 'POST' : 'PUT', body: { ...o, audience: showPick ? audience : { mode: 'all' }, enabled: true } });
      toast(isNew || !initial.enabled ? `${o.name} switched on` : 'Saved');
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
        <div className="row between wrap" style={{ width: '100%', gap: 8 }}>
          <span className="subtle" style={{ color: error ? 'var(--warn)' : undefined }}>{error || (isNew || !initial.enabled ? 'Ready to switch on.' : 'Changes apply from the next wish.')}</span>
          <span className="row" style={{ gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={Boolean(error) || busy} onClick={save}>{busy ? <Spinner /> : <><Check size={16} />{isNew ? 'Switch on' : initial.enabled ? 'Save' : 'Save and switch on'}</>}</button>
          </span>
        </div>
      )}
    >
      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0,1fr) 280px' }}>
        <div className="stack" style={{ minWidth: 0 }}>
          {kind === 'festival' && (
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

          {(
            <>
              <h3 className="sd-step">Message</h3>
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

          <div className="sd-who">
            <Users size={18} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>Who gets it: </b>
              {kind === 'festival' ? 'every customer who agreed to messages' : kind === 'thank_you' ? 'each customer after they use a sales code' : `every customer with ${an(KINDS[kind].one)} saved`}
              {!showPick && reach != null ? ` (${num(reach)} now)` : ''}. New customers are included automatically.
            </span>
            {showPick
              ? <button type="button" className="btn ghost sm" onClick={() => { setShowPick(false); setPick({ only: false, ids: [] }); setFilters({ cities: [], tags: [], search: '' }); }}>Include everyone</button>
              : <button type="button" className="link-btn" onClick={() => setShowPick(true)}>Leave some out?</button>}
          </div>
          {showPick && (
            <>
              <p className="subtle" style={{ margin: 0 }}>Untick anyone who should not get it, or narrow by city or group.</p>
              <CustomersStep t={t} title="Who gets these wishes" filters={filters} setFilters={setFilters} pick={pick} setPick={setPick}
                templateId={o.template_id || null} variables={o.variables} channel="whatsapp" preview={preview} wish />
            </>
          )}

          {(
            <>
              <h3 className="sd-step">When</h3>
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
                Each customer gets this wish once per {kind === 'festival' ? 'event' : 'year'}. It does not count towards the weekly message limit.
              </Alert>
              <div className="sd-test">
                <b>Send me a test</b>
                <div className="row wrap" style={{ gap: 8 }}>
                  <input className="input" style={{ maxWidth: 220 }} inputMode="tel" placeholder="Your WhatsApp number" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} aria-label="Your WhatsApp number" />
                  <button type="button" className="btn" onClick={sendTest} disabled={testing || !testPhone.trim()}>{testing ? <Spinner /> : <><Send size={15} />Send test</>}</button>
                </div>
              </div>
            </>
          )}
        </div>
        {(
          <div className="hide-mobile sd-preview">
            <PhonePreview body={template?.body} values={values} buttons={template?.buttons || []} imageUrl={template?.image_url} videoUrl={template?.video_url} businessName={businessName} caption={template ? 'Example: Priya' : 'Pick a template to see it here'} />
          </div>
        )}
      </div>
    </Modal>
  );
}
