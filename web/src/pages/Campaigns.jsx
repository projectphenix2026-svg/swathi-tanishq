import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Send } from 'lucide-react';
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

export const PROVIDER_NAMES = { mock: 'test mode', twilio: 'Twilio WhatsApp', meta: 'Meta WhatsApp Cloud API' };

export default function Campaigns() {
  const [list, setList] = useState(null);
  useEffect(() => {
    api('/api/campaigns').then((r) => setList(r.campaigns)).catch(() => setList([]));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <p>Every send, with how many customers received and read it.</p>
        </div>
        <Link to="/campaigns/new" className="btn primary"><Plus size={18} />New campaign</Link>
      </div>

      {!list ? (
        <div className="card stack" style={{ padding: 20 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={48} />)}</div>
      ) : list.length === 0 ? (
        <div className="card">
          <Empty icon={Send} title="No campaigns yet" actions={<Link to="/campaigns/new" className="btn primary"><Plus size={18} />Create your first campaign</Link>}>
            Pick who to send to, choose a message, check the preview and cost, and send. Most staff finish in under five minutes.
          </Empty>
        </div>
      ) : (
        <div className="card">
          <div className="card-head legend">
            <span><i style={{ background: 'var(--read)' }} />Read</span>
            <span><i style={{ background: 'var(--wa)' }} />Delivered</span>
            <span><i style={{ background: 'var(--text-3)', opacity: 0.45 }} />Sent</span>
            <span><i style={{ background: 'var(--bad)' }} />Failed</span>
          </div>
          {list.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b>
                  <CampaignStatus status={c.status} />
                </div>
                <div className="subtle">
                  {c.status === 'scheduled' ? `Goes out ${dateTime(c.scheduled_at)}` : dateTime(c.started_at || c.created_at)} · {c.template_name}
                </div>
              </div>
              <div style={{ flex: '1 1 220px' }} className="stack-sm">
                <Funnel total={c.total} sent={c.sent} delivered={c.delivered} read={c.read} failed={c.failed} />
                <div className="subtle num">
                  {num(c.total)} customers · {pct(c.read, c.total)}% read{c.failed ? ` · ${num(c.failed)} failed` : ''}{c.pending ? ` · ${num(c.pending)} waiting` : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
