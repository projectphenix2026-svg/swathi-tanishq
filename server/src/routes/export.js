// Owner-only "Download all data": the browser fetches everything in chunks of up to 2,000 rows
// (small enough for Cloudflare's free plan) and builds one Excel file with a sheet for each.
import express from 'express';
import { query, NOW } from '../db/index.js';
import { requireLevel } from './auth.js';
import { NOT_DELETED } from './customers.js';

const router = express.Router();
router.use(requireLevel('owner'));

const page = (req) => ({
  after: Math.max(0, Number(req.query.after) || 0),
  limit: Math.min(2000, Math.max(1, Number(req.query.limit) || 2000)),
});
const done = (rows, limit) => ({ rows, next: rows.length === limit ? rows[rows.length - 1].id : null });

router.get('/customers', async (req, res) => {
  const { after, limit } = page(req);
  const { rows } = await query(
    `SELECT id, name, phone, city, birthday, anniversary, last_purchase, interests, tags, whatsapp_opt_in, opt_in_at,
            opt_in_source, sms_opt_in, opted_out_at, created_at
       FROM contacts WHERE client_id = $1 AND ${NOT_DELETED} AND id > $2 ORDER BY id LIMIT $3`,
    [req.clientId, after, limit],
  );
  res.json(done(rows, limit));
});

router.get('/offers', async (req, res) => {
  const { after, limit } = page(req);
  const { rows } = await query(
    `SELECT c.id, c.name, c.status, c.created_at, c.started_at, c.completed_at, t.name AS message,
            count(m.id) FILTER (WHERE m.channel = 'whatsapp') AS total,
            count(m.id) FILTER (WHERE m.status IN ('sent', 'delivered', 'read')) AS sent,
            count(m.id) FILTER (WHERE m.status IN ('delivered', 'read')) AS reached,
            count(m.id) FILTER (WHERE m.status = 'read') AS read,
            count(m.id) FILTER (WHERE m.status = 'failed') AS failed,
            COALESCE(sum(m.cost), 0) AS cost
       FROM campaigns c JOIN templates t ON t.id = c.template_id LEFT JOIN messages m ON m.campaign_id = c.id
      WHERE c.client_id = $1 AND c.id > $2 GROUP BY c.id ORDER BY c.id LIMIT $3`,
    [req.clientId, after, limit],
  );
  res.json(done(rows, limit));
});

router.get('/bill-codes', async (req, res) => {
  const { after, limit } = page(req);
  const { rows } = await query(
    `SELECT r.id, r.code, r.amount, r.note, r.redeemed_at, ct.name AS customer, ct.phone, c.name AS offer, u.name AS entered_by
       FROM redemptions r JOIN contacts ct ON ct.id = r.contact_id JOIN messages m ON m.id = r.message_id
       LEFT JOIN campaigns c ON c.id = m.campaign_id LEFT JOIN users u ON u.id = r.redeemed_by
      WHERE r.client_id = $1 AND r.id > $2 ORDER BY r.id LIMIT $3`,
    [req.clientId, after, limit],
  );
  res.json(done(rows, limit));
});

// Remember when the owner last took a copy (Home reminds them weekly).
router.post('/done', async (req, res) => {
  await query(`UPDATE clients SET last_export_at = ${NOW} WHERE id = $1`, [req.clientId]);
  res.json({ ok: true });
});

export default router;
