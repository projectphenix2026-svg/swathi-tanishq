import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock, ExternalLink, FlaskConical, Inbox as InboxIcon, Lock, Phone, Reply, SendHorizontal } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Avatar, Empty, SectionTabs, Spinner, useToast } from '../components/ui.jsx';
import { ago, dateOnly, phone, timeOnly } from '../lib/format.js';

const QUICK = ['Thank you! We will call you shortly.', 'Yes, the offer is valid all week.', 'You are welcome to visit us any day, 10 am – 9 pm.'];

export default function Inbox() {
  const { contactId } = useParams();
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState('all');

  const loadList = useCallback(() => {
    api(`/api/inbox${filter === 'unread' ? '?filter=unread' : ''}`).then((r) => setList(r.conversations)).catch(() => setList([]));
  }, [filter]);

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, 6000);
    return () => clearInterval(t);
  }, [loadList]);

  const showList = !contactId;
  return (
    <div className="inbox">
      <section className="convo-list" style={{ display: showList ? undefined : 'none' }} data-desktop-show>
        <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ fontSize: '1.3rem' }}>Replies</h1>
          <p className="subtle" style={{ marginBottom: 10 }}>What customers wrote back, newest first.</p>
          <div style={{ marginBottom: 10 }}><SectionTabs tabs={[{ to: '/inbox', label: 'Messages' }, { to: '/leads', label: 'Call back list' }]} /></div>
          <div className="chips">
            <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
            <button className={`chip ${filter === 'unread' ? 'on' : ''}`} onClick={() => setFilter('unread')}>Unread</button>
          </div>
        </div>
        {!list ? (
          <div style={{ padding: 20 }}><Spinner /></div>
        ) : list.length === 0 ? (
          <Empty icon={InboxIcon} title={filter === 'unread' ? 'All caught up' : 'No replies yet'}>
            {filter === 'unread' ? 'Every reply has been read.' : 'When customers reply to an offer or tap a button, their message shows up here.'}
          </Empty>
        ) : (
          list.map((c) => (
            <Link key={c.contact_id} to={`/inbox/${c.contact_id}`} className={`convo ${String(c.contact_id) === contactId ? 'on' : ''}`}>
              <Avatar name={c.name} seed={c.phone} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || phone(c.phone)}</b>
                  <span className="subtle" style={{ flexShrink: 0, color: c.unread ? 'var(--wa)' : undefined }}>{ago(c.last_at)}</span>
                </div>
                <div className="row between" style={{ gap: 8 }}>
                  <span className="snippet">{c.last_direction === 'outbound' ? 'You: ' : ''}{c.last_body}</span>
                  {c.unread > 0 && <span className="unread">{c.unread}</span>}
                </div>
              </div>
            </Link>
          ))
        )}
      </section>
      {contactId ? <Thread key={contactId} contactId={contactId} onChange={loadList} /> : <NoThread />}
      <style>{`@media (min-width: 900px) { [data-desktop-show] { display: block !important; } }`}</style>
    </div>
  );
}

function NoThread() {
  return (
    <section className="thread hide-mobile" style={{ display: undefined }}>
      <div style={{ margin: 'auto' }}>
        <Empty icon={InboxIcon} title="Choose a conversation">Pick a customer on the left to read and reply.</Empty>
      </div>
    </section>
  );
}

