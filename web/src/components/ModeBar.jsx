import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dateTime } from '../lib/format.js';
import { useT } from '../lib/i18n.jsx';
import { atLeast } from '@shared/roles.js';

/**
 * The bar at the top of every screen that says which mode the app is in, so nobody is unsure:
 * Test mode (yellow, nothing reaches phones) or Live (green, messages go to real customers).
 */
export function ModeBar({ settings, paused, onResumed }) {
  const { t } = useT();
  if (!settings) return null;
  const p = settings.provider;
  const owner = atLeast(settings.role, 'owner');
  if (paused) return <Disconnected paused={paused} owner={owner} onResumed={onResumed} />;
  if (p.name === 'mock') {
    return (
      <div className="mode-bar test" role="status">
        <b>{t('Test mode')}</b>
        <span>{t('Messages are pretend: nothing reaches real phones.')}</span>
        {owner && <Link to="/settings#go-live">{t('Go live')} →</Link>}
      </div>
    );
  }
  if (p.missing.length) {
    return (
      <div className="mode-bar bad" role="status">
        <b>{t('WhatsApp not connected')}</b>
        {owner && <Link to="/settings#go-live">{t('Fix in Settings')} →</Link>}
      </div>
    );
  }
  return (
    <div className="mode-bar live" role="status">
      <b>{t('Live')}</b>
      <span>{t('Messages go to real customers.')}</span>
    </div>
  );
}

/** Red bar while Meta says the shop's number is off the WhatsApp API: sending is paused. */
function Disconnected({ paused, owner, onResumed }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  async function resume() {
    setBusy(true);
    try {
      const r = await api('/api/whatsapp/resume', { method: 'POST' });
      setNote(r.requeued ? `Sending again: ${r.requeued} waiting message(s) are going out.` : 'Sending again.');
      onResumed?.();
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mode-bar bad disconnected" role="alert">
      <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
        <b>WhatsApp number disconnected from Meta</b>
        <span>Sending is paused since {dateTime(paused.since)}. Messages are waiting and go out once it is reconnected.</span>
        <button type="button" className="link-btn" onClick={() => setOpen((x) => !x)}>{open ? 'Hide steps' : 'How to reconnect'}</button>
        {owner && <button type="button" className="btn sm" disabled={busy} onClick={resume}>I’ve reconnected: resume</button>}
      </div>
      {open && (
        <ol className="dc-steps">
          <li>On the shop phone, open <b>WhatsApp Business → Settings → Account</b> and check it is still linked to the <b>WhatsApp Business Platform</b>. Ask whether WhatsApp was reinstalled or re-verified.</li>
          <li>On <b>business.facebook.com → WhatsApp Manager → Phone numbers</b>, check the number’s status.</li>
          <li>If it shows disconnected, connect it again with “connect your existing WhatsApp Business app number” (scan the QR code with the shop phone).</li>
          <li>Come back here and press <b>I’ve reconnected: resume</b>{owner ? '' : ' (the owner can do this)'}. Sandesh also checks with Meta every 5 minutes and resumes by itself.</li>
        </ol>
      )}
      {note && <div className="dc-note">{note}</div>}
      <span className="subtle dc-code">Meta error #{paused.code}</span>
    </div>
  );
}
