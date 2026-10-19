import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthCtx } from './lib/auth.js';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './lib/api.js';
import { Layout } from './components/Layout.jsx';
import { useT } from './lib/i18n.jsx';
import { Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Customers from './pages/Customers.jsx';
import AddCustomers from './pages/AddCustomers.jsx';
import Templates from './pages/Templates.jsx';
import TemplateEditor from './pages/TemplateEditor.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Spending from './pages/Spending.jsx';
import CampaignBuilder from './pages/CampaignBuilder.jsx';
import CampaignReport from './pages/CampaignReport.jsx';
import Inbox from './pages/Inbox.jsx';
import Occasions from './pages/Occasions.jsx';
import Leads from './pages/Leads.jsx';
import Offers from './pages/Offers.jsx';
import Settings from './pages/Settings.jsx';


export default function App() {
  const [user, setUser] = useState(undefined);
  const [settings, setSettings] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { setLang } = useT();
  // The whole app opens in the language saved with this person's login.
  useEffect(() => {
    if (user?.language) setLang(user.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.language]);

  const loadSettings = useCallback(() => api('/api/dashboard/settings').then(setSettings).catch(() => {}), []);

  useEffect(() => {
    api('/api/auth/me')
      .then((r) => {
        setUser(r.user);
        loadSettings();
      })
      .catch(() => setUser(null));
  }, [loadSettings]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      navigate('/login', { replace: true, state: { from: location.pathname } });
    });
  }, [navigate, location.pathname]);

  const auth = useMemo(
    () => ({
      user,
      settings,
      reloadSettings: loadSettings,
      async login(email, password) {
        const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
        setUser(r.user);
        loadSettings();
      },
      async setLanguage(language) {
        setLang(language);
        const r = await api('/api/auth/me', { method: 'PATCH', body: { language } });
        setUser(r.user);
      },
      async logout() {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        setUser(null);
      },
    }),
    [user, settings, loadSettings, setLang],
  );

  if (user === undefined) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spinner size={28} /></div>;
  }

  return (
    <AuthCtx.Provider value={auth}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route element={user ? <Layout /> : <Navigate to="/login" replace state={{ from: location.pathname }} />}>
          <Route index element={<Dashboard />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/add" element={<AddCustomers />} />
          <Route path="templates" element={<Templates />} />
          <Route path="templates/new" element={<TemplateEditor />} />
          <Route path="templates/:id" element={<TemplateEditor />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="spending" element={<Spending />} />
          <Route path="campaigns/new" element={<CampaignBuilder />} />
          <Route path="campaigns/:id" element={<CampaignReport />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="inbox/:contactId" element={<Inbox />} />
          <Route path="occasions" element={<Occasions />} />
          <Route path="leads" element={<Leads />} />
          <Route path="offers" element={<Offers />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthCtx.Provider>
  );
}
