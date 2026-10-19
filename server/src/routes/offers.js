// Offer codes at the billing counter: look a code up, then record the sale.
import express from 'express';
import { query, indiaStartOf } from '../db/index.js';
import { normaliseCode } from '../lib/offers.js';
import { requireLevel } from './auth.js';

const router = express.Router();
const canEdit = requireLevel('staff');

async function lookup(clientId, code) {
  const { rows: [m] } = await query(
    `SELECT m.id AS message_id, m.offer_code, m.created_at AS sent_on, m.status, m.template_values,
            c.id AS contact_id, c.name, c.phone, cp.name AS campaign_name, o.name AS occasion_name,
            r.id AS redemption_id, r.amount, r.redeemed_at, u.name AS redeemed_by_name
       FROM messages m JOIN contacts c ON c.id = m.contact_id
       LEFT JOIN campaigns cp ON cp.id = m.campaign_id
       LEFT JOIN occasions o ON o.id = m.occasion_id
       LEFT JOIN redemptions r ON r.client_id = m.client_id AND r.code = m.offer_code
       LEFT JOIN users u ON u.id = r.redeemed_by
      WHERE m.client_id = $1 AND m.offer_code = $2`,
    [clientId, code],
  );
  return m;
}

router.get('/lookup', async (req, res) => {
  const code = normaliseCode(req.query.code);
  if (!code) return res.status(400).json({ error: 'Type the code from the customer’s message.' });
  const m = await lookup(req.clientId, code);
  if (!m) return res.status(404).json({ error: `No message has the code ${code}. Check the spelling with the customer.` });
  res.json({ offer: { ...m, offer: m.template_values?.offer || null, offer_ends: m.template_values?.offer_ends || null } });
});

router.post('/redeem', canEdit, async (req, res) => {
  const code = normaliseCode(req.body?.code);
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Enter the bill amount in rupees.' });
  const m = await lookup(req.clientId, code);
  if (!m) return res.status(404).json({ error: `No message has the code ${code}.` });
  if (m.redemption_id) {
    return res.status(409).json({ error: `Already used on ${new Date(m.redeemed_at).toLocaleDateString('en-IN')}${m.redeemed_by_name ? ` (${m.redeemed_by_name})` : ''}.` });
  }
  const { rows: [r] } = await query(
    `INSERT INTO redemptions (client_id, message_id, contact_id, code, amount, note, redeemed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (client_id, code) DO NOTHING RETURNING *`,
    [req.clientId, m.message_id, m.contact_id, code, amount, String(req.body?.note || '').slice(0, 200) || null, req.user.id],
  );
  if (!r) return res.status(409).json({ error: 'This code was just used.' });
  // A sale closes the customer's open lead.
  await query(`UPDATE leads SET status = 'won', updated_by = $2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE contact_id = $1 AND status IN ('new', 'called')`, [m.contact_id, req.user.id]);
  res.status(201).json({ redemption: r });
});

router.get('/recent', async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, c.name, c.phone, COALESCE(cp.name, o.name) AS source, u.name AS redeemed_by_name
       FROM redemptions r JOIN contacts c ON c.id = r.contact_id JOIN messages m ON m.id = r.message_id
       LEFT JOIN campaigns cp ON cp.id = m.campaign_id LEFT JOIN occasions o ON o.id = m.occasion_id
       LEFT JOIN users u ON u.id = r.redeemed_by
      WHERE r.client_id = $1 ORDER BY r.redeemed_at DESC LIMIT 50`,
    [req.clientId],
  );
  const { rows: [t] } = await query(
    `SELECT count(*) AS n, COALESCE(sum(amount), 0) AS revenue FROM redemptions
      WHERE client_id = $1 AND redeemed_at >= $2`,
    [req.clientId, indiaStartOf('month')],
  );
  res.json({ redemptions: rows, month: t });
});

export default router;
