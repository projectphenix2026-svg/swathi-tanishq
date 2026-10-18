import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { CampaignStatus, Empty, SectionTabs, Skeleton } from '../components/ui.jsx';
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
          <h1>Send offer</h1>
          <p>Every offer you sent, and how many customers got it and read it.</p>
        </div>
        <Link to="/campaigns/new" className="btn primary"><Plus size={18} />Send an offer</Link>
      </div>

      <div style={{ marginBottom: 16 }}><SectionTabs tabs={[{ to: '/campaigns', label: 'Offers sent' }, { to: '/occasions', label: 'Automatic wishes' }]} /></div>
      {!list ? (
        <div className="card stack" style={{ padding: 20 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={48} />)}</div>
      ) : list.length === 0 ? (
        <div className="card">
          <Empty icon={Send} title="No offers sent yet" actions={<Link to="/campaigns/new" className="btn primary"><Plus size={18} />Send your first offer</Link>}>
            Pick who gets it, tap a ready-made message, check how it looks and what it costs, and send. It takes about five minutes.
          </Empty>
        </div>
      ) : (
        <div className="card">
          <div className="card-head legend">
            <span><i style={{ background: 'var(--read)' }} />Read</span>
            <span><i style={{ background: 'var(--wa)' }} />Reached phone</span>
            <span><i style={{ background: 'var(--text-3)', opacity: 0.45 }} />Sent</span>
            <span><i style={{ background: 'var(--bad)' }} />Couldn’t reach</span>
          </div>
          {list.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b>
                  <CampaignStatus status={c.status} />
                  {c.name.startsWith('Test · ') && <span className="badge neutral">Test to my phone</span>}
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
