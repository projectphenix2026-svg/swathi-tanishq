// Hot leads: customers who tapped "Interested" or "Book a visit", for staff to call the same day.
import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();
const STATUSES = ['new', 'called', 'won', 'lost'];

router.get('/', async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const { rows } = await query(
    `SELECT l.*, c.name, c.phone, c.city, c.last_purchase, c.interests, cp.name AS campaign_name,
            u.name AS updated_by_name, i.body AS reply
       FROM leads l JOIN contacts c ON c.id = l.contact_id
       LEFT JOIN campaigns cp ON cp.id = l.campaign_id
       LEFT JOIN users u ON u.id = l.updated_by
       LEFT JOIN messages i ON i.id = l.message_id
      WHERE l.client_id = $1 ${status ? 'AND l.status = $2' : `AND l.status IN ('new', 'called')`}
      ORDER BY (l.status = 'new') DESC, l.created_at DESC LIMIT 300`,
    status ? [req.clientId, status] : [req.clientId],
  );
  const { rows: counts } = await query(
    `SELECT status, count(*)::int AS n FROM leads WHERE client_id = $1 GROUP BY status`,
    [req.clientId],
  );
  res.json({ leads: rows, counts: Object.fromEntries(counts.map((r) => [r.status, r.n])) });
});

router.patch('/:id', async (req, res) => {
  const status = req.body?.status;
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
  const { rows: [l] } = await query(
    `UPDATE leads SET status = COALESCE($3, status), note = COALESCE($4, note), updated_by = $5, updated_at = now()
      WHERE id = $1 AND client_id = $2 RETURNING *`,
    [req.params.id, req.clientId, status || null, req.body?.note ?? null, req.user.id],
  );
  if (!l) return res.status(404).json({ error: 'Lead not found.' });
  res.json({ lead: l });
});

export default router;
