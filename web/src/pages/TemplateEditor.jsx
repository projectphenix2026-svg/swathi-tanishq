import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Check, ChevronDown, ExternalLink, MessageSquareText, Phone, Plus, RefreshCw, Reply, Trash2 } from 'lucide-react';
import { VARIABLES, extractVariables, render, validateTemplate } from '@shared/template.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Field, Spinner, useToast } from '../components/ui.jsx';
import { PhonePreview } from '../components/PhonePreview.jsx';

const EXAMPLES = Object.fromEntries(VARIABLES.map((v) => [v.key, v.example]));

const STARTERS = [
  {
    name: 'New arrivals for past buyers',
    body: 'Hi {{name}}, thank you for choosing your {{last_purchase}} from us. New pieces that pair beautifully with it have just arrived, and this week you get {{offer}}. Valid till {{offer_ends}}.',
    buttons: [{ type: 'url', text: 'See the designs', url: 'https://' }, { type: 'quick_reply', text: 'Not now' }],
  },
  {
    name: 'Festival offer by city',
    body: 'Hello {{name}}, our {{city}} store is ready for the festive season with designs picked for {{interests}} lovers. Visit before {{offer_ends}} for {{offer}}.',
    buttons: [{ type: 'phone', text: 'Call the store', phone: '+91' }, { type: 'quick_reply', text: 'Interested' }],
  },
];

const BUTTON_TYPES = [
  { key: 'url', label: 'Open website', icon: ExternalLink },
  { key: 'phone', label: 'Call store', icon: Phone },
  { key: 'quick_reply', label: 'Quick reply', icon: Reply },
];

