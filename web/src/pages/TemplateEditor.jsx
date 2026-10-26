import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronDown, Clock, ExternalLink, Film, Image, MousePointerClick, Pencil, Phone, Plus, RefreshCw, Reply, Send, Settings2, Trash2, Type, Undo2 } from 'lucide-react';
import { VARIABLES, extractVariables, render, validateTemplate } from '@shared/template.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Field, Spinner, useToast } from '../components/ui.jsx';
import { PhoneInput } from '../components/PhoneInput.jsx';
import { PhonePreview } from '../components/PhonePreview.jsx';
import { READY_MESSAGES } from '../lib/ready.js';
import { PhotoPicker } from '../components/PhotoPicker.jsx';
import { VideoPicker } from '../components/VideoPicker.jsx';
import { shopVars } from '../lib/shop.js';
import { atLeast } from '@shared/roles.js';
import { detailLabel, fromFriendly, toFriendly } from '../lib/friendly.js';
import { LANGS, readyFor } from '../lib/ready-lang.js';
import { metaState } from '../lib/approval.js';
import { dateOnly } from '../lib/format.js';
import { useT } from '../lib/i18n.jsx';

// The template editor in three steps (message, photo or video, buttons) with the phone on the right
// showing the result. An existing template opens with every step filled in; a strip under the name
// says where Meta's approval stands and what to do next.
const EXAMPLES = Object.fromEntries(VARIABLES.map((v) => [v.key, v.example]));
const STEPS = [
  { key: 'message', label: 'Message' },
  { key: 'media', label: 'Photo or video' },
  { key: 'buttons', label: 'Buttons' },
];
const BUTTON_TYPES = [
  { key: 'quick_reply', label: 'Reply', icon: Reply },
  { key: 'url', label: 'Website', icon: ExternalLink },
  { key: 'phone', label: 'Call', icon: Phone },
];
const BUTTON_PRESETS = [
  { type: 'quick_reply', text: 'Interested' },
  { type: 'quick_reply', text: 'Not now' },
  { type: 'phone', text: 'Call the store', phone: '' },
  { type: 'url', text: 'See the designs', url: 'https://' },
];
// Meta's approval, as the badge next to the name shows it.
const STATE = {
  approved: ['ok', BadgeCheck, 'Approved by Meta'],
  waiting: ['warn', Clock, 'Waiting for Meta'],
  rejected: ['bad', AlertCircle, 'Rejected by Meta'],
  changed: ['warn', Pencil, 'Changed, not sent yet'],
  not_sent: ['neutral', Send, 'Not sent to Meta yet'],
};

