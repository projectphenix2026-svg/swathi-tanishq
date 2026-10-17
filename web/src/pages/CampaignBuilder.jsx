import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, Check, Filter, Search, Send, UserCheck, Users, X, Zap } from 'lucide-react';
import { VARIABLES, extractVariables, render, valuesFor } from '@shared/template.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Avatar, Field, Spinner, useToast } from '../components/ui.jsx';
import { PhonePreview } from '../components/PhonePreview.jsx';
import { ProviderBanner } from './Dashboard.jsx';
import { dateTime, inr, num, phone, plural, rate } from '../lib/format.js';

const STEPS = ['Who', 'Message', 'When', 'Review'];
const CAMPAIGN_VARS = VARIABLES.filter((v) => v.source === 'campaign');
const VAR_LABEL = Object.fromEntries(VARIABLES.map((v) => [v.key, v.label.toLowerCase()]));

export default function CampaignBuilder() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useAuth();

  const [step, setStep] = useState(0);
  const [audience, setAudience] = useState({ mode: 'all', cities: [], tags: [], search: '', contactIds: [] });
  const [picked, setPicked] = useState([]); // customers chosen by hand (for display)
  const [templates, setTemplates] = useState(null);
  const [templateId, setTemplateId] = useState(params.get('template') ? Number(params.get('template')) : null);
  const [variables, setVariables] = useState({ offer: '', offer_ends: '', store: settings?.businessName || '' });
  const [when, setWhen] = useState({ mode: 'now', at: defaultLater() });
  const [name, setName] = useState('');
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewAs, setPreviewAs] = useState(null);
  const [bigOk, setBigOk] = useState(false);
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api('/api/templates').then((r) => setTemplates(r.templates.filter((t) => t.status === 'approved'))).catch(() => setTemplates([]));
    api('/api/customers/summary').then(setSummary).catch(() => {});
  }, []);

  const template = templates?.find((t) => t.id === templateId) || null;
  const usedVars = useMemo(() => (template ? extractVariables(template.body) : []), [template]);
  const neededCampaignVars = CAMPAIGN_VARS.filter((v) => usedVars.includes(v.key));

  // Live numbers: who matches, who can receive, cost.
  useEffect(() => {
    setLoadingPreview(true);
    const t = setTimeout(() => {
      api('/api/campaigns/preview', { method: 'POST', body: { audience, templateId, variables } })
        .then((r) => {
          setPreview(r);
          setPreviewAs((cur) => (cur && r.sample.some((s) => s.id === cur.id) ? cur : r.sample[0] || null));
        })
        .catch(() => {})
        .finally(() => setLoadingPreview(false));
    }, 300);
    return () => clearTimeout(t);
  }, [audience, templateId, variables]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  useEffect(() => {
    if (template && !name) setName(`${template.name} · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`);
  }, [template, name]);

  const sendCount = template ? preview?.sendable ?? 0 : preview?.eligible ?? 0;
  const cost = sendCount * (preview?.costPerMessage ?? settings?.costPerMessage ?? 0.8631);
  const values = previewAs ? valuesFor(previewAs, variables) : null;
  const rendered = template && values ? render(template.body, values) : null;

  const stepError = [
    preview && preview.eligible === 0 ? 'No customers in this group can receive WhatsApp yet.' : audience.mode === 'selected' && !audience.contactIds.length ? 'Pick at least one customer.' : null,
    !template ? 'Choose a message.' : neededCampaignVars.find((v) => !String(variables[v.key] || '').trim()) ? `Fill in the ${neededCampaignVars.find((v) => !String(variables[v.key] || '').trim()).label.toLowerCase()}.` : sendCount === 0 ? 'None of these customers have the details this message needs.' : null,
    when.mode === 'later' && (!when.at || new Date(when.at).getTime() < Date.now()) ? 'Pick a time in the future.' : null,
    !name.trim() ? 'Give the campaign a name.' : sendCount >= 500 && !bigOk ? 'Tick the box to confirm this large send.' : null,
  ][step];

  async function send() {
    setSending(true);
    try {
      const r = await api('/api/campaigns', {
        method: 'POST',
        body: {
          name, templateId, audience, variables,
          scheduledAt: when.mode === 'later' ? new Date(when.at).toISOString() : null,
          expectedCount: sendCount,
        },
      });
      toast(when.mode === 'later' ? `Scheduled for ${dateTime(when.at)}` : `Sending to ${plural(r.queued, 'customer')}`);
      navigate(`/campaigns/${r.campaign.id}`);
    } catch (e) {
      toast(e.message, 'bad');
      if (e.data?.preview) setPreview(e.data.preview);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page">
      <Link to="/campaigns" className="back"><ArrowLeft size={16} />Campaigns</Link>
      <div className="page-head">
        <div>
          <h1>New campaign</h1>
          <p>Four short steps. The preview and cost update as you go.</p>
        </div>
      </div>

      <div className="stepper" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button key={s} className={`step ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick={() => i < step && setStep(i)} disabled={i >= step} aria-current={i === step ? 'step' : undefined}>
            <span className="bar" />
            <span className="lbl">{i < step ? <Check size={14} strokeWidth={3} /> : `${i + 1}.`} {s}</span>
          </button>
        ))}
      </div>

      <div className="two-col">
        <div className="stack">
          {step === 0 && <WhoStep audience={audience} setAudience={setAudience} picked={picked} setPicked={setPicked} preview={preview} summary={summary} />}
          {step === 1 && (
            <MessageStep
              templates={templates} templateId={templateId} setTemplateId={setTemplateId}
              neededVars={neededCampaignVars} variables={variables} setVariables={setVariables} preview={preview}
            />
          )}
          {step === 2 && <WhenStep when={when} setWhen={setWhen} />}
          {step === 3 && (
            <ReviewStep
              name={name} setName={setName} template={template} audience={audience} picked={picked} when={when}
              sendCount={sendCount} cost={cost} preview={preview} variables={variables} neededVars={neededCampaignVars}
              bigOk={bigOk} setBigOk={setBigOk} settings={settings} goTo={setStep}
            />
          )}

          <div className="action-bar">
            <div style={{ minWidth: 0 }}>
              {stepError ? (
                <span className="subtle" style={{ color: 'var(--warn)', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={15} />{stepError}</span>
              ) : (
                <>
                  <b className="num">{plural(sendCount, 'customer')}</b>
                  <div className="subtle num">about {inr(cost)}</div>
                </>
              )}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={18} /><span className="hide-mobile">Back</span></button>}
              {step < 3 ? (
                <button className="btn primary lg" onClick={() => setStep(step + 1)} disabled={Boolean(stepError) || loadingPreview && !preview}>
                  Next<ArrowRight size={18} />
                </button>
              ) : (
                <button className="btn wa lg" onClick={send} disabled={Boolean(stepError) || sending}>
                  {sending ? <Spinner /> : <><Send size={18} />{when.mode === 'later' ? 'Schedule' : `Send to ${num(sendCount)}`}</>}
                </button>
              )}
            </div>
          </div>
        </div>

        <aside className="stack sticky">
          {previewAs && template ? (
            <>
              <div className="field">
                <label htmlFor="preview-as">Preview as</label>
                <select id="preview-as" className="select" value={previewAs.id} onChange={(e) => setPreviewAs(preview.sample.find((s) => s.id === Number(e.target.value)))}>
                  {preview.sample.map((s) => <option key={s.id} value={s.id}>{s.name || phone(s.phone)}{s.city ? ` · ${s.city}` : ''}</option>)}
                </select>
              </div>
              <PhonePreview body={template.body} values={values} buttons={template.buttons} imageUrl={template.image_url} businessName={settings?.businessName} />
              {rendered?.missing.length > 0 && (
                <Alert tone="warn" icon={AlertTriangle}>
                  {previewAs.name || 'This customer'} has no {rendered.missing.map((k) => VAR_LABEL[k]).join(' or ')}, so they will be skipped rather than sent a message with a gap.
                </Alert>
              )}
            </>
          ) : (
            <PhonePreview body={template?.body} buttons={template?.buttons} businessName={settings?.businessName} caption={template ? 'No customer to preview yet' : 'Choose a message in step 2'} />
          )}
          <CostCard preview={preview} sendCount={sendCount} cost={cost} loading={loadingPreview} hasTemplate={Boolean(template)} />
        </aside>
      </div>
    </div>
  );
}

function CostCard({ preview, sendCount, cost, loading, hasTemplate }) {
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row between">
        <span className="muted">Estimated cost</span>
        {loading && <Spinner size={16} />}
      </div>
      <div className="cost">{inr(cost)}</div>
      <div className="subtle num">{num(sendCount)} × {rate(preview?.costPerMessage ?? 0.8631)} per message (Meta marketing rate, before GST)</div>
      {preview && (preview.no_opt_in > 0 || preview.opted_out > 0 || (hasTemplate && preview.eligible > preview.sendable)) && (
        <>
          <div className="divider" />
          <div className="stack-sm subtle">
            {preview.no_opt_in > 0 && <span>{plural(preview.no_opt_in, 'customer')} left out: no WhatsApp opt-in</span>}
            {preview.opted_out > 0 && <span>{plural(preview.opted_out, 'customer')} left out: opted out</span>}
            {hasTemplate && preview.eligible > preview.sendable && <span>{plural(preview.eligible - preview.sendable, 'customer')} left out: missing details for this message</span>}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Step 1: Who ---------- */
function WhoStep({ audience, setAudience, picked, setPicked, preview, summary }) {
  const opts = [
    { mode: 'all', icon: Users, title: 'Everyone who can receive WhatsApp', text: summary ? `${num(summary.opted_in)} customers` : '' },
    { mode: 'filter', icon: Filter, title: 'A group', text: 'By city, tag, interest or last purchase' },
    { mode: 'selected', icon: UserCheck, title: 'Customers I pick', text: 'Good for a test send to your own phone first' },
  ];
  const set = (patch) => setAudience((a) => ({ ...a, ...patch }));
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="card card-pad stack">
      <h2>Who should get this?</h2>
      <div className="options">
        {opts.map((o) => (
          <button key={o.mode} className={`option ${audience.mode === o.mode ? 'on' : ''}`} onClick={() => set({ mode: o.mode })}>
            <span className="radio" />
            <o.icon size={20} style={{ color: 'var(--brand)', flexShrink: 0, marginTop: 1 }} />
            <span><span className="option-title">{o.title}</span><span className="subtle" style={{ display: 'block' }}>{o.text}</span></span>
          </button>
        ))}
      </div>

      {audience.mode === 'filter' && summary && (
        <div className="stack" style={{ paddingTop: 4 }}>
          {summary.cities.length > 0 && (
            <Field label="City">
              <div className="chips">
                {summary.cities.map((c) => (
                  <button key={c.city} className={`chip ${audience.cities.includes(c.city.toLowerCase()) ? 'on' : ''}`} onClick={() => set({ cities: toggle(audience.cities, c.city.toLowerCase()) })}>
                    {c.city} <span className="n">{num(c.count)}</span>
                  </button>
                ))}
              </div>
            </Field>
          )}
          {summary.tags.length > 0 && (
            <Field label="Tag">
              <div className="chips">
                {summary.tags.map((t) => (
                  <button key={t.tag} className={`chip ${audience.tags.includes(t.tag) ? 'on' : ''}`} onClick={() => set({ tags: toggle(audience.tags, t.tag) })}>
                    {t.tag} <span className="n">{num(t.count)}</span>
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Interest or last purchase contains" hint="e.g. “bridal” or “diamond”">
            <div className="input-icon"><Search size={16} /><input className="input" value={audience.search} onChange={(e) => set({ search: e.target.value })} /></div>
          </Field>
        </div>
      )}

      {audience.mode === 'selected' && (
        <PickCustomers picked={picked} onChange={(list) => { setPicked(list); set({ contactIds: list.map((c) => c.id) }); }} />
      )}

      {preview && (
        <Alert tone={preview.eligible ? 'ok' : 'warn'} icon={preview.eligible ? Users : AlertTriangle}>
          <b>{plural(preview.eligible, 'customer')}</b> can receive this
          {preview.matched > preview.eligible ? ` (${num(preview.matched - preview.eligible)} more match but have not opted in or have opted out)` : ''}.
        </Alert>
      )}
    </div>
  );
}

function PickCustomers({ picked, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => {
      api(`/api/customers?${new URLSearchParams({ q, filter: 'opted_in', limit: 8, sort: 'name' })}`).then((r) => setResults(r.customers)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const ids = new Set(picked.map((p) => p.id));
  return (
    <div className="stack" style={{ gap: 10 }}>
      {picked.length > 0 && (
        <div className="chips">
          {picked.map((c) => (
            <span key={c.id} className="chip on" style={{ cursor: 'default' }}>
              {c.name || phone(c.phone)}
              <button onClick={() => onChange(picked.filter((p) => p.id !== c.id))} aria-label={`Remove ${c.name}`} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'grid', padding: 0 }}><X size={14} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="input-icon"><Search size={16} /><input className="input" placeholder="Search by name or number" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {results.length === 0 && <p className="subtle" style={{ padding: 14 }}>No opted-in customers match.</p>}
        {results.map((c) => (
          <label key={c.id} className="list-item" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={ids.has(c.id)} onChange={() => onChange(ids.has(c.id) ? picked.filter((p) => p.id !== c.id) : [...picked, c])} style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />
            <Avatar name={c.name} seed={c.phone} size={32} />
            <div><b>{c.name || 'No name'}</b><div className="subtle num">{phone(c.phone)}</div></div>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ---------- Step 2: Message ---------- */
function MessageStep({ templates, templateId, setTemplateId, neededVars, variables, setVariables, preview }) {
  if (!templates) return <div className="card card-pad"><Spinner /></div>;
  if (!templates.length) {
    return (
      <div className="card card-pad stack">
        <h2>What should it say?</h2>
        <Alert>You have no ready-to-send templates yet. <Link to="/templates/new">Write one</Link>; it takes two minutes.</Alert>
      </div>
    );
  }
  const missing = Object.entries(preview?.missing || {}).filter(([k]) => !CAMPAIGN_VARS.some((v) => v.key === k));
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div className="row between">
          <h2>What should it say?</h2>
          <Link to="/templates/new" className="btn ghost sm">New template</Link>
        </div>
        <div className="options">
          {templates.map((t) => (
            <button key={t.id} className={`option ${templateId === t.id ? 'on' : ''}`} onClick={() => setTemplateId(t.id)}>
              <span className="radio" />
              <span style={{ minWidth: 0 }}>
                <span className="option-title">{t.name}</span>
                <span className="subtle" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.body}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {neededVars.length > 0 && (
        <div className="card card-pad stack">
          <div>
            <h2>This campaign’s offer</h2>
            <p className="subtle">Same for everyone in this campaign. Personal details come from each customer.</p>
          </div>
          <div className="form-grid two">
            {neededVars.map((v) => (
              <Field key={v.key} label={v.label} hint={`e.g. ${v.example}`}>
                <input className="input" value={variables[v.key] || ''} onChange={(e) => setVariables((x) => ({ ...x, [v.key]: e.target.value }))} />
              </Field>
            ))}
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <Alert tone="warn" icon={AlertTriangle}>
          {missing.map(([k, n]) => `${plural(n, 'customer')} ${n === 1 ? 'has' : 'have'} no ${VAR_LABEL[k]}`).join('; ')}. They will be skipped so nobody gets a message with a blank in it.
          {' '}<Link to="/customers">Add the details</Link> or choose a message that does not need them.
        </Alert>
      )}
    </div>
  );
}

/* ---------- Step 3: When ---------- */
function WhenStep({ when, setWhen }) {
  return (
    <div className="card card-pad stack">
      <h2>When should it go out?</h2>
      <div className="options">
        <button className={`option ${when.mode === 'now' ? 'on' : ''}`} onClick={() => setWhen({ ...when, mode: 'now' })}>
          <span className="radio" /><Zap size={20} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          <span><span className="option-title">Send now</span><span className="subtle" style={{ display: 'block' }}>Messages start going out right after you confirm.</span></span>
        </button>
        <button className={`option ${when.mode === 'later' ? 'on' : ''}`} onClick={() => setWhen({ ...when, mode: 'later' })}>
          <span className="radio" /><CalendarClock size={20} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          <span><span className="option-title">Schedule for later</span><span className="subtle" style={{ display: 'block' }}>You can cancel any time before it starts.</span></span>
        </button>
      </div>
      {when.mode === 'later' && (
        <Field label="Date and time (India time)" hint="Late morning (10–12) and evening (6–8) usually get the most reads.">
          <input className="input" type="datetime-local" value={when.at} min={toLocalInput(new Date())} onChange={(e) => setWhen({ ...when, at: e.target.value })} style={{ maxWidth: 280 }} />
        </Field>
      )}
    </div>
  );
}

/* ---------- Step 4: Review ---------- */
function ReviewStep({ name, setName, template, audience, picked, when, sendCount, cost, preview, variables, neededVars, bigOk, setBigOk, settings, goTo }) {
  const who = audience.mode === 'all'
    ? 'Everyone who can receive WhatsApp'
    : audience.mode === 'selected'
      ? picked.map((p) => p.name || phone(p.phone)).join(', ')
      : [audience.cities.length && `City: ${audience.cities.join(', ')}`, audience.tags.length && `Tag: ${audience.tags.join(', ')}`, audience.search && `“${audience.search}”`].filter(Boolean).join(' · ') || 'Everyone who can receive WhatsApp';
  return (
    <div className="stack">
      <ProviderBanner settings={settings} compact />
      <div className="card card-pad stack">
        <h2>Check and send</h2>
        <Field label="Campaign name" hint="Only staff see this, in reports.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <dl className="summary-list" style={{ margin: 0 }}>
          <div><dt>Who</dt><dd>{who} <button className="btn ghost sm" onClick={() => goTo(0)}>Change</button></dd></div>
          <div><dt>Message</dt><dd>{template?.name} <button className="btn ghost sm" onClick={() => goTo(1)}>Change</button></dd></div>
          {neededVars.map((v) => <div key={v.key}><dt>{v.label}</dt><dd>{variables[v.key]}</dd></div>)}
          <div><dt>When</dt><dd>{when.mode === 'now' ? 'Right away' : dateTime(when.at)} <button className="btn ghost sm" onClick={() => goTo(2)}>Change</button></dd></div>
          <div><dt>Customers</dt><dd className="num">{num(sendCount)}</dd></div>
          <div><dt>Estimated cost</dt><dd className="num">{inr(cost)} <span className="subtle">+ GST</span></dd></div>
        </dl>
        {preview && preview.matched > sendCount && (
          <p className="subtle">{plural(preview.matched - sendCount, 'customer')} in this group will not get it (no opt-in, opted out, or missing details).</p>
        )}
        {sendCount >= 500 && (
          <label className="check alert warn" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={bigOk} onChange={(e) => setBigOk(e.target.checked)} />
            <span>I checked the preview. Send to <b>{num(sendCount)}</b> customers for about <b>{inr(cost)}</b>.</span>
          </label>
        )}
      </div>
    </div>
  );
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultLater() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  return toLocalInput(d);
}
