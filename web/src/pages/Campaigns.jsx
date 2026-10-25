import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { AlertCircle, Check, CheckCheck, Clock, Plus, Send, XCircle } from 'lucide-react';
import { SearchBox, matches } from '../components/SearchBox.jsx';
import { SortTh, useSort } from '../components/SortHead.jsx';
import { api } from '../lib/api.js';
import { CampaignStatus, Empty, Pic, Skeleton, Spinner, useToast } from '../components/ui.jsx';
import { iconFor } from '../lib/ready.js';
import { useAuth } from '../lib/auth.js';
import { atLeast } from '@shared/roles.js';
import { dateTime, num, pct, phone, plural } from '../lib/format.js';
import { toFriendly } from '../lib/friendly.js';

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

/** Campaigns and Spending sit side by side as two tabs. */
export function SentTabs() {
  return (
    <nav className="tabs" aria-label="Campaigns" style={{ maxWidth: 420 }}>
      <NavLink end to="/campaigns" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`}>Campaigns</NavLink>
      <NavLink to="/spending" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`}>Spending</NavLink>
    </nav>
  );
}

const SHOW = [['all', 'All'], ['waiting', 'Waiting'], ['scheduled', 'Scheduled'], ['done', 'Sent'], ['test', 'Tests']];
const PERIODS = [['all', 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 3 months']];
function keep(c, q, show, period) {
  if (!matches(q, c.name, c.template_name, c.first_name, c.first_phone, c.first_body)) return false;
  const isTest = c.name.startsWith('Test · ');
  if (show === 'test' && !isTest) return false;
  if (show === 'scheduled' && c.status !== 'scheduled') return false;
  if (show === 'waiting' && !(Number(c.pending) > 0)) return false;
  if (show === 'done' && (isTest || c.status === 'scheduled')) return false;
  if (period !== 'all' && Date.parse(c.started_at || c.created_at) < Date.now() - Number(period) * 86400e3) return false;
  return true;
}

export const PROVIDER_NAMES = { mock: 'test mode', twilio: 'Twilio WhatsApp', meta: 'Meta WhatsApp Cloud API' };

export default function Campaigns() {
  const { settings } = useAuth();
  const canSend = atLeast(settings?.role, 'manager');
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [period, setPeriod] = useState('all');
  const toast = useToast();
  const navigate = useNavigate();
  const [cancelling, setCancelling] = useState(null);
  const load = () => api('/api/campaigns').then((r) => setList(r.campaigns)).catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);
  // Newest first unless a heading is clicked.
  const { sorted: shown, sort, toggle } = useSort((list || []).filter((c) => keep(c, q, show, period)), {
    name: (c) => c.name.replace(/^Test · /, '').toLowerCase(),
    when: (c) => Date.parse(c.started_at || c.scheduled_at || c.created_at),
    to: (c) => Number(c.total || 0),
    read: (c) => (Number(c.total) ? Number(c.read) / Number(c.total) : -1),
  });

  // "Trying again" or still queued: stop what has not gone out yet.
  async function cancelWaiting(c) {
    const what = Number(c.total) === 1 ? `the message to ${c.first_name || phone(c.first_phone)}` : `${plural(c.pending, 'message')} still waiting`;
    if (!confirm(`Cancel ${what}? Messages already delivered stay delivered.`)) return;
    setCancelling(c.id);
    try {
      const r = await api(`/api/campaigns/${c.id}/cancel`, { method: 'POST' });
      toast(`Cancelled. ${plural(r.cancelled, 'message')} will not be sent.`);
      await load();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setCancelling(null);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <p>Everything you sent, and how many customers got it and read it.</p>
        </div>
        {canSend && <Link to="/campaigns/new" className="btn primary"><Plus size={18} />Send a message</Link>}
      </div>
      <SentTabs />

      {!list ? (
        <div className="card stack" style={{ padding: 20 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={48} />)}</div>
      ) : list.length === 0 ? (
        <div className="card">
          <Empty icon={Send} title="Nothing sent yet" actions={canSend ? <Link to="/campaigns/new" className="btn primary"><Plus size={18} />Send your first message</Link> : null}>
            Everything you send shows here, with how many read it and replied.
          </Empty>
        </div>
      ) : (
        <div className="card">
          <div className="list-tools">
            <SearchBox value={q} onChange={setQ} placeholder="Search by message, customer or number" style={{ flex: '1 1 220px' }} />
            <div className="chips">
              {SHOW.map(([k, label]) => <button key={k} type="button" className={`chip ${show === k ? 'on' : ''}`} onClick={() => setShow(k)}>{label}</button>)}
            </div>
            <select className="select" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="When">
              {PERIODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          {shown.length === 0 ? <p className="subtle" style={{ padding: 20 }}>Nothing matches. Try other words or another period.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th><span className="row" style={{ gap: 14 }}><SortTh as="span" label="Message" k="name" sort={sort} toggle={toggle} /><SortTh as="span" label="When" k="when" sort={sort} toggle={toggle} /></span></th>
                    <SortTh label="Sent to" k="to" sort={sort} toggle={toggle} />
                    <SortTh label="What happened" k="read" sort={sort} toggle={toggle} />
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/campaigns/${c.id}`)}>
                      <td className="cell-main">
                        <span className="row" style={{ gap: 8, minWidth: 0 }}>
                          <Pic name={iconFor(c.template_name || c.name)} size={26} />
                          <b className="ellipsis">{c.name.replace(/^Test · /, '')}</b>
                          {c.name.startsWith('Test · ') && <span className="badge neutral">Test</span>}
                          {c.provider === 'mock' && <span className="badge warn">Test mode</span>}
                        </span>
                        {c.first_body && <div className="cell-sub ellipsis">{toFriendly(c.first_body).replace(/\s*\n+\s*/g, ' ')}</div>}
                        <div className="subtle cell-sub">{c.status === 'scheduled' ? `Goes out ${dateTime(c.scheduled_at)}` : dateTime(c.started_at || c.created_at)}</div>
                      </td>
                      <td className="nowrap">
                        {Number(c.total) === 1 && c.first_phone ? (
                          <><b>{c.first_name || phone(c.first_phone)}</b>{c.first_name && <div className="subtle num">{phone(c.first_phone)}</div>}</>
                        ) : <b className="num">{plural(c.total, 'customer')}</b>}
                      </td>
                      <td><Outcome c={c} /></td>
                      <td className="cell-actions" onClick={(e) => e.stopPropagation()}>
                        {canSend && Number(c.pending) > 0 && c.status !== 'pending_approval' && (
                          <button type="button" className="btn sm danger ghost" disabled={cancelling === c.id} onClick={() => cancelWaiting(c)}>
                            {cancelling === c.id ? <Spinner /> : <><XCircle size={15} />Cancel{Number(c.total) > 1 ? ` ${num(c.pending)} waiting` : ''}</>}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** What happened, in words with the matching tick: the main state first, then the rest. */
function Outcome({ c }) {
  const total = Number(c.total) || 0;
  const read = Number(c.read) || 0;
  const delivered = Number(c.delivered) || 0;
  const failed = Number(c.failed) || 0;
  const pending = Number(c.pending) || 0;
  if (c.status === 'scheduled') return <span className="outcome wait"><Clock size={15} />Scheduled</span>;
  if (c.status === 'pending_approval') return <span className="outcome wait"><Clock size={15} />Waiting for the owner’s OK</span>;
  if (total === 1) {
    if (failed) return <span className="outcome bad" title={c.last_error || ''}><AlertCircle size={15} /><span>Couldn’t reach<small>{c.last_error}</small></span></span>;
    if (pending) return <span className="outcome wait"><Clock size={15} /><span>{c.retrying ? 'Trying again tomorrow' : 'Waiting to go out'}{c.retrying && <small>Meta limits how many offers one person gets from all businesses in a day.</small>}</span></span>;
    if (read) return <span className="outcome read"><CheckCheck size={15} />Read</span>;
    if (delivered) return <span className="outcome ok"><CheckCheck size={15} />Reached the phone</span>;
    if (c.status === 'cancelled') return <span className="outcome muted"><XCircle size={15} />Cancelled</span>;
    return <span className="outcome muted"><Check size={15} />Sent</span>;
  }
  const parts = [
    read && <span key="r" className="outcome read"><CheckCheck size={14} />{num(read)} read</span>,
    delivered - read > 0 && <span key="d" className="outcome ok"><CheckCheck size={14} />{num(delivered - read)} reached</span>,
    pending && <span key="w" className="outcome wait"><Clock size={14} />{num(pending)} waiting</span>,
    failed && <span key="f" className="outcome bad" title={c.last_error || ''}><AlertCircle size={14} />{num(failed)} couldn’t reach</span>,
  ].filter(Boolean);
  return parts.length ? <span className="outcome-list">{parts}</span> : <span className="outcome muted"><Check size={14} />{plural(total, 'message')} sent</span>;
}
