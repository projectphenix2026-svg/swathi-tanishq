import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { CakeSlice, FileText, Flame, Gem, Home, LogOut, Menu, MessageCircle, Send, Settings, Ticket, Users, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Avatar } from './ui.jsx';

const LINKS = [
  { to: '/', label: 'Home', icon: Home, end: true, main: true },
  { to: '/campaigns', label: 'Campaigns', icon: Send, main: true },
  { to: '/occasions', label: 'Occasions', icon: CakeSlice },
  { to: '/customers', label: 'Customers', icon: Users, main: true },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/inbox', label: 'Inbox', icon: MessageCircle, badge: 'unread', main: true },
  { to: '/leads', label: 'Hot leads', icon: Flame, badge: 'leads' },
  { to: '/offers', label: 'Offer codes', icon: Ticket },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Layout() {
  const { user, logout, settings } = useAuth();
  const [counts, setCounts] = useState({ unread: 0, leads: 0 });
  const [more, setMore] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([api('/api/inbox/unread-count'), api('/api/leads?status=new')])
        .then(([i, l]) => alive && setCounts({ unread: i.unread, leads: l.counts?.new || 0 }))
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
  const moreActive = LINKS.some((l) => !l.main && location.pathname.startsWith(l.to));
  const moreCount = LINKS.filter((l) => !l.main && l.badge).reduce((n, l) => n + (counts[l.badge] || 0), 0);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Gem size={19} /></div>
          <div>
            <div className="brand-name">{settings?.businessName || 'Swathi Tanishq'}</div>
            <div className="brand-sub">WhatsApp messaging</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {LINKS.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={19} />
              {label}
              {badge && counts[badge] > 0 && <span className={`count ${badge === 'leads' ? 'hot' : ''}`}>{counts[badge]}</span>}
            </NavLink>
          ))}
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
        {LINKS.filter((l) => l.main).map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon size={21} />
            {label}
            {badge && counts[badge] > 0 && <span className="dot">{counts[badge]}</span>}
          </NavLink>
        ))}
        <button className={`more-btn ${moreActive ? 'active' : ''}`} onClick={() => setMore(true)} aria-haspopup="dialog">
          <Menu size={21} />
          More
          {moreCount > 0 && <span className="dot hot">{moreCount}</span>}
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
              {LINKS.filter((l) => !l.main).map(({ to, label, icon: Icon, badge }) => (
                <NavLink key={to} to={to} className="more-item">
                  <span className="kpi-icon tone-brand" style={{ width: 44, height: 44, borderRadius: 14 }}><Icon size={22} /></span>
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

function ProviderPill({ settings }) {
  const p = settings.provider;
  const tone = p.name === 'mock' ? 'warn' : p.missing.length ? 'bad' : 'ok';
  const text = p.name === 'mock' ? 'Test mode: nothing is sent' : p.missing.length ? `${p.label}: not set up` : `Sending via ${p.label}`;
  return <span className={`badge ${tone}`} style={{ alignSelf: 'flex-start', height: 'auto', padding: '4px 10px', whiteSpace: 'normal' }}>{text}</span>;
}
