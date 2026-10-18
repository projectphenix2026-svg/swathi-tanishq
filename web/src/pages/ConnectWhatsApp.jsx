// Owner-only: connect the shop's own WhatsApp (Meta) account, check it, and switch real sending on.
// The key is sent once to the server, stored encrypted there, and never shown again.
import { useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Link2, Power, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Field, Pic, Spinner, useToast } from '../components/ui.jsx';
import { dateOnly } from '../lib/format.js';

export function ConnectWhatsApp() {
  const toast = useToast();
  const { reloadSettings } = useAuth();
  const [c, setC] = useState(null);
  const [f, setF] = useState({ phoneNumberId: '', wabaId: '', token: '', appSecret: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [askOff, setAskOff] = useState(false);

  useEffect(() => {
    api('/api/whatsapp').then((r) => {
      setC(r);
      setF((x) => ({ ...x, phoneNumberId: r.phoneNumberId, wabaId: r.wabaId }));
      setEditing(!r.connected);
    }).catch(() => setC({ error: true }));
  }, []);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function connect() {
    setBusy('connect');
    setError('');
    try {
      const r = await api('/api/whatsapp/connect', { method: 'POST', body: f });
      setC(r);
      setWarnings(r.warnings || []);
      setF((x) => ({ ...x, token: '', appSecret: '' }));
      setEditing(false);
      toast('WhatsApp account connected');
      reloadSettings();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function setLive(live) {
    setBusy('live');
    try {
      const r = await api('/api/whatsapp/live', { method: 'POST', body: { live } });
      setC(r);
      setAskOff(false);
      toast(live ? 'Real sending is on' : 'Back to test mode: nothing is sent');
      reloadSettings();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy('');
    }
  }

  async function disconnect() {
    if (!confirm('Remove the WhatsApp account from the app? It goes back to test mode.')) return;
    setBusy('remove');
    try {
      setC(await api('/api/whatsapp', { method: 'DELETE' }));
      setEditing(true);
      setWarnings([]);
      toast('Disconnected');
      reloadSettings();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy('');
    }
  }

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Select the text and copy it', 'info'));
  };

  if (!c) return <div className="card card-pad"><Spinner /></div>;
  if (c.error) return <Alert tone="bad">Could not load the WhatsApp connection. Refresh the page.</Alert>;

  return (
    <div className="card" id="connect-whatsapp">
      <div className="card-head">
        <div className="row" style={{ gap: 12 }}>
          <Pic name="speech" size={40} />
          <div>
            <h2>Connect WhatsApp</h2>
            <p className="subtle" style={{ margin: 0 }}>The shop’s own WhatsApp Business account from Meta. Only the owner sees this.</p>
          </div>
        </div>
        <span className={`badge ${c.live ? 'ok' : c.connected ? 'info' : 'warn'}`}>{c.live ? 'Sending real messages' : c.connected ? 'Connected · test mode' : 'Not connected'}</span>
      </div>

      <div className="stack" style={{ padding: 20 }}>
        {c.connected && (
          <div className="row wrap" style={{ gap: 16 }}>
            <div className="stack-sm" style={{ flex: '1 1 240px' }}>
              <b style={{ fontSize: '1.05rem' }}>{c.name || 'WhatsApp number'} · {c.phone || c.phoneNumberId}</b>
              <span className="subtle">
                Key {c.tokenHint} · {c.tokenExpiresAt ? `stops working ${dateOnly(c.tokenExpiresAt)}` : 'permanent'}
                {c.quality ? ` · quality ${c.quality.toLowerCase()}` : ''} · checked {dateOnly(c.checkedAt)}
              </span>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn" onClick={() => setEditing((x) => !x)}><RefreshCw size={16} />Change details</button>
              <button className="btn ghost danger" onClick={disconnect} disabled={busy === 'remove'}><Trash2 size={16} />Disconnect</button>
            </div>
          </div>
        )}

        {warnings.map((w) => <Alert key={w} tone="warn">{w}</Alert>)}

        {editing && (
          <div className="stack">
            <Alert tone="info">
              Copy these from Meta: <b>WhatsApp Manager → API setup</b> (Phone number ID and WhatsApp Business account ID), the <b>permanent key</b> from
              Business settings → System users, and the <b>App secret</b> from your Meta app → App settings → Basic. The setup guide shows each screen.
            </Alert>
            <div className="form-grid two">
              <Field label="Phone number ID" hint="About 15 digits, e.g. 1451515154704049">
                <input className="input" inputMode="numeric" value={f.phoneNumberId} onChange={set('phoneNumberId')} autoComplete="off" />
              </Field>
              <Field label="WhatsApp Business account ID" hint="About 15 digits, e.g. 1435002108077203">
                <input className="input" inputMode="numeric" value={f.wabaId} onChange={set('wabaId')} autoComplete="off" />
              </Field>
            </div>
            <Field label="Permanent access key" hint={c.connected ? 'Leave empty to keep the saved key.' : 'Starts with EAA… Paste the whole key.'}>
              <div className="row" style={{ gap: 8 }}>
                <input className="input" type={show ? 'text' : 'password'} value={f.token} onChange={set('token')} autoComplete="off" spellCheck={false} placeholder={c.connected ? `Saved key ${c.tokenHint}` : 'EAA…'} />
                <button type="button" className="icon-btn" onClick={() => setShow((x) => !x)} aria-label={show ? 'Hide key' : 'Show key'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
            </Field>
            <Field label="App secret (for replies and delivery ticks)" hint={c.hasAppSecret ? 'Saved. Leave empty to keep it.' : 'Meta app → App settings → Basic → App secret → Show.'}>
              <input className="input" type="password" value={f.appSecret} onChange={set('appSecret')} autoComplete="off" placeholder={c.hasAppSecret ? 'Saved' : ''} />
            </Field>
            {error && <Alert tone="bad">{error}</Alert>}
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              {c.connected && <button className="btn" onClick={() => setEditing(false)}>Cancel</button>}
              <button className="btn primary lg" onClick={connect} disabled={busy === 'connect' || !f.phoneNumberId || !f.wabaId || (!c.connected && !f.token)}>
                {busy === 'connect' ? <Spinner /> : <><Link2 size={18} />Test and connect</>}
              </button>
            </div>
          </div>
        )}

        {c.connected && (
          <div className="card" style={{ background: 'var(--surface-2)', padding: 14 }}>
            <b>Replies and delivery ticks</b>
            <p className="subtle" style={{ margin: '4px 0 10px' }}>In your Meta app → WhatsApp → Configuration → Webhook → Edit, paste these two, then tick <b>messages</b>.</p>
            <div className="stack-sm">
              <CopyRow label="Callback URL" value={c.webhookUrl} onCopy={copy} />
              <CopyRow label="Verify token" value={c.verifyToken} onCopy={copy} />
            </div>
          </div>
        )}

        {c.connected && (
          c.live ? (
            askOff ? (
              <Alert tone="warn" action={<div className="row" style={{ gap: 8 }}><button className="btn" onClick={() => setAskOff(false)}>Keep on</button><button className="btn danger" onClick={() => setLive(false)} disabled={busy === 'live'}>Yes, stop</button></div>}>
                Stop real sending? Offers will go back to test mode and nothing reaches phones.
              </Alert>
            ) : (
              <div className="row between wrap" style={{ gap: 10 }}>
                <span className="row" style={{ gap: 8 }}><Check size={18} style={{ color: 'var(--ok)' }} /><b>Real messages are going out from {c.phone || 'this number'}.</b></span>
                <button className="btn" onClick={() => setAskOff(true)}><Power size={16} />Back to test mode</button>
              </div>
            )
          ) : (
            <div className="alert warn" style={{ alignItems: 'center' }}>
              <div style={{ flex: 1 }}><b>Ready when you are.</b> Until you switch this on, the app stays in test mode and nothing reaches customers. Send a test to your own phone first.</div>
              <button className="btn wa lg" onClick={() => setLive(true)} disabled={busy === 'live'}>{busy === 'live' ? <Spinner /> : <><Power size={18} />Start real sending</>}</button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function CopyRow({ label, value, onCopy }) {
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <span className="subtle" style={{ width: 110 }}>{label}</span>
      <code style={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere', background: 'var(--surface)', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>{value}</code>
      <button className="btn sm" onClick={() => onCopy(value)}><Copy size={14} />Copy</button>
    </div>
  );
}
