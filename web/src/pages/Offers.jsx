import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, IndianRupee, Search, Ticket } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Field, Kpi, Spinner, useToast } from '../components/ui.jsx';
import { dateOnly, dateTime, inr, num, phone } from '../lib/format.js';

export default function Offers() {
  const toast = useToast();
  const codeRef = useRef(null);
  const [code, setCode] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState(null);

  const loadRecent = () => api('/api/offers/recent').then(setRecent).catch(() => setRecent({ redemptions: [], month: { n: 0, revenue: 0 } }));
  useEffect(() => {
    loadRecent();
  }, []);

  async function lookup(e) {
    e?.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    setFound(null);
    try {
      const r = await api(`/api/offers/lookup?code=${encodeURIComponent(code.trim())}`);
      setFound(r.offer);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function redeem(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/offers/redeem', { method: 'POST', body: { code: found.offer_code, amount: Number(amount || 0) } });
      toast(`Recorded ${inr(amount || 0)} for ${found.name || 'the customer'}`);
      setCode('');
      setFound(null);
      setAmount('');
      loadRecent();
      codeRef.current?.focus();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1>Offer codes</h1>
          <p>When a customer shows a code from their WhatsApp message, enter it here with the bill amount. Reports then show real sales per campaign.</p>
        </div>
      </div>
      <div className="two-col">
        <div className="stack">
          <form className="card card-pad stack" onSubmit={lookup}>
            <Field label="Code from the customer’s message" error={error || null}>
              <input ref={codeRef} className="input code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="PRIYA-DIWALI-4821" autoFocus spellCheck={false} autoComplete="off" />
            </Field>
            <button className="btn primary lg" disabled={busy || !code.trim()}>{busy && !found ? <Spinner /> : <><Search size={18} />Check code</>}</button>
          </form>

          {found && (
            <div className="card card-pad stack">
              <div className="row between wrap">
                <div>
                  <h2>{found.name || phone(found.phone)}</h2>
                  <p className="subtle num">{phone(found.phone)}</p>
                </div>
                <span className="badge brand" style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{found.offer_code}</span>
              </div>
              <dl className="summary-list" style={{ margin: 0 }}>
                <div><dt>From</dt><dd>{found.campaign_name || found.occasion_name || '—'}</dd></div>
                <div><dt>Sent</dt><dd>{dateOnly(found.sent_on)}</dd></div>
                {found.offer && <div><dt>Offer</dt><dd>{found.offer}</dd></div>}
                {found.offer_ends && <div><dt>Offer ends</dt><dd>{found.offer_ends}</dd></div>}
              </dl>
              {found.redemption_id ? (
                <Alert tone="bad">Already used on {dateTime(found.redeemed_at)}{found.redeemed_by_name ? ` by ${found.redeemed_by_name}` : ''} ({inr(found.amount)}).</Alert>
              ) : (
                <form className="stack" onSubmit={redeem}>
                  <Field label="Bill amount (₹)" hint="Before or after discount; just use the same rule every time.">
                    <input className="input" type="number" min="0" step="1" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="45000" autoFocus />
                  </Field>
                  <button className="btn wa lg" disabled={busy}><CheckCircle2 size={18} />Record sale</button>
                </form>
              )}
            </div>
          )}
        </div>

        <aside className="stack">
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Kpi icon={Ticket} tone="brand" label="Codes used" value={num(recent?.month.n || 0)} sub="this month" />
            <Kpi icon={IndianRupee} tone="gold" label="Sales" value={inr(recent?.month.revenue || 0)} sub="this month" />
          </div>
          <div className="card">
            <div className="card-head"><h3>Recently used</h3></div>
            {!recent ? (
              <div style={{ padding: 16 }}><Spinner /></div>
            ) : recent.redemptions.length === 0 ? (
              <p className="subtle" style={{ padding: 16 }}>No codes used yet. Add {'{{offer_code}}'} to a template to give every customer their own code.</p>
            ) : (
              recent.redemptions.map((r) => (
                <div key={r.id} className="list-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{r.name || phone(r.phone)}</b>
                    <div className="subtle">{r.source} · {dateTime(r.redeemed_at)}</div>
                  </div>
                  <b className="num">{inr(r.amount)}</b>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
