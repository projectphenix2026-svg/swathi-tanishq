import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Check, ChevronDown, Clock, ExternalLink, Film, Image, MessageSquareText, MousePointerClick, Phone, Plus, RefreshCw, Reply, Send, Settings2, Trash2 } from 'lucide-react';
import { VARIABLES, extractVariables, render, validateTemplate } from '@shared/template.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Field, Spinner, useToast } from '../components/ui.jsx';
import { PhonePreview } from '../components/PhonePreview.jsx';
import { READY_MESSAGES } from '../lib/ready.js';
import { PhotoPicker } from '../components/PhotoPicker.jsx';
import { VideoPicker } from '../components/VideoPicker.jsx';
import { shopVars } from '../lib/shop.js';
import { atLeast } from '@shared/roles.js';
import { detailLabel, fromFriendly, toFriendly } from '../lib/friendly.js';
import { readyFor } from '../lib/ready-lang.js';
import { useT } from '../lib/i18n.jsx';

// The template editor: one message box with a small toolbar (bold, slanted, add a detail),
// and everything else (photo, buttons, SMS version, WhatsApp approval, advanced) in rows that
// open when needed, each with a one-line summary. The phone on the right shows the result.
const EXAMPLES = Object.fromEntries(VARIABLES.map((v) => [v.key, v.example]));
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