function Thread({ contactId, onChange }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useAuth();
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef(null);
  const requestId = useRef(crypto.randomUUID());
  const lastCount = useRef(0);

  const load = useCallback(() => {
    api(`/api/inbox/${contactId}`)
      .then((r) => {
        setData(r);
        if (r.messages.length !== lastCount.current) {
          lastCount.current = r.messages.length;
          requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: 'end' }));
          onChange();
        }
      })
      .catch((e) => toast(e.message, 'bad'));
  }, [contactId, onChange, toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function send(body = text) {
    if (!body.trim()) return;
    setSending(true);
    try {
      await api(`/api/inbox/${contactId}/reply`, { method: 'POST', body: { body, clientRequestId: requestId.current } });
      requestId.current = crypto.randomUUID();
      setText('');
      load();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setSending(false);
    }
  }

  async function simulate() {
    const body = prompt('Pretend the customer wrote:', 'Interested');
    if (!body) return;
    await api('/api/inbox/simulate', { method: 'POST', body: { contactId: Number(contactId), body } }).catch((e) => toast(e.message, 'bad'));
    load();
  }

  if (!data) return <section className="thread" style={{ display: 'grid', placeItems: 'center' }}><Spinner /></section>;
  const { contact, messages, windowOpen } = data;
  const optedOut = Boolean(contact.opted_out_at);
  let lastDay = '';

  return (
    <section className="thread">
      <header className="thread-head">
        <button className="icon-btn show-mobile" onClick={() => navigate('/inbox')} aria-label="Back to inbox"><ArrowLeft size={20} /></button>
        <Avatar name={contact.name} seed={contact.phone} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{contact.name || phone(contact.phone)}</b>
          <div className="subtle num">{phone(contact.phone)}{contact.city ? ` · ${contact.city}` : ''}{contact.last_purchase ? ` · bought ${contact.last_purchase}` : ''}</div>
        </div>
        {optedOut && <span className="badge bad">Said STOP</span>}
        {settings?.provider.name === 'mock' && (
          <button className="btn sm" onClick={simulate} title="Test mode: pretend the customer replied"><FlaskConical size={15} /><span className="hide-mobile">Customer reply</span></button>
        )}
      </header>

      <div className="thread-body">
        {messages.map((m) => {
          const day = dateOnly(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && <span className="wa-day">{day}</span>}
              <div className={`msg ${m.direction === 'inbound' ? 'in' : 'out'}`}>
                {m.direction === 'outbound' && (m.campaign_name || m.sent_by_name) && (
                  <span className="tag">{m.campaign_name ? `Offer: ${m.campaign_name}` : `Reply by ${m.sent_by_name}`}</span>
                )}
                {m.body}
                {m.buttons?.length > 0 && (
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                    {m.buttons.map((b, i) => (
                      <span key={i} className="wa-btn" style={{ padding: 6, fontSize: '0.82rem' }}>
                        {b.type === 'url' ? <ExternalLink size={13} /> : b.type === 'phone' ? <Phone size={13} /> : <Reply size={13} />}{b.text}
                      </span>
                    ))}
                  </span>
                )}
                <span className={`meta ${m.status === 'read' ? 'read' : m.status === 'failed' ? 'failed' : ''}`}>
                  {timeOnly(m.created_at)}
                  {m.direction === 'outbound' && <Tick status={m.status} />}
                </span>
                {m.status === 'failed' && m.error_message && <span className="meta failed" style={{ justifyContent: 'flex-start' }}>{m.error_message}</span>}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <footer className="composer">
        {optedOut ? (
          <div className="row subtle" style={{ gap: 8 }}><Lock size={16} />This customer replied STOP, so no more messages can be sent.</div>
        ) : !windowOpen ? (
          <div className="row subtle" style={{ gap: 8 }}><Clock size={16} />More than 24 hours since they last wrote. WhatsApp only allows a free reply within 24 hours; reach them with a saved message (send an offer) template instead.</div>
        ) : (
          <>
            <div className="chips no-scrollbar" style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
              {QUICK.map((q) => <button key={q} className="chip" style={{ flexShrink: 0, height: 30, fontSize: '0.8rem' }} onClick={() => setText(q)}>{q}</button>)}
            </div>
            <div className="row">
              <textarea
                className="textarea"
                rows={1}
                placeholder="Type a reply"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                aria-label="Reply"
              />
              <button className="send-btn" onClick={() => send()} disabled={!text.trim() || sending} aria-label="Send reply">
                {sending ? <Spinner /> : <SendHorizontal size={20} />}
              </button>
            </div>
          </>
        )}
      </footer>
    </section>
  );
}

function Tick({ status }) {
  if (status === 'failed') return <AlertCircle size={13} />;
  if (status === 'read' || status === 'delivered') return <CheckCheck size={14} />;
  if (status === 'sent') return <Check size={14} />;
  return <Clock size={12} />;
}
