import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Check, ChevronRight, Plus, Smartphone } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, CampaignStatus, Pic, Skeleton } from '../components/ui.jsx';
import { dateOnly, dateTime, greeting, inr, num, pct, plural } from '../lib/format.js';
import { useT } from '../lib/i18n.jsx';

// Home answers two questions: "What should I do today?" and "Are our messages working?"
export default function Dashboard() {
  const { user, settings } = useAuth();
  const { t, lang } = useT();
  const [d, setD] = useState(null);

  useEffect(() => {
    api('/api/dashboard').then(setD).catch(() => setD({ error: true }));
  }, []);

  const first = user.name.split(' ')[0];

  return (
    <div className="page">
      <div className="page-head compact">
        <div>
          <h1>{t(`${greeting()}, {name}`, { name: first })}</h1>
        </div>
        <Link to="/campaigns/new" className="btn primary"><Plus size={18} />{t('Send a message')}</Link>
      </div>

      <div className="stack">
        <ProviderBanner settings={settings} compact />
        {!d ? (
          <div className="kpi-row">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="card kpi-tile"><Skeleton h={12} w="60%" /><Skeleton h={26} w="40%" style={{ marginTop: 10 }} /></div>)}</div>
        ) : d.error ? (
          <Alert tone="bad">Could not load Home. Refresh the page to try again.</Alert>
        ) : (
          <>
            <GettingStarted d={d} live={settings && settings.provider.name !== 'mock'} />
            <Today d={d} t={t} lang={lang} />

            <div className="kpi-row">
              <Tile label="Customers" value={num(d.customers.total)} sub={d.new_customers ? `+${num(d.new_customers)} this month` : `${num(d.customers.reachable)} can get WhatsApp`} />
              <Tile label="Messages sent" value={num(d.month.sent)} sub="this month" />
              <Tile label="Read" value={d.month.sent ? `${pct(d.month.read, d.month.sent)}%` : '—'} sub={<Change now={pct(d.month.read, d.month.sent)} before={d.last_sent ? pct(d.last_read, d.last_sent) : null} hasNow={d.month.sent > 0} />} />
              <Tile label="Replies" value={num(d.replies)} sub={`${num(d.interested)} said Interested`} />
              <Tile label="WhatsApp cost" value={inr(d.month.spend)} sub="this month, plus GST" />
            </div>

            <div className="home-grid">
              <WeeksChart weeks={d.weeks} />
              <LastMessage m={d.lastMessage} />
              <CitiesChart cities={d.cities} total={d.customers.total} />
              <Upcoming days={d.upcoming} />
            </div>

            <div className="card">
              <div className="card-head">
                <h2>{t('Recent messages')}</h2>
                <Link to="/campaigns" className="btn ghost sm">{t('See all')} <ChevronRight size={16} /></Link>
              </div>
              {d.recent.length === 0 ? (
                <p className="muted" style={{ padding: 16 }}>Nothing sent yet.</p>
              ) : (
                d.recent.slice(0, 3).map((c) => (
                  <Link key={c.id} to={`/campaigns/${c.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b>
                        <CampaignStatus status={c.status} />
                      </div>
                      <div className="subtle">{dateTime(c.scheduled_at || c.created_at)} · {plural(c.total, 'customer')}, {num(c.read)} read it</div>
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

function Tile({ label, value, sub }) {
  return (
    <div className="card kpi-tile">
      <span className="kpi-label">{label}</span>
      <span className="kpi-big num">{value}</span>
      <span className="subtle">{sub}</span>
    </div>
  );
}

/** "+4% vs last month" with an arrow (shape and sign, not only colour). */
function Change({ now, before, hasNow }) {
  if (!hasNow) return 'nothing sent yet';
  if (before === null) return 'of messages sent';
  const diff = now - before;
  if (!diff) return 'same as last month';
  const Up = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={diff > 0 ? 'chg up' : 'chg down'}><Up size={14} />{diff > 0 ? '+' : ''}{diff}% vs last month</span>;
}

/** Only what needs someone today. Empty: the row is not shown at all. */
function Today({ d, t, lang }) {
  const todayIndia = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const todayDays = d.upcoming.find((u) => u.date === todayIndia);
  const people = todayDays ? todayDays.birthday.length + todayDays.anniversary.length + todayDays.personal.length : 0;
  const items = [
    d.overdue_leads > 0 && { to: '/leads', pic: 'phone', urgent: true, title: t('{n} waiting more than a day', { n: plural(d.overdue_leads, 'interested customer'), count: d.overdue_leads }), action: t('Call now') },
    d.new_leads > d.overdue_leads && { to: '/leads', pic: 'phone', title: t('{n} said Interested', { n: plural(d.new_leads - (d.overdue_leads || 0), 'customer'), count: d.new_leads - (d.overdue_leads || 0) }), action: t('Call') },
    d.inbox.unread > 0 && { to: '/inbox', pic: 'speech', title: lang === 'en' ? plural(d.inbox.unread, 'new reply', 'new replies') : t('{n} new', { count: d.inbox.unread }), action: t('Answer') },
    d.pending_approval > 0 && { to: '/campaigns', pic: 'hourglass', title: `${plural(d.pending_approval, 'message')} ${d.pending_approval === 1 ? 'waits' : 'wait'} for the owner’s OK`, action: 'Check' },
    people > 0 && { to: '/occasions', pic: 'cake', title: `${plural(people, 'special day')} today`, action: 'See who' },
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="today-row">
      {items.map((it) => (
        <Link key={it.title} to={it.to} className={`today-chip ${it.urgent ? 'urgent' : ''}`}>
          <Pic name={it.pic} size={28} />
          <b>{it.title}</b>
          <span className="btn primary sm">{it.action}</span>
        </Link>
      ))}
    </div>
  );
}

function GettingStarted({ d, live }) {
  const steps = [
    { done: d.customers.total >= 3, title: 'Add your customers', to: '/customers/add' },
    { done: d.birthday_on > 0, title: 'Turn on birthday wishes', to: '/occasions' },
    { done: d.campaigns > 0, title: 'Send a test message', to: '/campaigns/new' },
    { done: Boolean(live), title: 'Go live', to: '/settings' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="card card-pad getting-started">
      <div className="row between wrap" style={{ gap: 8 }}>
        <h2>Getting started</h2>
        <span className="subtle">{doneCount} of {steps.length} done</span>
      </div>
      <div className="gs-steps">
        {steps.map((s, i) => (
          <Link key={s.title} to={s.to} className={`gs-step ${s.done ? 'done' : ''} ${i === next ? 'next' : ''}`}>
            <span className="tick">{s.done ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
            <span>{s.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Messages per week, sent and read, side by side (8 weeks). */
function WeeksChart({ weeks }) {
  const max = Math.max(1, ...weeks.map((w) => w.sent));
  const any = weeks.some((w) => w.sent);
  return (
    <div className="card card-pad chart-card">
      <div className="row between wrap" style={{ gap: 8 }}>
        <h3>Messages per week</h3>
        <span className="legend-row"><i className="sw sent" />Sent <i className="sw read" />Read</span>
      </div>
      {!any ? <p className="subtle">Nothing sent in the last 8 weeks.</p> : (
        <div className="wk-chart" role="img" aria-label={`Messages per week: ${weeks.map((w) => `${w.sent} sent, ${w.read} read`).join('; ')}`}>
          {weeks.map((w) => (
            <div key={w.ending} className="wk" title={`Week to ${dateOnly(w.ending)}: ${num(w.sent)} sent, ${num(w.read)} read`}>
              <div className="wk-bars">
                <span className="bar sent" style={{ height: `${(w.sent / max) * 100}%` }} />
                <span className="bar read" style={{ height: `${(w.read / max) * 100}%` }} />
              </div>
              <span className="wk-lbl">{Number(w.ending.slice(8))}/{Number(w.ending.slice(5, 7))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** What happened to the last message: sent, read, replied, Interested (and bought, with sales codes). */
function LastMessage({ m }) {
  if (!m) {
    return (
      <div className="card card-pad chart-card">
        <h3>Last message</h3>
        <p className="subtle">When you send a message, you see here how many read it and replied.</p>
      </div>
    );
  }
  const steps = [['Sent', m.sent], ['Read', m.read], ['Replied', m.replied], ['Interested', m.interested], ...(m.bought !== null ? [['Bought', m.bought]] : [])];
  const max = Math.max(1, m.sent);
  return (
    <Link to={`/campaigns/${m.id}`} className="card card-pad chart-card" style={{ textDecoration: 'none', color: 'inherit' }}>
      <h3>Last message: {m.name}</h3>
      <div className="hbars">
        {steps.map(([label, n]) => (
          <div key={label} className="hbar" title={`${label}: ${num(n)}`}>
            <span className="hbar-lbl">{label}</span>
            <span className="hbar-track"><span className="hbar-fill" style={{ width: `${Math.max(n ? 2 : 0, (n / max) * 100)}%` }} /></span>
            <span className="hbar-val num">{num(n)}{label !== 'Sent' && m.sent ? <span className="subtle"> · {pct(n, m.sent)}%</span> : null}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}

function CitiesChart({ cities, total }) {
  const max = Math.max(1, ...cities.map((c) => c.n));
  return (
    <div className="card card-pad chart-card">
      <h3>Customers by city</h3>
      {!cities.length ? <p className="subtle">Add customers with their city to see this.</p> : (
        <div className="hbars">
          {cities.map((c) => (
            <div key={c.city} className="hbar" title={`${c.city}: ${num(c.n)} of ${num(total)}`}>
              <span className="hbar-lbl">{c.city}</span>
              <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(c.n / max) * 100}%` }} /></span>
              <span className="hbar-val num">{num(c.n)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Upcoming({ days }) {
  return (
    <Link to="/occasions" className="card card-pad chart-card" style={{ textDecoration: 'none', color: 'inherit' }}>
      <h3>Next 7 days</h3>
      {!days.length ? <p className="subtle">No birthdays, anniversaries or events this week.</p> : (
        <div className="stack-sm">
          {days.slice(0, 5).map((d) => {
            const bits = [
              ...d.events,
              d.birthday.length && `${plural(d.birthday.length, 'birthday')} (${d.birthday.slice(0, 2).join(', ')}${d.birthday.length > 2 ? '…' : ''})`,
              d.anniversary.length && plural(d.anniversary.length, 'anniversary', 'anniversaries'),
              d.personal.length && plural(d.personal.length, 'family day'),
            ].filter(Boolean);
            return (
              <div key={d.date} className="up-row">
                <span className="up-date">{dateOnly(d.date).replace(/ \d{4}$/, '')}</span>
                <span className="subtle" style={{ minWidth: 0 }}>{bits.join(' · ')}</span>
              </div>
            );
          })}
        </div>
      )}
    </Link>
  );
}

export function ProviderBanner({ settings, compact }) {
  const { t } = useT();
  if (!settings) return null;
  const p = settings.provider;
  if (p.name === 'mock') {
    return (
      <Alert tone="warn" icon={null}>
        <b>{t('Test mode.')}</b> {compact ? 'Messages are pretend: nothing reaches real phones.' : t('Nothing is sent to real phones. Messages pretend to be delivered and then read within about a minute, so you can try everything safely.')}{' '}
        {settings.role === 'admin' ? <Link to="/settings">Go live in Settings</Link> : null}
      </Alert>
    );
  }
  if (p.missing.length) {
    return <Alert tone="bad"><b>Sending is not set up.</b> The owner connects WhatsApp in Settings.</Alert>;
  }
  if (p.name === 'twilio' && settings.sandbox && !compact) {
    return (
      <Alert tone="wa" icon={Smartphone}>
        <b>Twilio WhatsApp sandbox.</b> Only phones that joined the sandbox receive messages: from WhatsApp, send{' '}
        <code>{settings.sandbox.joinCode || 'join <your-code>'}</code> to <b>{settings.sandbox.number}</b>.
      </Alert>
    );
  }
  if (p.stub) {
    return <Alert tone="warn"><b>{p.label} is connected in test form.</b> Send a small test first.</Alert>;
  }
  return null;
}
