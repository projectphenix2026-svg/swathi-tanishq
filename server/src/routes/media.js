// Photos and videos for offers. The browser shrinks a photo (max 1200 px, JPEG) before uploading,
// so each is small enough to keep in the database. A video (MP4, up to 16 MB, WhatsApp's limit) is
// kept in the file store (lib/blobs.js). Each gets a public, unguessable link that WhatsApp (Meta)
// fetches when it delivers the message.
import express from 'express';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { requireAuth, requireLevel } from './auth.js';
import { blobs } from '../lib/blobs.js';

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 600 * 1024;
// WhatsApp accepts MP4 (H.264 video, AAC sound) or 3GP, up to 16 MB.
const VIDEO_TYPES = new Set(['video/mp4', 'video/3gpp']);
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');

export function mediaUrl(req, id) {
  const base = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}/media/${id}`;
}

/** Bytes of a stored photo or video, by id (also Meta's sample when a message is sent for approval). */
export async function mediaBytes(id) {
  const { rows: [m] } = await query('SELECT mime, data, store FROM media WHERE id = $1', [id]);
  if (!m) return null;
  if (m.store === 'blob') {
    const b = await blobs().get(`media/${id}`);
    return b && { mime: m.mime, bytes: b.bytes };
  }
  return { mime: m.mime, bytes: Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)) };
}

/** Upload: { dataUrl: "data:image/jpeg;base64,..." } -> { url } */
export const upload = express.Router();
upload.post('/', requireAuth, requireLevel('manager'), async (req, res) => {
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl || ''));
  if (!match || !TYPES.has(match[1])) return res.status(400).json({ error: 'Choose a JPG, PNG or WebP photo.' });
  const size = Math.floor((match[2].length * 3) / 4);
  if (size > MAX_BYTES) return res.status(400).json({ error: 'That photo is too large. Try a smaller one (under 600 KB).' });
  const id = newId();
  await query('INSERT INTO media (id, client_id, mime, data, size) VALUES ($1, $2, $3, $4, $5)', [id, req.clientId, match[1], match[2], size]);
  res.status(201).json({ id, url: mediaUrl(req, id) });
});

/** Video upload: the file's raw bytes with Content-Type video/mp4 -> { url } */
upload.post('/video', requireAuth, requireLevel('manager'), express.raw({ type: () => true, limit: MAX_VIDEO_BYTES + 1024 }), async (req, res) => {
  const mime = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!VIDEO_TYPES.has(mime)) return res.status(400).json({ error: 'Choose an MP4 video (WhatsApp plays MP4 and 3GP).' });
  const bytes = new Uint8Array(req.body?.buffer ? req.body.buffer.slice(req.body.byteOffset, req.body.byteOffset + req.body.length) : []);
  if (!bytes.length) return res.status(400).json({ error: 'That video is empty. Choose it again.' });
  if (bytes.length > MAX_VIDEO_BYTES) return res.status(400).json({ error: 'That video is larger than 16 MB, WhatsApp’s limit. Shorten it or send a smaller one.' });
  const id = newId();
  await blobs().put(`media/${id}`, bytes, mime);
  await query("INSERT INTO media (id, client_id, mime, data, size, store) VALUES ($1, $2, $3, '', $4, 'blob')", [id, req.clientId, mime, bytes.length]);
  res.status(201).json({ id, url: mediaUrl(req, id) });
});

/** Public: the photo itself (no login; the id is a long random string). */
export const serve = express.Router();
serve.get('/:id', async (req, res) => {
  if (!/^[0-9a-f]{32}$/.test(req.params.id)) return res.sendStatus(404);
  const m = await mediaBytes(req.params.id);
  if (!m) return res.sendStatus(404);
  res.set('Content-Type', m.mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(Buffer.from(m.bytes));
});
