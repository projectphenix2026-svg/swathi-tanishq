import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, Check, Filter, Search, Send, ShieldCheck, UserCheck, Users, X, Zap } from 'lucide-react';
import { VARIABLES, extractVariables, render, valuesFor } from '@shared/template.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Avatar, Field, Pic, Spinner, useToast } from '../components/ui.jsx';
import { PhonePreview } from '../components/PhonePreview.jsx';
import { ProviderBanner } from './Dashboard.jsx';
import { dateTime, inr, num, phone, plural, rate } from '../lib/format.js';
import { READY_MESSAGES } from '../lib/ready.js';
import { LANGS, readyIn } from '../lib/ready-lang.js';
import { toFriendly } from '../lib/friendly.js';
import { PhotoPicker } from '../components/PhotoPicker.jsx';
import { useT } from '../lib/i18n.jsx';

const STEPS = ['Who gets it', 'Message', 'When', 'Check & send'];
const CAMPAIGN_VARS = VARIABLES.filter((v) => v.source === 'campaign');
const VAR_LABEL = Object.fromEntries(VARIABLES.map((v) => [v.key, v.label.toLowerCase()]));

export default function CampaignBuilder() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useAuth();
  const { t } = useT();

  const [step, setStep] = useState(0);
  const [audience, setAudience] = useState({ mode: 'all', cities: [], tags: [], search: '', contactIds: [] });
  const [picked, setPicked] = useState([]); // customers chosen by hand (for display)
  const [templates, setTemplates] = useState(null);
  const [templateId, setTemplateId] = useState(params.get('template') ? Number(params.get('template')) : null);
  const [variables, setVariables] = useState({ offer: '', offer_ends: '', store: settings?.businessName || '' });
  const [when, setWhen] = useState({ mode: 'now', at: defaultLater(), sms: false });
  // How the offer goes out: WhatsApp (optionally with SMS backup) or bulk SMS.
  const [channel, setChannel] = useState('whatsapp');
  const isSms = channel === 'sms';
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
      api('/api/campaigns/preview', { method: 'POST', body: { audience, templateId, variables, channel } })
        .then((r) => {
          setPreview(r);
          setPreviewAs((cur) => (cur && r.sample.some((s) => s.id === cur.id) ? cur : r.sample[0] || null));
        })
        .catch(() => {})
        .finally(() => setLoadingPreview(false));
    }, 300);
    return () => clearTimeout(t);
  }, [audience, templateId, variables, channel]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  // The shop name arrives after the page opens; use it for {{store}} unless staff typed something.
  useEffect(() => {
    if (settings?.businessName) setVariables((x) => (x.store ? x : { ...x, store: settings.businessName }));
  }, [settings?.businessName]);

  useEffect(() => {
    if (template && !name) setName(`${template.name} · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`);
  }, [template, name]);

  const sendCount = preview?.sendable ?? 0;
  const cost = sendCount * (preview?.costPerMessage ?? settings?.costPerMessage ?? 0.8631);
  const values = previewAs ? { ...valuesFor(previewAs, variables), offer_code: exampleCode(previewAs.name, variables.code_prefix) } : null;
  const rendered = template && values ? render(template.body, values) : null;

  const stepError = [
    preview && preview.eligible === 0 ? (isSms ? 'No customers in this group have agreed to SMS yet.' : 'No customers in this group can receive WhatsApp yet.') : preview && preview.sendable === 0 && preview.atCap > 0 ? 'Everyone in this group already got this week’s offers. Try again in a few days, or the owner can raise the weekly limit in Settings.' : audience.mode === 'selected' && !audience.contactIds.length ? 'Pick at least one customer.' : null,
    !template ? 'Choose a message.' : isSms && !template.sms_body ? 'This message has no SMS version yet. Pick a ready-made message or add one on its page.' : neededCampaignVars.find((v) => !String(variables[v.key] || '').trim()) ? `Fill in the ${neededCampaignVars.find((v) => !String(variables[v.key] || '').trim()).label.toLowerCase()}.` : sendCount === 0 ? 'None of these customers have the details this message needs.' : null,
    when.mode === 'later' && (!when.at || new Date(when.at).getTime() < Date.now()) ? 'Pick a time in the future.' : null,
    !name.trim() ? 'Give this offer a name.' : sendCount >= 500 && !bigOk ? 'Tick the box to confirm this large send.' : null,
  ][step];

  async function send() {
    setSending(true);
    try {
      const r = await api('/api/campaigns', {
        method: 'POST',
        body: {
          name, templateId, audience, variables,
          scheduledAt: when.mode === 'later' ? new Date(when.at).toISOString() : null,
          undoSeconds: when.mode === 'now' ? 20 : 0,
          expectedCount: sendCount,
          smsFallback: !isSms && when.sms,
          channel,
        },
      });
      toast(
        r.pendingApproval
          ? 'Sent to the owner for approval. It goes out once approved.'
          : when.mode === 'later' ? `Will go out ${dateTime(when.at)}` : 'Starting within a minute. You can still undo.',
        r.pendingApproval ? 'info' : 'ok',
      );
      navigate(`/campaigns/${r.campaign.id}`, { state: { undo: when.mode === 'now' && !r.pendingApproval } });
    } catch (e) {
      toast(e.message, 'bad');
      if (e.data?.preview) setPreview(e.data.preview);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page">
      <Link to="/campaigns" className="back"><ArrowLeft size={16} />Send offer</Link>
      <div className="page-head">
        <div>
          <h1>{t('Send an offer')}</h1>
          <p>{t('Four short steps. You see the message and the cost as you go.')}</p>
        </div>
      </div>

      <div className="stepper" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button key={s} className={`step ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick={() => i < step && setStep(i)} disabled={i >= step} aria-current={i === step ? 'step' : undefined}>
            <span className="bar" />
            <span className="lbl">{i < step ? <Check size={14} strokeWidth={3} /> : `${i + 1}.`} {t(s)}</span>
          </button>
        ))}
      </div>

      <div className="two-col">
        <div className="stack">
          {step === 0 && <WhoStep t={t} channel={channel} setChannel={setChannel} audience={audience} setAudience={setAudience} picked={picked} setPicked={setPicked} preview={preview} summary={summary} />}
          {step === 1 && (
            <MessageStep
              t={t}
              templates={templates} templateId={templateId} setTemplateId={setTemplateId} setTemplates={setTemplates} channel={channel}
              neededVars={neededCampaignVars} variables={variables} setVariables={setVariables} preview={preview}
            />
          )}
          {step === 2 && <WhenStep t={t} channel={channel} when={when} setWhen={setWhen} template={template} preview={preview} settings={settings} />}
          {step === 3 && (
            <ReviewStep
              t={t}
              name={name} setName={setName} template={template} audience={audience} picked={picked} when={when}
              sendCount={sendCount} cost={cost} preview={preview} variables={variables} neededVars={neededCampaignVars}
              bigOk={bigOk} setBigOk={setBigOk} settings={settings} goTo={setStep} previewAs={previewAs} channel={channel}
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
              {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={18} /><span className="hide-mobile">{t('Back')}</span></button>}
              {step < 3 ? (
                <button className="btn primary lg" onClick={() => setStep(step + 1)} disabled={Boolean(stepError) || loadingPreview && !preview}>
                  {t('Next')}<ArrowRight size={18} />
                </button>
              ) : (
                <button className="btn wa lg" onClick={send} disabled={Boolean(stepError) || sending}>
                  {sending ? <Spinner /> : <><Send size={18} />{when.mode === 'later' ? `Schedule for ${plural(sendCount, 'customer')}` : t(isSms ? 'Send SMS to {n} for {cost}' : 'Send to {n} for {cost}', { n: plural(sendCount, 'customer'), count: sendCount, cost: inr(cost) })}</>}
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
              {isSms ? <SmsPreview text={template.sms_body} values={values} live={settings?.sms?.live} /> : <PhonePreview body={template.body} values={values} buttons={template.buttons} imageUrl={variables.image_url || template.image_url} businessName={settings?.businessName} />}
              {rendered?.missing.length > 0 && (
                <Alert tone="warn" icon={AlertTriangle}>
                  {previewAs.name || 'This customer'} has no {rendered.missing.map((k) => VAR_LABEL[k]).join(' or ')}, so they will be skipped rather than sent a message with a gap.
                </Alert>
              )}
            </>
          ) : (
            <PhonePreview body={template?.body} buttons={template?.buttons} businessName={settings?.businessName} caption={template ? 'No customer to preview yet' : 'Choose a message in step 2'} />
          )}
          <CostCard preview={preview} sendCount={sendCount} cost={cost} loading={loadingPreview} hasTemplate={Boolean(template)} isSms={isSms} />
        </aside>
      </div>
    </div>
  );
}

function CostCard({ preview, sendCount, cost, loading, hasTemplate, isSms }) {
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row between">
        <span className="muted">{isSms ? 'SMS will cost about' : 'WhatsApp will charge about'}</span>
        {loading && <Spinner size={16} />}
      </div>
      <div className="cost">{inr(cost)}</div>
      <div className="subtle num">{num(sendCount)} × {rate(preview?.costPerMessage ?? 0.8631)} per {isSms ? 'SMS (MSG91' : 'message (WhatsApp’s charge'}, plus 18% GST)</div>
    </div>
  );
}

/** Why some customers in the group will not get this offer, one line per reason. */
function LeftOut({ preview, isSms }) {
  const details = preview.eligible - preview.sendable - (preview.atCap || 0);
  const lines = [
    preview.atCap > 0 && `${plural(preview.atCap, 'customer')} already got ${preview.weeklyCap === 1 ? 'an offer' : `${preview.weeklyCap} offers`} in the last 7 days. The weekly limit keeps the shop’s WhatsApp number safe; they can get offers again in a few days.`,
    preview.no_opt_in > 0 && `${plural(preview.no_opt_in, 'customer')} ${preview.no_opt_in === 1 ? 'has' : 'have'} not agreed to ${isSms ? 'SMS' : 'WhatsApp'} messages.`,
    preview.opted_out > 0 && `${plural(preview.opted_out, 'customer')} said STOP.`,
    details > 0 && `${plural(details, 'customer')} ${details === 1 ? 'is' : 'are'} missing details this message needs (for example their last purchase).`,
  ].filter(Boolean);
  if (!lines.length) return null;
  return (
    <div className="stack-sm subtle">
      <b style={{ color: 'var(--text)' }}>Left out ({num(preview.matched - preview.sendable)})</b>
      {lines.map((l) => <span key={l}>• {l}</span>)}
    </div>
  );
}

/* ---------- Step 1: Who ---------- */
function WhoStep({ t, channel, setChannel, audience, setAudience, picked, setPicked, preview, summary }) {
  const opts = [
    { mode: 'all', icon: Users, title: channel === 'sms' ? 'Everyone who agreed to SMS' : 'Everyone who can receive WhatsApp', text: audience.mode === 'all' && preview ? `${plural(preview.sendable, 'customer')} can get an offer now` : '' },
    { mode: 'filter', icon: Filter, title: 'Some customers', text: 'For example only Hyderabad, or only bridal buyers' },
    { mode: 'selected', icon: UserCheck, title: 'Customers I pick', text: 'Choose people by name' },
  ];
  const set = (patch) => setAudience((a) => ({ ...a, ...patch }));
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="card card-pad stack">
      <div className="stack-sm">
        <h2>{t('Send by')}</h2>
        <div className="ready-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <button type="button" className={`ready-card ${channel === 'whatsapp' ? 'on' : ''}`} onClick={() => setChannel('whatsapp')} aria-pressed={channel === 'whatsapp'}>
            <Pic name="speech" size={40} /><b>WhatsApp</b><span>With photo, buttons and ticks. ₹0.86 each.</span>
          </button>
          <button type="button" className={`ready-card ${channel === 'sms' ? 'on' : ''}`} onClick={() => setChannel('sms')} aria-pressed={channel === 'sms'}>
            <Pic name="sms" size={40} /><b>SMS</b><span>Reaches every phone. About ₹0.25 each.</span>
          </button>
        </div>
      </div>
      <div className="divider" />
      <h2>{t('Who gets it?')}</h2>
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
            <Field label="Group (tag)">
              <div className="chips">
                {summary.tags.map((t) => (
                  <button key={t.tag} className={`chip ${audience.tags.includes(t.tag) ? 'on' : ''}`} onClick={() => set({ tags: toggle(audience.tags, t.tag) })}>
                    {t.tag} <span className="n">{num(t.count)}</span>
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Bought or likes" hint="e.g. “bridal” or “diamond”">
            <div className="input-icon"><Search size={16} /><input className="input" value={audience.search} onChange={(e) => set({ search: e.target.value })} /></div>
          </Field>
        </div>
      )}

      {audience.mode === 'selected' && (
        <PickCustomers picked={picked} onChange={(list) => { setPicked(list); set({ contactIds: list.map((c) => c.id) }); }} />
      )}

      {preview && (
        <Alert tone={preview.sendable ? 'ok' : 'warn'} icon={preview.sendable ? Users : AlertTriangle}>
          <div className="stack-sm">
            <span><b>{plural(preview.sendable, 'customer')}</b> will get this{preview.matched > preview.sendable ? ` (out of ${num(preview.matched)} in this group)` : ''}.</span>
            {preview.matched > preview.sendable && <LeftOut preview={preview} isSms={channel === 'sms'} />}
          </div>
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
        {results.length === 0 && <p className="subtle" style={{ padding: 14 }}>No customers who agreed to WhatsApp match.</p>}
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
function MessageStep({ t, templates, templateId, setTemplateId, setTemplates, channel, neededVars, variables, setVariables, preview }) {
  const toast = useToast();
  const [busyKey, setBusyKey] = useState(null);
  const [msgLang, setMsgLang] = useState(() => {
    try {
      return localStorage.getItem('st_msg_lang') || 'en';
    } catch {
      return 'en';
    }
  });
  const chooseLang = (code) => {
    setMsgLang(code);
    try {
      localStorage.setItem('st_msg_lang', code);
    } catch {
      // private window: not remembered
    }
  };
  const usesCode = extractVariables(templates?.find((t) => t.id === templateId)?.body || '').includes('offer_code');
  if (!templates) return <div className="card card-pad"><Spinner /></div>;

  // A ready-made message is saved once (as a saved message), then reused.
  async function pickReady(m) {
    setBusyKey(m.key);
    try {
      const r = readyIn(m, msgLang);
      let t = templates.find((x) => x.name === r.name);
      if (!t) {
        ({ template: t } = await api('/api/templates', { method: 'POST', body: { name: r.name, body: r.body, sms_body: r.sms, buttons: r.buttons, language: r.language, category: 'marketing', status: 'approved' } }));
        setTemplates((list) => [t, ...list]);
      } else if (!t.sms_body && r.sms) {
        // Saved before SMS versions existed: add it now.
        ({ template: t } = await api(`/api/templates/${t.id}`, { method: 'PUT', body: { ...t, sms_body: r.sms } }));
        setTemplates((list) => list.map((x) => (x.id === t.id ? t : x)));
      }
      setTemplateId(t.id);
      setVariables((x) => ({ ...x, offer: x.offer || m.offer, offer_ends: x.offer_ends || inAWeek(), code_prefix: x.code_prefix || m.codeWord }));
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusyKey(null);
    }
  }

  const chosen = templates.find((t) => t.id === templateId);
  async function addPhotoToMessage(url) {
    if (!url || !chosen) return;
    try {
      const { template: t } = await api(`/api/templates/${chosen.id}`, { method: 'PUT', body: { ...chosen, image_url: url } });
      setTemplates((list) => list.map((x) => (x.id === t.id ? t : x)));
      toast('Photo added to the message');
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  const readyNames = new Set(READY_MESSAGES.flatMap((m) => LANGS.map((l) => readyIn(m, l.code).name)));
  const own = templates.filter((t) => !readyNames.has(t.name));
  const chosenName = templates.find((t) => t.id === templateId)?.name;
  const missing = Object.entries(preview?.missing || {}).filter(([k]) => !CAMPAIGN_VARS.some((v) => v.key === k));
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div>
          <h2>{t('What should it say?')}</h2>
          <p className="subtle">{t('Tap a ready-made message. Each customer’s name and details are added for you.')}</p>
        </div>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <span className="subtle">Language</span>
          <div className="chips">
            {LANGS.map((l) => (
              <button key={l.code} type="button" className={`chip ${msgLang === l.code ? 'on' : ''}`} onClick={() => chooseLang(l.code)}>{l.label}</button>
            ))}
          </div>
        </div>
        <div className="ready-grid">
          {READY_MESSAGES.map((m) => (
            <button key={m.key} type="button" className={`ready-card ${chosenName === readyIn(m, msgLang).name ? 'on' : ''}`} onClick={() => pickReady(m)} disabled={Boolean(busyKey)} aria-pressed={chosenName === readyIn(m, msgLang).name}>
              <span className="emoji" aria-hidden="true">{busyKey === m.key ? <Spinner /> : <Pic name={m.pic} size={44} />}</span>
              <b>{t(m.title)}</b>
              <span>{m.when}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card card-pad stack">
        <div className="row between">
          <h3>Or one of your saved messages</h3>
          <Link to="/templates/new" className="btn ghost sm">Write my own</Link>
        </div>
        {own.length === 0 ? (
          <p className="subtle">None yet. Messages you write yourself show up here.</p>
        ) : (
          <div className="options">
            {own.map((t) => (
              <button key={t.id} className={`option ${templateId === t.id ? 'on' : ''}`} onClick={() => setTemplateId(t.id)}>
                <span className="radio" />
                <span style={{ minWidth: 0 }}>
                  <span className="option-title">{t.name}</span>
                  <span className="subtle" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{toFriendly(t.body)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {neededVars.length > 0 && (
        <div className="card card-pad stack">
          <div>
            <h2>This offer</h2>
            <p className="subtle">Same for everyone who gets this offer. Personal details come from each customer.</p>
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

      {chosen && channel !== 'sms' && (
        <div className="card card-pad stack">
          <div>
            <h2>Photo</h2>
            <p className="subtle">
              {chosen.image_url
                ? 'This message has a photo. Use it, or pick a different photo just for this offer.'
                : 'Add a jewellery photo to this message. It is saved with the message; with WhatsApp (Meta) the message is then approved once more.'}
            </p>
          </div>
          {chosen.image_url ? (
            <PhotoPicker value={variables.image_url || chosen.image_url} changeLabel="Use a different photo" removable={Boolean(variables.image_url)}
              onChange={(url) => setVariables((x) => ({ ...x, image_url: url || undefined }))} />
          ) : (
            <PhotoPicker value="" onChange={addPhotoToMessage} />
          )}
        </div>
      )}

      {usesCode && (
        <div className="card card-pad stack">
          <div>
            <h2>Bill codes</h2>
            <p className="subtle">Every customer gets their own code, like {exampleCode('Priya', variables.code_prefix)}. Staff type it in under Bill codes when the customer buys, so you see real sales from this offer.</p>
          </div>
          <Field label="Word in the code" hint="Letters and numbers, up to 10. E.g. DIWALI, BRIDAL.">
            <input className="input" style={{ maxWidth: 240, textTransform: 'uppercase' }} value={variables.code_prefix || ''} maxLength={10} onChange={(e) => setVariables((x) => ({ ...x, code_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))} placeholder="OFFER" />
          </Field>
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
function WhenStep({ t, channel, when, setWhen, template, preview, settings }) {
  const smsReady = Boolean(template?.sms_body);
  const smsCustomers = preview?.sample?.filter((s) => s.sms_opt_in).length || 0;
  return (
    <div className="card card-pad stack">
      <h2>{t('When should it go out?')}</h2>
      <div className="options">
        <button className={`option ${when.mode === 'now' ? 'on' : ''}`} onClick={() => setWhen({ ...when, mode: 'now' })}>
          <span className="radio" /><Zap size={20} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          <span><span className="option-title">{t('Send now')}</span><span className="subtle" style={{ display: 'block' }}>Messages start going out right after you confirm.</span></span>
        </button>
        <button className={`option ${when.mode === 'later' ? 'on' : ''}`} onClick={() => setWhen({ ...when, mode: 'later' })}>
          <span className="radio" /><CalendarClock size={20} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          <span><span className="option-title">{t('Schedule for later')}</span><span className="subtle" style={{ display: 'block' }}>You can cancel any time before it starts.</span></span>
        </button>
      </div>
      {when.mode === 'later' && (
        <Field label="Date and time (India time)" hint="Late morning (10–12) and evening (6–8) usually get the most reads.">
          <input className="input" type="datetime-local" value={when.at} min={toLocalInput(new Date())} onChange={(e) => setWhen({ ...when, at: e.target.value })} style={{ maxWidth: 280 }} />
        </Field>
      )}
      {channel !== 'sms' && <div className="divider" />}
      {channel !== 'sms' && <label className="check" style={{ opacity: smsReady ? 1 : 0.6 }}>
        <span className="switch"><input type="checkbox" checked={when.sms && smsReady} disabled={!smsReady} onChange={(e) => setWhen({ ...when, sms: e.target.checked })} /><span /></span>
        <span>
          <b>SMS backup</b>
          <span className="hint" style={{ display: 'block' }}>
            {!smsReady
              ? 'This message has no SMS version yet. Add one on the saved message page to use SMS backup.'
              : `Customers who are not on WhatsApp and agreed to SMS get the SMS version instead${settings?.sms?.live ? ` (${rate(settings.sms.costPerSms)} each)` : ' (preview only until DLT registration is done)'}.`}
            {smsReady && smsCustomers === 0 && ' None of the first customers here have SMS consent yet.'}
          </span>
        </span>
      </label>}
    </div>
  );
}

function exampleCode(name, prefix) {
  const first = String(name || 'Priya').split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'GUEST';
  return `${first}-${(prefix || 'OFFER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'OFFER'}-4821`;
}

/* ---------- Step 4: Review ---------- */
function ReviewStep({ t, name, setName, template, audience, picked, when, sendCount, cost, preview, variables, neededVars, bigOk, setBigOk, settings, goTo, previewAs, channel }) {
  const everyone = channel === 'sms' ? 'Everyone who agreed to SMS' : 'Everyone who can receive WhatsApp';
  const who = audience.mode === 'all'
    ? everyone
    : audience.mode === 'selected'
      ? picked.map((p) => p.name || phone(p.phone)).join(', ')
      : [audience.cities.length && `City: ${audience.cities.join(', ')}`, audience.tags.length && `Tag: ${audience.tags.join(', ')}`, audience.search && `“${audience.search}”`].filter(Boolean).join(' · ') || everyone;
  return (
    <div className="stack">
      <ProviderBanner settings={settings} compact />
      <div className="card card-pad stack">
        <h2>{t('Check and send')}</h2>
        <TestSend template={template} variables={variables} previewAs={previewAs} channel={channel} />
        {channel === 'sms' && !settings?.sms?.live && (
          <Alert tone="warn" icon={AlertTriangle}>
            <b>SMS trial mode.</b> Until the shop’s DLT registration is done, the app records the exact SMS for each customer but does not send it. The report shows them as “SMS (trial, not sent)”.
          </Alert>
        )}
        <Field label="Name for this offer" hint="Only staff see this, in reports.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <dl className="summary-list" style={{ margin: 0 }}>
          <div><dt>Send by</dt><dd>{channel === 'sms' ? 'SMS' : when.sms ? 'WhatsApp (SMS if not on WhatsApp)' : 'WhatsApp'} <button className="btn ghost sm" onClick={() => goTo(0)}>Change</button></dd></div>
          <div><dt>Who</dt><dd>{who} <button className="btn ghost sm" onClick={() => goTo(0)}>Change</button></dd></div>
          <div><dt>Message</dt><dd>{template?.name} <button className="btn ghost sm" onClick={() => goTo(1)}>Change</button></dd></div>
          {neededVars.map((v) => <div key={v.key}><dt>{v.label}</dt><dd>{variables[v.key]}</dd></div>)}
          <div><dt>When</dt><dd>{when.mode === 'now' ? 'Right away' : dateTime(when.at)} <button className="btn ghost sm" onClick={() => goTo(2)}>Change</button></dd></div>
          <div><dt>Customers</dt><dd className="num">{num(sendCount)}</dd></div>
          <div><dt>{channel === 'sms' ? 'SMS charge' : 'WhatsApp charge'}</dt><dd className="num">about {inr(cost)} <span className="subtle">+ GST</span></dd></div>
        </dl>
        {preview && preview.matched > sendCount && <LeftOut preview={preview} isSms={channel === 'sms'} />}
        {when.sms && <p className="subtle">SMS backup is on for customers who are not on WhatsApp.</p>}
        {preview?.pace?.finishBy && (
          <Alert tone="info" icon={CalendarClock}>
            WhatsApp lets this number reach <b>{num(preview.pace.limit)} new customers a day</b> ({num(preview.pace.remaining)} left right now).
            This offer goes out over a few days on its own and should finish by <b>{dateTime(preview.pace.finishBy)}</b>.
          </Alert>
        )}
        {preview && settings?.role !== 'admin' && sendCount >= preview.approvalThreshold && (
          <Alert tone="info" icon={ShieldCheck}>
            This goes to {num(sendCount)} customers, so the owner must approve it first. You’ll find it under Send offer as “Waiting for owner’s OK”.
          </Alert>
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

/** "Send a test to my phone": the exact message one customer would get, sent to a staff phone. */
function TestSend({ template, variables, previewAs, channel }) {
  const toast = useToast();
  const [phoneNo, setPhoneNo] = useState(() => {
    try {
      return localStorage.getItem('st_test_phone') || '';
    } catch {
      return '';
    }
  });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  async function go() {
    setBusy(true);
    try {
      try {
        localStorage.setItem('st_test_phone', phoneNo);
      } catch {
        // Private window: the number just isn't remembered.
      }
      const r = await api('/api/campaigns/test', { method: 'POST', body: { templateId: template.id, variables, phone: phoneNo, asContactId: previewAs?.id, channel } });
      setSent(r);
      toast(`Test sent to ${r.phone}`);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="alert info" style={{ alignItems: 'flex-start' }}>
      <Pic name="mobile" size={36} />
      <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
        <b>Send a test {channel === 'sms' ? 'SMS ' : ''}to my phone first</b>
        <span className="subtle">You get exactly what {previewAs?.name || 'the customer'} will get. Costs one message.</span>
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input" style={{ maxWidth: 220 }} inputMode="tel" placeholder="Your WhatsApp number" value={phoneNo} onChange={(e) => setPhoneNo(e.target.value)} aria-label="Your WhatsApp number" />
          <button className="btn" onClick={go} disabled={busy || !phoneNo.trim() || !template}>{busy ? <Spinner /> : 'Send test'}</button>
        </div>
        {sent && <span className="subtle">Sent to {sent.phone}. Check WhatsApp on that phone.</span>}
      </div>
    </div>
  );
}

function inAWeek() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
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

/** What one customer's SMS will say, with its length (SMS are billed per 160-character part). */
function SmsPreview({ text, values, live }) {
  if (!text) return <Alert tone="warn" icon={AlertTriangle}>This message has no SMS version yet. Pick a ready-made message, or add an SMS version on its saved message page.</Alert>;
  const { text: out, missing } = render(text, values || {});
  const unicode = /[^\x20-\x7E\n\r]/.test(out);
  const parts = out.length <= (unicode ? 70 : 160) ? 1 : Math.ceil(out.length / (unicode ? 67 : 153));
  return (
    <div className="card card-pad stack-sm">
      <span className="row" style={{ gap: 8 }}><Pic name="sms" size={28} /><b>SMS preview</b>{!live && <span className="badge warn">Trial: not sent until DLT</span>}</span>
      <div className="sms-bubble">{out}</div>
      <span className="subtle num">{out.length} characters · {parts} SMS {parts === 1 ? 'part' : 'parts'}{unicode ? ' (Telugu/₹ text uses 70 per part)' : ''}</span>
      {missing.length > 0 && <span className="subtle" style={{ color: 'var(--warn)' }}>This customer is missing some details and will be skipped.</span>}
    </div>
  );
}
