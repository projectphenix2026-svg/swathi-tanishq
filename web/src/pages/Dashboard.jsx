import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CakeSlice, Check, ChevronRight, Eye, FileText, Flame, IndianRupee, MessageCircle, Plus, Send, ShieldCheck, Smartphone, TestTube2, Ticket, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, CampaignStatus, Kpi, Skeleton } from '../components/ui.jsx';
import { dateTime, greeting, inr, num, pct } from '../lib/format.js';

export default function Dashboard() {
  const { user, settings } = useAuth();
  const [d, setD] = useState(null);

  useEffect(() => {
    api('/api/dashboard').then(setD).catch(() => setD({ error: true }));
  }, []);

  const first = user.name.split(' ')[0];
  const setupDone = d && d.customers.total > 0 && d.templates > 0 && d.recent.length > 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{greeting()}, {first}</h1>
          <p>Here’s how your WhatsApp messages are doing this month.</p>
        </div>
        <Link to="/campaigns/new" className="btn primary lg"><Plus size={19} />New campaign</Link>
      </div>

      <div className="stack">
        <ProviderBanner settings={settings} />

        {!d ? (
          <div className="grid kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="card kpi"><Skeleton h={14} w="60%" /><Skeleton h={28} w="40%" style={{ marginTop: 12 }} /></div>)}</div>
        ) : d.error ? (
          <Alert tone="bad">Could not load the dashboard. Refresh the page to try again.</Alert>
        ) : (
          <>
            <div className="grid kpis">
              <Kpi icon={Users} label="Customers you can message" value={num(d.customers.reachable)} sub={`of ${num(d.customers.total)} saved`} />
              <Kpi icon={Send} tone="wa" label="Sent this month" value={num(d.month.sent)} sub={d.month.failed ? `${num(d.month.failed)} could not be sent` : 'No failures'} />
              <Kpi icon={Eye} tone="info" label="Read rate" value={`${pct(d.month.read, d.month.sent)}%`} sub={`${num(d.month.read)} customers opened it`} />
              <Kpi icon={IndianRupee} tone="gold" label="Spent this month" value={inr(d.month.spend)} sub="WhatsApp charges, before GST" />
            </div>

            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              {d.new_leads > 0 && (
                <ActionCard to="/leads" icon={Flame} tone="tone-bad" title={`${num(d.new_leads)} hot ${d.new_leads === 1 ? 'lead' : 'leads'} to call`} text="They tapped “Interested”. Call today." />
              )}
              {d.inbox.unread > 0 && (
                <ActionCard to="/inbox" icon={MessageCircle} tone="tone-wa" title={`${num(d.inbox.unread)} new ${d.inbox.unread === 1 ? 'reply' : 'replies'}`} text="Answer them while they’re interested." />
              )}
              {d.pending_approval > 0 && (
                <ActionCard to="/campaigns" icon={ShieldCheck} tone="tone-gold" title={`${num(d.pending_approval)} ${d.pending_approval === 1 ? 'campaign needs' : 'campaigns need'} approval`} text="Big sends wait for the owner." />
              )}
              <ActionCard to="/offers" icon={Ticket} tone="tone-brand" title={`${inr(d.revenue)} from offer codes`} text={`${num(d.redeemed)} codes used this month`} />
              <ActionCard to="/occasions" icon={CakeSlice} tone="tone-gold" title={d.occasions_on ? `${num(d.greetings_today)} greetings today` : 'Set up birthday greetings'} text={d.occasions_on ? `${num(d.occasions_on)} occasion${d.occasions_on === 1 ? '' : 's'} switched on` : 'They go out every morning on their own.'} />
            </div>

            {!setupDone && <GettingStarted d={d} />}

            <div className="card">
              <div className="card-head">
                <h2>Recent campaigns</h2>
                <Link to="/campaigns" className="btn ghost sm">See all <ChevronRight size={16} /></Link>
              </div>
              {d.recent.length === 0 ? (
                <p className="muted" style={{ padding: 20 }}>No campaigns yet. Your first one takes about 5 minutes.</p>
              ) : (
                d.recent.map((c) => (
                  <Link key={c.id} to={`/campaigns/${c.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b>
                        <CampaignStatus status={c.status} />
                      </div>
                      <div className="subtle">{dateTime(c.scheduled_at || c.created_at)} · {num(c.total)} customers</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <b className="num">{pct(c.read, c.total)}%</b>
                      <div className="subtle">read</div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GettingStarted({ d }) {
  const steps = [
    { done: d.customers.total > 0, title: 'Add your customers', text: 'Upload an Excel or CSV file, or type numbers in.', to: '/customers/add', icon: Users },
    { done: d.templates > 0, title: 'Write a message template', text: 'Use their name and last purchase so it feels personal.', to: '/templates/new', icon: FileText },
    { done: d.recent.length > 0, title: 'Send your first campaign', text: 'Pick who, check the preview and cost, then send.', to: '/campaigns/new', icon: Send },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="card card-pad stack">
      <div>
        <h2>Get set up in three steps</h2>
        <p className="muted">{steps.filter((s) => s.done).length} of 3 done</p>
      </div>
      <div className="checklist">
        {steps.map((s, i) => (
          <Link key={s.title} to={s.to} className={`check-item ${s.done ? 'done' : ''}`}>
            <span className="tick"><Check size={16} strokeWidth={3} /></span>
            <div style={{ flex: 1 }}>
              <div className="title" style={{ fontWeight: 600 }}>{s.title}</div>
              <div className="subtle">{s.text}</div>
            </div>
            {i === next && <span className="btn primary sm">Start</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ProviderBanner({ settings, compact }) {
  if (!settings) return null;
  const p = settings.provider;
  if (p.name === 'mock') {
    return (
      <Alert tone="warn" icon={TestTube2}>
        <b>Test mode.</b> Nothing is sent to real phones. Messages pretend to be delivered and then read within about a minute, so you can try everything safely.
      </Alert>
    );
  }
  if (p.missing.length) {
    return (
      <Alert tone="bad">
        <b>Sending is not set up.</b> Add {p.missing.join(', ')} to the server settings (.env), then restart the server.
      </Alert>
    );
  }
  if (p.name === 'twilio' && settings.sandbox && !compact) {
    return (
      <Alert tone="wa" icon={Smartphone}>
        <b>Twilio WhatsApp sandbox.</b> Only phones that joined the sandbox receive messages: from WhatsApp, send{' '}
        <code>{settings.sandbox.joinCode || 'join <your-code>'}</code> to <b>{settings.sandbox.number}</b>. Buttons appear as links under the message.
      </Alert>
    );
  }
  if (p.stub) {
    return <Alert tone="warn"><b>{p.label} is connected in test form.</b> Send a small test first.</Alert>;
  }
  return null;
}

function ActionCard({ to, icon: Icon, tone, title, text }) {
  return (
    <Link to={to} className="card card-pad row between" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="row" style={{ minWidth: 0 }}>
        <span className={`kpi-icon ${tone}`} style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0 }}><Icon size={20} /></span>
        <div style={{ minWidth: 0 }}>
          <h3>{title}</h3>
          <p className="muted" style={{ fontSize: '0.88rem' }}>{text}</p>
        </div>
      </div>
      <ChevronRight size={20} className="muted" />
    </Link>
  );
}
