import { ExternalLink, Phone, Reply } from 'lucide-react';
import { timeOnly } from '../lib/format.js';

const PLACEHOLDER = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/**
 * A WhatsApp-style phone showing exactly what the customer sees.
 * Filled-in personal values are highlighted in gold; missing ones in red.
 */
export function PhonePreview({ body, values, buttons = [], imageUrl, businessName = 'Swathi Tanishq', caption }) {
  return (
    <figure style={{ margin: 0 }}>
      <div className="phone" aria-label="Message preview">
        <div className="phone-screen">
          <div className="phone-bar">
            <div className="avatar">ST</div>
            <div>
              <b>{businessName}</b>
              <small>Business account</small>
            </div>
          </div>
          <div className="phone-body">
            <span className="wa-day">Today</span>
            {body ? (
              <>
                <div className="bubble">
                  {imageUrl && <img src={imageUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                  <Highlighted body={body} values={values} />
                  <span className="meta">{timeOnly(new Date())}</span>
                </div>
                {buttons.length > 0 && (
                  <div className="wa-buttons">
                    {buttons.map((b, i) => (
                      <div className="wa-btn" key={i}>
                        {b.type === 'url' ? <ExternalLink size={15} /> : b.type === 'phone' ? <Phone size={15} /> : <Reply size={15} />}
                        {b.text || 'Button'}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="bubble" style={{ color: 'var(--text-3)' }}>Your message will appear here.</div>
            )}
          </div>
        </div>
      </div>
      {caption && <figcaption className="subtle" style={{ textAlign: 'center', marginTop: 12 }}>{caption}</figcaption>}
    </figure>
  );
}

function Highlighted({ body, values }) {
  if (!values) return body;
  const parts = [];
  let last = 0;
  for (const m of body.matchAll(PLACEHOLDER)) {
    parts.push(body.slice(last, m.index));
    const key = m[1].toLowerCase();
    const v = values[key];
    parts.push(
      v ? (
        <span className="var" key={m.index} title={`{{${key}}}`}>{v}</span>
      ) : (
        <span className="var missing" key={m.index} title="No value for this customer">{`{{${key}}}`}</span>
      ),
    );
    last = m.index + m[0].length;
  }
  parts.push(body.slice(last));
  return parts;
}
