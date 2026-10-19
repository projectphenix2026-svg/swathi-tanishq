import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock, Flame, IndianRupee, MessageCircle, MessageSquareText, RefreshCw, ShieldCheck, Ticket, Undo2, XCircle } from 'lucide-react';
import { useAuth } from '../lib/auth.js';
import { SearchBox, matches } from '../components/SearchBox.jsx';
import { api } from '../lib/api.js';
import { Alert, CampaignStatus, Kpi, MessageStatus, Pic, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { iconFor } from '../lib/ready.js';
import { Funnel, PROVIDER_NAMES } from './Campaigns.jsx';
import { dateTime, inr, num, pct, phone, plural } from '../lib/format.js';

const TABS = [
  { key: '', label: 'Everyone' },
  { key: 'read', label: 'Read' },
  { key: 'delivered', label: 'Reached phone' },
  { key: 'failed', label: 'Couldn’t reach' },
  { key: 'pending', label: 'Waiting' },
  { key: 'sms', label: 'SMS' },
];

export default function CampaignReport() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('');
  const [messages, setMessages] = useState(null);
  const [q, setQ] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [approving, setApproving] = useState(false);
  const { settings } = useAuth();
  const location = useLocation();
  const [undone, setUndone] = useState(false);

  const load = useCallback(() => {
    api(`/api/campaigns/${id}`).then(setData).catch((e) => setData({ error: e.message }));
    api(`/api/campaigns/${id}/messages${tab ? `?status=${tab}` : ''}`).then((r) => setMessages(r.messages)).catch(() => {});
  }, [id, tab]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh while messages are still going out, and for 15 minutes after the last one, while
  // most delivered/read updates arrive. Some customers never read, so don't wait for everyone.
  const camp = data?.campaign;
  const recent = camp?.completed_at && Date.now() - Date.parse(camp.completed_at) < 15 * 60 * 1000;
  const live = camp && (['scheduled', 'sending'].includes(camp.status) || (recent && data.report.sent > data.report.read));
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [live, load]);

  async function approve() {
    setApproving(true);
    try {
      const r = await api(`/api/campaigns/${id}/approve`, { method: 'POST' });
      toast(`Approved. Sending to ${plural(r.queued, 'customer')}.`);
      load();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setApproving(false);
    }
  }

  async function cancel({ ask = true } = {}) {
    if (ask && !confirm('Stop this offer? Messages already sent cannot be taken back.')) return;
    setCancelling(true);
    try {
      const r = await api(`/api/campaigns/${id}/cancel`, { method: 'POST' });
      toast(ask ? `Stopped. ${plural(r.cancelled, 'message')} will not be sent.` : 'Undone. Nothing was sent.');
      if (!ask) setUndone(true);
      load();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setCancelling(false);
    }
  }

  if (!data) return <div className="page"><Skeleton h={28} w="40%" /><Skeleton h={120} style={{ marginTop: 20 }} /></div>;
  if (data.error) return <div className="page"><Alert tone="bad">{data.error}</Alert></div>;

  const { campaign: c, report: r } = data;
  return (
    <div className="page">
      <Link to="/campaigns" className="back"><ArrowLeft size={16} />Sent messages</Link>
      <div className="page-head">
        <div>
          <div className="row wrap" style={{ gap: 10 }}>
            <h1 className="row" style={{ gap: 10 }}><Pic name={iconFor(c.template_name || c.name)} size={34} />{c.name}</h1>
            <CampaignStatus status={c.status} />
            {live && <span className="badge neutral"><RefreshCw size={12} className="spin" />Updating</span>}
          </div>
          <p>
            {c.status === 'scheduled' ? `Goes out ${dateTime(c.scheduled_at)}` : `Started ${dateTime(c.started_at || c.created_at)}`}
            {c.created_by_name ? ` by ${c.created_by_name}` : ''} · {c.template_name} · via {PROVIDER_NAMES[c.provider] || c.provider}
          </p>
        </div>
        <div className="row wrap">
          {c.status === 'pending_approval' && settings?.role === 'admin' && (
            <button className="btn wa" onClick={approve} disabled={approving}>{approving ? <Spinner /> : <><ShieldCheck size={18} />Approve and send</>}</button>
          )}
          {['scheduled', 'sending', 'pending_approval'].includes(c.status) && (
            <button className="btn danger" onClick={() => cancel()} disabled={cancelling}>{cancelling ? <Spinner /> : <><XCircle size={18} />{c.status === 'sending' ? 'Stop sending' : 'Stop'}</>}</button>
          )}
        </div>
      </div>

      <div className="stack">
        {location.state?.undo && !undone && c.status === 'scheduled' && (
          <div className="alert warn undo-bar">
            <span><b>Your offer starts going out within a minute.</b> Changed your mind? Undo now and nothing is sent.</span>
            <button className="btn lg" onClick={() => cancel({ ask: false })} disabled={cancelling}>{cancelling ? <Spinner /> : <><Undo2 size={18} />Undo</>}</button>
          </div>
        )}
        {c.provider === 'mock' && (
          <Alert tone="warn" icon={AlertCircle}>
            <b>Test only: nothing reached these phones.</b> This offer was sent while the app is in test mode, so the ticks below are pretend,
            to show how reports will look. Real messages go out once the shop’s WhatsApp (Meta) account is connected.
          </Alert>
        )}
        <div className="card card-pad">
          <p style={{ fontSize: '1.05rem', margin: 0 }}>
            <b>{num(r.sent)}</b> sent · <b>{num(r.delivered)}</b> reached phones · <b>{num(r.read)}</b> read it
            {r.redeemed > 0 && <> · <b>{num(r.redeemed)}</b> bought with their code ({inr(r.revenue)})</>}
            {r.failed > 0 && <> · <b>{num(r.failed)}</b> couldn’t be reached</>}
          </p>
        </div>
        {data.pace && r.pending > 0 && (
          <Alert tone="info" icon={Clock}>
            <b>{num(r.pending)} waiting.</b> WhatsApp lets this number reach {num(data.pace.limit)} new customers a day
            ({num(data.pace.remaining)} left right now). The rest go out on their own{data.pace.finishBy ? `, finishing by ${dateTime(data.pace.finishBy)}` : ' today'}.
          </Alert>
        )}
        {c.status === 'pending_approval' && (
          <Alert tone="warn" icon={ShieldCheck}>
            <b>Waiting for the owner’s approval.</b> It goes to about {num(c.expected_count)} customers ({inr((c.expected_count || 0) * Number(c.cost_per_message))}). Nothing has been sent yet.
          </Alert>
        )}
        <div className="grid kpis">
          <Kpi icon={Check} tone="brand" label="✓ Sent" value={num(r.sent)} sub={r.pending ? `${num(r.pending)} still waiting` : `of ${num(r.total)}`} />
          <Kpi icon={CheckCheck} tone="wa" label="✓✓ Reached phone" value={num(r.delivered)} sub={`${pct(r.delivered, r.sent)}% of sent`} />
          <Kpi icon={CheckCheck} tone="info" label="Blue ✓✓ Read" value={num(r.read)} sub={`${pct(r.read, r.sent)}% of sent`} />
          <Kpi icon={MessageCircle} tone="gold" label="Replied" value={num(r.replied)} sub={<Link to="/inbox">Open replies</Link>} />
          <Kpi icon={Flame} tone="bad" label="Interested" value={num(r.leads)} sub={<Link to="/leads">See them</Link>} />
          <Kpi icon={Ticket} tone="brand" label="Bought with code" value={num(r.redeemed)} sub={`${inr(r.revenue)} in sales`} />
          <Kpi icon={IndianRupee} tone="gold" label="Sales per ₹1 spent" value={r.cost ? `₹${num(Math.round(r.revenue / r.cost))}` : '—'} sub={`${inr(r.cost)} spent`} />
          {(r.sms_total > 0 || c.sms_fallback) && <Kpi icon={MessageSquareText} tone="info" label="SMS backup" value={num(r.sms_total)} sub={r.sms_preview ? `${num(r.sms_preview)} trial only, not sent` : 'On'} />}
        </div>

        <div className="card card-pad stack" style={{ gap: 12 }}>
          <div className="row between wrap">
            <h2>Where the messages are</h2>
            <span className="row muted" style={{ gap: 6 }}><IndianRupee size={16} />Cost so far <b className="num" style={{ color: 'var(--text)' }}>{inr(r.cost)}</b></span>
          </div>
          <Funnel total={r.total} sent={r.sent} delivered={r.delivered} read={r.read} failed={r.failed} />
          <div className="legend">
            <span><i style={{ background: 'var(--read)' }} />Read {num(r.read)}</span>
            <span><i style={{ background: 'var(--wa)' }} />Reached phone, not read yet {num(r.delivered - r.read)}</span>
            <span><i style={{ background: 'var(--text-3)', opacity: 0.45 }} />Sent, not reached yet {num(r.sent - r.delivered)}</span>
            {r.pending > 0 && <span><i style={{ background: 'var(--border)' }} />Waiting to send {num(r.pending)}</span>}
            <span><i style={{ background: 'var(--bad)' }} />Couldn’t reach {num(r.failed)}</span>
            {r.cancelled > 0 && <span>Not sent {num(r.cancelled)}</span>}
          </div>
        </div>

        {r.failureReasons.length > 0 && (
          <div className="card">
            <div className="card-head"><h2>Why some couldn’t be reached</h2></div>
            {r.failureReasons.map((f) => (
              <div key={f.reason} className="list-item">
                <AlertCircle size={18} style={{ color: 'var(--bad)', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{f.reason}</span>
                <b className="num">{num(f.count)}</b>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <div className="card-head" style={{ overflowX: 'auto' }}>
            <div className="chips" style={{ flexWrap: 'nowrap' }}>
              {TABS.map((t) => <button key={t.key} className={`chip ${tab === t.key ? 'on' : ''}`} onClick={() => { setTab(t.key); setMessages(null); }}>{t.label}</button>)}
            </div>
            <SearchBox value={q} onChange={setQ} placeholder="Search name or phone" style={{ flex: '0 1 240px' }} />
          </div>
          {!messages ? (
            <div style={{ padding: 20 }}><Spinner /></div>
          ) : messages.length === 0 ? (
            <p className="muted" style={{ padding: 20 }}>Nobody here yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Customer</th><th>Status</th><th className="hide-mobile">Sent</th><th className="hide-mobile">Read</th></tr></thead>
                <tbody>
                  {messages.filter((m) => matches(q, m.name, m.phone, m.offer_code)).map((m) => (
                    <tr key={m.id}>
                      <td><b>{m.name || 'No name'}</b><div className="subtle num">{phone(m.phone)}{m.offer_code ? ` · ${m.offer_code}` : ''}</div></td>
                      <td>
                        {m.channel === 'sms' && <span className="badge info" style={{ marginRight: 6 }}>SMS</span>}<MessageStatus status={m.status} />
                        {m.error_message && <div className="subtle" style={{ marginTop: 4, maxWidth: 360 }}>{m.error_message}</div>}
                      </td>
                      <td className="hide-mobile subtle">{dateTime(m.sent_at)}</td>
                      <td className="hide-mobile subtle">{dateTime(m.read_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
