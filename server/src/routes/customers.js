import express from 'express';
import multer from 'multer';
import { query, db } from '../db/index.js';
import { normalizePhone } from '../lib/phone.js';
import { parseFile, parsePasted, buildPreview, parseDate, sampleWorkbook, sheetsCsvUrl, FIELDS, ImportError } from '../lib/importer.js';
import { requireRole } from './auth.js';

const canEdit = requireRole('admin', 'manager');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const SORTS = { recent: 'created_at DESC', name: 'name ASC NULLS LAST' };

router.get('/', async (req, res) => {
  const { q = '', filter = 'all', sort = 'recent' } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const params = [req.clientId];
  const where = ['client_id = $1'];
  if (q) {
    params.push(`%${q}%`);
    const digits = String(q).replace(/\D/g, '');
    let phoneCond = '';
    if (digits.length >= 3) {
      params.push(`%${digits}%`);
      phoneCond = ` OR phone LIKE $${params.length}`;
    }
    where.push(`(name ILIKE $2 OR city ILIKE $2 OR interests ILIKE $2 OR last_purchase ILIKE $2${phoneCond})`);
  }
  if (filter === 'opted_in') where.push('whatsapp_opt_in = true AND opted_out_at IS NULL');
  if (filter === 'no_opt_in') where.push('whatsapp_opt_in = false AND opted_out_at IS NULL');
  if (filter === 'opted_out') where.push('opted_out_at IS NOT NULL');
  const w = where.join(' AND ');
  const { rows } = await query(
    `SELECT * FROM contacts WHERE ${w} ORDER BY ${SORTS[sort] || SORTS.recent}, id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const { rows: [{ total }] } = await query(`SELECT count(*)::int AS total FROM contacts WHERE ${w}`, params);
  res.json({ customers: rows, total });
});

router.get('/summary', async (req, res) => {
  const { rows: [s] } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE whatsapp_opt_in AND opted_out_at IS NULL)::int AS opted_in,
            count(*) FILTER (WHERE NOT whatsapp_opt_in AND opted_out_at IS NULL)::int AS no_opt_in,
            count(*) FILTER (WHERE opted_out_at IS NOT NULL)::int AS opted_out
       FROM contacts WHERE client_id = $1`,
    [req.clientId],
  );
  const { rows: cities } = await query(
    `SELECT initcap(city) AS city, count(*)::int AS count FROM contacts
      WHERE client_id = $1 AND city IS NOT NULL AND city <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
    [req.clientId],
  );
  const { rows: tags } = await query(
    `SELECT t AS tag, count(*)::int AS count FROM contacts, unnest(tags) t
      WHERE client_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
    [req.clientId],
  );
  res.json({ ...s, cities, tags });
});

router.get('/sample.xlsx', (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="customers-sample.xlsx"');
  res.send(sampleWorkbook());
});

router.get('/fields', (req, res) => res.json({ fields: FIELDS.map(({ key, label }) => ({ key, label })) }));

// One customer from the form.
router.post('/', canEdit, async (req, res) => {
  const b = req.body || {};
  const phone = normalizePhone(b.phone);
  const errors = {};
  if (!phone.ok) errors.phone = phone.reason;
  if (!String(b.name || '').trim()) errors.name = 'Add the customer’s name so messages can greet them personally.';
  const warnings = [];
  const birthday = parseDate(b.birthday, 'Birthday', warnings);
  const anniversary = parseDate(b.anniversary, 'Anniversary', warnings);
  if (b.birthday && !birthday) errors.birthday = 'Use a real date.';
  if (b.anniversary && !anniversary) errors.anniversary = 'Use a real date.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });

  const { rows: [exists] } = await query('SELECT id, name FROM contacts WHERE client_id = $1 AND phone = $2', [
    req.clientId,
    phone.e164,
  ]);
  if (exists) {
    return res.status(409).json({
      error: `${phone.display} is already saved${exists.name ? ` as ${exists.name}` : ''}.`,
      fields: { phone: 'Already a customer' },
      existingId: exists.id,
    });
  }
  const optIn = Boolean(b.whatsapp_opt_in);
  const { rows: [c] } = await query(
    `INSERT INTO contacts (client_id, name, phone, city, birthday, anniversary, last_purchase, interests, tags,
                           whatsapp_opt_in, opt_in_at, opt_in_source, sms_opt_in)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10 THEN now() END, $11, $12) RETURNING *`,
    [
      req.clientId,
      b.name.trim(),
      phone.e164,
      clean(b.city),
      birthday,
      anniversary,
      clean(b.last_purchase),
      clean(b.interests),
      tagsFrom(b.tags),
      optIn,
      optIn ? clean(b.opt_in_source) || 'Added by staff (form)' : null,
      Boolean(b.sms_opt_in),
    ],
  );
  res.status(201).json({ customer: c });
});

