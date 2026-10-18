import { useEffect, useState } from 'react';
import { MessageSquareText, ShieldCheck, Smartphone, UserPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Avatar, Field, Modal, Spinner, useToast } from '../components/ui.jsx';
import { dateOnly, rate } from '../lib/format.js';
import { ConnectWhatsApp } from './ConnectWhatsApp.jsx';
import { YourData } from './YourData.jsx';
import { GoLive } from './GoLive.jsx';

const ROLE_TEXT = {
  admin: 'Everything, including staff, settings and approving big sends',
  manager: 'Customers, templates, offers and wishes',
  viewer: 'Reports, replies, call back list and sales codes; cannot send offers',
};

export default function Settings() {
  const { settings, user, reloadSettings } = useAuth();
  const isAdmin = settings?.role === 'admin';
  const [version, setVersion] = useState(0);
  // Links like /settings#go-live scroll to that card once the page has drawn.
  useEffect(() => {
    if (!window.location.hash) return undefined;
    const timer = setTimeout(() => document.querySelector(window.location.hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Going live, the shop’s WhatsApp account, limits that protect the number, and staff logins.</p>
        </div>
      </div>
      <div className="stack">
        {isAdmin && <GoLive onChange={() => setVersion((v) => v + 1)} />}
        {isAdmin && <ConnectWhatsApp key={version} />}
        <Channels settings={settings} />
        {isAdmin && <SalesCodes settings={settings} onChange={reloadSettings} />}
        <Limits isAdmin={isAdmin} settings={settings} />
        {isAdmin && <YourData lastExportAt={settings?.lastExportAt} onDone={reloadSettings} />}
        {isAdmin ? <Staff me={user} /> : <Alert>Only the owner (an admin) can change limits and staff logins. Your role: <b>{settings?.role}</b>.</Alert>}
      </div>
    </div>
  );
}

/** Optional: a code in each message that staff type at the counter, to see which message brought a sale. */
function SalesCodes({ settings, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!settings) return null;
  async function toggle(on) {
    setBusy(true);
    try {
      await api('/api/dashboard/settings/sales-codes', { method: 'PUT', body: { on } });
      toast(on ? 'Sales codes switched on' : 'Sales codes switched off');
      onChange?.();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card card-pad">
      <label className="check">
        <span className="switch"><input type="checkbox" checked={settings.salesCodes} disabled={busy} onChange={(e) => toggle(e.target.checked)} /><span /></span>
        <span>
          <b>Sales codes</b>
          <span className="hint" style={{ display: 'block' }}>
            Adds a code to each customer’s message (for example PRIYA-DIWALI-4821). When the customer shows it at billing, staff type it under Sales codes, and you see which message brought the sale. Off: no codes, and no Sales codes page.
          </span>
        </span>
      </label>
    </div>
  );
}

function Channels({ settings }) {
  if (!settings) return null;
  const wa = settings.provider;
  const sms = settings.sms;
  return (
    <div className="card">
      <div className="card-head"><h2>Channels</h2></div>
      <div className="list-item">
        <span className="kpi-icon tone-wa" style={{ width: 40, height: 40, borderRadius: 12 }}><Smartphone size={20} /></span>
        <div style={{ flex: 1 }}>
          <b>WhatsApp</b>
          <div className="subtle">{wa.name === 'mock' ? 'Test mode: nothing is sent' : wa.label} · {rate(settings.costPerMessage)} per marketing message</div>
          {wa.name === 'mock' && <div className="subtle">The owner connects the shop’s WhatsApp above, under Connect WhatsApp.</div>}
        </div>
        <span className={`badge ${wa.missing.length ? 'bad' : wa.name === 'mock' ? 'warn' : 'ok'}`}>{wa.missing.length ? 'Not set up' : wa.name === 'mock' ? 'Test mode' : 'Connected'}</span>
      </div>
      <div className="list-item">
        <span className="kpi-icon tone-info" style={{ width: 40, height: 40, borderRadius: 12 }}><MessageSquareText size={20} /></span>
        <div style={{ flex: 1 }}>
          <b>SMS backup</b>
          <div className="subtle">{sms.live ? `${sms.label} · ${rate(sms.costPerSms)} per SMS` : 'Preview: the app records exactly what would be sent. Switch on after DLT registration (SMS_MODE=msg91).'}</div>
        </div>
        <span className={`badge ${sms.missing.length ? 'bad' : sms.live ? 'ok' : 'warn'}`}>{sms.missing.length ? 'Not set up' : sms.live ? 'Live' : 'Preview'}</span>
      </div>
      <div className="list-item">
        <span className="kpi-icon tone-brand" style={{ width: 40, height: 40, borderRadius: 12 }}><ShieldCheck size={20} /></span>
        <div style={{ flex: 1 }}>
          <b>Delivery updates and replies</b>
          <div className="subtle">{settings.webhooksReachable ? 'Webhooks are set up: delivered/read ticks and replies arrive instantly.' : 'No public address yet: replies cannot arrive and Meta read receipts are not recorded.'}</div>
        </div>
        <span className={`badge ${settings.webhooksReachable ? 'ok' : 'warn'}`}>{settings.webhooksReachable ? 'On' : 'Off'}</span>
      </div>
    </div>
  );
}

function Limits({ isAdmin, settings }) {
  const toast = useToast();
  const { reloadSettings } = useAuth();
  const [cap, setCap] = useState(settings?.weeklyCap ?? 2);
  const [threshold, setThreshold] = useState(settings?.approvalThreshold ?? 500);
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/dashboard/settings', { method: 'PUT', body: { weeklyCap: Number(cap), approvalThreshold: Number(threshold) } });
      toast('Limits saved');
      reloadSettings?.();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card card-pad stack" onSubmit={save}>
      <h2>Limits</h2>
      <div className="form-grid two">
        <Field label="Offers per customer per week" hint="Marketing messages only; birthday and anniversary greetings don’t count. 0 = no limit. Two a week keeps the WhatsApp number’s quality rating healthy.">
          <input className="input" type="number" min="0" max="14" value={cap} onChange={(e) => setCap(e.target.value)} disabled={!isAdmin} />
        </Field>
        <Field label="Needs an admin’s approval from" hint="Offers to this many customers or more, created by managers, wait for an admin to approve.">
          <input className="input" type="number" min="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={!isAdmin} />
        </Field>
      </div>
      {isAdmin && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy}>{busy ? <Spinner /> : 'Save limits'}</button></div>}
    </form>
  );
}

function Staff({ me }) {
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = () => api('/api/auth/users').then((r) => setUsers(r.users)).catch(() => setUsers([]));
  useEffect(() => {
    load();
  }, []);
  async function changeRole(u, role) {
    try {
      await api(`/api/auth/users/${u.id}`, { method: 'PATCH', body: { role } });
      toast(`${u.name} is now ${role === 'admin' ? 'an admin' : `a ${role}`}`);
      load();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
  return (
    <div className="card">
      <div className="card-head">
        <h2>Staff logins</h2>
        <button className="btn sm primary" onClick={() => setAdding(true)}><UserPlus size={16} />Add staff</button>
      </div>
      {!users ? (
        <div style={{ padding: 16 }}><Spinner /></div>
      ) : (
        users.map((u) => (
          <div key={u.id} className="list-item" style={{ flexWrap: 'wrap' }}>
            <Avatar name={u.name} seed={u.email} />
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <b>{u.name}{u.id === me.id ? ' (you)' : ''}</b>
              <div className="subtle">{u.email} · added {dateOnly(u.created_at)}</div>
            </div>
            <select className="select" style={{ width: 'auto', minHeight: 38 }} value={u.role} onChange={(e) => changeRole(u, e.target.value)} disabled={u.id === me.id} aria-label={`Role for ${u.name}`}>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
        ))
      )}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }} className="stack-sm">
        {Object.entries(ROLE_TEXT).map(([r, t]) => <span key={r} className="subtle"><b style={{ textTransform: 'capitalize', color: 'var(--text-2)' }}>{r}:</b> {t}</span>)}
      </div>
      {adding && <AddStaff onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function AddStaff({ onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'manager' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setBusy(true);
    try {
      await api('/api/auth/users', { method: 'POST', body: f });
      toast(`${f.name || f.email} can now sign in`);
      onSaved();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add staff" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Add'}</button></>}>
      <div className="stack">
        <Field label="Name"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="First password" hint="At least 8 characters. Share it with them in person; they can sign in straight away.">
          <input className="input" type="text" value={f.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Role">
          <select className="select" value={f.role} onChange={set('role')}>
            <option value="manager">Manager: {ROLE_TEXT.manager}</option>
            <option value="viewer">Viewer: {ROLE_TEXT.viewer}</option>
            <option value="admin">Admin: {ROLE_TEXT.admin}</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
