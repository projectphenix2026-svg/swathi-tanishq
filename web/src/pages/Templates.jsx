import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Film, Image, MousePointerClick, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { SearchBox, matches } from '../components/SearchBox.jsx';
import { api } from '../lib/api.js';
import { Pic, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { Highlighted } from '../components/PhonePreview.jsx';
import { dateOnly } from '../lib/format.js';
import { toFriendly } from '../lib/friendly.js';
import { READY_MESSAGES, iconFor } from '../lib/ready.js';
import { LANGS, isReadyText, readyFor, readyIn } from '../lib/ready-lang.js';
import { useAuth } from '../lib/auth.js';
import { atLeast } from '@shared/roles.js';
import { useT } from '../lib/i18n.jsx';
import { META_BADGE, isApproved, metaState } from '../lib/approval.js';

const STATUS = { approved: ['ok', 'Ready'], draft: ['neutral', 'Not finished'], rejected: ['bad', 'Needs a change'] };
const READY_NAMES = new Set(READY_MESSAGES.flatMap((m) => LANGS.map((l) => readyIn(m, l.code).name)));

/** Templates: the wording you reuse. Ready-made ones and the shop's own, in one place. */
export default function Templates() {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useAuth();
  const canWrite = atLeast(settings?.role, 'manager');
  const [asking, setAsking] = useState(null);
  async function removeTemplate(tpl) {
    try {
      await api(`/api/templates/${tpl.id}`, { method: 'DELETE' });
      toast(`${tpl.name} deleted`);
      setList((l) => l.filter((x) => x.id !== tpl.id));
    } catch (e) {
      toast(e.message, 'bad');
    }
    setAsking(null);
  }
  // Ready-made templates are shown in this person's app language.
  const { lang } = useT();
  useEffect(() => {
    api('/api/templates').then((r) => setList(r.templates)).catch(() => setList([]));
  }, []);
  const anyWaiting = (list || []).some((t) => metaState(t) === 'waiting');
  useEffect(() => {
    if (!anyWaiting) return undefined;
    const timer = setInterval(() => api('/api/templates').then((r) => setList(r.templates)).catch(() => {}), 30000);
    return () => clearInterval(timer);
  }, [anyWaiting]);

  // A ready-made template is saved the first time it is opened, then edited like any other.
  async function openReady(m) {
    setBusy(m.key);
    try {
      const r = readyFor(m, lang, Boolean(settings?.salesCodes));
      let t = list.find((x) => x.name === r.name);
      if (!t) {
        ({ template: t } = await api('/api/templates', { method: 'POST', body: { name: r.name, body: r.body, sms_body: r.sms, buttons: r.buttons, language: r.language, category: 'marketing', status: 'approved' } }));
      } else if (isReadyText(t.body) && t.body !== r.body) {
        ({ template: t } = await api(`/api/templates/${t.id}`, { method: 'PUT', body: { ...t, body: r.body, sms_body: r.sms } }));
      }
      navigate(`/templates/${t.id}`);
    } catch (e) {
      toast(e.message, 'bad');
      setBusy(null);
    }
  }

  const own = (list || []).filter((t) => !READY_NAMES.has(t.name));
  // With WhatsApp connected, "approved" means approved by Meta: only those can be sent.
  const needsMeta = Boolean(settings?.metaTemplatesReady);
  const ok = (t) => (needsMeta ? isApproved(t) : t.status === 'approved');
  const all = [...own, ...(list || []).filter((t) => READY_NAMES.has(t.name))];
  const nApproved = all.filter(ok).length;
  // Approved ones first, so the ones that can be sent are easy to find.
  const shown = all.filter((t) => matches(q, t.name, t.body) && (show === 'all' || (show === 'approved') === ok(t)))
    .sort((a, b) => ok(b) - ok(a));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <p>The wording you send again and again. Each customer gets their own name and details.</p>
        </div>
        {canWrite && <Link to="/templates/new" className="btn primary"><Plus size={18} />New template</Link>}
      </div>

      <div className="list-tools card" style={{ marginBottom: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search templates by name or words" style={{ flex: '1 1 260px' }} />
        <div className="chips">
          {[
            ['all', 'All', all.length],
            ['approved', needsMeta ? 'Approved by Meta' : 'Ready', nApproved],
            ['waiting', needsMeta ? 'Not approved yet' : 'Not ready yet', all.length - nApproved],
          ].map(([k, label, n]) => (
            <button key={k} type="button" className={`chip ${show === k ? 'on' : ''}`} onClick={() => setShow(k)}>{label}{list ? ` (${n})` : ''}</button>
          ))}
        </div>
      </div>

      {canWrite && !q && show === 'all' && <div className="card card-pad stack" style={{ gap: 12 }}>
        <h2>Ready-made</h2>
        <div className="ready-grid">
          {READY_MESSAGES.map((m) => (
            <button key={m.key} type="button" className="ready-card" onClick={() => openReady(m)} disabled={!list || busy}>
              {busy === m.key ? <Spinner /> : <Pic name={m.pic} size={40} />}
              <b>{m.title}</b>
              <span className="subtle">{m.when}</span>
            </button>
          ))}
        </div>
      </div>}

      <div className="row between wrap" style={{ margin: '20px 0 10px', gap: 8 }}>
        <h2>Your templates</h2>
        {canWrite && <Link to="/templates/new" className="btn sm"><Plus size={16} />New template</Link>}
      </div>
      {!canWrite && <p className="subtle" style={{ marginTop: -4, marginBottom: 12 }}>Only the store manager or owner can add or change templates.</p>}
      {needsMeta && <p className="subtle" style={{ marginTop: -4, marginBottom: 12 }}>Only templates <b>approved by Meta</b> can be sent. Open a template and press “Save and send to Meta”; the status updates by itself.</p>}
      {!list ? (
        <div className="card stack" style={{ padding: 20 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={44} />)}</div>
      ) : list.length === 0 && !canWrite ? (
        <div className="card card-pad subtle">No templates yet.</div>
      ) : (
        <div className="card">
          <div className="tpl-table" role="table" aria-label="Your templates">
            <div className="tpl-row tpl-head" role="row">
              <span role="columnheader">Template</span>
              <span role="columnheader">Has</span>
              <span role="columnheader">{needsMeta ? 'Meta approval' : 'Status'}</span>
              <span role="columnheader">Used</span>
              <span role="columnheader" />
            </div>
            {list.length > 0 && shown.length === 0 && <p className="subtle" style={{ padding: 20 }}>No template matches. Try other words, or make a new one.</p>}
            {list.length === 0 && <p className="subtle" style={{ padding: 20 }}>No templates yet. Make one with “New template”, or start from a ready-made one above.</p>}
            {shown.map((t) => {
              const [tone, label] = needsMeta ? META_BADGE[metaState(t)] : STATUS[t.status] || ['neutral', t.status];
              return (
                <div key={t.id} className={`tpl-row ${ok(t) ? 'tpl-ok' : ''}`} role="row" onClick={() => navigate(`/templates/${t.id}`)}>
                  <span className="tpl-cell-name" role="cell">
                    <span className="row" style={{ gap: 8, minWidth: 0 }}>
                      <Pic name={iconFor(t.name)} size={26} />
                      <b className="ellipsis">{t.name}</b>
                    </span>
                    <span className="tpl-preview">{toFriendly(t.body).replace(/\s*\n+\s*/g, ' ')}</span>
                  </span>
                  <span className="tpl-has" role="cell">
                    {t.video_url && <span title="Video"><Film size={16} />Video</span>}
                    {t.image_url && <span title="Photo"><Image size={16} />Photo</span>}
                    {t.buttons.length > 0 && <span title={t.buttons.map((b) => b.text).join(', ')}><MousePointerClick size={16} />{t.buttons.length === 1 ? t.buttons[0].text : `${t.buttons.length} buttons`}</span>}
                    {!t.video_url && !t.image_url && !t.buttons.length && <span className="subtle">Text only</span>}
                  </span>
                  <span role="cell">
                    <span className={`badge ${tone}`}>{tone === 'ok' && <Check size={13} />}{label}</span>
                    {needsMeta && metaState(t) === 'waiting' && <span className="subtle tpl-note">Updates by itself</span>}
                    {needsMeta && metaState(t) === 'rejected' && t.provider_reason && <span className="subtle tpl-note">{t.provider_reason}</span>}
                  </span>
                  <span className="subtle tpl-used" role="cell">{t.used_in ? `${t.used_in} time${t.used_in > 1 ? 's' : ''}` : 'Not yet'}<br />Updated {dateOnly(t.updated_at)}</span>
                  <span className="tpl-actions" role="cell" onClick={(e) => e.stopPropagation()}>
                    {asking === t.id ? (
                      <>
                        <span className="subtle">Delete?</span>
                        <button type="button" className="btn sm" onClick={() => setAsking(null)}>Keep</button>
                        <button type="button" className="btn sm danger" onClick={() => removeTemplate(t)}>Yes, delete</button>
                      </>
                    ) : (
                      <>
                        {ok(t) && <Link to={`/campaigns/new?template=${t.id}`} className="btn sm primary"><Send size={14} />Use</Link>}
                        <Link to={`/templates/${t.id}`} className="btn sm ghost"><Pencil size={14} />Edit</Link>
                        {canWrite && <button type="button" className="btn sm ghost danger" onClick={() => setAsking(t.id)} aria-label={`Delete ${t.name}`}><Trash2 size={14} /></button>}
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
