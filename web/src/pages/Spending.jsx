import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Wallet } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Empty, Skeleton } from '../components/ui.jsx';
import { SentTabs } from './Campaigns.jsx';
import { dateOnly, inr, num, rate } from '../lib/format.js';

// Today's date in India, as YYYY-MM-DD.
const indiaDay = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

function presetRange(key) {
  const today = indiaDay();
  if (key === 'today') return { from: today, to: today };
  if (key === '7') return { from: indiaDay(-6), to: today };
  if (key === '30') return { from: indiaDay(-29), to: today };
  if (key === 'last') {
    const first = new Date(`${today.slice(0, 8)}01T00:00:00Z`);
    const end = new Date(first.getTime() - 86400e3).toISOString().slice(0, 10);
    return { from: `${end.slice(0, 8)}01`, to: end };
  }
  return { from: `${today.slice(0, 8)}01`, to: today }; // this month
}

const PRESETS = [['today', 'Today'], ['7', 'Last 7 days'], ['month', 'This month'], ['last', 'Last month'], ['30', 'Last 30 days'], ['custom', 'Choose dates']];
const KINDS = [
  ['messages', 'Offers and messages', 'Sent from Send a message'],
  ['wishes', 'Wishes', 'Birthdays, anniversaries and events'],
  ['replies', 'Replies to customers', 'Free within 24 hours of their message'],
  ['sms', 'SMS', 'Text messages'],
];

/** What messages cost over a chosen period: totals, a bar for each day, and which sends cost most. */
export default function Spending() {
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(presetRange('month'));
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!range.from || !range.to) return;
    setError('');
    api(`/api/dashboard/spending?from=${range.from}&to=${range.to}`).then(setD).catch((e) => { setD(null); setError(e.message); });
  }, [range.from, range.to]);

  const pick = (key) => {
    setPreset(key);
    if (key !== 'custom') setRange(presetRange(key));
  };

  return (
    <div className="page spending-page">
      <div className="page-head">
        <div>
          <h1>Spending</h1>
          <p>What your WhatsApp messages cost, day by day, for any period.</p>
        </div>
      </div>
      <SentTabs />

      <div className="card card-pad stack-sm">
        <div className="seg" role="group" aria-label="Period">
          {PRESETS.map(([k, label]) => <button key={k} type="button" className={preset === k ? 'on' : ''} onClick={() => pick(k)}>{label}</button>)}
        </div>
        {preset === 'custom' && (
          <div className="row wrap" style={{ gap: 10 }}>
            <label className="field-inline">From <input type="date" className="input" value={range.from} max={range.to || indiaDay()} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></label>
            <label className="field-inline">To <input type="date" className="input" value={range.to} min={range.from} max={indiaDay()} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></label>
          </div>
        )}
      </div>

      {error ? <Alert tone="bad">{error}</Alert> : !d ? (
        <div className="kpi-row">{[0, 1, 2, 3].map((i) => <div key={i} className="card kpi-tile"><Skeleton h={12} w="60%" /><Skeleton h={26} w="40%" style={{ marginTop: 10 }} /></div>)}</div>
      ) : (
        <>
          <div className="kpi-row">
            <div className="card kpi-tile"><span className="kpi-label">Spent</span><span className="kpi-big num">{inr(d.total.cost)}</span><span className="subtle">{dateOnly(d.from)}{d.from !== d.to ? ` – ${dateOnly(d.to)}` : ''}</span></div>
            <div className="card kpi-tile"><span className="kpi-label">With 18% GST</span><span className="kpi-big num">{inr(d.total.withGst)}</span><span className="subtle">about what you pay</span></div>
            <div className="card kpi-tile"><span className="kpi-label">Per day</span><span className="kpi-big num">{inr(d.total.perDay)}</span><span className="subtle">average over {num(d.days)} {d.days === 1 ? 'day' : 'days'}</span></div>
            <div className="card kpi-tile"><span className="kpi-label">Messages</span><span className="kpi-big num">{num(d.total.sent)}</span><span className="subtle">sent in this period</span></div>
          </div>

          {d.total.sent === 0 ? (
            <div className="card"><Empty icon={Wallet} title="No messages in this period">Pick another period, or send a message to see what it costs.</Empty></div>
          ) : (
            <>
              <DayChart series={d.series} />
              <div className="spend-grid">
                <div className="card">
                  <div className="card-head"><h2>By type</h2></div>
                  {KINDS.map(([k, label, hint]) => {
                    const v = d.byKind[k] || { sent: 0, cost: 0 };
                    if (k === 'sms' && !v.sent) return null;
                    return (
                      <div key={k} className="list-item">
                        <div style={{ flex: 1, minWidth: 0 }}><b>{label}</b><div className="subtle">{hint}</div></div>
                        <div style={{ textAlign: 'right' }}><b className="num">{inr(v.cost)}</b><div className="subtle num">{num(v.sent)} sent</div></div>
                      </div>
                    );
                  })}
                </div>
                <SendsTable rows={d.bySend} />
              </div>
            </>
          )}
          <EstimateNote price={d.pricePerMessage} />
        </>
      )}
    </div>
  );
}

