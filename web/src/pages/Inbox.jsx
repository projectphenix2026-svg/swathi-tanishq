import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { SelectBar, allTicked, toggleIn } from '../components/SelectBar.jsx';
import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock, ExternalLink, FileText, FlaskConical, Inbox as InboxIcon, Lock, Phone, Reply, SendHorizontal } from 'lucide-react';
import { SearchBox, matches } from '../components/SearchBox.jsx';
import { api, apiUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Avatar, Empty, SectionTabs, Spinner, useToast } from '../components/ui.jsx';
import { useT } from '../lib/i18n.jsx';
import { ago, dateOnly, phone, timeOnly } from '../lib/format.js';
import { Highlighted } from '../components/PhonePreview.jsx';

const QUICK = ['Thank you! We will call you shortly.', 'Yes, the offer is valid all week.', 'You are welcome to visit us any day, 10 am – 9 pm.'];

export default function Inbox() {
  const { t } = useT();
  const { contactId } = useParams();
  const { counts, refreshCounts } = useOutletContext() || {};
  const toastList = useToast();
  // Ticked chats: mark them read at once.
  const [sel, setSel] = useState(new Set());
  async function markRead() {
    try {
      const r = await api('/api/inbox/read', { method: 'POST', body: { contactIds: [...sel] } });
      toastList(`${r.done} message${r.done === 1 ? '' : 's'} marked read`);
      setSel(new Set());
      loadList();
      refreshCounts?.();
    } catch (e) {
      toastList(e.message, 'bad');
    }
  }
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

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
          <h1 style={{ fontSize: '1.3rem' }}>{t('Replies')}</h1>
          <p className="subtle" style={{ marginBottom: 10 }}>{t('What customers wrote back, newest first.')}</p>
          <div style={{ marginBottom: 10 }}><SectionTabs tabs={[{ to: '/inbox', label: t('Chats'), count: counts?.unread }, { to: '/leads', label: t('Interested'), count: counts?.leads }]} /></div>
          <SearchBox value={q} onChange={setQ} placeholder={t('Search name, phone or message')} style={{ marginBottom: 8 }} />
          <div className="chips">
            <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>{t('All')}</button>
            <button className={`chip ${filter === 'unread' ? 'on' : ''}`} onClick={() => setFilter('unread')}>{t('Unread')}</button>
          </div>
        </div>
        {sel.size > 0 && (
          <div style={{ padding: '8px 10px 0' }}>
            <SelectBar count={sel.size} onClear={() => setSel(new Set())}>
              <button className="btn sm primary" onClick={markRead}><CheckCheck size={15} />Mark as read</button>
            </SelectBar>
          </div>
        )}
        {list?.length > 0 && (
          <label className="row tick" style={{ gap: 8, padding: '8px 16px 0', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={allTicked(sel, list.map((c) => c.contact_id))} onChange={(e) => setSel(e.target.checked ? new Set(list.map((c) => c.contact_id)) : new Set())} />
            <span className="subtle">Select all</span>
          </label>
        )}
        {!list ? (
          <div style={{ padding: 20 }}><Spinner /></div>
        ) : list.length === 0 ? (
          <Empty icon={InboxIcon} title={filter === 'unread' ? 'All caught up' : 'No replies yet'} actions={filter === 'unread' ? null : <Link to="/campaigns/new" className="btn primary">Send a message</Link>}>
            {filter === 'unread' ? 'Every reply has been read.' : 'When customers reply to a message, you answer them here. Replies within 24 hours are free.'}
          </Empty>
        ) : !list.some((c) => matches(q, c.name, c.phone, preview(c.last_body, c.last_media))) ? (
          <p className="subtle" style={{ padding: 16 }}>{t('Nobody matches.')}</p>
        ) : (
          list.filter((c) => matches(q, c.name, c.phone, preview(c.last_body, c.last_media))).map((c) => (
            <Link key={c.contact_id} to={`/inbox/${c.contact_id}`} className={`convo ${String(c.contact_id) === contactId ? 'on' : ''} ${sel.has(c.contact_id) ? 'ticked' : ''}`}>
              <span className="tick" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSel((x) => toggleIn(x, c.contact_id)); }} style={{ alignSelf: 'center' }}>
                <input type="checkbox" readOnly tabIndex={-1} checked={sel.has(c.contact_id)} aria-label={`Select ${c.name || phone(c.phone)}`} />
              </span>
              <Avatar name={c.name} seed={c.phone} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || phone(c.phone)}</b>
                  <span className="subtle" style={{ flexShrink: 0, color: c.unread ? 'var(--wa)' : undefined }}>{ago(c.last_at)}</span>
                </div>
                <div className="row between" style={{ gap: 8 }}>
                  <span className="snippet">{c.last_direction === 'outbound' ? 'You: ' : ''}{preview(c.last_body, c.last_media)}</span>
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

  const { refreshCounts } = useOutletContext() || {};
  const load = useCallback(() => {
    api(`/api/inbox/${contactId}`)
      .then((r) => {
        setData(r);
        refreshCounts?.(); // this chat is now read
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
                {m.direction === 'inbound' && <InboundMedia m={m} />}
                {m.body && !OLD_PLACEHOLDER.test(m.body) && <Highlighted body={m.body} values={{}} />}
                {m.buttons?.length > 0 && (
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                    {m.buttons.map((b, i) => (
                      <span key={i} className="wa-btn" style={{ padding: 6, fontSize: '0.82rem' }}>
                        {b.type === 'url' ? <ExternalLink size={13} /> : b.type === 'phone' ? <Phone size={13} /> : <Reply size={13} />}{b.text}
                      </span>
                    ))}
                  </span>
                )}
                <span className={`meta ${m.provider === 'mock' ? '' : m.status === 'read' ? 'read' : m.status === 'failed' ? 'failed' : ''}`}>
                  {timeOnly(m.created_at)}
                  {m.direction === 'outbound' && (m.provider === 'mock'
                    ? <span className="pretend" title="Sent while Sandesh was in Test mode: it did not reach the customer">Test mode: not sent</span>
                    : <Tick status={m.status} />)}
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
          <div className="row subtle" style={{ gap: 8 }}><Clock size={16} />More than 24 hours since they last wrote. WhatsApp only allows a free reply within 24 hours; reach them by sending a template (an offer) instead.</div>
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

// What customers send besides words. Meta's file is fetched (free) the first time someone opens it.
const MEDIA_LABEL = { image: 'Photo', video: 'Video', audio: 'Voice note', document: 'Document', sticker: 'Sticker', revoke: 'Deleted message', unsupported: 'Message WhatsApp could not pass on' };
// Saved before Sandesh showed files: "[image message]", "[unsupported message]" and so on.
const OLD_PLACEHOLDER = /^\[(\w+) message\]$/;

/** The list's one-line preview: the words, or what kind of file it was. */
function preview(body, media) {
  const old = OLD_PLACEHOLDER.exec(body || '');
  const kind = media || old?.[1];
  if (body && !old) return kind && MEDIA_LABEL[kind] ? `${MEDIA_LABEL[kind]}: ${body}` : body;
  return MEDIA_LABEL[kind] || (kind ? `${kind[0].toUpperCase()}${kind.slice(1)}` : '');
}

function InboundMedia({ m }) {
  const [broken, setBroken] = useState(false);
  const kind = m.media_type || OLD_PLACEHOLDER.exec(m.body || '')?.[1];
  if (!kind) return null;
  const onPhone = 'Open WhatsApp on the shop phone to see it.';
  if (kind === 'revoke') return <span className="msg-note">The customer deleted this message.</span>;
  if (kind === 'unsupported') return <span className="msg-note">WhatsApp did not pass this message on (for example a view-once photo, a poll or an edited message). {onPhone}</span>;
  const label = MEDIA_LABEL[kind] || 'File';
  if (!m.has_file || broken) return <span className="msg-note">{label}: {broken ? 'could not be loaded from WhatsApp.' : 'arrived before Sandesh could show files.'} {onPhone}</span>;
  const src = apiUrl(`/api/inbox/media/${m.id}`);
  const fail = () => setBroken(true);
  if (kind === 'image' || kind === 'sticker') {
    return <a href={src} target="_blank" rel="noreferrer" className="msg-media"><img src={src} alt={label} loading="lazy" onError={fail} className={kind === 'sticker' ? 'sticker' : ''} /></a>;
  }
  if (kind === 'video') return <video className="msg-media" src={src} controls preload="metadata" onError={fail} />;
  if (kind === 'audio') return <audio className="msg-audio" src={src} controls preload="none" onError={fail} />;
  return <a href={src} target="_blank" rel="noreferrer" className="msg-file"><FileText size={20} /><span className="ellipsis">{m.media_name || 'Document'}</span></a>;
}
