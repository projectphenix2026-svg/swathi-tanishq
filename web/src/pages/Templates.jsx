import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText, Phone, Plus, Reply } from 'lucide-react';
import { api } from '../lib/api.js';
import { Empty, Skeleton } from '../components/ui.jsx';
import { dateOnly } from '../lib/format.js';
import { toFriendly } from '../lib/friendly.js';

const STATUS = { approved: ['ok', 'Ready to send'], draft: ['neutral', 'Not finished'], rejected: ['bad', 'Rejected'] };

export default function Templates() {
  const [list, setList] = useState(null);
  useEffect(() => {
    api('/api/templates').then((r) => setList(r.templates)).catch(() => setList([]));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Saved messages</h1>
          <p>Messages you can send again and again. Each customer gets their own name and details.</p>
        </div>
        <Link to="/templates/new" className="btn primary"><Plus size={18} />Write a message</Link>
      </div>
      {!list ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {[0, 1, 2].map((i) => <div key={i} className="card card-pad"><Skeleton h={16} w="50%" /><Skeleton h={80} style={{ marginTop: 14 }} /></div>)}
        </div>
      ) : list.length === 0 ? (
        <div className="card">
          <Empty icon={FileText} title="Write your first message" actions={<Link to="/templates/new" className="btn primary"><Plus size={18} />Write a message</Link>}>
            A good message greets the customer by name, mentions something personal like their last purchase, and gives a real offer with an end date.
          </Empty>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {list.map((t) => {
            const [tone, label] = STATUS[t.status] || ['neutral', t.status];
            return (
              <Link key={t.id} to={`/templates/${t.id}`} className="card card-pad stack" style={{ textDecoration: 'none', color: 'inherit', gap: 12 }}>
                <div className="row between">
                  <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</h3>
                  <span className={`badge ${tone}`}>{label}</span>
                </div>
                <div style={{ background: 'var(--wa-chat)', borderRadius: 12, padding: 12 }}>
                  <div className="bubble" style={{ maxWidth: '100%', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{toFriendly(t.body)}</div>
                  {t.buttons.length > 0 && (
                    <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                      {t.buttons.map((b, i) => (
                        <span key={i} className="wa-btn" style={{ padding: '5px 10px', fontSize: '0.8rem' }}>
                          {b.type === 'url' ? <ExternalLink size={13} /> : b.type === 'phone' ? <Phone size={13} /> : <Reply size={13} />}{b.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="subtle">Updated {dateOnly(t.updated_at)}{t.used_in ? ` · sent ${t.used_in} time${t.used_in > 1 ? 's' : ''}` : ''}</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
