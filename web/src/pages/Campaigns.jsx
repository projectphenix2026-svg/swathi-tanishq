import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Plus, Send } from 'lucide-react';
import { SearchBox, matches } from '../components/SearchBox.jsx';
import { api } from '../lib/api.js';
import { CampaignStatus, Empty, Skeleton } from '../components/ui.jsx';
import { dateTime, num, pct } from '../lib/format.js';

export function Funnel({ total, sent, delivered, read, failed }) {
  const t = total || 1;
  const onTheWay = Math.max(0, (sent ?? delivered) - delivered);
  return (
    <div className="progress" aria-label={`${read} read, ${delivered - read} delivered, ${onTheWay} sent, ${failed} failed of ${total}`}>
      <span style={{ width: `${(read / t) * 100}%`, background: 'var(--read)' }} />
      <span style={{ width: `${((delivered - read) / t) * 100}%`, background: 'var(--wa)' }} />
      <span style={{ width: `${(onTheWay / t) * 100}%`, background: 'var(--text-3)', opacity: 0.45 }} />
      <span style={{ width: `${(failed / t) * 100}%`, background: 'var(--bad)' }} />
    </div>
  );
}

/** Sent messages and Spending sit side by side as two tabs. */
export function SentTabs() {
  return (
    <nav className="tabs" aria-label="Sent messages" style={{ maxWidth: 420 }}>
      <NavLink end to="/campaigns" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`}>Messages</NavLink>
      <NavLink to="/spending" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`}>Spending</NavLink>
    </nav>
  );
}

const SHOW = [['all', 'All'], ['scheduled', 'Scheduled'], ['done', 'Sent'], ['test', 'Tests']];
const PERIODS = [['all', 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 3 months']];
function keep(c, q, show, period) {
  if (!matches(q, c.name, c.template_name)) return false;
  const isTest = c.name.startsWith('Test · ');
  if (show === 'test' && !isTest) return false;
  if (show === 'scheduled' && c.status !== 'scheduled') return false;
  if (show === 'done' && (isTest || c.status === 'scheduled')) return false;
  if (period !== 'all' && Date.parse(c.started_at || c.created_at) < Date.now() - Number(period) * 86400e3) return false;
  return true;
}

export const PROVIDER_NAMES = { mock: 'test mode', twilio: 'Twilio WhatsApp', meta: 'Meta WhatsApp Cloud API' };

export default function Campaigns() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [period, setPeriod] = useState('all');
  useEffect(() => {
    api('/api/campaigns').then((r) => setList(r.campaigns)).catch(() => setList([]));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sent messages</h1>
          <p>Everything you sent, and how many customers got it and read it.</p>
        </div>
        <Link to="/campaigns/new" className="btn primary"><Plus size={18} />Send a message</Link>
      </div>
      <SentTabs />

      {!list ? (
        <div className="card stack" style={{ padding: 20 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={48} />)}</div>
      ) : list.length === 0 ? (
        <div className="card">
          <Empty icon={Send} title="Nothing sent yet" actions={<Link to="/campaigns/new" className="btn primary"><Plus size={18} />Send your first message</Link>}>
            Everything you send shows here, with how many read it and replied.
          </Empty>
        </div>
      ) : (
        <div className="card">
          <div className="list-tools">
            <SearchBox value={q} onChange={setQ} placeholder="Search by message or template" style={{ flex: '1 1 220px' }} />
            <div className="chips">
              {SHOW.map(([k, label]) => <button key={k} type="button" className={`chip ${show === k ? 'on' : ''}`} onClick={() => setShow(k)}>{label}</button>)}
            </div>
            <select className="input" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="When">
              {PERIODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div className="card-head legend">
            <span><i style={{ background: 'var(--read)' }} />Read</span>
            <span><i style={{ background: 'var(--wa)' }} />Reached phone</span>
            <span><i style={{ background: 'var(--text-3)', opacity: 0.45 }} />Sent</span>
            <span><i style={{ background: 'var(--bad)' }} />Couldn’t reach</span>
          </div>
          {list.filter((c) => keep(c, q, show, period)).length === 0 && <p className="subtle" style={{ padding: 20 }}>Nothing matches. Try other words or another period.</p>}
          {list.filter((c) => keep(c, q, show, period)).map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b>
                  <CampaignStatus status={c.status} />
                  {c.name.startsWith('Test · ') && <span className="badge neutral">Test to my phone</span>}
                  {c.provider === 'mock' && <span className="badge warn">Test mode: not really sent</span>}
                </div>
                <div className="subtle">
                  {c.status === 'scheduled' ? `Goes out ${dateTime(c.scheduled_at)}` : dateTime(c.started_at || c.created_at)} · {c.template_name}
                </div>
              </div>
              <div style={{ flex: '1 1 220px' }} className="stack-sm">
                <Funnel total={c.total} sent={c.sent} delivered={c.delivered} read={c.read} failed={c.failed} />
                <div className="subtle num">
                  {num(c.total)} customers · {pct(c.read, c.total)}% read{c.failed ? ` · ${num(c.failed)} couldn’t be reached` : ''}{c.pending ? ` · ${num(c.pending)} waiting` : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
