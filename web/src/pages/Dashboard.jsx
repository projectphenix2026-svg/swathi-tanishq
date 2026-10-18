import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Eye, FileText, IndianRupee, Plus, Send, Smartphone, Ticket, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, CampaignStatus, Kpi, Pic, Skeleton } from '../components/ui.jsx';
import { dateTime, greeting, inr, num, pct, plural } from '../lib/format.js';

export default function Dashboard() {
  const { user, settings } = useAuth();
  const [d, setD] = useState(null);
  const [showNumbers, setShowNumbers] = useState(false);

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
          <p>Here’s what needs you today.</p>
        </div>
        <Link to="/campaigns/new" className="btn primary lg"><Plus size={19} />Send an offer</Link>
      </div>

      <div className="stack">
        <ProviderBanner settings={settings} />

        {!d ? (
          <div className="grid kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="card kpi"><Skeleton h={14} w="60%" /><Skeleton h={28} w="40%" style={{ marginTop: 12 }} /></div>)}</div>
        ) : d.error ? (
          <Alert tone="bad">Could not load the dashboard. Refresh the page to try again.</Alert>
        ) : (
          <>
            <Today d={d} isOwner={settings?.role === 'admin'} />

            {!setupDone && <GettingStarted d={d} />}

            <div className="card">
              <button className="card-head" onClick={() => setShowNumbers((x) => !x)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', borderBottom: showNumbers ? undefined : 'none' }} aria-expanded={showNumbers}>
                <h2>This month in numbers</h2>
                <span className="btn ghost sm">{showNumbers ? 'Hide' : 'See numbers'}</span>
              </button>
              {showNumbers && (
                <div className="grid kpis" style={{ padding: 16 }}>
                  <Kpi icon={Users} label="Customers you can message" value={num(d.customers.reachable)} sub={`of ${num(d.customers.total)} saved`} />
                  <Kpi icon={Send} tone="wa" label="Messages sent" value={num(d.month.sent)} sub={d.month.failed ? `${num(d.month.failed)} couldn’t be reached` : 'All reached WhatsApp'} />
                  <Kpi icon={Eye} tone="info" label="Read" value={`${pct(d.month.read, d.month.sent)}%`} sub={`${num(d.month.read)} customers opened it`} />
                  <Kpi icon={IndianRupee} tone="gold" label="Paid to WhatsApp" value={inr(d.month.spend)} sub="plus 18% GST" />
                  <Kpi icon={Ticket} tone="brand" label="Bought with a code" value={num(d.redeemed)} sub={`${inr(d.revenue)} in bills`} />
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Recent offers</h2>
                <Link to="/campaigns" className="btn ghost sm">See all <ChevronRight size={16} /></Link>
              </div>
              {d.recent.length === 0 ? (
                <p className="muted" style={{ padding: 20 }}>No offers sent yet. Your first one takes about 5 minutes.</p>
              ) : (
                d.recent.map((c) => (
                  <Link key={c.id} to={`/campaigns/${c.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b>
                        <CampaignStatus status={c.status} />
                      </div>
                      <div className="subtle">{dateTime(c.scheduled_at || c.created_at)} · sent to {plural(c.total, 'customer')}, {num(c.read)} read it</div>
                    </div>
                    <ChevronRight size={18} className="muted" />
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

/** Home: what needs doing today, in plain sentences, most urgent first. */
function Today({ d, isOwner }) {
  const copyDue = isOwner && (!d.lastExportAt || Date.now() - Date.parse(d.lastExportAt) > 7 * 24 * 3600 * 1000);
  const last = d.recent.find((c) => c.status !== 'cancelled' && !c.name.startsWith('Test · '));
  const items = [
    d.overdue_leads > 0 && { to: '/leads', pic: 'phone', urgent: true, title: `${plural(d.overdue_leads, 'interested customer')} waiting more than a day`, text: 'Call them now: interest fades fast.', action: 'Call now' },
    d.new_leads > d.overdue_leads && { to: '/leads', pic: 'phone', title: `${plural(d.new_leads - (d.overdue_leads || 0), 'customer')} said Interested`, text: 'Call them today, while they’re keen.', action: 'Call' },
    d.inbox.unread > 0 && { to: '/inbox', pic: 'speech', title: `${plural(d.inbox.unread, 'new reply', 'new replies')}`, text: 'Answer them from here. Replies within 24 hours are free.', action: 'Answer' },
    d.pending_approval > 0 && { to: '/campaigns', pic: 'hourglass', title: `${plural(d.pending_approval, 'offer')} ${d.pending_approval === 1 ? 'waits' : 'wait'} for the owner’s OK`, text: 'Big sends by staff go out once the owner approves.', action: 'Check' },
    d.occasions_on
      ? { to: '/occasions', pic: 'cake', title: d.greetings_today ? `${plural(d.greetings_today, 'wish', 'wishes')} went out today` : 'No birthdays or anniversaries today', text: 'Wishes go out every morning on their own.', done: true }
      : { to: '/occasions', pic: 'cake', title: 'Switch on birthday wishes', text: 'Set it once. They go out every morning on their own.', action: 'Set up' },
    copyDue && { to: '/settings#your-data', pic: 'chart', title: 'Download this week’s copy of your data', text: 'One click: customers, offers and bill codes in Excel.', action: 'Download' },
    last && { to: `/campaigns/${last.id}`, pic: 'megaphone', title: `Your “${last.name}”: ${num(last.total)} sent, ${num(last.read)} read it`, text: d.redeemed ? `This month ${plural(d.redeemed, 'customer')} bought with their code (${inr(d.revenue)}).` : 'When a customer buys with their code, it shows here.', done: true },
  ].filter(Boolean);
  const nothingToDo = !d.new_leads && !d.inbox.unread && !d.pending_approval;
  return (
    <div className="card">
      <div className="card-head"><h2>What to do today</h2></div>
      <div className="today">
        {nothingToDo && (
          <div className="today-item">
            <span className="emoji" aria-hidden="true"><Pic name="check" size={36} /></span>
            <div className="what"><b>Nothing waiting for you</b><span className="subtle">A good day to send an offer.</span></div>
            <Link to="/campaigns/new" className="btn primary sm">Send offer</Link>
          </div>
        )}
        {items.map((it) => (
          <Link key={it.title} to={it.to} className={`today-item ${it.done ? 'done' : ''} ${it.urgent ? 'urgent' : ''}`}>
            <span className="emoji" aria-hidden="true"><Pic name={it.pic} size={36} /></span>
            <div className="what"><b>{it.title}</b><span className="subtle">{it.text}</span></div>
            {it.action ? <span className="btn primary sm">{it.action}</span> : <ChevronRight size={18} className="muted" />}
          </Link>
        ))}
      </div>
    </div>
  );
}

function GettingStarted({ d }) {
  const steps = [
    { done: d.customers.total > 0, title: 'Add your customers', text: 'From phone contacts, an Excel file, or type them in.', to: '/customers/add', icon: Users },
    { done: d.templates > 0, title: 'Pick a ready-made message', text: 'Diwali, wedding season, new collection… each customer’s name is added for you.', to: '/campaigns/new', icon: FileText },
    { done: d.recent.length > 0, title: 'Send your first offer', text: 'See exactly how it looks and what it costs before you send.', to: '/campaigns/new', icon: Send },
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
      <Alert tone="warn" icon={null}>
        <b>Test mode.</b> Nothing is sent to real phones. Messages pretend to be delivered and then read within about a minute, so you can try everything safely. To send real messages, the owner connects the shop’s WhatsApp under <Link to="/settings">Settings → Connect WhatsApp</Link>.
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
