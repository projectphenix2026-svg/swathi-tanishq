import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, Phone, Plus, Reply } from 'lucide-react';
import { SearchBox, matches } from '../components/SearchBox.jsx';
import { api } from '../lib/api.js';
import { Pic, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { Highlighted } from '../components/PhonePreview.jsx';
import { dateOnly } from '../lib/format.js';
import { toFriendly } from '../lib/friendly.js';
import { READY_MESSAGES, iconFor } from '../lib/ready.js';
import { LANGS, isReadyText, readyFor, readyIn } from '../lib/ready-lang.js';
import { useAuth } from '../lib/auth.js';
import { useT } from '../lib/i18n.jsx';

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
  // Ready-made templates are shown in this person's app language.
  const { lang } = useT();
  useEffect(() => {
    api('/api/templates').then((r) => setList(r.templates)).catch(() => setList([]));
  }, []);

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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <p>The wording you send again and again. Each customer gets their own name and details.</p>
        </div>
        <Link to="/templates/new" className="btn primary"><Plus size={18} />New template</Link>
      </div>

      <div className="list-tools card" style={{ marginBottom: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search templates by name or words" style={{ flex: '1 1 260px' }} />
        <div className="chips">
          {[['all', 'All'], ['approved', 'Ready'], ['waiting', 'Not ready yet']].map(([k, label]) => (
            <button key={k} type="button" className={`chip ${show === k ? 'on' : ''}`} onClick={() => setShow(k)}>{label}</button>
          ))}
        </div>
      </div>

      {!q && show === 'all' && <div className="card card-pad stack" style={{ gap: 12 }}>
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

      <div className="row between" style={{ margin: '20px 0 10px' }}>
        <h2>Your templates</h2>
      </div>
      {!list ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {[0, 1, 2].map((i) => <div key={i} className="card card-pad"><Skeleton h={16} w="50%" /><Skeleton h={80} style={{ marginTop: 14 }} /></div>)}
        </div>
      ) : list.length === 0 ? (
        <div className="card card-pad subtle">None yet. Open a ready-made template above, or click New template.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {[...own, ...list.filter((t) => READY_NAMES.has(t.name))].filter((t) => matches(q, t.name, t.body) && (show === 'all' || (show === 'approved' ? t.status === 'approved' : t.status !== 'approved'))).length === 0 && (
            <p className="subtle">No template matches. Try other words, or make a new one.</p>
          )}
          {[...own, ...list.filter((t) => READY_NAMES.has(t.name))].filter((t) => matches(q, t.name, t.body) && (show === 'all' || (show === 'approved' ? t.status === 'approved' : t.status !== 'approved'))).map((t) => {
            const [tone, label] = STATUS[t.status] || ['neutral', t.status];
            return (
              <Link key={t.id} to={`/templates/${t.id}`} className="card card-pad stack" style={{ textDecoration: 'none', color: 'inherit', gap: 10 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <span className="row" style={{ gap: 8, minWidth: 0 }}><Pic name={iconFor(t.name)} size={28} /><h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{t.name}</h3></span>
                  <span className={`badge ${tone}`}>{label}</span>
                </div>
                <div style={{ background: 'var(--wa-chat)', borderRadius: 12, padding: 10 }}>
                  <div className="bubble" style={{ maxWidth: '100%', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    <Highlighted body={toFriendly(t.body)} />
                  </div>
                  {t.buttons.length > 0 && (
                    <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                      {t.buttons.map((b, i) => (
                        <span key={i} className="wa-btn" style={{ padding: '5px 10px', fontSize: '0.8rem' }}>
                          {b.type === 'url' ? <ExternalLink size={13} /> : b.type === 'phone' ? <Phone size={13} /> : <Reply size={13} />}{b.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="subtle">Updated {dateOnly(t.updated_at)}{t.used_in ? ` · sent ${t.used_in} time${t.used_in > 1 ? 's' : ''}` : ''}</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
