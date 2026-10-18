import express from 'express';
import crypto from 'node:crypto';
import { query } from '../db/index.js';
import { kick } from '../lib/dispatch.js';
import { recordInbound } from '../lib/messages.js';
import { getProvider } from '../providers/index.js';

const router = express.Router();

// One row per customer who has written to us, newest first.
router.get('/', async (req, res) => {
  const filter = req.query.filter === 'unread' ? 'HAVING count(*) FILTER (WHERE m.direction = \'inbound\' AND m.seen_at IS NULL) > 0' : '';
  const { rows } = await query(
    `SELECT c.id AS contact_id, c.name, c.phone, c.city, c.opted_out_at,
            max(m.created_at) AS last_at,
            max(m.created_at) FILTER (WHERE m.direction = 'inbound') AS last_inbound_at,
            count(*) FILTER (WHERE m.direction = 'inbound' AND m.seen_at IS NULL) AS unread,
            (SELECT body FROM messages x WHERE x.contact_id = c.id ORDER BY x.created_at DESC, x.id DESC LIMIT 1) AS last_body,
            (SELECT direction FROM messages x WHERE x.contact_id = c.id ORDER BY x.created_at DESC, x.id DESC LIMIT 1) AS last_direction
       FROM contacts c JOIN messages m ON m.contact_id = c.id
      WHERE c.client_id = $1
        AND EXISTS (SELECT 1 FROM messages i WHERE i.contact_id = c.id AND i.direction = 'inbound')
      GROUP BY c.id ${filter}
      ORDER BY last_at DESC LIMIT 200`,
    [req.clientId],
  );
  res.json({ conversations: rows });
});

router.get('/unread-count', async (req, res) => {
  const { rows: [r] } = await query(
    `SELECT count(*) AS n FROM messages WHERE client_id = $1 AND direction = 'inbound' AND seen_at IS NULL`,
    [req.clientId],
  );
  res.json({ unread: r.n });
});

router.get('/:contactId', async (req, res) => {
  const { rows: [contact] } = await query('SELECT * FROM contacts WHERE id = $1 AND client_id = $2', [
    req.params.contactId,
    req.clientId,
  ]);
  if (!contact) return res.status(404).json({ error: 'Customer not found.' });
  const { rows: messages } = await query(
    `SELECT m.id, m.direction, m.body, m.buttons, m.image_url, m.status, m.error_message, m.created_at, m.sent_at,
            m.delivered_at, m.read_at, cp.name AS campaign_name, u.name AS sent_by_name
       FROM messages m LEFT JOIN campaigns cp ON cp.id = m.campaign_id LEFT JOIN users u ON u.id = m.sent_by
      WHERE m.contact_id = $1 ORDER BY m.created_at, m.id`,
    [contact.id],
  );
  await query(`UPDATE messages SET seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE contact_id = $1 AND direction = 'inbound' AND seen_at IS NULL`, [contact.id]);
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound');
  const windowOpen = lastInbound ? Date.now() - new Date(lastInbound.created_at).getTime() < 24 * 3600 * 1000 : false;
  res.json({ contact, messages, windowOpen, lastInboundAt: lastInbound?.created_at || null });
});

// Test mode only: pretend a customer wrote in, so the inbox can be tried without a phone.
router.post('/simulate', async (req, res) => {
  if (getProvider().name !== 'mock') return res.status(404).json({ error: 'Only available in test mode.' });
  const { rows: [c] } = await query('SELECT * FROM contacts WHERE id = $1 AND client_id = $2', [req.body?.contactId, req.clientId]);
  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  const r = await recordInbound(req.clientId, {
    providerMessageId: `SIM${crypto.randomUUID()}`,
    from: c.phone,
    body: String(req.body?.body || 'Interested'),
    provider: 'mock',
  });
  res.status(201).json(r);
});

// Staff reply. clientRequestId comes from the browser, so a double-click sends once.
router.post('/:contactId/reply', async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Type a reply first.' });
  if (body.length > 4096) return res.status(400).json({ error: 'That reply is too long.' });
  const { rows: [contact] } = await query('SELECT * FROM contacts WHERE id = $1 AND client_id = $2', [
    req.params.contactId,
    req.clientId,
  ]);
  if (!contact) return res.status(404).json({ error: 'Customer not found.' });
  const requestId = String(req.body?.clientRequestId || crypto.randomUUID()).slice(0, 64);
  const { rows: [m] } = await query(
    `INSERT INTO messages (client_id, contact_id, direction, idempotency_key, body, status, sent_by)
     VALUES ($1, $2, 'outbound', $3, $4, 'queued', $5)
     ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = excluded.idempotency_key
     RETURNING *`,
    [req.clientId, contact.id, `reply:${req.user.id}:${requestId}`, body, req.user.id],
  );
  kick();
  res.status(201).json({ message: m });
});

export default router;
