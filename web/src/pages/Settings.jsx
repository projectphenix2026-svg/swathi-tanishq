import { useEffect, useState } from 'react';
import { KeyRound, UserMinus, UserPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Avatar, Field, Modal, Pic, Spinner, useToast } from '../components/ui.jsx';
import { dateOnly, rate } from '../lib/format.js';
import { SCREEN_LANGS, useT } from '../lib/i18n.jsx';
import { ConnectWhatsApp } from './ConnectWhatsApp.jsx';
import { YourData } from './YourData.jsx';
import { GoLive } from './GoLive.jsx';

// Settings in sections: a menu on the left (chips on phones) and one section at a time.
// The owner sees every section; staff see their own account and the shop's sending rules.
const SECTIONS = [
  { id: 'go-live', label: 'WhatsApp and going live', pic: 'speech', owner: true },
  { id: 'messages', label: 'Message rules', pic: 'megaphone' },
  { id: 'staff', label: 'Staff', pic: 'people', owner: true },
  { id: 'your-data', label: 'Your data', pic: 'chart', owner: true },
  { id: 'account', label: 'My account', pic: 'gear' },
];
// Two everyday roles: the owner (everything) and staff (send, customers, replies). "View only"
// stays for logins that already have it.
const ROLES = [
  { value: 'admin', label: 'Owner', text: 'Everything: going live, settings, staff, approving big sends.' },
  { value: 'manager', label: 'Staff', text: 'Sends messages, adds customers, answers replies, records sales codes.' },
  { value: 'viewer', label: 'View only', text: 'Sees reports and replies; cannot send.' },
];

export default function Settings() {
  const { settings, user, reloadSettings } = useAuth();
  const isOwner = settings?.role === 'admin';
  const sections = SECTIONS.filter((s) => isOwner || !s.owner);
  const fromHash = () => {
    const h = window.location.hash.slice(1);
    return sections.some((s) => s.id === h) ? h : h === 'connect-whatsapp' ? 'go-live' : sections[0].id;
  };
  const [section, setSection] = useState(fromHash);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    // Owner-only sections appear once the login's role has loaded; pick the right one again.
    setSection(fromHash());
    const onHash = () => setSection(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);
  const open = (id) => {
    setSection(id);
    window.history.replaceState(null, '', `#${id}`);
  };
  const current = sections.find((s) => s.id === section) || sections[0];

  return (
    <div className="page settings-page">
      <div className="page-head compact"><h1>Settings</h1></div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map((s) => (
            <button key={s.id} type="button" className={s.id === current.id ? 'on' : ''} onClick={() => open(s.id)} aria-current={s.id === current.id ? 'page' : undefined}>
              <Pic name={s.pic} size={22} plain />{s.label}
            </button>
          ))}
        </nav>
        <div className="settings-body stack">
          <h2 className="settings-title">{current.label}</h2>
          {current.id === 'go-live' && (
            <>
              <GoLive onChange={() => setVersion((v) => v + 1)} />
              <ConnectWhatsApp key={version} />
            </>
          )}
          {current.id === 'messages' && (
            <>
              <Limits isOwner={isOwner} settings={settings} />
              {isOwner && <SalesCodes settings={settings} onChange={reloadSettings} />}
              <SmsStatus settings={settings} />
            </>
          )}
          {current.id === 'staff' && <Staff me={user} />}
          {current.id === 'your-data' && <YourData lastExportAt={settings?.lastExportAt} onDone={reloadSettings} />}
          {current.id === 'account' && <Account user={user} isOwner={isOwner} />}
        </div>
      </div>
    </div>
  );
}

