import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, Check, ChevronLeft, ChevronRight, Pencil, Plus, Search, Send, ShieldCheck, X, Zap } from 'lucide-react';
import { VARIABLES, extractVariables, render, valuesFor } from '@shared/template.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Avatar, Field, Pic, Spinner, useToast } from '../components/ui.jsx';
import { Highlighted, PhonePreview } from '../components/PhonePreview.jsx';
import { PhotoPicker } from '../components/PhotoPicker.jsx';
import { ago, dateTime, inr, num, phone, plural } from '../lib/format.js';
import { READY_MESSAGES } from '../lib/ready.js';
import { LANGS, isReadyText, readyFor, readyIn } from '../lib/ready-lang.js';
import { toFriendly } from '../lib/friendly.js';
import { useT } from '../lib/i18n.jsx';
import { atLeast } from '@shared/roles.js';
import { SHOP_KEYS, shopVars } from '../lib/shop.js';
import { CustomersStep, LeftOut } from '../components/CustomerPicker.jsx';
import { TemplateChooser } from '../components/TemplatePicker.jsx';

// Send a message in three steps: pick a template, pick customers, check and send.
const STEPS = ['Template', 'Customers', 'Check and send'];
const CAMPAIGN_VARS = VARIABLES.filter((v) => v.source === 'campaign');
const VAR_LABEL = Object.fromEntries(VARIABLES.map((v) => [v.key, v.label.toLowerCase()]));
const READY_NAMES = new Set(READY_MESSAGES.flatMap((m) => LANGS.map((l) => readyIn(m, l.code).name)));

