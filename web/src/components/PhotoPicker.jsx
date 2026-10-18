// "Add a photo" button with a small preview; uploads straight away and returns the link.
import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { uploadPhoto } from '../lib/photo.js';
import { Spinner, useToast } from './ui.jsx';

export function PhotoPicker({ value, onChange, addLabel = 'Add a photo', changeLabel = 'Change photo', removable = true }) {
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadPhoto(file));
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row wrap" style={{ gap: 12, alignItems: 'center' }}>
      {value && <img src={value} alt="" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />}
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
      <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Spinner /> : <><ImagePlus size={17} />{value ? changeLabel : addLabel}</>}
      </button>
      {value && removable && <button type="button" className="btn ghost sm" onClick={() => onChange('')}><X size={15} />Remove</button>}
    </div>
  );
}