export default function TemplateEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings, user } = useAuth();
  const isOwner = atLeast(user?.role, 'owner');
  const { lang } = useT();
  const textRef = useRef(null);
  const [t, setT] = useState(id ? null : { name: '', body: '', buttons: [], image_url: '', video_url: '', status: 'approved', provider_ref: '', category: 'marketing', sms_body: '', sms_dlt_template_id: '' });
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  // Which extra row is open; a link like /templates/5#buttons opens that one.
  const [open, setOpen] = useState(() => window.location.hash.slice(1) || null);
  const [askDelete, setAskDelete] = useState(false);

  // The template as last saved, to know when there are changes not saved yet.
  const [orig, setOrig] = useState(null);
  const loaded = (tpl) => {
    const x = { ...tpl, image_url: tpl.image_url || '', video_url: tpl.video_url || '', provider_ref: tpl.provider_ref || '', sms_body: tpl.sms_body || '', sms_dlt_template_id: tpl.sms_dlt_template_id || '' };
    setT(x);
    setOrig(x);
  };
  useEffect(() => {
    if (id) {
      api(`/api/templates/${id}`)
        .then((r) => loaded(r.template))
        .catch((e) => { toast(e.message, 'bad'); navigate('/templates'); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate, toast]);

  // While Meta reviews it, look again every 20 seconds; Sandesh itself asks Meta every few minutes.
  const savedStatus = String(orig?.provider_status || '').toUpperCase();
  useEffect(() => {
    if (!id || !['PENDING', 'IN_APPEAL'].includes(savedStatus)) return undefined;
    const timer = setInterval(() => {
      api(`/api/templates/${id}`).then((r) => {
        const st = String(r.template.provider_status || '').toUpperCase();
        if (st === savedStatus) return;
        // Only Meta's answer changes; anything typed but not saved stays.
        const meta = (x) => ({ ...x, provider_ref: r.template.provider_ref || '', provider_status: r.template.provider_status, provider_reason: r.template.provider_reason });
        setT(meta);
        setOrig(meta);
        if (st === 'APPROVED') toast('Approved by Meta. You can use it now.');
        else if (st === 'REJECTED') toast('Meta did not approve it. See the reason under WhatsApp approval.', 'bad');
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

  // With WhatsApp connected a template must be approved by Meta before it can be sent, so the main
  // button saves and sends it for approval in one go, then becomes "Use this template" once approved.
  const needsMeta = Boolean(settings?.metaTemplatesReady);
  const FIELDS = ['name', 'body', 'buttons', 'image_url', 'video_url', 'category', 'language', 'sms_body', 'sms_dlt_template_id', 'status', 'provider_ref'];
  const pick = (x) => JSON.stringify(FIELDS.map((k) => x?.[k] ?? null));
  const dirty = !id || !orig || pick(t) !== pick(orig);
  const metaStatus = String(t?.provider_status || '').toUpperCase();

  async function save({ submit = false } = {}) {
    if (!atLeast(user?.role, 'manager')) return toast('Templates are changed by a store manager or the store owner.', 'bad');
    setTried(true);
    if (errors.length) return;
    setBusy(true);
    try {
      let saved = t;
      if (dirty) saved = (await api(id ? `/api/templates/${id}` : '/api/templates', { method: id ? 'PUT' : 'POST', body: t })).template;
      if (!needsMeta) {
        toast('Template saved');
        navigate(id ? '/templates' : `/campaigns/new?template=${saved.id}`);
        return;
      }
      if (submit && String(saved.provider_status || '').toUpperCase() !== 'APPROVED') {
        try {
          const before = saved.provider_ref;
          saved = (await api(`/api/templates/${saved.id}/submit-meta`, { method: 'POST' })).template;
          toast(before && saved.provider_ref !== before
            ? `Saved and sent to Meta as a new version (${saved.provider_ref}). Approval usually takes minutes.`
            : 'Saved and sent to Meta for approval. It usually takes minutes; press “Check status”.');
        } catch (e) {
          toast(`Saved, but not sent to Meta. ${e.message}`, 'bad');
        }
      } else {
        toast(submit ? 'Saved. Meta’s approval still applies, so it can be used now.' : 'Template saved');
      }
      loaded(saved);
      if (!id) navigate(`/templates/${saved.id}`, { replace: true });
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
      loaded(r.template);
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
  const meta = t.provider_status === 'APPROVED' ? ['ok', 'Approved by Meta'] : t.provider_status === 'REJECTED' ? ['bad', 'Rejected by Meta'] : t.provider_status ? ['warn', 'Waiting for Meta'] : null;

  return (
    <div className="page te-page">
      <div className="page-head compact">
        <div>
          <Link to="/templates" className="back"><ArrowLeft size={16} />Templates</Link>
          <h1>{id ? 'Edit template' : 'New template'}</h1>
        </div>
        {meta && <span className={`badge ${meta[0]}`}>{meta[1]}</span>}
      </div>

      <div className="two-col te-cols">
        <div className="stack" style={{ minWidth: 0, gap: 12 }}>
          {!id && !t.body && (
            <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
              <span className="subtle">Start from:</span>
              {READY_MESSAGES.map((m) => (
                <button key={m.key} type="button" className="chip" onClick={() => { const r = readyFor(m, lang, Boolean(settings?.salesCodes)); setT((x) => ({ ...x, name: r.name, body: r.body, buttons: r.buttons, sms_body: r.sms || x.sms_body })); }}>{m.title}</button>
              ))}
            </div>
          )}

          <div className="card card-pad stack" style={{ gap: 12 }}>
            <Field label="Template name" hint="Only staff see this.">
              <input id="tpl-name" className="input" value={t.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Diwali offer for past buyers" />
            </Field>
            <Field label="Message" error={tried ? errors.find((e) => /message|personal detail|1,024/i.test(e)) : null}>
              <div className="te-box">
                <div className="te-toolbar">
                  <button type="button" className="te-tool" onClick={() => wrap('*')} title="Bold: select words, then click"><b>B</b></button>
                  <button type="button" className="te-tool" onClick={() => wrap('_')} title="Slanted: select words, then click"><i>I</i></button>
                  <span className="te-sep" />
                  <AddDetail details={details} onPick={insert} />
                  <span className="subtle num te-count" style={{ color: t.body.length > 1024 ? 'var(--bad)' : undefined }}>{t.body.length}/1024</span>
                </div>
                <textarea ref={textRef} id="tpl-body" className="te-text" rows={11} value={shown} onChange={(e) => set({ body: fromFriendly(e.target.value) })} placeholder="Hi [Customer name], ..." />
              </div>
              <span className="hint">Details in [brackets] are filled in for each customer. Select words, then B or I, to make them stand out.</span>
            </Field>
          </div>

          <div className="card te-extras">
            <Extra id="photo" open={open} setOpen={setOpen} icon={Image} title="Photo" summary={t.image_url ? 'Photo added' : 'None. A jewellery photo gets far more taps.'}>
              {t.video_url && <p className="subtle" style={{ margin: 0 }}>This message has a video. A message can have a photo or a video, so adding a photo removes the video.</p>}
              <PhotoPicker value={t.image_url} onChange={(url) => set({ image_url: url || '', ...(url ? { video_url: '' } : {}) })} />
              <Field label="Or paste a photo link" hint="A public https:// link to a photo of the jewellery.">
                <input id="tpl-image" className="input" value={t.image_url} onChange={(e) => set({ image_url: e.target.value, ...(e.target.value ? { video_url: '' } : {}) })} placeholder="https://..." />
              </Field>
            </Extra>

            <Extra id="video" open={open} setOpen={setOpen} icon={Film} title="Video" summary={t.video_url ? 'Video added' : 'None. A short video of a new collection (MP4, up to 16 MB).'}>
              {t.image_url && <p className="subtle" style={{ margin: 0 }}>This message has a photo. A message can have a photo or a video, so adding a video removes the photo.</p>}
              <VideoPicker value={t.video_url} onChange={(url) => set({ video_url: url || '', ...(url ? { image_url: '' } : {}) })} />
              <span className="hint">MP4, up to 16 MB (about 1–2 minutes on a phone). Meta approves the message with its video; after a change, press “Submit again”.</span>
            </Extra>

            <Extra id="buttons" open={open} setOpen={setOpen} icon={MousePointerClick} title="Buttons" summary={t.buttons.length ? t.buttons.map((b) => b.text || 'Button').join(' · ') : 'None. Add up to 2, like “Interested”.'}>
              {t.buttons.map((b, i) => (
                <div key={i} className="te-button">
                  <div className="seg" role="group" aria-label="Button type">
                    {BUTTON_TYPES.map(({ key, label, icon: Icon }) => (
                      <button key={key} type="button" className={b.type === key ? 'on' : ''} onClick={() => setButton(i, { type: key })}><Icon size={14} />{label}</button>
                    ))}
                  </div>
                  <input className="input" maxLength={25} value={b.text} onChange={(e) => setButton(i, { text: e.target.value })} placeholder="Button text" aria-label="Button text" />
                  {b.type === 'url' && <input className="input" value={b.url || ''} onChange={(e) => setButton(i, { url: e.target.value })} inputMode="url" placeholder="https://" aria-label="Website link" />}
                  {b.type === 'phone' && <input className="input" value={b.phone || ''} onChange={(e) => setButton(i, { phone: e.target.value })} inputMode="tel" placeholder="+91 98765 43210" aria-label="Phone number" />}
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
              <span className="hint">Customers who tap “Interested” go to Replies → Interested.</span>
            </Extra>

            {isOwner && (
              <Extra id="sms" open={open} setOpen={setOpen} icon={MessageSquareText} title="SMS version" summary={t.sms_body ? 'Added' : 'None. Only needed for SMS (after DLT registration).'}>
                <SmsFields t={t} set={set} />
              </Extra>
            )}
            {isOwner && id && (
              <Extra id="meta" open={open} setOpen={setOpen} icon={BadgeCheck} title="WhatsApp approval (Meta)" summary={meta ? meta[1] : 'Not submitted'}>
                <MetaFields t={t} onChange={(u) => {
                  // Approval changes come from Meta, not from editing: keep them out of "unsaved changes".
                  const meta = (x) => ({ ...x, provider_ref: u.provider_ref || '', provider_status: u.provider_status, provider_reason: u.provider_reason });
                  setT(meta);
                  setOrig(meta);
                }} canSubmit={settings?.metaTemplatesReady} />
              </Extra>
            )}
            {isOwner && (
              <Extra id="advanced" open={open} setOpen={setOpen} icon={Settings2} title="Advanced" summary={`${t.category === 'utility' ? 'Utility' : 'Marketing'} · ${t.status === 'draft' ? 'Draft' : 'Ready'}`}>
                <div className="form-grid two">
                  <Field label="Category" hint="Marketing counts towards the weekly limit. Utility is for service updates.">
                    <select className="select" value={t.category || 'marketing'} onChange={(e) => set({ category: e.target.value })}>
                      <option value="marketing">Marketing (offers, new designs)</option>
                      <option value="utility">Utility (service update)</option>
                    </select>
                  </Field>
                  <Field label="Status">
                    <select className="select" value={t.status} onChange={(e) => set({ status: e.target.value })}>
                      <option value="approved">Ready to send</option>
                      <option value="draft">Draft (cannot be sent)</option>
                    </select>
                  </Field>
                  <Field label="Language code" hint="en for English; en_US for Meta’s sample templates.">
                    <input className="input" value={t.language || 'en'} onChange={(e) => set({ language: e.target.value })} />
                  </Field>
                  <Field label="Approved template ID" hint="Meta: the approved template’s name. Twilio: the Content SID (HX…).">
                    <input className="input" value={t.provider_ref} onChange={(e) => set({ provider_ref: e.target.value })} placeholder="e.g. past_buyers_offer" />
                  </Field>
                </div>
              </Extra>
            )}
          </div>

          {tried && errors.length > 0 && (
            <Alert tone="bad"><b>Please fix:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>
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

      <div className="action-bar">
        {id ? (
          askDelete ? (
            <span className="row wrap" style={{ gap: 8 }}>
              <span>Delete this template?</span>
              <button className="btn" onClick={() => setAskDelete(false)}>Keep</button>
              <button className="btn danger" onClick={remove}><Trash2 size={16} />Yes, delete</button>
            </span>
          ) : <button className="btn ghost danger" onClick={() => setAskDelete(true)}><Trash2 size={17} />Delete</button>
        ) : <span />}
        {!needsMeta ? (
          <button className="btn primary lg" onClick={() => save()} disabled={busy}>{busy ? <Spinner /> : id ? 'Save changes' : 'Save and use it'}</button>
        ) : dirty ? (
          <span className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => save()} disabled={busy}>Save only</button>
            <button className="btn primary lg" onClick={() => save({ submit: true })} disabled={busy}>{busy ? <Spinner /> : <><Send size={17} />Save and send to Meta</>}</button>
          </span>
        ) : metaStatus === 'APPROVED' ? (
          <span className="row wrap" style={{ gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
            <span className="badge ok"><Check size={13} />Approved by Meta</span>
            <Link to={`/campaigns/new?template=${id}`} className="btn primary lg"><Send size={17} />Use this template</Link>
          </span>
        ) : ['PENDING', 'IN_APPEAL'].includes(metaStatus) ? (
          <span className="row wrap" style={{ gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
            <span className="subtle row" style={{ gap: 6 }}><Spinner size={14} />Waiting for Meta’s approval. This page updates by itself.</span>
            <button className="btn ghost sm" onClick={checkStatus} disabled={busy}><RefreshCw size={15} />Check now</button>
          </span>
        ) : (
          <button className="btn primary lg" onClick={() => save({ submit: true })} disabled={busy}>{busy ? <Spinner /> : <><Send size={17} />{metaStatus ? 'Send to Meta again' : 'Send to Meta for approval'}</>}</button>
        )}
      </div>
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

/** One fold-out row: title and a one-line summary; the fields show when opened. */
function Extra({ id, open, setOpen, icon: Icon, title, summary, children }) {
  const on = open === id;
  return (
    <div className={`te-extra ${on ? 'on' : ''}`}>
      <button type="button" className="te-extra-head" onClick={() => setOpen(on ? null : id)} aria-expanded={on}>
        <Icon size={18} />
        <span style={{ minWidth: 0, flex: 1 }}><b>{title}</b><span className="subtle te-sum">{summary}</span></span>
        <ChevronDown size={18} style={{ transform: on ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      {on && <div className="te-extra-body">{children}</div>}
    </div>
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

function SmsFields({ t, set }) {
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

function MetaFields({ t, onChange, canSubmit }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const status = t.provider_status;
  async function go(path, done) {
    setBusy(true);
    try {
      const r = await api(`/api/templates/${t.id}/${path}`, { method: 'POST' });
      onChange(r.template);
      toast(done(r.template));
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="subtle" style={{ margin: 0 }}>
        Meta approves a template before it can go to customers. It usually takes minutes to a day.
        {t.provider_ref && <> Name at Meta: <code>{t.provider_ref}</code>.</>}
      </p>
      {status === 'REJECTED' && t.provider_reason && <Alert tone="bad">Reason: {t.provider_reason}. Edit the wording and submit again.</Alert>}
      {!status && t.provider_ref && t.provider_reason && <Alert tone="warn">{t.provider_reason}</Alert>}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn" disabled={busy || !canSubmit} onClick={() => go('submit-meta', (u) => (u.provider_ref && u.provider_ref !== t.provider_ref && t.provider_ref ? `Sent to Meta as a new version (${u.provider_ref}). Approval usually takes minutes.` : 'Sent to Meta for approval'))}>{busy ? <Spinner /> : status || t.provider_ref ? 'Submit again' : 'Submit to Meta'}</button>
        {t.provider_ref && <button className="btn ghost" disabled={busy} onClick={() => go('sync-meta', (u) => (u.provider_status ? `Meta says: ${u.provider_status.toLowerCase()}` : u.provider_reason || 'Not approved for this version yet.'))}><RefreshCw size={16} />Check now</button>}
      </div>
      {!canSubmit && <span className="subtle">Connect WhatsApp in Settings first.</span>}
    </>
  );
}
