import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Gem, LogOut, Menu, Plus, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Avatar, Pic } from './ui.jsx';
import { SCREEN_LANGS, useT } from '../lib/i18n.jsx';

// The six places in the app. Settings sits at the bottom of the menu; Sales codes appears
// only when the owner switches sales codes on.
const LINKS = [
  { to: '/', label: 'Home', pic: 'home', end: true },
  { to: '/campaigns', label: 'Send', pic: 'megaphone' },
  { to: '/customers', label: 'Customers', pic: 'people' },
  { to: '/occasions', label: 'Special days', pic: 'cake' },
  { to: '/inbox', label: 'Replies', pic: 'speech', badge: 'replies', also: ['/leads'] },
  { to: '/templates', label: 'Templates', pic: 'memo' },
];
const SALES_CODES = { to: '/offers', label: 'Sales codes', pic: 'ticket' };
const SETTINGS = { to: '/settings', label: 'Settings', pic: 'gear' };
// Phones: four places and a large Send button in the middle; the rest is under Menu.
const PHONE = ['/', '/customers', 'send', '/occasions', '/inbox'];

export function Layout() {
  const { user, logout, settings } = useAuth();
  const { t, lang, setLang } = useT();
  const [counts, setCounts] = useState({ unread: 0, leads: 0, replies: 0 });
  const [sheet, setSheet] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([api('/api/inbox/unread-count'), api('/api/leads?status=new')])
        .then(([i, l]) => alive && setCounts({ unread: i.unread, leads: l.counts?.new || 0, replies: i.unread + (l.counts?.new || 0) }))
        .catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => setSheet(false), [location.pathname]);

  const signOut = () => logout().then(() => navigate('/login'));
  const links = [...LINKS, ...(settings?.salesCodes ? [SALES_CODES] : [])];
  const extra = [LINKS[5], ...(settings?.salesCodes ? [SALES_CODES] : []), SETTINGS];
  const sending = location.pathname === '/campaigns/new';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Gem size={19} /></div>
          <div>
            <div className="brand-name">{settings?.businessName || 'Swathi Tanishq'}</div>
            <div className="brand-sub">{t('WhatsApp messages')}</div>
          </div>
        </div>
        <NavLink to="/campaigns/new" className="btn primary nav-send"><Plus size={18} />{t('Send a message')}</NavLink>
        <nav className="nav" aria-label="Main">
          {links.map((l) => <SideLink key={l.to} link={l} counts={counts} pathname={location.pathname} t={t} exclude={l.to === '/campaigns' && sending} />)}
        </nav>
        <div className="sidebar-foot">
          {settings && <ModeBadge settings={settings} t={t} />}
          <nav className="nav" aria-label="Settings"><SideLink link={SETTINGS} counts={counts} pathname={location.pathname} t={t} /></nav>
          <UserMenu user={user} lang={lang} setLang={setLang} t={t} onSignOut={signOut} />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <div className="brand-mark" style={{ width: 32, height: 32 }}><Gem size={17} /></div>
            <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{settings?.businessName || 'Swathi Tanishq'}</b>
          </div>
          <span className="row" style={{ gap: 6 }}>
            {settings && <ModeBadge settings={settings} t={t} compact />}
            <button className="icon-btn" onClick={() => setSheet(true)} aria-label={t('Menu')} aria-haspopup="dialog"><Menu size={21} /></button>
          </span>
        </header>
        <Outlet />
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {PHONE.map((to) => {
          if (to === 'send') {
            return (
              <NavLink key="send" to="/campaigns/new" className="send-tab">
                <span className="send-circle"><Plus size={24} /></span>
                {t('Send')}
              </NavLink>
            );
          }
          const { label, pic, end, badge, also } = LINKS.find((l) => l.to === to);
          return (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive || also?.some((p) => location.pathname.startsWith(p)) ? 'active' : '')}>
              <Pic name={pic} size={24} plain />
              {t(label)}
              {badge && counts[badge] > 0 && <span className="dot">{counts[badge]}</span>}
            </NavLink>
          );
        })}
      </nav>

      {sheet && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div className="modal" role="dialog" aria-label={t('Menu')}>
            <div className="modal-head">
              <h2>{t('Menu')}</h2>
              <button className="icon-btn" onClick={() => setSheet(false)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="more-grid">
              <NavLink to="/campaigns" end className="more-item"><Pic name="megaphone" size={44} />{t('Sent messages')}</NavLink>
              {extra.map(({ to, label, pic }) => (
                <NavLink key={to} to={to} className="more-item"><Pic name={pic} size={44} />{t(label)}</NavLink>
              ))}
            </div>
            <div className="stack-sm" style={{ padding: '0 16px 20px' }}>
              <span className="label">{t('Language')}</span>
              <LangSwitch lang={lang} setLang={setLang} label={t('Language')} />
              <button className="btn" onClick={signOut} style={{ marginTop: 8 }}><LogOut size={17} />{t('Sign out')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SideLink({ link: { to, label, pic, end, badge, also }, counts, pathname, t, exclude }) {
  const sub = also?.some((p) => pathname.startsWith(p));
  return (
    <NavLink to={to} end={end} className={({ isActive }) => ((isActive || sub) && !exclude ? 'active' : '')}>
      <Pic name={pic} size={22} plain />
      {t(label)}
      {badge && counts[badge] > 0 && <span className="count">{counts[badge]}</span>}
    </NavLink>
  );
}

/** The signed-in person; opens a small menu with the screen language and Sign out. */
function UserMenu({ user, lang, setLang, t, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const role = user.role === 'admin' ? t('Owner') : t('Staff');
  return (
    <div className="user-menu" ref={ref}>
      {open && (
        <div className="user-pop" role="menu">
          <span className="label">{t('Language')}</span>
          <LangSwitch lang={lang} setLang={setLang} label={t('Language')} />
          <button className="btn ghost sm" onClick={onSignOut} role="menuitem"><LogOut size={16} />{t('Sign out')}</button>
        </div>
      )}
      <button className="user-chip" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-haspopup="menu">
        <Avatar name={user.name} size={32} />
        <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</span>
          <span className="subtle" style={{ display: 'block' }}>{role} · {SCREEN_LANGS.find((l) => l.code === lang)?.label}</span>
        </span>
      </button>
    </div>
  );
}

/** English / తెలుగు / हिन्दी for the everyday screens; remembered on this device. */
function LangSwitch({ lang, setLang, label }) {
  return (
    <div className="lang-switch" role="group" aria-label={label}>
      {SCREEN_LANGS.map((l) => (
        <button key={l.code} type="button" className={lang === l.code ? 'on' : ''} onClick={() => setLang(l.code)} aria-pressed={lang === l.code} title={l.label}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Which mode the app is in: Test mode (nothing reaches phones) or Live. */
function ModeBadge({ settings, t, compact }) {
  const p = settings.provider;
  const test = p.name === 'mock';
  const broken = !test && p.missing.length;
  const tone = test ? 'warn' : broken ? 'bad' : 'ok';
  const text = test ? (compact ? t('Test mode') : t('Test mode: nothing is sent')) : broken ? t('WhatsApp not connected') : t('Live');
  return <span className={`badge ${tone} mode-badge`}>{text}</span>;
}
