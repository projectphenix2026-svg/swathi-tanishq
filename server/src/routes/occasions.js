import express from 'express';
import { query } from '../db/index.js';
import { requireRole } from './auth.js';
import { runOccasion, upcoming, indiaNow } from '../lib/occasions.js';

const router = express.Router();
const canEdit = requireRole('admin', 'manager');
// thank_you = "After a purchase": a thank-you (with a Google review button) N days after a bill code is used.
const KINDS = ['birthday', 'anniversary', 'festival', 'thank_you'];

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT o.*, t.name AS template_name, t.body AS template_body, t.buttons AS template_buttons,
            (SELECT count(*) FROM messages m WHERE m.occasion_id = o.id AND m.channel = 'whatsapp'
               AND m.status IN ('sent', 'delivered', 'read') AND m.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')) AS sent_30d,
            (SELECT count(*) FROM messages m WHERE m.occasion_id = o.id AND m.status = 'read'
               AND m.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')) AS read_30d,
            (SELECT count(*) FROM redemptions r JOIN messages m ON m.id = r.message_id WHERE m.occasion_id = o.id) AS redeemed,
            (SELECT COALESCE(sum(r.amount), 0) FROM redemptions r JOIN messages m ON m.id = r.message_id WHERE m.occasion_id = o.id) AS revenue
       FROM occasions o JOIN templates t ON t.id = o.template_id
      WHERE o.client_id = $1 ORDER BY o.created_at`,
    [req.clientId],
  );
  const { rows: [dates] } = await query(
    `SELECT count(*) FILTER (WHERE birthday IS NOT NULL) AS with_birthday,
            count(*) FILTER (WHERE anniversary IS NOT NULL) AS with_anniversary,
            count(*) AS total
       FROM contacts WHERE client_id = $1 AND whatsapp_opt_in = 1 AND opted_out_at IS NULL`,
    [req.clientId],
  );
  res.json({ occasions: rows, dates, today: indiaNow() });
});

router.get('/:id/upcoming', async (req, res) => {
  const o = await find(req.clientId, req.params.id);
  if (!o) return res.status(404).json({ error: 'Occasion not found.' });
  res.json({ upcoming: await upcoming(req.clientId, o, Math.min(Number(req.query.days) || 30, 60)) });
});

router.post('/', canEdit, async (req, res) => {
  const input = await normalise(req.clientId, req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  const { rows: [o] } = await query(
    `INSERT INTO occasions (client_id, name, kind, festival_date, days_before, send_hour, template_id, variables, audience, sms_fallback, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [req.clientId, input.name, input.kind, input.festival_date, input.days_before, input.send_hour, input.template_id,
      JSON.stringify(input.variables), JSON.stringify(input.audience), input.sms_fallback, input.enabled],
  );
  res.status(201).json({ occasion: o });
});

router.put('/:id', canEdit, async (req, res) => {
  const input = await normalise(req.clientId, req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  const { rows: [o] } = await query(
    `UPDATE occasions SET name = $3, kind = $4, festival_date = $5, days_before = $6, send_hour = $7, template_id = $8,
            variables = $9, audience = $10, sms_fallback = $11, enabled = $12, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = $1 AND client_id = $2 RETURNING *`,
    [req.params.id, req.clientId, input.name, input.kind, input.festival_date, input.days_before, input.send_hour, input.template_id,
      JSON.stringify(input.variables), JSON.stringify(input.audience), input.sms_fallback, input.enabled],
  );
  if (!o) return res.status(404).json({ error: 'Occasion not found.' });
  res.json({ occasion: o });
});

router.patch('/:id/enabled', canEdit, async (req, res) => {
  const { rows: [o] } = await query(
    `UPDATE occasions SET enabled = $3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1 AND client_id = $2 RETURNING *`,
    [req.params.id, req.clientId, Boolean(req.body?.enabled)],
  );
  if (!o) return res.status(404).json({ error: 'Occasion not found.' });
  res.json({ occasion: o });
});

// Send today's greetings now instead of waiting for the send time (admins only).
router.post('/:id/run', requireRole('admin'), async (req, res) => {
  const o = await find(req.clientId, req.params.id);
  if (!o) return res.status(404).json({ error: 'Occasion not found.' });
  res.json(await runOccasion(o, { force: true }));
});

router.delete('/:id', canEdit, async (req, res) => {
  const { rows: [used] } = await query('SELECT count(*) AS n FROM messages WHERE occasion_id = $1', [req.params.id]);
  if (used.n) {
    await query('UPDATE occasions SET enabled = 0 WHERE id = $1 AND client_id = $2', [req.params.id, req.clientId]);
    return res.json({ ok: true, disabled: true });
  }
  await query('DELETE FROM occasions WHERE id = $1 AND client_id = $2', [req.params.id, req.clientId]);
  res.json({ ok: true });
});

async function normalise(clientId, b = {}) {
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return { error: 'Choose birthday, anniversary, festival or after a purchase.' };
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) return { error: 'Give the occasion a name.' };
  const days = [...new Set((Array.isArray(b.days_before) ? b.days_before : [0]).map(Number).filter((n) => Number.isInteger(n) && n >= (kind === 'thank_you' ? 1 : 0) && n <= 30))];
  if (!days.length) return { error: kind === 'thank_you' ? 'Choose when to send: the next day, or a few days after the purchase.' : 'Choose when to send: on the day, or some days before.' };
  const hour = Number(b.send_hour ?? 10);
  if (!(hour >= 7 && hour <= 21)) return { error: 'Send between 7 am and 9 pm.' };
  let festival = null;
  if (kind === 'festival') {
    festival = String(b.festival_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(festival)) return { error: 'Pick the festival date.' };
  }
  const { rows: [t] } = await query('SELECT id, status FROM templates WHERE id = $1 AND client_id = $2', [b.template_id, clientId]);
  if (!t) return { error: 'Choose the message to send.' };
  return {
    name,
    kind,
    festival_date: festival,
    days_before: days.sort((a, c) => c - a),
    send_hour: hour,
    template_id: t.id,
    variables: typeof b.variables === 'object' && b.variables ? b.variables : {},
    audience: typeof b.audience === 'object' && b.audience ? b.audience : { mode: 'all' },
    sms_fallback: Boolean(b.sms_fallback),
    enabled: b.enabled !== false,
  };
}

async function find(clientId, id) {
  const { rows: [o] } = await query('SELECT * FROM occasions WHERE id = $1 AND client_id = $2', [id, clientId]);
  return o;
}

export default router;
