import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Gem, LogOut, Menu, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Avatar, Pic } from './ui.jsx';

// Four places for everyday work; the rest sits under More.
const LINKS = [
  { to: '/', label: 'Home', pic: 'home', end: true, main: true },
  { to: '/campaigns', label: 'Send offer', pic: 'megaphone', main: true, also: ['/occasions'] },
  { to: '/customers', label: 'Customers', pic: 'people', main: true },
  { to: '/inbox', label: 'Replies', pic: 'speech', badge: 'replies', main: true, also: ['/leads'] },
  { to: '/occasions', label: 'Birthday & festival wishes', pic: 'cake' },
  { to: '/leads', label: 'Call back list', pic: 'phone', badge: 'leads' },
  { to: '/templates', label: 'Saved messages', pic: 'memo' },
  { to: '/offers', label: 'Bill codes', pic: 'ticket' },
  { to: '/settings', label: 'Settings', pic: 'gear' },
];

export function Layout() {
  const { user, logout, settings } = useAuth();
  const [counts, setCounts] = useState({ unread: 0, leads: 0, replies: 0 });
  const [more, setMore] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([api('/api/inbox/unread-count'), api('/api/leads?status=new')])
        .then(([i, l]) => alive && setCounts({ unread: i.unread, leads: l.counts?.new || 0, replies: i.unread + (l.counts?.new || 0) }))
        .catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => setMore(false), [location.pathname]);

  const signOut = () => logout().then(() => navigate('/login'));
  const moreActive = ['/templates', '/offers', '/settings'].some((p) => location.pathname.startsWith(p));
  

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Gem size={19} /></div>
          <div>
            <div className="brand-name">{settings?.businessName || 'Swathi Tanishq'}</div>
            <div className="brand-sub">WhatsApp &amp; SMS offers</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {LINKS.filter((l) => l.main).map((l) => <SideLink key={l.to} link={l} counts={counts} pathname={location.pathname} />)}
          <div className="nav-group">More</div>
          {LINKS.filter((l) => !l.main).map((l) => <SideLink key={l.to} link={l} counts={counts} pathname={location.pathname} />)}
        </nav>
        <div className="sidebar-foot">
          {settings && <ProviderPill settings={settings} />}
          <div className="user-chip">
            <Avatar name={user.name} size={34} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
              <div className="subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'capitalize' }}>{user.role}</div>
            </div>
            <button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="row" style={{ gap: 10 }}>
            <div className="brand-mark" style={{ width: 32, height: 32 }}><Gem size={17} /></div>
            <b>{settings?.businessName || 'Swathi Tanishq'}</b>
          </div>
          <button className="icon-btn" onClick={signOut} aria-label="Sign out"><LogOut size={19} /></button>
        </header>
        <Outlet />
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {LINKS.filter((l) => l.main).map(({ to, label, pic, end, badge, also }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive || also?.some((p) => location.pathname.startsWith(p)) ? 'active' : '')}>
            <Pic name={pic} size={24} plain />
            {label}
            {badge && counts[badge] > 0 && <span className="dot">{counts[badge]}</span>}
          </NavLink>
        ))}
        <button className={`more-btn ${moreActive ? 'active' : ''}`} onClick={() => setMore(true)} aria-haspopup="dialog">
          <Menu size={21} />
          More
                  </button>
      </nav>

      {more && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className="modal" role="dialog" aria-label="More">
            <div className="modal-head">
              <h2>More</h2>
              <button className="icon-btn" onClick={() => setMore(false)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="more-grid">
              {LINKS.filter((l) => !l.main).map(({ to, label, pic, badge }) => (
                <NavLink key={to} to={to} className="more-item">
                  <Pic name={pic} size={44} />
                  {label}
                  {badge && counts[badge] > 0 && <span className="count hot">{counts[badge]}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SideLink({ link: { to, label, pic, end, badge, also }, counts, pathname }) {
  const sub = also?.some((p) => pathname.startsWith(p));
  return (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive || sub ? 'active' : '')}>
      <Pic name={pic} size={22} plain />
      {label}
      {badge && counts[badge] > 0 && <span className={`count ${badge === 'leads' ? 'hot' : ''}`}>{counts[badge]}</span>}
    </NavLink>
  );
}

function ProviderPill({ settings }) {
  const p = settings.provider;
  const tone = p.name === 'mock' ? 'warn' : p.missing.length ? 'bad' : 'ok';
  const text = p.name === 'mock' ? 'Test mode: nothing is sent' : p.missing.length ? `${p.label}: not set up` : `Sending via ${p.label}`;
  return <span className={`badge ${tone}`} style={{ alignSelf: 'flex-start', height: 'auto', padding: '4px 10px', whiteSpace: 'normal' }}>{text}</span>;
}