export default function TemplateEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useAuth();
  const textRef = useRef(null);
  const [t, setT] = useState(id ? null : { name: '', body: '', buttons: [], image_url: '', status: 'approved', provider_ref: '', category: 'marketing', sms_body: '', sms_dlt_template_id: '' });
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (id) {
      api(`/api/templates/${id}`)
        .then((r) => setT({ ...r.template, image_url: r.template.image_url || '', provider_ref: r.template.provider_ref || '', sms_body: r.template.sms_body || '', sms_dlt_template_id: r.template.sms_dlt_template_id || '' }))
        .catch((e) => { toast(e.message, 'bad'); navigate('/templates'); });
    }
  }, [id, navigate, toast]);

  const errors = useMemo(() => (t ? validateTemplate(t) : []), [t]);
  const vars = useMemo(() => (t ? extractVariables(t.body) : []), [t]);

  if (!t) return <div className="page"><Spinner /></div>;

  const set = (patch) => setT((x) => ({ ...x, ...patch }));

  function insert(key) {
    const el = textRef.current;
    const token = `{{${key}}}`;
    const start = el?.selectionStart ?? t.body.length;
    const end = el?.selectionEnd ?? t.body.length;
    const body = t.body.slice(0, start) + token + t.body.slice(end);
    set({ body });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function setButton(i, patch) {
    set({ buttons: t.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  }

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
    if (!confirm('Delete this template?')) return;
    try {
      await api(`/api/templates/${id}`, { method: 'DELETE' });
      toast('Template deleted');
      navigate('/templates');
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  const rules = [
    { ok: vars.includes('name') || vars.includes('full_name'), text: 'Greets the customer by name' },
    { ok: vars.some((v) => ['last_purchase', 'interests', 'city'].includes(v)), text: 'Mentions something personal (last purchase, interests or city)' },
    { ok: vars.includes('offer'), text: 'Gives a real offer' },
    { ok: vars.includes('offer_ends') || /\b(till|until|ends?|before|last day)\b/i.test(t.body), text: 'Says when the offer ends' },
    { ok: t.buttons.length > 0, text: 'Has a one-tap button' },
  ];

  return (
    <div className="page">
      <Link to="/templates" className="back"><ArrowLeft size={16} />Templates</Link>
      <div className="page-head">
        <div>
          <h1>{id ? 'Edit template' : 'New template'}</h1>
          <p>Write it once; each customer gets their own name, purchase and offer filled in.</p>
        </div>
      </div>

      <div className="two-col">
        <div className="stack">
          {!id && !t.body && (
            <div className="card card-pad stack" style={{ gap: 10 }}>
              <b>Start from an example</b>
              <div className="options" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                {STARTERS.map((s) => (
                  <button key={s.name} className="option" onClick={() => setT((x) => ({ ...x, ...s }))}>
                    <div>
                      <div className="option-title">{s.name}</div>
                      <div className="subtle" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.body}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card card-pad stack">
            <Field label="Template name" hint="Only staff see this.">
              <input className="input" value={t.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Diwali offer for past buyers" />
            </Field>
            <Field label="Message" error={tried ? errors.find((e) => /message|placeholder|1,024/i.test(e)) : null}>
              <div className="chips" style={{ marginBottom: 4 }}>
                {VARIABLES.map((v) => (
                  <button key={v.key} type="button" className="chip" onClick={() => insert(v.key)} title={`Insert {{${v.key}}}`} style={{ height: 30, fontSize: '0.8rem' }}>
                    <Plus size={13} />{v.label}
                  </button>
                ))}
              </div>
              <textarea ref={textRef} className="textarea" rows={7} value={t.body} onChange={(e) => set({ body: e.target.value })} placeholder="Hi {{name}}, ..." />
              <div className="row between">
                <span className="hint">Tap a chip to add a personal detail where your cursor is.</span>
                <span className="subtle num" style={{ color: t.body.length > 1024 ? 'var(--bad)' : undefined }}>{t.body.length} / 1024</span>
              </div>
            </Field>
          </div>

          <div className="card card-pad stack">
            <div className="row between">
              <div>
                <h3>Buttons</h3>
                <p className="subtle">Up to 2. Every tap tells you who is interested.</p>
              </div>
              <button className="btn sm" disabled={t.buttons.length >= 2} onClick={() => set({ buttons: [...t.buttons, { type: 'url', text: '', url: 'https://' }] })}>
                <Plus size={16} />Add button
              </button>
            </div>
            {t.buttons.length === 0 && <p className="muted" style={{ fontSize: '0.9rem' }}>No buttons yet. “See the designs” or “Call the store” get far more responses than text alone.</p>}
            {t.buttons.map((b, i) => (
              <div key={i} className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
                <div className="stack" style={{ gap: 12 }}>
                  <div className="row between">
                    <div className="chips">
                      {BUTTON_TYPES.map(({ key, label, icon: Icon }) => (
                        <button key={key} type="button" className={`chip ${b.type === key ? 'on' : ''}`} style={{ height: 32, fontSize: '0.82rem' }} onClick={() => setButton(i, { type: key })}>
                          <Icon size={14} />{label}
                        </button>
                      ))}
                    </div>
                    <button className="icon-btn" onClick={() => set({ buttons: t.buttons.filter((_, j) => j !== i) })} aria-label="Remove button"><Trash2 size={17} /></button>
                  </div>
                  <div className="form-grid two">
                    <Field label="Button text" hint={`${(b.text || '').length}/25`}>
                      <input className="input" maxLength={25} value={b.text} onChange={(e) => setButton(i, { text: e.target.value })} placeholder={b.type === 'quick_reply' ? 'Interested' : b.type === 'phone' ? 'Call the store' : 'See the designs'} />
                    </Field>
                    {b.type === 'url' && <Field label="Website link"><input className="input" value={b.url || ''} onChange={(e) => setButton(i, { url: e.target.value })} inputMode="url" /></Field>}
                    {b.type === 'phone' && <Field label="Phone number"><input className="input" value={b.phone || ''} onChange={(e) => setButton(i, { phone: e.target.value })} inputMode="tel" placeholder="+91 98765 43210" /></Field>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <button className="card-head" onClick={() => setAdvanced((a) => !a)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', borderBottom: advanced ? undefined : 'none' }}>
              <h3>More options</h3>
              <ChevronDown size={18} style={{ transform: advanced ? 'rotate(180deg)' : undefined }} />
            </button>
            {advanced && (
              <div className="stack" style={{ padding: 20 }}>
                <Field label="Image link (optional)" hint="A public https:// link to a photo of the jewellery.">
                  <input className="input" value={t.image_url} onChange={(e) => set({ image_url: e.target.value })} placeholder="https://..." />
                </Field>
                <div className="form-grid two">
                  <Field label="Category" hint="Marketing counts towards the weekly limit. Utility is for order and service updates.">
                    <select className="select" value={t.category || 'marketing'} onChange={(e) => set({ category: e.target.value })}>
                      <option value="marketing">Marketing (offers, new designs)</option>
                      <option value="utility">Utility (order or service update)</option>
                    </select>
                  </Field>
                  <Field label="Language code" hint="en for English; en_US for Meta’s sample templates.">
                    <input className="input" value={t.language || 'en'} onChange={(e) => set({ language: e.target.value })} />
                  </Field>
                </div>
                <Field label="Status">
                  <select className="select" value={t.status} onChange={(e) => set({ status: e.target.value })}>
                    <option value="approved">Ready to send</option>
                    <option value="draft">Draft (cannot be sent)</option>
                  </select>
                </Field>
                <Field label="Approved template ID" hint="Twilio: the Content template SID (HX…). Meta Cloud API: the approved template’s name. Needed when the sender only accepts approved templates.">
                  <input className="input" value={t.provider_ref} onChange={(e) => set({ provider_ref: e.target.value })} placeholder="e.g. past_buyers_offer" />
                </Field>
              </div>
            )}
          </div>

          <SmsCard t={t} set={set} />
          {id && <MetaCard t={t} onChange={(u) => setT((x) => ({ ...x, provider_ref: u.provider_ref || '', provider_status: u.provider_status, provider_reason: u.provider_reason }))} canSubmit={settings?.metaTemplatesReady} />}

          {tried && errors.length > 0 && (
            <Alert tone="bad"><b>Please fix:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>
          )}

          <div className="action-bar">
            {id ? <button className="btn ghost danger" onClick={remove}><Trash2 size={17} />Delete</button> : <span />}
            <button className="btn primary lg" onClick={save} disabled={busy}>{busy ? <Spinner /> : id ? 'Save changes' : 'Save and use in a campaign'}</button>
          </div>
        </div>

        <div className="stack sticky">
          <PhonePreview body={t.body} values={EXAMPLES} buttons={t.buttons} imageUrl={t.image_url} businessName={settings?.businessName} caption="Example values shown in gold" />
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <h3>Will customers care?</h3>
            {rules.map((r) => (
              <div key={r.text} className={`rule ${r.ok ? 'yes' : 'no'}`}>
                <span className="dot">{r.ok ? <Check size={13} strokeWidth={3} /> : null}</span>
                {r.text}
              </div>
            ))}
            <p className="subtle">Messages without a reason to open them get ignored, and too many ignored messages can get the WhatsApp number limited.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** SMS parts: 160 characters, or 70 when the text has characters like ₹ or Telugu. */
function smsParts(text) {
  const unicode = /[^\x20-\x7E\n\r]/.test(text);
  const single = unicode ? 70 : 160;
  return text.length <= single ? 1 : Math.ceil(text.length / (unicode ? 67 : 153));
}

function SmsCard({ t, set }) {
  const [open, setOpen] = useState(Boolean(t.sms_body));
  const example = render(t.sms_body || '', EXAMPLES).text;
  const parts = smsParts(example);
  return (
    <div className="card">
      <button className="card-head" onClick={() => setOpen((o) => !o)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', borderBottom: open ? undefined : 'none' }}>
        <span className="row" style={{ gap: 10 }}><MessageSquareText size={18} /><h3>SMS version (backup)</h3>{t.sms_body && <span className="badge info">Added</span>}</span>
        <ChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <div className="stack" style={{ padding: 20 }}>
          <p className="subtle">Sent by SMS only to customers who are not on WhatsApp and agreed to SMS. The wording must match the template registered on the DLT portal, with the same placeholders.</p>
          <Field label="SMS text">
            <textarea className="textarea" rows={4} value={t.sms_body || ''} onChange={(e) => set({ sms_body: e.target.value })} placeholder="Hi {{name}}, 20% off making charges at Swathi Tanishq till {{offer_ends}}. -SWATHI" />
          </Field>
          {t.sms_body && (
            <div className="stack-sm">
              <div className="sms-bubble">{example}</div>
              <span className="subtle num">{example.length} characters · {parts} SMS {parts === 1 ? 'part' : 'parts'} per customer (example values)</span>
            </div>
          )}
          <Field label="DLT template ID" hint="The long number the DLT portal gives this SMS template. Needed before SMS can really be sent.">
            <input className="input" value={t.sms_dlt_template_id || ''} onChange={(e) => set({ sms_dlt_template_id: e.target.value.replace(/\D/g, '') })} inputMode="numeric" placeholder="1107170000000000000" />
          </Field>
        </div>
      )}
    </div>
  );
}

function MetaCard({ t, onChange, canSubmit }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const status = t.provider_status;
  const tone = status === 'APPROVED' ? 'ok' : status === 'REJECTED' ? 'bad' : status ? 'warn' : 'neutral';
  const label = status === 'APPROVED' ? 'Approved by Meta' : status === 'REJECTED' ? 'Rejected by Meta' : status ? 'Waiting for Meta' : 'Not submitted';
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
    <div className="card card-pad stack">
      <div className="row between wrap">
        <span className="row" style={{ gap: 10 }}><BadgeCheck size={18} /><h3>WhatsApp approval (Meta)</h3></span>
        <span className={`badge ${tone}`}>{label}</span>
      </div>
      <p className="subtle">
        Meta must approve a template before it can go to customers through the WhatsApp Cloud API. Approval usually takes minutes to a day.
        {t.provider_ref && <> Name at Meta: <code>{t.provider_ref}</code>.</>}
      </p>
      {status === 'REJECTED' && t.provider_reason && <Alert tone="bad">Reason: {t.provider_reason}. Edit the wording and submit again.</Alert>}
      <div className="row wrap">
        <button className="btn" disabled={busy || !canSubmit} onClick={() => go('submit-meta', () => 'Sent to Meta for approval')}>{busy ? <Spinner /> : status ? 'Submit again' : 'Submit to Meta'}</button>
        {t.provider_ref && <button className="btn ghost" disabled={busy} onClick={() => go('sync-meta', (u) => `Meta says: ${u.provider_status?.toLowerCase()}`)}><RefreshCw size={16} />Check status</button>}
      </div>
      {!canSubmit && <span className="subtle">To submit from here, add META_WABA_ID and META_ACCESS_TOKEN to the server settings.</span>}
    </div>
  );
}
