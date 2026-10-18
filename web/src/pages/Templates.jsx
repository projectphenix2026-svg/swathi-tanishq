import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, Phone, Plus, Reply } from 'lucide-react';
import { api } from '../lib/api.js';
import { Pic, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { Highlighted } from '../components/PhonePreview.jsx';
import { dateOnly } from '../lib/format.js';
import { toFriendly } from '../lib/friendly.js';
import { OLD_READY_BODIES, READY_MESSAGES } from '../lib/ready.js';
import { LANGS, readyIn } from '../lib/ready-lang.js';

const STATUS = { approved: ['ok', 'Ready'], draft: ['neutral', 'Not finished'], rejected: ['bad', 'Needs a change'] };
const READY_NAMES = new Set(READY_MESSAGES.flatMap((m) => LANGS.map((l) => readyIn(m, l.code).name)));

/** Templates: the wording you reuse. Ready-made ones and the shop's own, in one place. */
export default function Templates() {
  const [list, setList] = useState(null);
  const [lang, setLang] = useState('en');
  const [busy, setBusy] = useState(null);
  const navigate = useNavigate();
  const toast = useToast();
  useEffect(() => {
    api('/api/templates').then((r) => setList(r.templates)).catch(() => setList([]));
  }, []);

  // A ready-made template is saved the first time it is opened, then edited like any other.
  async function openReady(m) {
    setBusy(m.key);
    try {
      const r = readyIn(m, lang);
      let t = list.find((x) => x.name === r.name);
      if (!t) {
        ({ template: t } = await api('/api/templates', { method: 'POST', body: { name: r.name, body: r.body, sms_body: r.sms, buttons: r.buttons, language: r.language, category: 'marketing', status: 'approved' } }));
      } else if (OLD_READY_BODIES.has(t.body)) {
        ({ template: t } = await api(`/api/templates/${t.id}`, { method: 'PUT', body: { ...t, body: r.body, sms_body: t.sms_body || r.sms } }));
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

      <div className="card card-pad stack" style={{ gap: 12 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <h2>Ready-made</h2>
          <div className="lang-switch" role="group" aria-label="Template language">
            {LANGS.map((l) => (
              <button key={l.code} type="button" className={lang === l.code ? 'on' : ''} onClick={() => setLang(l.code)} aria-pressed={lang === l.code}>{l.label}</button>
            ))}
          </div>
        </div>
        <div className="ready-grid">
          {READY_MESSAGES.map((m) => (
            <button key={m.key} type="button" className="ready-card" onClick={() => openReady(m)} disabled={!list || busy}>
              {busy === m.key ? <Spinner /> : <Pic name={m.pic} size={40} />}
              <b>{m.title}</b>
              <span className="subtle">{m.when}</span>
            </button>
          ))}
        </div>
      </div>

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
          {[...own, ...list.filter((t) => READY_NAMES.has(t.name))].map((t) => {
            const [tone, label] = STATUS[t.status] || ['neutral', t.status];
            return (
              <Link key={t.id} to={`/templates/${t.id}`} className="card card-pad stack" style={{ textDecoration: 'none', color: 'inherit', gap: 10 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{t.name}</h3>
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
