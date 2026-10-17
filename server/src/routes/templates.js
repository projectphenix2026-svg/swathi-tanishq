import express from 'express';
import { query } from '../db/index.js';
import { validateTemplate, cleanButtons, extractVariables, VARIABLES } from '../lib/template.js';

const router = express.Router();

router.get('/variables', (req, res) => res.json({ variables: VARIABLES }));

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT t.*, (SELECT count(*)::int FROM campaigns c WHERE c.template_id = t.id) AS used_in
       FROM templates t WHERE client_id = $1 ORDER BY updated_at DESC`,
    [req.clientId],
  );
  res.json({ templates: rows.map(withVars) });
});

router.get('/:id', async (req, res) => {
  const t = await find(req.clientId, req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  res.json({ template: withVars(t) });
});

router.post('/', async (req, res) => {
  const input = normalise(req.body);
  const errors = validateTemplate(input);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const { rows: [t] } = await query(
    `INSERT INTO templates (client_id, name, category, language, body, image_url, buttons, status, provider_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [req.clientId, input.name, input.category, input.language, input.body, input.image_url, JSON.stringify(input.buttons), input.status, input.provider_ref],
  );
  res.status(201).json({ template: withVars(t) });
});

router.put('/:id', async (req, res) => {
  const input = normalise(req.body);
  const errors = validateTemplate(input);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const { rows: [t] } = await query(
    `UPDATE templates SET name = $3, category = $4, language = $5, body = $6, image_url = $7, buttons = $8,
            status = $9, provider_ref = $10, updated_at = now()
      WHERE id = $1 AND client_id = $2 RETURNING *`,
    [req.params.id, req.clientId, input.name, input.category, input.language, input.body, input.image_url, JSON.stringify(input.buttons), input.status, input.provider_ref],
  );
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  res.json({ template: withVars(t) });
});

router.delete('/:id', async (req, res) => {
  const { rows: [used] } = await query('SELECT count(*)::int AS n FROM campaigns WHERE template_id = $1', [req.params.id]);
  if (used.n) return res.status(409).json({ error: 'This template was used in a campaign, so it is kept for the reports.' });
  await query('DELETE FROM templates WHERE id = $1 AND client_id = $2', [req.params.id, req.clientId]);
  res.json({ ok: true });
});

function normalise(b = {}) {
  return {
    name: String(b.name || '').trim().slice(0, 80),
    category: ['marketing', 'utility'].includes(b.category) ? b.category : 'marketing',
    language: String(b.language || 'en').slice(0, 10),
    body: String(b.body || '').replace(/\r\n/g, '\n').trim(),
    image_url: String(b.image_url || '').trim() || null,
    buttons: Array.isArray(b.buttons) ? cleanButtons(b.buttons) : [],
    status: ['draft', 'approved', 'rejected'].includes(b.status) ? b.status : 'approved',
    provider_ref: String(b.provider_ref || '').trim() || null,
  };
}

async function find(clientId, id) {
  const { rows: [t] } = await query('SELECT * FROM templates WHERE id = $1 AND client_id = $2', [id, clientId]);
  return t;
}

function withVars(t) {
  return { ...t, variables: extractVariables(t.body) };
}

export default router;
