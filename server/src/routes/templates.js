import express from 'express';
import { query } from '../db/index.js';
import { validateTemplate, cleanButtons, extractVariables, VARIABLES } from '../lib/template.js';
import { buildProvider, getProvider } from '../providers/index.js';
import { requireLevel } from './auth.js';
import { savedMetaProvider } from '../lib/whatsapp-connection.js';
import { mediaBytes } from './media.js';

const router = express.Router();
const canEdit = requireLevel('manager');
const EXAMPLES = Object.fromEntries(VARIABLES.map((v) => [v.key, v.example]));

router.get('/variables', (req, res) => res.json({ variables: VARIABLES }));

// Order and repair updates were removed; their old templates stay (past reports use them) but are hidden.
const RETIRED = ['%Order ready', '%Repair ready'];

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT t.*, (SELECT count(*) FROM campaigns c WHERE c.template_id = t.id) AS used_in
       FROM templates t WHERE client_id = $1 AND t.name NOT LIKE $2 AND t.name NOT LIKE $3 ORDER BY updated_at DESC`,
    [req.clientId, ...RETIRED],
  );
  res.json({ templates: rows.map(withVars) });
});

router.get('/:id', async (req, res) => {
  const t = await find(req.clientId, req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  res.json({ template: withVars(t) });
});

const COLS = ['name', 'category', 'language', 'body', 'image_url', 'buttons', 'status', 'provider_ref', 'sms_body', 'sms_dlt_template_id'];
const values = (input) => COLS.map((c) => (c === 'buttons' ? JSON.stringify(input.buttons) : input[c]));

router.post('/', canEdit, async (req, res) => {
  const input = normalise(req.body);
  const errors = validate(input);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const { rows: [t] } = await query(
    `INSERT INTO templates (client_id, ${COLS.join(', ')}) VALUES ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
    [req.clientId, ...values(input)],
  );
  res.status(201).json({ template: withVars(t) });
});

router.put('/:id', canEdit, async (req, res) => {
  const input = normalise(req.body);
  const errors = validate(input);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const existing = await find(req.clientId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found.' });
  // Changing the wording invalidates a Meta approval: the approved text is what Meta sends.
  // Wording, buttons, or adding/removing a photo header need Meta's approval again (a different photo does not).
  const textChanged = existing.body !== input.body || JSON.stringify(existing.buttons) !== JSON.stringify(input.buttons)
    || Boolean(existing.image_url) !== Boolean(input.image_url);
  const { rows: [t] } = await query(
    `UPDATE templates SET ${COLS.map((c, i) => `${c} = $${i + 3}`).join(', ')},
            provider_status = CASE WHEN $${COLS.length + 3} THEN NULL ELSE provider_status END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = $1 AND client_id = $2 RETURNING *`,
    [req.params.id, req.clientId, ...values(input), textChanged && existing.provider_status !== null],
  );
  res.json({ template: withVars(t), approvalReset: textChanged && Boolean(existing.provider_status) });
});

router.delete('/:id', canEdit, async (req, res) => {
  const { rows: [used] } = await query(
    `SELECT (SELECT count(*) FROM campaigns WHERE template_id = $1) + (SELECT count(*) FROM occasions WHERE template_id = $1) AS n`,
    [req.params.id],
  );
  if (Number(used.n)) return res.status(409).json({ error: 'This template is used by a campaign or occasion, so it is kept.' });
  await query('DELETE FROM templates WHERE id = $1 AND client_id = $2', [req.params.id, req.clientId]);
  res.json({ ok: true });
});

// Phase 2: send the template to Meta for approval, then check back for the result.
router.post('/:id/submit-meta', canEdit, async (req, res) => {
  const t = await find(req.clientId, req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  const meta = metaProvider();
  const missing = meta.missingConfig();
  if (missing.length) return res.status(400).json({ error: `Meta is not set up yet. Missing: ${missing.join(', ')}.` });
  const result = await meta.submitTemplate(t, EXAMPLES, { sample: await photoSample(t.image_url) });
  const { rows: [u] } = await query(
    `UPDATE templates SET provider_ref = $2, provider_status = $3, provider_reason = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1 RETURNING *`,
    [t.id, result.name, result.status],
  );
  res.json({ template: withVars(u) });
});

router.post('/:id/sync-meta', async (req, res) => {
  const t = await find(req.clientId, req.params.id);
  if (!t?.provider_ref) return res.status(400).json({ error: 'This template has not been submitted to Meta.' });
  const s = await metaProvider().templateStatus(t.provider_ref);
  if (!s) return res.status(404).json({ error: `Meta has no template named ${t.provider_ref}.` });
  const { rows: [u] } = await query(
    `UPDATE templates SET provider_status = $2, provider_reason = $3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1 RETURNING *`,
    [t.id, s.status, s.reason],
  );
  res.json({ template: withVars(u) });
});

/** The message's photo bytes (from the app's own photo store, or its web link) for Meta's sample. */
async function photoSample(url) {
  if (!url) return null;
  const own = /\/media\/([0-9a-f]{32})$/.exec(url);
  if (own) return mediaBytes(own[1]);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return { mime: res.headers.get('content-type') || 'image/jpeg', bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch {
    return null;
  }
}

function metaProvider() {
  const p = getProvider();
  if (p.name === 'meta') return p;
  return savedMetaProvider() || buildProvider('meta');
}

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
    sms_body: String(b.sms_body || '').replace(/\r\n/g, '\n').trim() || null,
    sms_dlt_template_id: String(b.sms_dlt_template_id || '').trim() || null,
  };
}

function validate(input) {
  const errors = validateTemplate(input);
  if (input.sms_body) {
    const known = new Set(VARIABLES.map((v) => v.key));
    const unknown = extractVariables(input.sms_body).filter((k) => !known.has(k));
    if (unknown.length) errors.push(`SMS text: unknown placeholder ${unknown.map((k) => `{{${k}}}`).join(', ')}.`);
    if (input.sms_body.length > 480) errors.push('Keep the SMS under 480 characters (3 SMS parts).');
  }
  if (input.sms_dlt_template_id && !/^\d{10,25}$/.test(input.sms_dlt_template_id)) {
    errors.push('The DLT template ID is the long number from the DLT portal (digits only).');
  }
  return errors;
}

async function find(clientId, id) {
  const { rows: [t] } = await query('SELECT * FROM templates WHERE id = $1 AND client_id = $2', [id, clientId]);
  return t;
}

function withVars(t) {
  return { ...t, variables: extractVariables(t.body) };
}

export default router;
