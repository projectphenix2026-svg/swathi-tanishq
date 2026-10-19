// Hot leads: customers who tapped "Interested" or "Book a visit", for staff to call the same day.
import express from 'express';
import { query, ago } from '../db/index.js';
import { requireRole } from './auth.js';

const router = express.Router();
const canEdit = requireRole('admin', 'manager');
const STATUSES = ['new', 'called', 'won', 'lost'];

router.get('/', async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const { rows } = await query(
    `SELECT l.*, c.name, c.phone, c.city, c.last_purchase, c.interests, cp.name AS campaign_name,
            u.name AS updated_by_name, i.body AS reply,
            (l.status = 'new' AND l.created_at < ${ago('24 hours')}) AS overdue
       FROM leads l JOIN contacts c ON c.id = l.contact_id
       LEFT JOIN campaigns cp ON cp.id = l.campaign_id
       LEFT JOIN users u ON u.id = l.updated_by
       LEFT JOIN messages i ON i.id = l.message_id
      WHERE l.client_id = $1 ${status ? 'AND l.status = $2' : `AND l.status IN ('new', 'called')`}
      ORDER BY (l.status = 'new' AND l.created_at < ${ago('24 hours')}) DESC, (l.status = 'new') DESC, l.created_at DESC LIMIT 300`,
    status ? [req.clientId, status] : [req.clientId],
  );
  const { rows: counts } = await query(
    `SELECT status, count(*) AS n FROM leads WHERE client_id = $1 GROUP BY status`,
    [req.clientId],
  );
  const { rows: [od] } = await query(
    `SELECT count(*) AS n FROM leads WHERE client_id = $1 AND status = 'new' AND created_at < ${ago('24 hours')}`,
    [req.clientId],
  );
  res.json({ leads: rows, counts: { ...Object.fromEntries(counts.map((r) => [r.status, r.n])), overdue: od.n } });
});

// Who called whom: each staff member's calls and sales from the call back list this week.
router.get('/summary', async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, count(*) AS handled,
            count(*) FILTER (WHERE l.status = 'won') AS won,
            count(*) FILTER (WHERE l.status = 'called') AS called
       FROM leads l JOIN users u ON u.id = l.updated_by
      WHERE l.client_id = $1 AND l.status <> 'new' AND l.updated_at > ${ago('7 days')}
      GROUP BY u.id ORDER BY handled DESC`,
    [req.clientId],
  );
  res.json({ staff: rows });
});

router.patch('/:id', canEdit, async (req, res) => {
  const status = req.body?.status;
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
  const { rows: [l] } = await query(
    `UPDATE leads SET status = COALESCE($3, status), note = COALESCE($4, note), updated_by = $5, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = $1 AND client_id = $2 RETURNING *`,
    [req.params.id, req.clientId, status || null, req.body?.note ?? null, req.user.id],
  );
  if (!l) return res.status(404).json({ error: 'Lead not found.' });
  res.json({ lead: l });
});

export default router;
