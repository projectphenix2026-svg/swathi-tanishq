import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Pic, Spinner, useToast } from './ui.jsx';

const CARDS = [
  { pic: 'people', title: 'Add your customers', text: 'Name, WhatsApp number, city and their special days. Bring in your Excel list in one go.' },
  { pic: 'megaphone', title: 'Send them a message', text: 'Pick a template, pick customers, send. Each customer sees their own name.' },
  { pic: 'cake', title: 'Never miss a special day', text: 'Birthday and anniversary wishes go out on the day, by themselves.' },
];
const key = (user) => `st_welcome_${user.id}`;

/** True the first time this person opens the app on this device. */
export function shouldWelcome(user) {
  try {
    return !localStorage.getItem(key(user));
  } catch {
    return false;
  }
}

/** Three short cards for a new shop, shown once. In Test mode it offers sample customers to try with. */
export function Welcome({ user, testMode, onClose }) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const done = () => {
    try {
      localStorage.setItem(key(user), '1');
    } catch {
      // Private window: the welcome may show again next time.
    }
    onClose();
  };
  async function trySamples() {
    setBusy(true);
    try {
      await api('/api/customers/samples', { method: 'POST' });
      toast('5 sample customers added. They are removed when you go live.');
      done();
      navigate('/customers');
    } catch (e) {
      toast(e.message, 'bad');
      setBusy(false);
    }
  }
  return (
    <div className="overlay">
      <div className="modal welcome" role="dialog" aria-modal="true" aria-label="Welcome">
        <div className="modal-head">
          <h2>Welcome, {user.name.split(' ')[0]}</h2>
          <button className="icon-btn" onClick={done} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="welcome-body">
          <p className="muted">This app does three things for the shop:</p>
          <div className="welcome-cards">
            {CARDS.map((c, i) => (
              <div key={c.title} className="welcome-card">
                <span className="welcome-n">{i + 1}</span>
                <Pic name={c.pic} size={40} />
                <b>{c.title}</b>
                <span className="subtle">{c.text}</span>
              </div>
            ))}
          </div>
          {testMode && <p className="subtle">You are in <b>Test mode</b>: try everything freely, nothing reaches real phones until the owner goes live.</p>}
        </div>
        <div className="modal-foot">
          {testMode && <button className="btn" onClick={trySamples} disabled={busy}>{busy ? <Spinner /> : 'Try with 5 sample customers'}</button>}
          <button className="btn primary" onClick={done}>Start<ArrowRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}
