import { ExternalLink, Phone, Reply } from 'lucide-react';
import { timeOnly } from '../lib/format.js';

const PLACEHOLDER = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/**
 * A WhatsApp-style phone showing exactly what the customer sees.
 * Filled-in personal values are highlighted in gold; missing ones in red.
 */

export function PhonePreview({ body, values, buttons = [], imageUrl, videoUrl, businessName = '', caption }) {
  return (
    <figure style={{ margin: 0 }}>
      <div className="phone" aria-label="Message preview">
        <div className="phone-screen">
          <div className="phone-bar">
            <img className="avatar" src="/brand/logo.png" alt="" />
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
                  {videoUrl ? <video src={videoUrl} playsInline controls preload="metadata" />
                    : imageUrl && <img src={imageUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
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

const MARK = /\u0001(\d+)\u0002/;
// WhatsApp formatting: *bold*, _italic_, ~strike~ (no space just inside the markers).
const STYLE = /([*_~])(?=\S)([^\n]*?\S)\1(?!\w)/;
const TAGS = { '*': 'b', _: 'i', '~': 's' };

/**
 * The message as WhatsApp shows it: bold, italic, strike and line breaks, with each
 * customer's own details highlighted (gold) or flagged when missing (red).
 */
export function Highlighted({ body, values }) {
  const vars = [];
  // Placeholders become markers first, so names like {{offer_ends}} are not read as _italic_.
  const text = String(body || '').replace(PLACEHOLDER, (_, k) => {
    vars.push(k.toLowerCase());
    return `\u0001${vars.length - 1}\u0002`;
  });
  let n = 0;
  const leaf = (str) =>
    str.split(/(\u0001\d+\u0002)/).map((part) => {
      const m = part.match(MARK);
      if (!m) return part;
      const key = vars[Number(m[1])];
      const v = values?.[key];
      if (!values) return `{{${key}}}`;
      return v ? (
        <span className="var" key={`v${n++}`} title={`{{${key}}}`}>{v}</span>
      ) : (
        <span className="var missing" key={`v${n++}`} title="No value for this customer">{`{{${key}}}`}</span>
      );
    });
  const format = (str) => {
    const out = [];
    let rest = str;
    for (let m = rest.match(STYLE); m; m = rest.match(STYLE)) {
      out.push(...leaf(rest.slice(0, m.index)));
      const Tag = TAGS[m[1]];
      out.push(<Tag key={`f${n++}`}>{format(m[2])}</Tag>);
      rest = rest.slice(m.index + m[0].length);
    }
    out.push(...leaf(rest));
    return out;
  };
  return format(text);
}