/** One bar per day; hover or tap a bar to see the day's amount. */
function DayChart({ series }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...series.map((s) => s.cost), 0.01);
  const peak = useMemo(() => series.reduce((a, b) => (b.cost > a.cost ? b : a), series[0]), [series]);
  const every = Math.ceil(series.length / 10); // about 10 date labels at most
  const shown = hover ?? peak;
  return (
    <div className="card card-pad chart-card">
      <div className="row between wrap" style={{ gap: 8 }}>
        <h3>Spent each day</h3>
        <span className="subtle num">{hover ? '' : 'Highest: '}{dateOnly(shown.day)} · <b>{inr(shown.cost)}</b> · {num(shown.sent)} sent</span>
      </div>
      <div className="day-chart" role="img" aria-label={`Spent each day: ${series.map((s) => `${dateOnly(s.day)} ${inr(s.cost)}`).join('; ')}`} onMouseLeave={() => setHover(null)} style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` }}>
        {series.map((s, i) => (
          <div key={s.day} className={`day ${hover?.day === s.day ? 'on' : ''}`} onMouseEnter={() => setHover(s)} onClick={() => setHover(s)}>
            <span className="bar sent" style={{ height: `${s.cost ? Math.max(2, (s.cost / max) * 100) : 0}%` }} />
            <span className="day-lbl">{i % every === 0 ? `${Number(s.day.slice(8))}/${Number(s.day.slice(5, 7))}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SendsTable({ rows }) {
  const [q, setQ] = useState('');
  const list = rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="card">
      <div className="card-head wrap" style={{ gap: 8 }}>
        <h2>Which messages cost most</h2>
        {rows.length > 5 && <input className="input" style={{ maxWidth: 220 }} placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
      {list.length === 0 ? <p className="subtle" style={{ padding: 16 }}>No message matches.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Message</th><th>Type</th><th className="num">Sent</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={`${r.kind}${r.id}`}>
                  <td>{r.kind === 'messages' ? <Link to={`/campaigns/${r.id}`}>{r.name}</Link> : r.name}<div className="subtle">{dateOnly(r.first_day)}</div></td>
                  <td>{r.kind === 'messages' ? 'Message' : 'Wish'}</td>
                  <td className="num">{num(r.sent)}</td>
                  <td className="num"><b>{inr(r.cost)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** These are the app's estimates; Meta's bill can differ a little. */
function EstimateNote({ price }) {
  return (
    <Alert icon={Info}>
      <b>These amounts are close estimates, not your bill.</b> The app counts {rate(price)} for each marketing message sent, the price Meta publishes for India.
      Meta’s bill can differ a little: prices change from time to time, messages that never reach the phone are not charged, replies within 24 hours of a customer’s message are free, and GST and rounding are added by Meta.
      For the exact amount, open WhatsApp Manager → Billing.
    </Alert>
  );
}