/** A section card with a title and one line of help. */
function Block({ title, hint, children, id }) {
  return (
    <div className="card card-pad stack" id={id} style={{ gap: 12 }}>
      <div>
        <h3>{title}</h3>
        {hint && <p className="subtle" style={{ marginTop: 2 }}>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Limits({ isOwner, settings }) {
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
    <form onSubmit={save}>
      <Block title="Sending limits" hint="These protect the shop’s WhatsApp number. Only the owner can change them.">
        <div className="settings-rows">
          <label className="settings-row" htmlFor="weekly-cap">
            <span><b>Messages per customer per week</b><span className="subtle">Birthday and anniversary wishes don’t count. 2 keeps the number’s quality healthy. 0 = no limit.</span></span>
            <input id="weekly-cap" className="input num-input" type="number" min="0" max="14" value={cap} onChange={(e) => setCap(e.target.value)} disabled={!isOwner} />
          </label>
          <label className="settings-row" htmlFor="approval">
            <span><b>Owner approves sends to this many or more</b><span className="subtle">When staff send to this many customers, it waits for the owner’s OK.</span></span>
            <input id="approval" className="input num-input" type="number" min="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={!isOwner} />
          </label>
        </div>
        {isOwner && <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy}>{busy ? <Spinner /> : 'Save limits'}</button>}
      </Block>
    </form>
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
    <Block title="Sales codes" hint="A code in each customer’s message (like PRIYA-DIWALI-4821). Staff type it at billing, so you see which message brought the sale.">
      <label className="check consent">
        <span className="switch"><input type="checkbox" checked={settings.salesCodes} disabled={busy} onChange={(e) => toggle(e.target.checked)} /><span /></span>
        <span><b>{settings.salesCodes ? 'On' : 'Off'}</b><span className="hint" style={{ display: 'block' }}>Off: no codes in messages, and no Sales codes page.</span></span>
      </label>
    </Block>
  );
}

function SmsStatus({ settings }) {
  if (!settings) return null;
  const sms = settings.sms;
  return (
    <Block title="SMS" hint="For customers without WhatsApp. India needs DLT registration before SMS can really be sent.">
      <div className="row between wrap" style={{ gap: 8 }}>
        <span>{sms.live ? `${sms.label} · ${rate(sms.costPerSms)} per SMS` : 'Not switched on yet. Ask the app’s maker after DLT registration (about ₹5,900, 1–2 weeks).'}</span>
        <span className={`badge ${sms.live ? 'ok' : 'neutral'}`}>{sms.live ? 'On' : 'Off'}</span>
      </div>
    </Block>
  );
}

function Staff({ me }) {
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [removing, setRemoving] = useState(null);
  const load = () => api('/api/auth/users').then((r) => setUsers(r.users)).catch(() => setUsers([]));
  useEffect(() => {
    load();
  }, []);
  async function changeRole(u, role) {
    try {
      await api(`/api/auth/users/${u.id}`, { method: 'PATCH', body: { role } });
      toast(`${u.name} is now ${ROLES.find((r) => r.value === role).label}`);
      load();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
  return (
    <>
      <Block title="Who can sign in" hint="Each person has their own login. Share a first password in person.">
        {!users ? <Spinner /> : (
          <div className="staff-list">
            {users.map((u) => (
              <div key={u.id} className="staff-row">
                <Avatar name={u.name} seed={u.email} size={36} />
                <span style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <b>{u.name}{u.id === me.id ? ' (you)' : ''}</b>
                  <span className="subtle" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email} · added {dateOnly(u.created_at)}</span>
                </span>
                <select className="select sm" value={u.role} onChange={(e) => changeRole(u, e.target.value)} disabled={u.id === me.id} aria-label={`Role for ${u.name}`}>
                  {ROLES.filter((r) => r.value !== 'viewer' || u.role === 'viewer').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {u.id !== me.id && <button className="btn ghost sm" onClick={() => setResetting(u)}><KeyRound size={15} />New password</button>}
                {u.id !== me.id && <button className="btn ghost sm danger" onClick={() => setRemoving(u)}><UserMinus size={15} />Remove</button>}
              </div>
            ))}
          </div>
        )}
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}><UserPlus size={16} />Add staff</button>
      </Block>
      <Block title="What each role can do">
        <div className="stack-sm">
          {ROLES.slice(0, 2).map((r) => <span key={r.value}><b>{r.label}:</b> <span className="subtle">{r.text}</span></span>)}
        </div>
      </Block>
      {adding && <AddStaff onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {resetting && <ResetPassword u={resetting} onClose={() => setResetting(null)} />}
      {removing && <RemoveStaff u={removing} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); load(); }} />}
    </>
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
        <Field label="Name"><input id="staff-name" className="input" value={f.name} onChange={set('name')} autoComplete="off" /></Field>
        <Field label="Email"><input id="staff-email" className="input" type="email" value={f.email} onChange={set('email')} autoComplete="off" /></Field>
        <Field label="First password" hint="At least 8 characters. Share it with them in person; they can sign in straight away.">
          <input id="staff-password" className="input" type="text" value={f.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Role">
          <div className="options">
            {ROLES.slice(0, 2).map((r) => (
              <button key={r.value} type="button" className={`option ${f.role === r.value ? 'on' : ''}`} onClick={() => setF((x) => ({ ...x, role: r.value }))}>
                <span className="radio" />
                <span><span className="option-title">{r.label}</span><span className="subtle" style={{ display: 'block' }}>{r.text}</span></span>
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

/** Someone left: their login stops working at once. Past reports still show their name. */
function RemoveStaff({ u, onClose, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await api(`/api/auth/users/${u.id}`, { method: 'DELETE' });
      toast(`${u.name} can no longer sign in`);
      onDone();
    } catch (e) {
      toast(e.message, 'bad');
      setBusy(false);
    }
  }
  return (
    <Modal title={`Remove ${u.name}?`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Keep</button><button className="btn danger" onClick={remove} disabled={busy}>{busy ? <Spinner /> : 'Yes, remove'}</button></>}>
      <p>{u.name} is signed out at once and can no longer sign in. Messages they sent stay in the reports.</p>
    </Modal>
  );
}

function ResetPassword({ u, onClose }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/api/auth/users/${u.id}`, { method: 'PATCH', body: { password } });
      toast(`New password set for ${u.name}`);
      onClose();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`New password for ${u.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy || password.length < 8}>{busy ? <Spinner /> : 'Set password'}</button></>}>
      <Field label="New password" hint="At least 8 characters. Tell them in person.">
        <input id="reset-password" className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
    </Modal>
  );
}

function Account({ user, isOwner }) {
  const { setLanguage } = useAuth();
  const { lang } = useT();
  return (
    <>
      <Block title="Signed in as">
        <div className="row" style={{ gap: 12 }}>
          <Avatar name={user.name} size={44} />
          <span><b>{user.name}</b><span className="subtle" style={{ display: 'block' }}>{user.email} · {isOwner ? 'Owner' : user.role === 'viewer' ? 'View only' : 'Staff'}</span></span>
        </div>
      </Block>
      <Block title="Language" hint="The whole app opens in this language for you, on any phone or computer.">
        <div className="lang-switch" role="group" aria-label="Language" style={{ alignSelf: "flex-start" }}>
          {SCREEN_LANGS.map((l) => (
            <button key={l.code} type="button" className={lang === l.code ? 'on' : ''} onClick={() => setLanguage(l.code)} aria-pressed={lang === l.code}>{l.label}</button>
          ))}
        </div>
      </Block>
      <ChangePassword isOwner={isOwner} />
    </>
  );
}

/** Change your own password (the current one is needed). Other phones and computers are signed out. */
function ChangePassword({ isOwner }) {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/auth/me/password', { method: 'POST', body: { currentPassword: f.current, newPassword: f.next } });
      toast('Password changed. Other phones and computers are signed out.');
      setF({ current: '', next: '' });
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <Block title="Password" hint={isOwner ? 'Change the first password you were given to one only you know.' : 'Forgot it? Ask the owner: Settings → Staff → New password.'}>
        <div className="form-grid two">
          <Field label="Current password"><input id="pw-current" className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF((x) => ({ ...x, current: e.target.value }))} /></Field>
          <Field label="New password" hint="At least 8 characters."><input id="pw-new" className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF((x) => ({ ...x, next: e.target.value }))} /></Field>
        </div>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !f.current || f.next.length < 8}>{busy ? <Spinner /> : 'Change password'}</button>
      </Block>
    </form>
  );
}
