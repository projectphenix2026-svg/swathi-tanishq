import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { avatarColors, initials } from '../lib/format.js';

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.tone === 'bad' ? <AlertCircle size={18} /> : t.tone === 'info' ? <Info size={18} /> : <CheckCircle2 size={18} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Bits ---------- */
export function Spinner({ size = 18 }) {
  return <Loader2 size={size} className="spin" aria-label="Loading" />;
}

export function Avatar({ name, seed, size = 38 }) {
  return (
    <div className="avatar" style={{ ...avatarColors(seed || name), width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      {initials(name)}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, actions }) {
  return (
    <div className="empty">
      <div className="empty-art">{Icon && <Icon size={34} strokeWidth={1.6} />}</div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="row wrap" style={{ justifyContent: 'center', marginTop: 6 }}>{actions}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', icon: Icon = Info, children, action }) {
  return (
    <div className={`alert ${tone}`}>
      <Icon size={18} />
      <div style={{ flex: 1 }}>{children}</div>
      {action}
    </div>
  );
}

export function Kpi({ icon: Icon, tone = 'brand', label, value, sub }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">
        <span className={`kpi-icon tone-${tone}`}><Icon size={16} /></span>
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', style }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}

/* ---------- Modal (a bottom sheet on phones) ---------- */
export function Modal({ title, onClose, children, footer, width }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, textarea, select, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={width ? { maxWidth: width } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Status pills ---------- */
const CAMPAIGN = {
  pending_approval: ['warn', 'Waiting for approval'],
  scheduled: ['info', 'Scheduled'],
  sending: ['warn', 'Sending'],
  completed: ['ok', 'Completed'],
  cancelled: ['neutral', 'Cancelled'],
};
export function CampaignStatus({ status }) {
  const [tone, label] = CAMPAIGN[status] || ['neutral', status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

const MESSAGE = {
  queued: ['neutral', 'Waiting'],
  retrying: ['warn', 'Retrying'],
  sending: ['warn', 'Sending'],
  sent: ['info', 'Sent'],
  delivered: ['ok', 'Delivered'],
  read: ['ok', 'Read'],
  failed: ['bad', 'Failed'],
  cancelled: ['neutral', 'Skipped'],
  preview: ['info', 'SMS preview'],
};
export function MessageStatus({ status }) {
  const [tone, label] = MESSAGE[status] || ['neutral', status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function OptInBadge({ c }) {
  if (c.opted_out_at) return <span className="badge bad">Opted out</span>;
  if (c.whatsapp_opt_in) return <span className="badge ok">Can receive</span>;
  return <span className="badge warn">No opt-in</span>;
}

/** Label + control + hint/error. A single input, select or textarea child is linked to the label automatically. */
export function Field({ label, hint, error, children, htmlFor }) {
  const autoId = useId();
  const linkable = isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type);
  const id = htmlFor || (linkable ? children.props.id || autoId : undefined);
  const hintId = `${autoId}-hint`;
  const control = linkable
    ? cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? hintId : undefined })
    : children;
  return (
    <div className="field">
      {label && (id ? <label htmlFor={id}>{label}</label> : <span className="label">{label}</span>)}
      {control}
      {error ? (
        <span className="error-text" id={hintId} role="alert"><AlertCircle size={14} style={{ marginTop: 2 }} />{error}</span>
      ) : hint ? (
        <span className="hint" id={hintId}>{hint}</span>
      ) : null}
    </div>
  );
}
