import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Check, ChevronDown, ExternalLink, Image, MessageSquareText, MousePointerClick, Phone, Plus, RefreshCw, Reply, Settings2, Trash2 } from 'lucide-react';
import { VARIABLES, extractVariables, render, validateTemplate } from '@shared/template.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Field, Spinner, useToast } from '../components/ui.jsx';
import { PhonePreview } from '../components/PhonePreview.jsx';
import { READY_MESSAGES } from '../lib/ready.js';
import { PhotoPicker } from '../components/PhotoPicker.jsx';
import { shopVars } from '../lib/shop.js';
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
  const isOwner = user?.role === 'admin';
  const { lang } = useT();
  const textRef = useRef(null);
  const [t, setT] = useState(id ? null : { name: '', body: '', buttons: [], image_url: '', status: 'approved', provider_ref: '', category: 'marketing', sms_body: '', sms_dlt_template_id: '' });
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [open, setOpen] = useState(null); // which extra row is open
  const [askDelete, setAskDelete] = useState(false);

  useEffect(() => {
    if (id) {
      api(`/api/templates/${id}`)
        .then((r) => setT({ ...r.template, image_url: r.template.image_url || '', provider_ref: r.template.provider_ref || '', sms_body: r.template.sms_body || '', sms_dlt_template_id: r.template.sms_dlt_template_id || '' }))
        .catch((e) => { toast(e.message, 'bad'); navigate('/templates'); });
    }
  }, [id, navigate, toast]);

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

  async function save() {
    setTried(true);
    if (errors.length) return;
    setBusy(true);
    try {
      const r = await api(id ? `/api/templates/${id}` : '/api/templates', { method: id ? 'PUT' : 'POST', body: t });
      toast('Template saved');
      navigate(id ? '/templates' : `/campaigns/new?template=${r.template.id}`);
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
              <PhotoPicker value={t.image_url} onChange={(url) => set({ image_url: url || '' })} />
              <Field label="Or paste a photo link" hint="A public https:// link to a photo of the jewellery.">
                <input id="tpl-image" className="input" value={t.image_url} onChange={(e) => set({ image_url: e.target.value })} placeholder="https://..." />
              </Field>
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
                <MetaFields t={t} onChange={(u) => setT((x) => ({ ...x, provider_ref: u.provider_ref || '', provider_status: u.provider_status, provider_reason: u.provider_reason }))} canSubmit={settings?.metaTemplatesReady} />
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
          <PhonePreview body={t.body} values={{ ...EXAMPLES, ...Object.fromEntries(Object.entries(shopVars(settings)).filter(([, v]) => v)) }} buttons={t.buttons} imageUrl={t.image_url} businessName={settings?.businessName} caption="Example customer: Priya" />
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
        <button className="btn primary lg" onClick={save} disabled={busy}>{busy ? <Spinner /> : id ? 'Save changes' : 'Save and use it'}</button>
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
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn" disabled={busy || !canSubmit} onClick={() => go('submit-meta', () => 'Sent to Meta for approval')}>{busy ? <Spinner /> : status ? 'Submit again' : 'Submit to Meta'}</button>
        {t.provider_ref && <button className="btn ghost" disabled={busy} onClick={() => go('sync-meta', (u) => `Meta says: ${u.provider_status?.toLowerCase()}`)}><RefreshCw size={16} />Check status</button>}
      </div>
      {!canSubmit && <span className="subtle">Connect WhatsApp in Settings first.</span>}
    </>
  );
}
