import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { FileText, Gem, Home, LogOut, MessageCircle, Send, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Avatar } from './ui.jsx';

const LINKS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/campaigns', label: 'Campaigns', icon: Send },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/inbox', label: 'Inbox', icon: MessageCircle, badge: true },
];

export function Layout() {
  const { user, logout, settings } = useAuth();
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const load = () => api('/api/inbox/unread-count').then((r) => alive && setUnread(r.unread)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

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
              {badge && unread > 0 && <span className="count">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {settings && <ProviderPill settings={settings} />}
          <div className="user-chip">
            <Avatar name={user.name} size={34} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
              <div className="subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
            </div>
            <button className="icon-btn" onClick={() => logout().then(() => navigate('/login'))} aria-label="Sign out" title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="row" style={{ gap: 10 }}>
            <div className="brand-mark" style={{ width: 32, height: 32 }}><Gem size={17} /></div>
            <b>{settings?.businessName || 'Swathi Tanishq'}</b>
          </div>
          <button className="icon-btn" onClick={() => logout().then(() => navigate('/login'))} aria-label="Sign out">
            <LogOut size={19} />
          </button>
        </header>
        <Outlet />
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {LINKS.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon size={21} />
            {label}
            {badge && unread > 0 && <span className="dot">{unread}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function ProviderPill({ settings }) {
  const p = settings.provider;
  const tone = p.name === 'mock' ? 'warn' : p.missing.length ? 'bad' : 'ok';
  const text = p.name === 'mock' ? 'Test mode: nothing is sent' : p.missing.length ? `${p.label}: not set up` : `Sending via ${p.label}`;
  return <span className={`badge ${tone}`} style={{ alignSelf: 'flex-start', height: 'auto', padding: '4px 10px', whiteSpace: 'normal' }}>{text}</span>;
}
