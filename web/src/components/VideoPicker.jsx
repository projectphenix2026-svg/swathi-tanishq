// "Add a video" button with a small player; uploads straight away and returns the link.
// WhatsApp plays MP4 (or 3GP) videos up to 16 MB.
import { useRef, useState } from 'react';
import { Film, X } from 'lucide-react';
import { uploadVideo } from '../lib/photo.js';
import { Spinner, useToast } from './ui.jsx';

export function VideoPicker({ value, onChange }) {
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadVideo(file));
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row wrap" style={{ gap: 12, alignItems: 'center' }}>
      {value && <video src={value} muted playsInline controls preload="metadata" style={{ width: 160, height: 96, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)', background: '#000' }} />}
      <input ref={input} type="file" accept="video/mp4,video/3gpp" hidden onChange={pick} />
      <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <><Spinner />Uploading…</> : <><Film size={17} />{value ? 'Change video' : 'Add a video'}</>}
      </button>
      {value && !busy && <button type="button" className="btn ghost sm" onClick={() => onChange('')}><X size={15} />Remove</button>}
    </div>
  );
}