export default function CampaignBuilder() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useAuth();
  const { t } = useT();
  const salesCodes = Boolean(settings?.salesCodes);
  const smsOn = Boolean(settings?.sms?.live);

  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState(null);
  const [templateId, setTemplateId] = useState(params.get('template') ? Number(params.get('template')) : null);
  const [variables, setVariables] = useState({ offer: '', offer_ends: '' });
  // Who gets it: the filters, then single people ticked off (everyone else stays in) or,
  // after "Untick all", only the people ticked by hand.
  const [filters, setFilters] = useState({ cities: [], tags: [], search: '' });
  const [pick, setPick] = useState({ only: false, ids: [] });
  const [when, setWhen] = useState({ mode: 'now', at: defaultLater() });
  const [channel, setChannel] = useState('whatsapp');
  const isSms = channel === 'sms';
  const [name, setName] = useState('');
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sampleAt, setSampleAt] = useState(0);
  const [bigOk, setBigOk] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api('/api/templates').then((r) => setTemplates(r.templates.filter((x) => x.status === 'approved'))).catch(() => setTemplates([]));
  }, []);

  const template = templates?.find((x) => x.id === templateId) || null;
  const usedVars = useMemo(() => (template ? extractVariables(template.body) : []), [template]);
  const neededVars = CAMPAIGN_VARS.filter((v) => usedVars.includes(v.key) && v.key !== 'store');
  const audience = useMemo(
    () => (pick.only ? { mode: 'selected', contactIds: pick.ids } : { mode: 'filter', ...filters, excludeIds: pick.ids }),
    [pick, filters],
  );

  // Live numbers: who can get it, who is left out and why, cost.
  useEffect(() => {
    setLoadingPreview(true);
    const timer = setTimeout(() => {
      api('/api/campaigns/preview', { method: 'POST', body: { audience, templateId, variables, channel } })
        .then(setPreview)
        .catch(() => {})
        .finally(() => setLoadingPreview(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [audience, templateId, variables, channel]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  useEffect(() => {
    if (template) setName(`${template.name.replace(/^\W+\s*/u, '')} · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`);
  }, [template]);

  const sample = preview?.sample || [];
  const previewAs = sample.length ? sample[sampleAt % sample.length] : null;
  const sendCount = preview?.sendable ?? 0;
  const cost = sendCount * (preview?.costPerMessage ?? settings?.costPerMessage ?? 0.8631);
  const values = previewAs ? { ...valuesFor(previewAs, { ...variables, ...shopVars(settings) }), offer_code: exampleCode(previewAs.name, variables.code_prefix) } : null;
  const rendered = template && values ? render(isSms ? template.sms_body || '' : template.body, values) : null;
  const blank = neededVars.find((v) => !String(variables[v.key] || '').trim());

  const stepError = [
    !template ? 'Pick a template.' : blank ? `Fill in the ${blank.label.toLowerCase()}.` : null,
    pick.only && !pick.ids.length ? 'Tick at least one customer.' : preview && sendCount === 0 ? (preview.atCap > 0 && preview.atCap === preview.eligible ? 'Everyone here already got this week’s messages. Try again in a few days.' : 'None of these customers can get this message.') : null,
    when.mode === 'later' && (!when.at || new Date(when.at).getTime() < Date.now()) ? 'Pick a time in the future.' : isSms && !template?.sms_body ? 'This template has no SMS version.' : sendCount >= 500 && !bigOk ? 'Tick the box to confirm this large send.' : !name.trim() ? 'Give it a name for your reports.' : null,
  ][step];

  async function send() {
    setSending(true);
    try {
      const r = await api('/api/campaigns', {
        method: 'POST',
        body: {
          name, templateId, audience, variables, channel,
          scheduledAt: when.mode === 'later' ? new Date(when.at).toISOString() : null,
          undoSeconds: when.mode === 'now' ? 20 : 0,
          expectedCount: sendCount,
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
    <div className="page send-page">
      <div className="page-head compact">
        <div>
          <Link to="/campaigns" className="back"><ArrowLeft size={16} />{t('Sent messages')}</Link>
          <h1>{t('Send a message')}</h1>
        </div>
      </div>

      <div className="stepper" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button key={s} className={`step ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick={() => i < step && setStep(i)} disabled={i >= step} aria-current={i === step ? 'step' : undefined}>
            <span className="bar" />
            <span className="lbl">
              {i < step ? <Check size={14} strokeWidth={3} /> : `${i + 1}.`} {t(s)}
              {i < step && i === 0 && template ? <span className="subtle"> · {template.name}</span> : null}
              {i < step && i === 1 ? <span className="subtle"> · {num(sendCount)}</span> : null}
            </span>
          </button>
        ))}
      </div>

      <div className="two-col send-cols">
        <div className="stack" style={{ minWidth: 0 }}>
          {step === 0 && (
            <TemplateStep
              t={t} templates={templates} setTemplates={setTemplates} templateId={templateId} setTemplateId={setTemplateId}
              neededVars={neededVars} variables={variables} setVariables={setVariables} salesCodes={salesCodes} template={template} toast={toast}
            />
          )}
          {step === 1 && (
            <CustomersStep
              t={t} filters={filters} setFilters={setFilters} pick={pick} setPick={setPick}
              templateId={templateId} variables={variables} channel={channel} preview={preview}
            />
          )}
          {step === 2 && (
            <ReviewStep
              t={t} name={name} setName={setName} template={template} when={when} setWhen={setWhen} channel={channel} setChannel={setChannel} smsOn={smsOn}
              sendCount={sendCount} cost={cost} preview={preview} filters={filters} pick={pick} variables={variables}
              bigOk={bigOk} setBigOk={setBigOk} settings={settings} goTo={setStep} previewAs={previewAs}
            />
          )}
        </div>

        <aside className={`stack sticky send-preview ${template ? "" : "empty"}`}>
          {template && previewAs ? (
            <>
              <div className="row between preview-nav">
                <span className="subtle" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  As <b style={{ color: 'var(--text)' }}>{previewAs.name || phone(previewAs.phone)}</b> sees it
                </span>
                {sample.length > 1 && (
                  <span className="row" style={{ gap: 2 }}>
                    <button className="icon-btn sm" onClick={() => setSampleAt((i) => (i - 1 + sample.length) % sample.length)} aria-label="Previous customer"><ChevronLeft size={18} /></button>
                    <button className="icon-btn sm" onClick={() => setSampleAt((i) => (i + 1) % sample.length)} aria-label="Next customer"><ChevronRight size={18} /></button>
                  </span>
                )}
              </div>
              {isSms ? (
                <SmsPreview text={template.sms_body} values={values} live={smsOn} />
              ) : (
                <PhonePreview body={template.body} values={values} buttons={template.buttons} imageUrl={template.image_url} businessName={settings?.businessName} />
              )}
              {rendered?.missing.some((k) => !SHOP_KEYS.includes(k)) && (
                <span className="subtle" style={{ color: 'var(--warn)' }}>
                  {previewAs.name || 'This customer'} has no {rendered.missing.filter((k) => !SHOP_KEYS.includes(k)).map((k) => VAR_LABEL[k]).join(' or ')}, so they will be skipped.
                </span>
              )}
              {rendered?.missing.some((k) => SHOP_KEYS.includes(k)) && (
                <span className="subtle" style={{ color: 'var(--warn)' }}>
                  This template uses your {rendered.missing.filter((k) => SHOP_KEYS.includes(k)).map((k) => VAR_LABEL[k]).join(' and ')}, which is empty. <Link to="/settings#shop">Add it in Settings → Shop details</Link>.
                </span>
              )}
            </>
          ) : (
            <PhonePreview body={template?.body} buttons={template?.buttons} imageUrl={template?.image_url} businessName={settings?.businessName} caption={template ? 'No customer to show yet' : 'Pick a template to see it here'} />
          )}
        </aside>
      </div>

      <div className="action-bar">
        <div style={{ minWidth: 0 }}>
          {stepError ? (
            <span className="subtle" style={{ color: 'var(--warn)', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={15} style={{ flexShrink: 0 }} />{stepError}</span>
          ) : (
            <>
              <b className="num">{plural(sendCount, 'customer')}</b>
              <div className="subtle num">about {inr(cost)} {isSms ? 'for SMS' : 'to WhatsApp'} {loadingPreview && <Spinner size={12} />}</div>
            </>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={18} /><span className="hide-mobile">{t('Back')}</span></button>}
          {step < 2 ? (
            <button className="btn primary lg" onClick={() => setStep(step + 1)} disabled={Boolean(stepError) || (loadingPreview && !preview)}>
              {t('Next')}<ArrowRight size={18} />
            </button>
          ) : (
            <button className="btn wa lg" onClick={send} disabled={Boolean(stepError) || sending}>
              {sending ? <Spinner /> : <><Send size={18} />{when.mode === 'later' ? `Schedule for ${plural(sendCount, 'customer')}` : `Send to ${plural(sendCount, 'customer')}`}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Step 1: Template ---------- */
function TemplateStep({ t, templates, setTemplates, templateId, setTemplateId, neededVars, variables, setVariables, salesCodes, template, toast }) {
  const [busyKey, setBusyKey] = useState(null);
  // Messages are offered in this person's app language; another language can be picked for one send.
  const { lang: appLang } = useT();
  const [lang, setLang] = useState(appLang);
  useEffect(() => setLang(appLang), [appLang]);
  if (!templates) return <div className="card card-pad"><Spinner /></div>;

  // A ready-made template is saved the first time it is used, then reused. A saved copy still in
  // the app's own wording is brought up to date (formatting, sales codes on or off).
  async function pickReady(m) {
    setBusyKey(m.key);
    try {
      const r = readyFor(m, lang, salesCodes);
      let found = templates.find((x) => x.name === r.name);
      if (!found) {
        ({ template: found } = await api('/api/templates', { method: 'POST', body: { name: r.name, body: r.body, sms_body: r.sms, buttons: r.buttons, language: r.language, category: 'marketing', status: 'approved' } }));
        setTemplates((list) => [found, ...list]);
      } else if (isReadyText(found.body) && (found.body !== r.body || !found.sms_body)) {
        ({ template: found } = await api(`/api/templates/${found.id}`, { method: 'PUT', body: { ...found, body: r.body, sms_body: r.sms } }));
        setTemplates((list) => list.map((x) => (x.id === found.id ? found : x)));
      }
      setTemplateId(found.id);
      setVariables((x) => ({ ...x, offer_ends: x.offer_ends || inAWeek(), code_prefix: x.code_prefix || m.codeWord }));
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusyKey(null);
    }
  }

  async function setPhoto(url) {
    if (!template) return;
    try {
      const { template: saved } = await api(`/api/templates/${template.id}`, { method: 'PUT', body: { ...template, image_url: url || '' } });
      setTemplates((list) => list.map((x) => (x.id === saved.id ? saved : x)));
      toast(url ? 'Photo added to the template' : 'Photo removed');
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  // Every template in one searchable list: the ready-made ones (in the message language) and the shop's own.
  const ready = READY_MESSAGES.map((m) => ({ m, r: readyFor(m, lang, salesCodes) }));
  const items = [
    ...ready.map(({ m, r }) => ({ key: `ready:${m.key}`, ready: true, m, name: r.name, title: t(m.title), body: r.body, pic: m.pic })),
    ...templates.filter((x) => !READY_NAMES.has(x.name)).map((x) => ({ key: `t:${x.id}`, id: x.id, name: x.name, body: x.body, pic: 'memo' })),
  ];
  const readyChosen = template && ready.find(({ r }) => r.name === template.name);
  const chosenKey = !template ? null : readyChosen ? `ready:${readyChosen.m.key}` : `t:${template.id}`;
  const usesCode = template && extractVariables(template.body).includes('offer_code');

  return (
    <div className="stack">
      <div className="card card-pad stack" style={{ gap: 12 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <h2>{t('Pick a template')}</h2>
          <label className="row" style={{ gap: 6, fontSize: '0.85rem' }}>
            <span className="subtle">{t('Message language')}</span>
            <select id="msg-lang" className="select sm" value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
        </div>
        <TemplateChooser items={items} chosenKey={chosenKey} busyKey={busyKey} t={t} onPick={(i) => (i.ready ? pickReady(i.m) : setTemplateId(i.id))} />
      </div>

      {template && (neededVars.length > 0 || (salesCodes && usesCode)) && (
        <div className="card card-pad stack" style={{ gap: 12 }}>
          <h2>Fill in</h2>
          <div className="form-grid two">
            {neededVars.map((v) => (
              <Field key={v.key} label={v.label} hint={`e.g. ${v.example}`}>
                <input id={`var-${v.key}`} className="input" value={variables[v.key] || ''} onChange={(e) => setVariables((x) => ({ ...x, [v.key]: e.target.value }))} />
              </Field>
            ))}
            {salesCodes && usesCode && (
              <Field label="Word in the sales code" hint={`Each customer gets their own, like ${exampleCode('Priya', variables.code_prefix)}.`}>
                <input id="var-code" className="input" style={{ textTransform: 'uppercase' }} value={variables.code_prefix || ''} maxLength={10} onChange={(e) => setVariables((x) => ({ ...x, code_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))} placeholder="OFFER" />
              </Field>
            )}
          </div>
        </div>
      )}

      {template && (
        <div className="card card-pad row wrap" style={{ gap: 12, alignItems: 'center' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <b>Photo</b>
            <div className="subtle">{template.image_url ? 'Shown at the top of the message.' : 'Optional: a jewellery photo at the top of the message.'}</div>
          </div>
          <PhotoPicker value={template.image_url || ''} onChange={setPhoto} removable />
          <Link to={`/templates/${template.id}`} className="btn ghost sm"><Pencil size={15} />Edit wording</Link>
        </div>
      )}
      {template && !salesCodes && usesCode && (
        <Alert tone="info">This template has a sales code in it. Sales codes are off in Settings, so pick a ready-made template or edit the wording to remove it.</Alert>
      )}
    </div>
  );
}

/* ---------- Step 3: Check and send ---------- */
function ReviewStep({ t, name, setName, template, when, setWhen, channel, setChannel, smsOn, sendCount, cost, preview, filters, pick, variables, bigOk, setBigOk, settings, goTo, previewAs }) {
  const [renaming, setRenaming] = useState(false);
  const who = pick.only
    ? `${plural(pick.ids.length, 'customer')} picked by hand`
    : [filters.cities.length && filters.cities.map(cap).join(', '), filters.tags.length && filters.tags.join(', '), filters.search && `“${filters.search}”`].filter(Boolean).join(' · ') || 'Everyone';
  return (
    <div className="stack">
      <div className="card card-pad stack" style={{ gap: 14 }}>
        <div className="send-line">
          <b>{template?.name}</b> <span className="arrow">→</span> <b>{plural(sendCount, 'customer')}</b> <span className="subtle">({who})</span>
          <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
            <button className="btn ghost sm" onClick={() => goTo(0)}>Change template</button>
            <button className="btn ghost sm" onClick={() => goTo(1)}>Change customers</button>
          </span>
        </div>
        {variables.offer && <span className="subtle">Offer: <b style={{ color: 'var(--text)' }}>{variables.offer}</b>{variables.offer_ends ? ` · valid till ${variables.offer_ends}` : ''}</span>}

        {smsOn && (
          <div className="seg" role="group" aria-label="Send by">
            <button className={channel === 'whatsapp' ? 'on' : ''} onClick={() => setChannel('whatsapp')}>WhatsApp</button>
            <button className={channel === 'sms' ? 'on' : ''} onClick={() => setChannel('sms')}>SMS</button>
          </div>
        )}

        <div className="stack-sm">
          <b>{t('When')}</b>
          <div className="seg" role="group" aria-label="When">
            <button className={when.mode === 'now' ? 'on' : ''} onClick={() => setWhen({ ...when, mode: 'now' })}><Zap size={15} />{t('Send now')}</button>
            <button className={when.mode === 'later' ? 'on' : ''} onClick={() => setWhen({ ...when, mode: 'later' })}><CalendarClock size={15} />Pick a date and time</button>
          </div>
          {when.mode === 'later' ? (
            <input id="when-at" className="input" type="datetime-local" value={when.at} min={toLocalInput(new Date())} onChange={(e) => setWhen({ ...when, at: e.target.value })} style={{ maxWidth: 280 }} />
          ) : (
            <span className="subtle">You can undo for 20 seconds after pressing Send.</span>
          )}
        </div>

        <TestSend template={template} variables={variables} previewAs={previewAs} channel={channel} />

        <div className="subtle">
          Name in your reports: {renaming ? (
            <input id="send-name" className="input" style={{ maxWidth: 320, display: 'inline-block', marginLeft: 6 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(false)} autoFocus />
          ) : (
            <><b style={{ color: 'var(--text)' }}>{name}</b> <button className="link-btn" onClick={() => setRenaming(true)}>Rename</button></>
          )}
        </div>

        {channel === 'sms' && !smsOn && <Alert tone="warn" icon={AlertTriangle}>SMS are recorded but not sent until the shop’s DLT registration is done.</Alert>}
        {preview?.pace?.finishBy && (
          <Alert tone="info" icon={CalendarClock}>
            WhatsApp lets this number reach <b>{num(preview.pace.limit)} new customers a day</b> ({num(preview.pace.remaining)} left today), so this goes out over a few days and should finish by <b>{dateTime(preview.pace.finishBy)}</b>.
          </Alert>
        )}
        {preview && !atLeast(settings?.role, 'owner') && sendCount >= preview.approvalThreshold && (
          <Alert tone="info" icon={ShieldCheck}>This goes to {num(sendCount)} customers, so the owner approves it first. It waits under Sent messages as “Waiting for owner’s OK”.</Alert>
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
  const [open, setOpen] = useState(false);
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
  if (!open) {
    return (
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        <Pic name="mobile" size={20} plain />Send a test to my phone first
      </button>
    );
  }
  return (
    <div className="alert info" style={{ alignItems: 'flex-start' }}>
      <Pic name="mobile" size={32} />
      <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
        <b>Send a test to my phone</b>
        <span className="subtle">You get exactly what {previewAs?.name || 'the customer'} will get. Costs one message.</span>
        <div className="row wrap" style={{ gap: 8 }}>
          <input id="test-phone" className="input" style={{ maxWidth: 220 }} inputMode="tel" autoComplete="tel" placeholder="Your WhatsApp number" value={phoneNo} onChange={(e) => setPhoneNo(e.target.value)} aria-label="Your WhatsApp number" />
          <button className="btn" onClick={go} disabled={busy || !phoneNo.trim() || !template}>{busy ? <Spinner /> : 'Send test'}</button>
        </div>
        {sent && <span className="subtle">Sent to {sent.phone}. Check WhatsApp on that phone.</span>}
      </div>
    </div>
  );
}

function exampleCode(name, prefix) {
  const first = String(name || 'Priya').split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'GUEST';
  return `${first}-${(prefix || 'OFFER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'OFFER'}-4821`;
}
const cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

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
  if (!text) return <Alert tone="warn" icon={AlertTriangle}>This template has no SMS version yet.</Alert>;
  const { text: out, missing } = render(text, values || {});
  const unicode = /[^\x20-\x7E\n\r]/.test(out);
  const parts = out.length <= (unicode ? 70 : 160) ? 1 : Math.ceil(out.length / (unicode ? 67 : 153));
  return (
    <div className="card card-pad stack-sm">
      <span className="row" style={{ gap: 8 }}><Pic name="sms" size={28} /><b>SMS</b>{!live && <span className="badge warn">Not sent until DLT</span>}</span>
      <div className="sms-bubble">{out}</div>
      <span className="subtle num">{out.length} characters · {parts} SMS {parts === 1 ? 'part' : 'parts'}</span>
      {missing.length > 0 && <span className="subtle" style={{ color: 'var(--warn)' }}>This customer is missing some details and will be skipped.</span>}
    </div>
  );
}
