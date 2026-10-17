import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Eye, EyeOff, Gem, MessageCircle, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth.js';
import { Alert, Field, Spinner } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate(location.state?.from && location.state.from !== '/login' ? location.state.from : '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-art">
        <div className="row" style={{ gap: 12 }}>
          <div className="brand-mark" style={{ background: 'rgba(255,255,255,.12)' }}><Gem size={19} /></div>
          <b style={{ fontSize: '1.05rem' }}>Swathi Tanishq</b>
        </div>
        <div>
          <h1>Messages your customers are glad to receive.</h1>
          <p>Send personal WhatsApp offers to thousands of customers in minutes, see who read them, and answer replies in one place.</p>
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <div className="feat"><span><Sparkles size={18} /></span>Every message uses the customer’s name and last purchase</div>
          <div className="feat"><span><BarChart3 size={18} /></span>Delivered, read and failed, counted for you</div>
          <div className="feat"><span><MessageCircle size={18} /></span>Replies land in one shared inbox</div>
        </div>
      </section>

      <section className="login-form">
        <form className="login-card stack" onSubmit={submit} noValidate>
          <div className="row" style={{ gap: 12, marginBottom: 8 }}>
            <div className="brand-mark"><Gem size={19} /></div>
            <div>
              <h1 style={{ fontSize: '1.35rem' }}>Welcome back</h1>
              <p className="muted">Sign in with your staff login.</p>
            </div>
          </div>
          {error && <Alert tone="bad">{error}</Alert>}
          <Field label="Email" htmlFor="email">
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password" htmlFor="password">
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                className="input"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingRight: 48 }}
                required
              />
              <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 2, top: 2 }}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          <button className="btn primary lg block" disabled={busy || !email || !password}>
            {busy ? <Spinner /> : 'Sign in'}
          </button>
          <p className="subtle" style={{ textAlign: 'center' }}>Forgot your password? Ask the owner to reset it for you.</p>
        </form>
      </section>
    </div>
  );
}