router.patch('/:id', canEdit, async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const params = [req.params.id, req.clientId];
  const add = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if ('name' in b) add('name', clean(b.name));
  if ('city' in b) add('city', clean(b.city));
  if ('last_purchase' in b) add('last_purchase', clean(b.last_purchase));
  if ('interests' in b) add('interests', clean(b.interests));
  if ('tags' in b) add('tags', tagsFrom(b.tags));
  if ('sms_opt_in' in b) add('sms_opt_in', Boolean(b.sms_opt_in));
  if ('birthday' in b) add('birthday', parseDate(b.birthday));
  if ('anniversary' in b) add('anniversary', parseDate(b.anniversary));
  if ('whatsapp_opt_in' in b) {
    const on = Boolean(b.whatsapp_opt_in);
    add('whatsapp_opt_in', on);
    sets.push(on ? `opt_in_at = now(), opted_out_at = NULL` : `opted_out_at = now()`);
    if (on) add('opt_in_source', clean(b.opt_in_source) || 'Updated by staff');
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
  const { rows: [c] } = await query(
    `UPDATE contacts SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND client_id = $2 RETURNING *`,
    params,
  );
  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  res.json({ customer: c });
});

// Step 1 of a file / paste import: parse and show what will happen. Nothing is saved.
router.post('/import/preview', canEdit, upload.single('file'), async (req, res) => {
  let table;
  if (req.file) table = parseFile(req.file.buffer, req.file.originalname);
  else if (req.body?.text !== undefined) table = parsePasted(req.body.text);
  else if (req.body?.sheetUrl) table = parseFile(await fetchSheet(req.body.sheetUrl), 'sheet.csv');
  else throw new ImportError('Choose a file or paste some numbers.');
  if (req.body?.mapping) {
    const m = typeof req.body.mapping === 'string' ? JSON.parse(req.body.mapping) : req.body.mapping;
    table.mapping = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null && v !== '' && v !== -1).map(([k, v]) => [k, Number(v)]));
  }
  if (!table.rows.length) throw new ImportError('No customers found. Check that the file has rows under the header.');
  const existing = await existingPhones(req.clientId);
  const preview = buildPreview(table, existing);
  res.json({
    columns: table.columns,
    mapping: table.mapping,
    summary: preview.summary,
    rows: preview.rows,
    sampleRaw: table.rows.slice(0, 3),
  });
});

// Step 2: save the rows the staff member accepted.
router.post('/import/commit', canEdit, async (req, res) => {
  const { rows = [], optIn = {}, updateExisting = false, source = 'import', tags = [] } = req.body || {};
  if (!optIn.confirmed) {
    return res.status(400).json({ error: 'Please confirm these customers agreed to receive WhatsApp messages, or untick opt-in.' });
  }
  const defaultOptIn = Boolean(optIn.value);
  const defaultSms = Boolean(optIn.sms);
  const extraTags = tagsFrom(tags);
  const toSave = rows.filter((r) => r.status === 'ok' || (updateExisting && r.status === 'exists'));
  let created = 0;
  let updated = 0;
  let skipped = 0;
  await db().transaction(async (tx) => {
    for (const r of toSave) {
      const phone = normalizePhone(r.phone);
      if (!phone.ok) {
        skipped += 1;
        continue;
      }
      const optedIn = r.opt_in === null || r.opt_in === undefined ? defaultOptIn : Boolean(r.opt_in);
      const result = await tx.query(
        `INSERT INTO contacts (client_id, name, phone, city, birthday, anniversary, last_purchase, interests, tags,
                               whatsapp_opt_in, opt_in_at, opt_in_source, sms_opt_in)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10 THEN now() END, $11, $12)
         ON CONFLICT (client_id, phone) DO ${
           updateExisting
             ? `UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name),
                    city = COALESCE(EXCLUDED.city, contacts.city),
                    birthday = COALESCE(EXCLUDED.birthday, contacts.birthday),
                    anniversary = COALESCE(EXCLUDED.anniversary, contacts.anniversary),
                    last_purchase = COALESCE(EXCLUDED.last_purchase, contacts.last_purchase),
                    interests = COALESCE(EXCLUDED.interests, contacts.interests),
                    tags = ARRAY(SELECT DISTINCT unnest(contacts.tags || EXCLUDED.tags)),
                    updated_at = now()`
             : 'NOTHING'
         }
         RETURNING (xmax = 0) AS inserted`,
        [
          req.clientId,
          clean(r.name),
          phone.e164,
          clean(r.city),
          r.birthday || null,
          r.anniversary || null,
          clean(r.last_purchase),
          clean(r.interests),
          extraTags,
          optedIn,
          optedIn ? String(source).slice(0, 120) : null,
          r.sms_opt_in === null || r.sms_opt_in === undefined ? defaultSms : Boolean(r.sms_opt_in),
        ],
      );
      const row = result.rows[0];
      if (!row) skipped += 1;
      else if (row.inserted) created += 1;
      else updated += 1;
    }
  });
  res.json({ created, updated, skipped: skipped + (rows.length - toSave.length) });
});

/** Downloads a Google Sheet shared "anyone with the link" as CSV. Only docs.google.com links are accepted. */
async function fetchSheet(link) {
  const url = sheetsCsvUrl(link);
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new ImportError('Could not reach Google Sheets. Check the internet connection and try again.');
  }
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('text/csv')) {
    throw new ImportError('Google did not share this sheet. In Google Sheets, click Share and set it to "Anyone with the link can view", then try again.');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new ImportError('That sheet is too large (15 MB limit).');
  return buf;
}

async function existingPhones(clientId) {
  const { rows } = await query('SELECT phone FROM contacts WHERE client_id = $1', [clientId]);
  return new Set(rows.map((r) => r.phone));
}

function clean(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 200) : null;
}

function tagsFrom(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

export default router;
