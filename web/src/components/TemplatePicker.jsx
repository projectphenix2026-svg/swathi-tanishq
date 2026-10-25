import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus, Search, X } from 'lucide-react';
import { Pic } from './ui.jsx';
import { Highlighted } from './PhonePreview.jsx';
import { toFriendly } from '../lib/friendly.js';
import { META_BADGE } from '../lib/approval.js';

/**
 * Choosing a template: the chosen one is shown with its text, and "Search templates" opens a
 * window to find any template by name or words, with the ready-made ones and the shop's own
 * in one list. items: [{ key, name, body, pic, ready, meta }]
 * meta (only once WhatsApp is connected): Meta's approval, see lib/approval.js. Only approved
 * templates can be picked; the rest are listed greyed out with their status.
 */
export function TemplateChooser({ items, chosenKey, onPick, busyKey, t = (s) => s }) {
  const [open, setOpen] = useState(false);
  const chosen = items.find((i) => i.key === chosenKey);
  const popular = items.filter((i) => i.ready && canPick(i)).slice(0, 6);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {chosen ? (
        <div className="tpl-chosen">
          <span className="row" style={{ gap: 8 }}>
            <Pic name={chosen.pic || 'memo'} size={30} />
            <b style={{ flex: 1, minWidth: 0 }}>{chosen.name}</b>
            <button type="button" className="btn sm" onClick={() => setOpen(true)}><Search size={15} />{t('Change template')}</button>
          </span>
          <span className="tpl-text"><Highlighted body={toFriendly(chosen.body).replace(/\n{2,}/g, '\n')} /></span>
        </div>
      ) : (
        <button type="button" className="tpl-search-btn" onClick={() => setOpen(true)}>
          <Search size={20} />
          <span><b>{t('Search templates')}</b><span className="subtle" style={{ display: 'block' }}>{t('Find one by name or words, e.g. “Diwali” or “bridal”.')}</span></span>
        </button>
      )}
      {!chosen && popular.length > 0 && (
        <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
          <span className="subtle">{t('Popular:')}</span>
          {popular.map((i) => (
            <button key={i.key} type="button" className="chip" onClick={() => onPick(i)} disabled={Boolean(busyKey)}>{i.title || i.name}</button>
          ))}
        </div>
      )}
      {!chosen && (
        <Link to="/templates/new" className="tpl-new-link"><Plus size={18} />{t('Write a new template')}<span className="subtle">{t('It comes straight back here when you save it.')}</span></Link>
      )}
      {open && <TemplateSearch items={items} chosenKey={chosenKey} busyKey={busyKey} t={t} onClose={() => setOpen(false)} onPick={(i) => { onPick(i); setOpen(false); }} />}
    </div>
  );
}

const canPick = (i) => !i.meta || i.meta === 'approved';

function TemplateSearch({ items, chosenKey, onPick, onClose, t }) {
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items
      .filter((i) => show === 'all' || (show === 'ready') === Boolean(i.ready))
      .filter((i) => words.every((w) => `${i.name} ${i.title || ''} ${i.body}`.toLowerCase().includes(w)));
  }, [items, q, show]);
  const open = list.filter(canPick);
  const locked = list.filter((i) => !canPick(i));
  const row = (i) => {
    const off = !canPick(i);
    const [tone, label] = i.meta ? META_BADGE[i.meta] : [];
    return (
      <button key={i.key} type="button" className={`tpl-result ${i.key === chosenKey ? 'on' : ''}`} onClick={() => onPick(i)} disabled={off}
        title={off ? t('Meta has not approved this template yet, so it cannot be sent.') : undefined}>
        <Pic name={i.pic || 'memo'} size={30} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="row wrap" style={{ gap: 6 }}>
            <b>{i.name}</b>
            {i.ready && <span className="badge neutral">{t('Ready-made')}</span>}
            {i.meta && <span className={`badge ${tone}`}>{tone === 'ok' && <Check size={12} />}{t(label)}</span>}
          </span>
          <span className="tpl-text short"><Highlighted body={toFriendly(i.body).replace(/\s*\n+\s*/g, ' ')} /></span>
        </span>
        {i.key === chosenKey && <Check size={18} style={{ color: 'var(--brand)', flexShrink: 0 }} />}
      </button>
    );
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tpl-modal" role="dialog" aria-modal="true" aria-label={t('Search templates')}>
        <div className="modal-head">
          <h2>{t('Search templates')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="tpl-modal-tools">
          <div className="input-icon">
            <Search size={16} />
            <input ref={input} id="tpl-search" className="input" placeholder={t('Search by name or words in the message')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="chips">
            {[['all', 'All'], ['ready', 'Ready-made'], ['own', 'Your templates']].map(([k, label]) => (
              <button key={k} type="button" className={`chip ${show === k ? 'on' : ''}`} onClick={() => setShow(k)}>{t(label)}</button>
            ))}
          </div>
        </div>
        <div className="tpl-results">
          {list.length === 0 ? (
            <p className="subtle" style={{ padding: 16 }}>{t('No template matches. Try other words, or make a new one.')}</p>
          ) : (
            <>
              {open.length === 0 && <p className="subtle" style={{ padding: '8px 4px' }}>{t('No approved template matches yet.')}</p>}
              {open.map(row)}
              {locked.length > 0 && (
                <>
                  <div className="tpl-group">{t('Not approved by Meta yet: cannot be sent')}</div>
                  <p className="subtle" style={{ margin: '0 4px 4px', fontSize: '0.82rem' }}>{t('Open it on the Templates page and press “Submit to Meta”. Approval usually takes minutes to a few hours.')}</p>
                  {locked.map(row)}
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-foot" style={{ justifyContent: 'space-between' }}>
          <Link to="/templates/new" className="btn ghost"><Plus size={16} />{t('New template')}</Link>
          <button className="btn" onClick={onClose}>{t('Close')}</button>
        </div>
      </div>
    </div>
  );
}
