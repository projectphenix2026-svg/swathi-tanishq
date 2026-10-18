// Photos for offers. The browser shrinks a photo (max 1200 px, JPEG) before uploading, so each
// is small enough to keep in the database. Each photo gets a public, unguessable link that
// WhatsApp (Meta) fetches when it delivers the message.
import express from 'express';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { requireAuth, requireRole } from './auth.js';

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 600 * 1024;

export function mediaUrl(req, id) {
  const base = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}/media/${id}`;
}

/** Bytes of a stored photo, by id (used to give Meta a sample when a message is sent for approval). */
export async function mediaBytes(id) {
  const { rows: [m] } = await query('SELECT mime, data FROM media WHERE id = $1', [id]);
  if (!m) return null;
  return { mime: m.mime, bytes: Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)) };
}

/** Upload: { dataUrl: "data:image/jpeg;base64,..." } -> { url } */
export const upload = express.Router();
upload.post('/', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl || ''));
  if (!match || !TYPES.has(match[1])) return res.status(400).json({ error: 'Choose a JPG, PNG or WebP photo.' });
  const size = Math.floor((match[2].length * 3) / 4);
  if (size > MAX_BYTES) return res.status(400).json({ error: 'That photo is too large. Try a smaller one (under 600 KB).' });
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await query('INSERT INTO media (id, client_id, mime, data, size) VALUES ($1, $2, $3, $4, $5)', [id, req.clientId, match[1], match[2], size]);
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