export default function TemplateEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings, user } = useAuth();
  const isOwner = atLeast(user?.role, 'owner');
  const { lang } = useT();
  const textRef = useRef(null);
  const [t, setT] = useState(id ? null : { name: '', body: '', buttons: [], image_url: '', video_url: '', status: 'approved', provider_ref: '', category: 'marketing', language: lang, sms_body: '', sms_dlt_template_id: '' });
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  // Which step is open; a link like /templates/5#buttons opens that one.
  const [step, setStep] = useState(() => {
    const h = window.location.hash.slice(1);
    return h === 'photo' || h === 'video' ? 'media' : STEPS.some((s) => s.key === h) ? h : 'message';
  });
  const [mediaPick, setMediaPick] = useState(null); // 'photo' | 'video' | 'none' once chosen in step 2
  const [more, setMore] = useState(false);
  const [askDelete, setAskDelete] = useState(false);

  // The template as last saved, to know when there are changes not saved yet.
  const [orig, setOrig] = useState(null);
  const loaded = (tpl) => {
    const x = { ...tpl, image_url: tpl.image_url || '', video_url: tpl.video_url || '', provider_ref: tpl.provider_ref || '', sms_body: tpl.sms_body || '', sms_dlt_template_id: tpl.sms_dlt_template_id || '' };
    setT(x);
    setOrig(x);
    setMediaPick(null);
  };
  useEffect(() => {
    if (id) {
      api(`/api/templates/${id}`)
        .then((r) => loaded(r.template))
        .catch((e) => { toast(e.message, 'bad'); navigate('/templates'); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate, toast]);

  // Approval changes come from Meta, not from editing: keep them out of "unsaved changes".
  const fromMeta = (u) => (x) => ({ ...x, provider_ref: u.provider_ref || '', provider_status: u.provider_status, provider_reason: u.provider_reason, approved_version: u.approved_version });

  // While Meta reviews it, look again every 20 seconds; Sandesh itself asks Meta every few minutes.
  const savedStatus = String(orig?.provider_status || '').toUpperCase();
  useEffect(() => {
    if (!id || !['PENDING', 'IN_APPEAL'].includes(savedStatus)) return undefined;
    const timer = setInterval(() => {
      api(`/api/templates/${id}`).then((r) => {
        const st = String(r.template.provider_status || '').toUpperCase();
        if (st === savedStatus) return;
        setT(fromMeta(r.template));
        setOrig(fromMeta(r.template));
        if (st === 'APPROVED') toast('Approved by Meta. You can use it now.');
        else if (st === 'REJECTED') toast('Meta did not approve it. The reason is under the name.', 'bad');
      }).catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [id, savedStatus, toast]);

  // Same checks as the server, in shop words: [Customer name] instead of {{name}}.
  const errors = useMemo(() => (t ? validateTemplate(t) : []).map(plainError), [t]);
  const vars = useMemo(() => (t ? extractVariables(t.body) : []), [t]);
  if (!t) return <div className="page"><Spinner /></div>;

  const set = (patch) => setT((x) => ({ ...x, ...patch }));
  const shown = toFriendly(t.body);
  const details = VARIABLES.filter((v) => v.key !== 'days_left' && v.key !== 'full_name' && (v.key !== 'offer_code' || settings?.salesCodes));

  function insert(key) {
    const el = textRef.current;
    const token = `[${detailLabel(key)}]`;
    const start = el?.selectionStart ?? shown.length;
    const end = el?.selectionEnd ?? shown.length;
    set({ body: fromFriendly(shown.slice(0, start) + token + shown.slice(end)) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  // WhatsApp formatting: wraps the selected words in *bold* or _slanted_ (or adds example words).
  function wrap(mark) {
    const el = textRef.current;
    const start = el?.selectionStart ?? shown.length;
    const end = el?.selectionEnd ?? shown.length;
    const picked = shown.slice(start, end).trim() || (mark === '*' ? 'bold words' : 'slanted words');
    set({ body: fromFriendly(shown.slice(0, start) + mark + picked + mark + shown.slice(end)) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + 1, start + 1 + picked.length);
    });
  }
  const setButton = (i, patch) => set({ buttons: t.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const mediaKind = mediaPick || (t.video_url ? 'video' : t.image_url ? 'photo' : 'none');
  function chooseMedia(kind) {
    setMediaPick(kind);
    if (kind === 'photo') set({ video_url: '' });
    if (kind === 'video') set({ image_url: '' });
    if (kind === 'none') set({ image_url: '', video_url: '' });
  }

  // With WhatsApp connected a template must be approved by Meta before it can be sent, so the main
  // button saves and sends it for approval in one go, then becomes "Use this template" once approved.
  const needsMeta = Boolean(settings?.metaTemplatesReady);
  const FIELDS = ['name', 'body', 'buttons', 'image_url', 'video_url', 'category', 'language', 'sms_body', 'sms_dlt_template_id', 'status', 'provider_ref'];
  const pick = (x) => JSON.stringify(FIELDS.map((k) => x?.[k] ?? null));
  const dirty = !id || !orig || pick(t) !== pick(orig);
  const approvedBefore = orig?.approved_version?.provider_ref ? orig.approved_version : null;
  const saved = metaState(orig);
  // A change to an approved template: the approved version keeps sending until Meta approves this one.
  const state = !needsMeta || !id ? null
    : (dirty && (saved === 'approved' || approvedBefore)) || (saved === 'not_sent' && approvedBefore) ? 'changed'
      : saved;
  const canUse = id && !dirty && (saved === 'approved' || Boolean(approvedBefore));
  const stepAt = STEPS.findIndex((s) => s.key === step);

  async function save({ submit = false } = {}) {
    if (!atLeast(user?.role, 'manager')) return toast('Templates are changed by a store manager or the store owner.', 'bad');
    setTried(true);
    if (errors.length) return;
    setBusy(true);
    try {
      let next = t;
      if (dirty) next = (await api(id ? `/api/templates/${id}` : '/api/templates', { method: id ? 'PUT' : 'POST', body: t })).template;
      if (!needsMeta) {
        toast('Template saved');
        navigate(id ? '/templates' : `/campaigns/new?template=${next.id}`);
        return;
      }
      if (submit && String(next.provider_status || '').toUpperCase() !== 'APPROVED') {
        try {
          next = (await api(`/api/templates/${next.id}/submit-meta`, { method: 'POST' })).template;
          toast(next.approved_version?.provider_ref
            ? 'Saved and sent to Meta. The approved version keeps sending until Meta approves this one.'
            : 'Saved and sent to Meta. It usually takes minutes; this page updates by itself.');
        } catch (e) {
          toast(`Saved, but not sent to Meta. ${e.message}`, 'bad');
        }
      } else {
        toast(submit ? 'Saved. Meta’s approval still applies, so it can be used now.' : 'Template saved');
      }
      loaded(next);
      if (!id) navigate(`/templates/${next.id}`, { replace: true });
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  // Back to the version Meta approved: unsaved changes are dropped; saved ones are put back.
  async function undo() {
    if (dirty) {
      setT(orig);
      setMediaPick(null);
      return;
    }
    const v = approvedBefore;
    setBusy(true);
    try {
      const r = await api(`/api/templates/${id}`, { method: 'PUT', body: { ...t, body: v.body, buttons: v.buttons || [], image_url: v.image_url || '', video_url: v.video_url || '' } });
      loaded(r.template);
      toast('Back to the version Meta approved');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    setBusy(true);
    try {
      const r = await api(`/api/templates/${id}/sync-meta`, { method: 'POST' });
      setT(fromMeta(r.template));
      setOrig(fromMeta(r.template));
      toast(r.template.provider_status ? `Meta says: ${String(r.template.provider_status).toLowerCase()}` : r.template.provider_reason || 'Not approved yet.');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    try {
      await api(`/api/templates/${id}`, { method: 'DELETE' });
      toast('Template deleted');
      navigate('/templates');
    } catch (e) {
      toast(e.message, 'bad');
      setAskDelete(false);
    }
  }

  const rules = [
    { ok: vars.includes('name') || vars.includes('full_name'), text: 'Greets the customer by name' },
    { ok: vars.some((v) => ['last_purchase', 'interests', 'city'].includes(v)), text: 'Mentions something personal' },
    { ok: vars.includes('offer'), text: 'Gives a real offer' },
    { ok: vars.includes('offer_ends') || /\b(till|until|ends?|before|last day)\b/i.test(t.body), text: 'Says when the offer ends' },
    { ok: t.buttons.length > 0, text: 'Has a one-tap button' },
  ];
  const stepInfo = {
    message: [Boolean(t.body.trim()), t.body.trim() ? `${t.body.length} letters` : 'Not written yet'],
    media: [mediaKind !== 'none' || mediaPick === 'none' || Boolean(id), { photo: 'Photo', video: 'Video', none: 'Words only' }[mediaKind]],
    buttons: [t.buttons.length > 0, t.buttons.length ? t.buttons.map((b) => b.text || 'Button').join(' · ') : 'None'],
  };
  const [tone, StateIcon, stateLabel] = state ? STATE[state] : [];

  return (
    <div className="page te-page">
      <div className="page-head compact">
        <div style={{ minWidth: 0 }}>
          <Link to="/templates" className="back"><ArrowLeft size={16} />Templates</Link>
          <h1 className="ellipsis">{id ? orig?.name || 'Template' : 'New template'}</h1>
        </div>
        {state && <span className={`badge ${tone} te-badge`}><StateIcon size={14} />{stateLabel}</span>}
      </div>

      {state && <MetaStrip state={state} t={orig} approvedBefore={approvedBefore} busy={busy} onCheck={checkStatus} />}

      <div className="two-col te-cols">
        <div className="stack" style={{ minWidth: 0, gap: 12 }}>
          <div className="card card-pad te-top">
            <input id="tpl-name" className="input" value={t.name} onChange={(e) => set({ name: e.target.value })} placeholder="Template name, e.g. Diwali offer for past buyers" aria-label="Template name" />
            <div className="seg te-lang" role="group" aria-label="Language of the message">
              {LANGS.map((l) => <button key={l.code} type="button" className={(t.language || 'en').split('_')[0] === l.code ? 'on' : ''} onClick={() => set({ language: l.code })}>{l.label}</button>)}
            </div>
          </div>

          <div className="te-steps" role="tablist" aria-label="Steps">
            {STEPS.map((s, i) => (
              <button key={s.key} type="button" role="tab" aria-selected={step === s.key} className={`te-step ${step === s.key ? 'on' : ''} ${stepInfo[s.key][0] ? 'done' : ''}`} onClick={() => setStep(s.key)}>
                <span className="te-step-n">{stepInfo[s.key][0] && step !== s.key ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
                <span style={{ minWidth: 0 }}><b>{s.label}</b><span className="subtle te-sum">{stepInfo[s.key][1]}</span></span>
              </button>
            ))}
          </div>

          <div className="card card-pad stack te-panel" style={{ gap: 12 }}>
            {step === 'message' && (
              <>
                {!id && !t.body && (
                  <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
                    <span className="subtle">Start from:</span>
                    {READY_MESSAGES.map((m) => (
                      <button key={m.key} type="button" className="chip" onClick={() => { const r = readyFor(m, t.language || lang, Boolean(settings?.salesCodes)); setT((x) => ({ ...x, name: x.name || r.name, body: r.body, buttons: r.buttons, sms_body: r.sms || x.sms_body })); }}>{m.title}</button>
                    ))}
                  </div>
                )}
                <Field label="Message" error={tried ? errors.find((e) => /message|personal detail|1,024/i.test(e)) : null}>
                  <div className="te-box">
                    <div className="te-toolbar">
                      <button type="button" className="te-tool" onClick={() => wrap('*')} title="Bold: select words, then click"><b>B</b></button>
                      <button type="button" className="te-tool" onClick={() => wrap('_')} title="Slanted: select words, then click"><i>I</i></button>
                      <span className="te-sep" />
                      <AddDetail details={details} onPick={insert} />
                      <span className="subtle num te-count" style={{ color: t.body.length > 1024 ? 'var(--bad)' : undefined }}>{t.body.length}/1024</span>
                    </div>
                    <textarea ref={textRef} id="tpl-body" className="te-text" rows={8} value={shown} onChange={(e) => set({ body: fromFriendly(e.target.value) })} placeholder="Hi [Customer name], ..." />
                  </div>
                  <span className="hint">Details in [brackets] are filled in for each customer. Put the offer in the first 3 lines.</span>
                  {longForWhatsApp(t) && (
                    <Alert tone="warn">{t.image_url || t.video_url
                      ? 'Under a photo or video, WhatsApp shows only about the first 3 lines; the rest is behind “Read more” (big brands too). Put the offer and the date in the first 2–3 lines. The buttons always show in full.'
                      : 'Long message: WhatsApp may hide the end behind “Read more”. Put the offer and the date near the top. The buttons always show in full.'}</Alert>
                  )}
                </Field>
              </>
            )}

            {step === 'media' && (
              <>
                <div className="te-choices" role="radiogroup" aria-label="Photo or video">
                  {[['photo', Image, 'Photo', 'A jewellery photo gets far more taps'], ['video', Film, 'Video', 'MP4, up to 16 MB'], ['none', Type, 'Words only', 'No photo or video']].map(([k, Icon, label, sub]) => (
                    <button key={k} type="button" role="radio" aria-checked={mediaKind === k} className={`te-choice ${mediaKind === k ? 'on' : ''}`} onClick={() => chooseMedia(k)}>
                      <Icon size={22} /><b>{label}</b><span className="subtle">{sub}</span>
                    </button>
                  ))}
                </div>
                {mediaKind === 'photo' && (
                  <>
                    <PhotoPicker value={t.image_url} onChange={(url) => set({ image_url: url || '', ...(url ? { video_url: '' } : {}) })} />
                    <Field label="Or paste a photo link" hint="A public https:// link to a photo of the jewellery.">
                      <input id="tpl-image" className="input" value={t.image_url} onChange={(e) => set({ image_url: e.target.value })} placeholder="https://..." />
                    </Field>
                  </>
                )}
                {mediaKind === 'video' && <VideoPicker value={t.video_url} onChange={(url) => set({ video_url: url || '', ...(url ? { image_url: '' } : {}) })} />}
                {mediaKind !== 'none' && <span className="hint">You can use a different {mediaKind} for each offer when you send it; Meta does not need to approve it again.</span>}
              </>
            )}

            {step === 'buttons' && (
              <>
                {t.buttons.length === 0 && <p className="subtle" style={{ margin: 0 }}>Add up to 2 buttons. One tap is easier for customers than typing a reply.</p>}
                {t.buttons.map((b, i) => (
                  <div key={i} className="te-button">
                    <div className="seg" role="group" aria-label="Button type">
                      {BUTTON_TYPES.map(({ key, label, icon: Icon }) => (
                        <button key={key} type="button" className={b.type === key ? 'on' : ''} onClick={() => setButton(i, { type: key })}><Icon size={14} />{label}</button>
                      ))}
                    </div>
                    <input className="input" maxLength={25} value={b.text} onChange={(e) => setButton(i, { text: e.target.value })} placeholder="Button text" aria-label="Button text" />
                    {b.type === 'url' && <input className="input" value={b.url || ''} onChange={(e) => setButton(i, { url: e.target.value })} inputMode="url" placeholder="https://" aria-label="Website link" />}
                    {b.type === 'phone' && <PhoneInput value={b.phone || ''} onChange={(v) => setButton(i, { phone: v })} aria-label="Phone number" />}
                    <button type="button" className="icon-btn sm" onClick={() => set({ buttons: t.buttons.filter((_, j) => j !== i) })} aria-label="Remove button"><Trash2 size={16} /></button>
                  </div>
                ))}
                {t.buttons.length < 2 && (
                  <div className="row wrap" style={{ gap: 6 }}>
                    {BUTTON_PRESETS.filter((p) => !t.buttons.some((b) => b.text === p.text)).map((p) => (
                      <button key={p.text} type="button" className="chip" onClick={() => set({ buttons: [...t.buttons, { ...p }] })}><Plus size={13} />{p.text}</button>
                    ))}
                  </div>
                )}
                <span className="hint">Customers who tap a reply button like “Interested” go to Replies → Interested.</span>
              </>
            )}

            {tried && errors.length > 0 && (
              <Alert tone="bad"><b>Please fix:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>
            )}

            <div className="te-foot">
              {stepAt > 0 ? <button type="button" className="btn ghost" onClick={() => setStep(STEPS[stepAt - 1].key)}><ArrowLeft size={16} />Back</button> : <span />}
              <span className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
                {!needsMeta ? (
                  <>
                    {!id && stepAt < 2 && <button type="button" className="btn" onClick={() => setStep(STEPS[stepAt + 1].key)}>Next<ArrowRight size={16} /></button>}
                    <button className="btn primary" onClick={() => save()} disabled={busy}>{busy ? <Spinner /> : id ? 'Save changes' : 'Save and use it'}</button>
                  </>
                ) : dirty && !id && stepAt < 2 ? (
                  <>
                    <button className="btn ghost" onClick={() => save()} disabled={busy}>Save draft</button>
                    <button className="btn primary" onClick={() => setStep(STEPS[stepAt + 1].key)}>Next<ArrowRight size={16} /></button>
                  </>
                ) : dirty ? (
                  <>
                    {id && state === 'changed' && <button className="btn ghost" onClick={undo} disabled={busy}><Undo2 size={16} />Undo changes</button>}
                    <button className="btn ghost" onClick={() => save()} disabled={busy}>Save draft</button>
                    <button className="btn primary" onClick={() => save({ submit: true })} disabled={busy}>{busy ? <Spinner /> : <><Send size={16} />Save and send to Meta</>}</button>
                  </>
                ) : (
                  <>
                    {state === 'waiting' && <button className="btn ghost" onClick={checkStatus} disabled={busy}><RefreshCw size={15} />Check now</button>}
                    {state === 'changed' && <button className="btn ghost" onClick={undo} disabled={busy}><Undo2 size={16} />Undo changes</button>}
                    {canUse && <Link to={`/campaigns/new?template=${id}`} className={`btn ${saved === 'approved' || state === 'waiting' ? 'primary' : 'ghost'}`}><Send size={16} />Use this template</Link>}
                    {['rejected', 'not_sent', 'changed'].includes(state) && (
                      <button className="btn primary" onClick={() => save({ submit: true })} disabled={busy}>{busy ? <Spinner /> : <><Send size={16} />{state === 'rejected' ? 'Send to Meta again' : 'Send to Meta for approval'}</>}</button>
                    )}
                  </>
                )}
              </span>
            </div>
          </div>

          {id && (
            <div className="card te-extras">
              <button type="button" className="te-extra-head" onClick={() => setMore((x) => !x)} aria-expanded={more}>
                <Settings2 size={18} />
                <span style={{ minWidth: 0, flex: 1 }}><b>More settings</b><span className="subtle te-sum">{t.category === 'utility' ? 'Service update' : 'Offer'}{t.provider_ref ? ` · Name at Meta: ${t.provider_ref}` : ''} · Delete</span></span>
                <ChevronDown size={18} style={{ transform: more ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
              </button>
              {more && (
                <div className="te-extra-body">
                  {isOwner && (
                    <div className="form-grid two">
                      <Field label="Type" hint="Offers count towards the weekly limit. Service updates are for orders and repairs.">
                        <select className="select" value={t.category || 'marketing'} onChange={(e) => set({ category: e.target.value })}>
                          <option value="marketing">Offer (marketing)</option>
                          <option value="utility">Service update (utility)</option>
                        </select>
                      </Field>
                      <Field label="Status">
                        <select className="select" value={t.status} onChange={(e) => set({ status: e.target.value })}>
                          <option value="approved">Ready to send</option>
                          <option value="draft">Draft (cannot be sent)</option>
                        </select>
                      </Field>
                    </div>
                  )}
                  {isOwner && settings?.sms?.live && <SmsFields t={t} set={set} settings={settings} />}
                  {t.provider_ref && (
                    <p className="subtle" style={{ margin: 0 }}>
                      Name at Meta: <code>{t.provider_ref}</code>
                      {approvedBefore && approvedBefore.provider_ref !== t.provider_ref && <> · Sending now: <code>{approvedBefore.provider_ref}</code></>}
                      {' '}<button type="button" className="link-btn" onClick={checkStatus} disabled={busy}>Check with Meta now</button>
                    </p>
                  )}
                  {askDelete ? (
                    <span className="row wrap" style={{ gap: 8 }}>
                      <span>Delete this template?</span>
                      <button className="btn sm" onClick={() => setAskDelete(false)}>Keep</button>
                      <button className="btn sm danger" onClick={remove}><Trash2 size={15} />Yes, delete</button>
                    </span>
                  ) : <button className="btn sm ghost danger" style={{ alignSelf: 'flex-start' }} onClick={() => setAskDelete(true)}><Trash2 size={15} />Delete template</button>}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="stack sticky" style={{ gap: 10 }}>
          <PhonePreview body={t.body} values={{ ...EXAMPLES, ...Object.fromEntries(Object.entries(shopVars(settings)).filter(([, v]) => v)) }} buttons={t.buttons} imageUrl={t.image_url} videoUrl={t.video_url} businessName={settings?.businessName} caption="Example customer: Priya" />
          <div className="te-rules">
            {rules.map((r) => (
              <span key={r.text} className={`rule ${r.ok ? 'yes' : 'no'}`}><span className="dot">{r.ok ? <Check size={12} strokeWidth={3} /> : null}</span>{r.text}</span>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The coloured strip under the name: where Meta's approval stands, in plain words. */
function MetaStrip({ state, t, approvedBefore, busy, onCheck }) {
  const when = approvedBefore?.approved_at ? ` on ${dateOnly(approvedBefore.approved_at)}` : '';
  const old = approvedBefore ? ' Customers still get the version Meta approved before.' : '';
  const text = {
    approved: `Ready to send. Meta approved it${when}. Changing the words, photo or buttons means Meta checks it again; until then this version keeps sending.`,
    waiting: `Sent to Meta. It usually takes a few minutes to a few hours, and this page updates by itself.${approvedBefore ? ' Until then customers get the version Meta approved before.' : ''}`,
    rejected: `Meta said: ${t?.provider_reason || 'not approved'}. Change the words, then send it again.${old}`,
    changed: `You changed an approved template. The approved version keeps sending until Meta approves this one.`,
    not_sent: t?.provider_reason || 'Not sent to Meta yet. Meta approves a template before it can go to customers.',
  }[state];
  const [tone, Icon] = STATE[state];
  return (
    <div className={`te-strip ${tone}`} role="status">
      <Icon size={18} />
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      {state === 'waiting' && <button type="button" className="link-btn" onClick={onCheck} disabled={busy}>Check now</button>}
    </div>
  );
}

/** "+ Add detail": a small menu of the customer and offer details to put where the cursor is. */
function AddDetail({ details, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <span className="te-detail" ref={ref}>
      <button type="button" className="te-tool wide" onClick={() => setOpen((x) => !x)} aria-haspopup="menu" aria-expanded={open}><Plus size={14} />Add detail<ChevronDown size={14} /></button>
      {open && (
        <span className="te-menu" role="menu">
          {details.map((v) => (
            <button key={v.key} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(v.key); setOpen(false); }}>
              <b>{v.label}</b><span className="subtle">e.g. {v.example}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function plainError(e) {
  return e.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k) => `[${detailLabel(k)}]`).replace(/placeholders?/gi, 'personal detail');
}

/** SMS parts: 160 characters, or 70 when the text has characters like ₹ or Telugu. */
function smsParts(text) {
  const unicode = /[^\x20-\x7E\n\r]/.test(text);
  const single = unicode ? 70 : 160;
  return text.length <= single ? 1 : Math.ceil(text.length / (unicode ? 67 : 153));
}

function SmsFields({ t, set, settings }) {
  const example = render(t.sms_body || '', { ...EXAMPLES, ...Object.fromEntries(Object.entries(shopVars(settings)).filter(([, v]) => v)) }).text;
  const parts = smsParts(example);
  return (
    <>
      <p className="subtle" style={{ margin: 0 }}>Sent by SMS only to customers who are not on WhatsApp and agreed to SMS. The wording must match the template registered on the DLT portal.</p>
      <Field label="SMS text">
        <textarea className="textarea" rows={3} value={t.sms_body || ''} onChange={(e) => set({ sms_body: e.target.value })} placeholder="Hi {{name}}, 20% off making charges at {{store}} till {{offer_ends}}." />
      </Field>
      {t.sms_body && <span className="subtle num">{example.length} characters · {parts} SMS {parts === 1 ? 'part' : 'parts'} per customer</span>}
      <Field label="DLT template ID" hint="The long number the DLT portal gives this SMS template.">
        <input className="input" value={t.sms_dlt_template_id || ''} onChange={(e) => set({ sms_dlt_template_id: e.target.value.replace(/\D/g, '') })} inputMode="numeric" placeholder="1107170000000000000" />
      </Field>
    </>
  );
}

/**
 * Roughly when WhatsApp folds a message behind "Read more": counted in phone lines (about 32
 * characters each, blank lines included). Under a photo or video only about 3 lines show (seen on
 * a Mia by Tanishq video offer); plain text folds much later.
 */
function longForWhatsApp(t) {
  const text = render(t.body || '', EXAMPLES).text || '';
  const lines = text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 32)), 0);
  const media = Boolean(t.image_url || t.video_url);
  return media ? lines > 3 : lines > 16;
}
