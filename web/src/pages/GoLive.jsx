import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Power } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Spinner, useToast } from '../components/ui.jsx';
import { dateTime } from '../lib/format.js';

/**
 * Owner's checklist from Test mode to real sending: Meta business verification, connecting
 * WhatsApp, approved templates, a real test to the owner's phone, then Live.
 */
export function GoLive({ onChange }) {
  const toast = useToast();
  const { reloadSettings } = useAuth();
  const [c, setC] = useState(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => api('/api/whatsapp').then(setC).catch(() => setC({ connected: false, live: false, ready: { templates: {} } }));
  useEffect(() => {
    load();
  }, []);

  async function setLive(live) {
    setBusy(true);
    try {
      const r = await api('/api/whatsapp/live', { method: 'POST', body: { live } });
      toast(live ? `You are live${r.removedSamples ? `; ${r.removedSamples} sample customers removed` : ''}` : 'Back to Test mode: nothing reaches phones');
      setAsk(false);
      await load();
      reloadSettings?.();
      onChange?.();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  if (!c) return <div className="card card-pad" id="go-live"><Spinner /></div>;
  const t = c.ready?.templates || {};
  const steps = [
    { done: c.connected, title: 'Business verified with Meta', text: 'Meta checks the shop’s documents (1–3 days). Follow Part A of the guide.' },
    { done: c.connected, title: 'Connect WhatsApp', text: c.connected ? `Connected${c.phone ? `: ${c.phone}` : ''}` : 'Paste the four details from Meta below and press Test and connect.', action: !c.connected && <a href="#connect-whatsapp" className="btn sm">Connect below</a> },
    { done: t.approved > 0, title: 'Templates approved by WhatsApp', text: t.total ? `${t.approved || 0} approved, ${t.waiting || 0} waiting` : 'Send your templates for approval.', action: <Link to="/templates" className="btn sm">Templates</Link> },
    { done: Boolean(c.ready?.testSentAt), title: 'Send a real test to your own phone', text: c.ready?.testSentAt ? `Sent ${dateTime(c.ready.testSentAt)}` : 'In Send a message, use “Send a test to my phone”.', action: c.connected && !c.ready?.testSentAt && <Link to="/campaigns/new" className="btn sm">Send a test</Link> },
  ];
  return (
    <div className={`card card-pad go-live ${c.live ? 'is-live' : ''}`} id="go-live">
      <div className="row between wrap" style={{ gap: 8 }}>
        <h2>{c.live ? 'You are live' : 'Go live'}</h2>
        <span className={`badge ${c.live ? 'ok' : 'warn'}`}>{c.live ? 'Live: real messages' : 'Test mode'}</span>
      </div>
      {!c.live && <p className="subtle">Four steps, then real customers get your messages. Until then everything is pretend.</p>}
      {!c.live && (
        <ol className="gl-steps">
          {steps.map((s, i) => (
            <li key={s.title} className={s.done ? 'done' : ''}>
              <span className="tick">{s.done ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b>{s.title}</b><span className="subtle" style={{ display: 'block' }}>{s.text}</span></span>
              {!s.done && s.action}
            </li>
          ))}
        </ol>
      )}
      {c.live ? (
        ask ? (
          <div className="alert warn row wrap" style={{ gap: 8 }}>
            <span style={{ flex: '1 1 220px' }}>Stop real sending? Messages become pretend again until you go live.</span>
            <button className="btn" onClick={() => setAsk(false)}>Keep live</button>
            <button className="btn danger" onClick={() => setLive(false)} disabled={busy}>{busy ? <Spinner /> : 'Back to Test mode'}</button>
          </div>
        ) : (
          <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAsk(true)}>Pause: back to Test mode</button>
        )
      ) : ask ? (
        <div className="alert warn row wrap" style={{ gap: 8 }}>
          <span style={{ flex: '1 1 220px' }}><b>Real customers will get messages from now on.</b> Sample customers are removed.</span>
          <button className="btn" onClick={() => setAsk(false)}>Not yet</button>
          <button className="btn wa" onClick={() => setLive(true)} disabled={busy}>{busy ? <Spinner /> : 'Yes, go live'}</button>
        </div>
      ) : (
        <button className="btn wa lg" style={{ alignSelf: 'flex-start' }} disabled={!c.connected} onClick={() => setAsk(true)}>
          <Power size={18} />Go live
        </button>
      )}
    </div>
  );
}
