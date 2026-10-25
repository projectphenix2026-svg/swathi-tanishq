import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Clock, Plus, Smartphone } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, CampaignStatus, Pic, Skeleton } from '../components/ui.jsx';
import { iconFor } from '../lib/ready.js';
import { atLeast } from '@shared/roles.js';
import { dateOnly, dateTime, greeting, inr, num, pct, plural } from '../lib/format.js';
import { useT } from '../lib/i18n.jsx';

// Home answers two questions: "What should I do today?" and "Are our messages working?"
export default function Dashboard() {
  const { user, settings } = useAuth();
  const { t, lang } = useT();
  const [d, setD] = useState(null);
  // Which period the business numbers cover: this month, last month or the last 3 months.
  const [period, setPeriod] = useState('month');

  useEffect(() => {
    api(`/api/dashboard?period=${period}`).then(setD).catch(() => setD({ error: true }));
  }, [period]);

  const first = user.name.split(' ')[0];

  return (
    <div className="page">
      <div className="page-head compact">
        <div>
          <h1>{t(`${greeting()}, {name}`, { name: first })}</h1>
        </div>
        {atLeast(settings?.role, 'manager') && <Link to="/campaigns/new" className="btn primary"><Plus size={18} />{t('Send a message')}</Link>}
      </div>

      <div className="stack">
        {!d ? (
          <div className="kpi-row">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="card kpi-tile"><Skeleton h={12} w="60%" /><Skeleton h={26} w="40%" style={{ marginTop: 10 }} /></div>)}</div>
        ) : d.error ? (
          <Alert tone="bad">Could not load Home. Refresh the page to try again.</Alert>
        ) : (
          <>
            {atLeast(settings?.role, 'owner') && <GettingStarted d={d} live={settings && settings.provider.name !== 'mock'} />}
            <Today d={d} t={t} lang={lang} />

            <Insights d={d} i={d.insights} period={period} setPeriod={setPeriod} salesCodes={Boolean(settings?.salesCodes)} />

            <div className="home-grid">
              <WeeksChart weeks={d.weeks} />
              <Upcoming days={d.upcoming} />
              <CitiesChart cities={d.cities} total={d.customers.total} />
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
                        <Pic name={iconFor(c.name)} size={24} /><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b>
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

const PERIODS = [['month', 'This month'], ['last', 'Last month'], ['90d', 'Last 3 months']];

/**
 * The business picture for a period: what messages brought in, where customers drop off between
 * sent and sale, the best offers and time to send, gaps in the customer list, and the WhatsApp
 * number's health. How each number is worked out: server/src/routes/dashboard.js homeInsights().
 */
function Insights({ d, i, period, setPeriod, salesCodes }) {
  if (!i) return null;
  const f = i.funnel;
  const steps = [
    ['Sent', f.sent],
    ['Reached the phone', f.delivered],
    ['Read', f.read],
    ['Replied or Interested', f.engaged],
    ...(salesCodes ? [['Bought with a code', f.bought]] : []),
  ];
  const h = i.health;
  const qual = { GREEN: ['ok', 'Good'], YELLOW: ['warn', 'Medium'], RED: ['bad', 'Low'] }[String(i.account.quality || '').toUpperCase()];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <h2>How your messages are doing</h2>
        <select className="select sm" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
          {PERIODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <div className="kpi-row">
        {salesCodes ? (
          <>
            <Link to="/offers" className="tile-link"><Tile label="Sales from messages" value={inr(i.sales.revenue)} sub={`${plural(i.sales.bought, 'customer')} bought with a code`} /></Link>
            <Link to="/spending" className="tile-link"><Tile label="Back for every ₹1 spent" value={i.sales.perRupee != null ? `₹${num(i.sales.perRupee)}` : '—'} sub={`${inr(i.sales.spend)} on WhatsApp`} /></Link>
          </>
        ) : (
          <>
            <Tile label="Read" value={f.sent ? `${pct(f.read, f.sent)}%` : '—'} sub={f.sent ? `${num(f.read)} of ${num(f.sent)} messages` : 'nothing sent yet'} />
            <Link to="/spending" className="tile-link"><Tile label="WhatsApp cost" value={inr(i.sales.spend)} sub="plus GST · see daily" /></Link>
          </>
        )}
        <Link to="/leads" className="tile-link"><Tile label="Interested customers" value={num(i.interested.count)} sub={i.interested.notCalled ? <span className="badge warn">{num(i.interested.notCalled)} not called yet</span> : 'everyone called'} /></Link>
        <Link to="/customers" className="tile-link"><Tile label="Customers" value={num(d.customers.total)} sub={d.new_customers ? `+${num(d.new_customers)} this month` : `${num(d.customers.reachable)} can get WhatsApp`} /></Link>
      </div>

      <div className="ins-grid">
        <div className="card card-pad stack-sm">
          <h3>From message to sale</h3>
          {!f.sent ? <p className="subtle" style={{ margin: 0 }}>Nothing sent in this period yet.</p> : steps.map(([label, n]) => (
            <div key={label}>
              <div className="row between"><span className="subtle">{label}</span><span className="num">{num(n)}{label !== 'Sent' ? ` (${pct(n, f.sent)}%)` : ''}</span></div>
              <div className="fn-bar"><span style={{ width: `${Math.max(2, (100 * n) / Math.max(1, f.sent))}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="card card-pad stack-sm">
          <h3>Best offers</h3>
          {i.best.length === 0 ? <p className="subtle" style={{ margin: 0 }}>No offers or wishes in this period yet.</p> : i.best.map((b) => (
            <div key={b.id} className="row between" style={{ gap: 8 }}>
              <span className="ellipsis" style={{ minWidth: 0 }}>{b.name.replace(/^Test · /, '')}</span>
              <span className="subtle num" style={{ flexShrink: 0 }}>{b.readPct}% read{salesCodes ? ` · ${plural(b.sales, 'sale')}` : ''}</span>
            </div>
          ))}
          <div className="subtle" style={{ marginTop: 6 }}>
            <Clock size={14} style={{ verticalAlign: '-2px' }} />{' '}
            {i.bestTime ? `Read most when sent ${i.bestTime.label} (${i.bestTime.readPct}% read within a day)` : 'Best time to send shows after about 50 messages.'}
          </div>
        </div>
        <div className="card card-pad stack-sm">
          <h3>Customer health</h3>
          <div className="row between"><span>Can get WhatsApp</span><span className="num">{num(h.reachable)} ({pct(h.reachable, h.total)}%)</span></div>
          <div className="row between"><span>Birthday saved</span><span className="row" style={{ gap: 8 }}><span className="num">{num(h.with_birthday)} ({pct(h.with_birthday, h.total)}%)</span>{h.total > h.with_birthday && <Link to="/customers?filter=no_birthday" className="btn sm">Add more</Link>}</span></div>
          <div className="row between"><span>Not read anything in 90 days</span><span className="row" style={{ gap: 8 }}><span className="num">{num(h.sleeping)}</span>{h.sleeping > 0 && <Link to="/customers?filter=sleeping" className="btn sm">Win them back</Link>}</span></div>
          <div className="row between"><span>Said STOP</span><span className="num">{num(h.stopped)}</span></div>
        </div>
        <div className="card card-pad stack-sm">
          <h3>WhatsApp account</h3>
          <div className="row between"><span>Quality</span>{qual ? <span className={`badge ${qual[0]}`}>{qual[1]}</span> : <span className="subtle">Not connected yet</span>}</div>
          <div className="row between"><span>New customers per day</span><span className="num">{i.account.dailyLimit ? num(i.account.dailyLimit) : '—'}</span></div>
          <div className="row between"><span>Templates approved by Meta</span><Link to="/templates" className="num">{num(i.account.approved)} of {num(i.account.templates)}</Link></div>
          <div className="row between"><span>Spent in this period</span><Link to="/spending" className="num">{inr(i.sales.spend)} + GST</Link></div>
        </div>
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
        {atLeast(settings.role, 'owner') ? <Link to="/settings">Go live in Settings</Link> : null}
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
