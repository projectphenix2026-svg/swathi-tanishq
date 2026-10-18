import express from 'express';
import { query, batch, NOW } from '../db/index.js';
import { normalizePhone } from '../lib/phone.js';
import { parseDate, sheetsCsvUrl, ImportError } from '../lib/import-basics.js';
import { requireRole } from './auth.js';
import { offersThisWeekSql, lastOfferSql } from '../lib/campaigns.js';
import { addSamples, countSamples, removeSamples } from '../lib/samples.js';
import { getProvider } from '../providers/index.js';

const router = express.Router();
const canEdit = requireRole('admin', 'manager');

const SORTS = { recent: 'created_at DESC', name: 'name IS NULL, name ASC' };
const DATE_KINDS = ['spouse_birthday', 'child_birthday', 'other'];
const CITY_NEEDED = 'Add the customer’s city or town.';
// Each customer's extra special days, as a JSON list.
const DATES_SQL = `(SELECT json_group_array(json_object('kind', d.kind, 'label', d.label, 'date', d.date))
                     FROM contact_dates d WHERE d.contact_id = c.id) AS dates`;
// Deleted customers keep their row (so past offer totals and sales stay right) with all personal
// details removed and the phone replaced by deleted:<id>; lists and counts leave them out.
export const NOT_DELETED = "phone NOT LIKE 'deleted:%'";

router.get('/', async (req, res) => {
  const { q = '', filter = 'all', sort = 'recent' } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const params = [req.clientId];
  const where = ['client_id = $1', NOT_DELETED];
  if (q) {
    params.push(`%${q}%`);
    const digits = String(q).replace(/\D/g, '');
    let phoneCond = '';
    if (digits.length >= 3) {
      params.push(`%${digits}%`);
      phoneCond = ` OR phone LIKE $${params.length}`;
    }
    where.push(`(name LIKE $2 OR city LIKE $2 OR interests LIKE $2 OR last_purchase LIKE $2${phoneCond})`);
  }
  if (filter === 'opted_in') where.push('whatsapp_opt_in = 1 AND opted_out_at IS NULL');
  if (filter === 'no_opt_in') where.push('whatsapp_opt_in = 0 AND opted_out_at IS NULL');
  if (filter === 'opted_out') where.push('opted_out_at IS NOT NULL');
  if (filter === 'sms') where.push('sms_opt_in = 1 AND opted_out_at IS NULL');
  const w = where.join(' AND ');
  const { rows } = await query(
    `SELECT *, ${DATES_SQL}${req.query.offers ? `, ${offersThisWeekSql()} AS offers_this_week, ${lastOfferSql()} AS last_offer` : ''}
       FROM contacts c WHERE ${w} ORDER BY ${SORTS[sort] || SORTS.recent}, id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const { rows: [{ total }] } = await query(`SELECT count(*) AS total FROM contacts WHERE ${w}`, params);
  res.json({ customers: rows, total });
});

router.get('/summary', async (req, res) => {
  const { rows: [s] } = await query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE whatsapp_opt_in = 1 AND opted_out_at IS NULL) AS opted_in,
            count(*) FILTER (WHERE whatsapp_opt_in = 0 AND opted_out_at IS NULL) AS no_opt_in,
            count(*) FILTER (WHERE opted_out_at IS NOT NULL) AS opted_out
       FROM contacts WHERE client_id = $1 AND ${NOT_DELETED}`,
    [req.clientId],
  );
  const { rows: cities } = await query(
    `SELECT lower(city) AS key, count(*) AS count, min(city) AS city FROM contacts
      WHERE client_id = $1 AND city IS NOT NULL AND city <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
    [req.clientId],
  );
  const { rows: tags } = await query(
    `SELECT t.value AS tag, count(*) AS count FROM contacts, json_each(contacts.tags) t
      WHERE client_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
    [req.clientId],
  );
  res.json({ ...s, cities: cities.map((c) => ({ city: titleCase(c.city), count: c.count })), tags });
});

// Sample customers for Test mode: add five (only in test mode), or remove them.
router.get('/samples', async (req, res) => {
  res.json({ samples: await countSamples(req.clientId) });
});
router.post('/samples', canEdit, async (req, res) => {
  if (getProvider().name !== 'mock') return res.status(400).json({ error: 'Sample customers are only for Test mode.' });
  res.status(201).json({ samples: await addSamples(req.clientId) });
});
router.delete('/samples', canEdit, async (req, res) => {
  res.json({ removed: await removeSamples(req.clientId) });
});

// One customer from the form.
router.post('/', canEdit, async (req, res) => {
  const b = req.body || {};
  const phone = normalizePhone(b.phone);
  const errors = {};
  if (!phone.ok) errors.phone = phone.reason;
  if (!String(b.name || '').trim()) errors.name = 'Add the customer’s name so messages can greet them personally.';
  if (!clean(b.city)) errors.city = CITY_NEEDED;
  const warnings = [];
  const dates = datesFrom(b.dates, errors);
  const birthday = parseDate(b.birthday, 'Birthday', warnings);
  const anniversary = parseDate(b.anniversary, 'Anniversary', warnings);
  if (b.birthday && !birthday) errors.birthday = 'Use a real date.';
  if (b.anniversary && !anniversary) errors.anniversary = 'Use a real date.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });

  const { rows: [exists] } = await query('SELECT id, name FROM contacts WHERE client_id = $1 AND phone = $2', [req.clientId, phone.e164]);
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
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10 THEN ${NOW} END, $11, $12) RETURNING *`,
    [req.clientId, b.name.trim(), phone.e164, clean(b.city), birthday, anniversary, clean(b.last_purchase), clean(b.interests),
      tagsFrom(b.tags), optIn, optIn || b.sms_opt_in ? clean(b.opt_in_source) || 'Added by staff (form)' : null, Boolean(b.sms_opt_in)],
  );
  await saveDates(req.clientId, c.id, dates);
  res.status(201).json({ customer: { ...c, dates } });
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
  if ('city' in b) {
    if (!clean(b.city)) return res.status(400).json({ error: CITY_NEEDED, fields: { city: CITY_NEEDED } });
    add('city', clean(b.city));
  }
  const errors = {};
  const dates = 'dates' in b ? datesFrom(b.dates, errors) : null;
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  if ('last_purchase' in b) add('last_purchase', clean(b.last_purchase));
  if ('interests' in b) add('interests', clean(b.interests));
  if ('tags' in b) add('tags', tagsFrom(b.tags));
  if ('birthday' in b) add('birthday', parseDate(b.birthday));
  if ('anniversary' in b) add('anniversary', parseDate(b.anniversary));
  if ('sms_opt_in' in b) add('sms_opt_in', Boolean(b.sms_opt_in));
  if ('whatsapp_opt_in' in b) {
    const on = Boolean(b.whatsapp_opt_in);
    add('whatsapp_opt_in', on);
    sets.push(on ? `opt_in_at = ${NOW}, opted_out_at = NULL` : `opted_out_at = ${NOW}`);
    if (on) add('opt_in_source', clean(b.opt_in_source) || 'Updated by staff');
  }
  if (!sets.length && !dates) return res.status(400).json({ error: 'Nothing to change.' });
  const { rows: [c] } = await query(
    `UPDATE contacts SET ${[...sets, `updated_at = ${NOW}`].join(', ')} WHERE id = $1 AND client_id = $2 AND ${NOT_DELETED} RETURNING *`,
    params,
  );
  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  if (dates) await saveDates(req.clientId, c.id, dates);
  const { rows: [withDates] } = await query(`SELECT ${DATES_SQL} FROM contacts c WHERE c.id = $1`, [c.id]);
  res.json({ customer: { ...c, dates: withDates.dates } });
});

// Delete a customer: their name, number, details, chats and call-back entry are removed; queued
// messages to them are cancelled. Past offer counts, costs and bill-code sales stay in reports.
router.delete('/:id', canEdit, async (req, res) => {
  const { rows: [c] } = await query(`SELECT id FROM contacts WHERE id = $1 AND client_id = $2 AND ${NOT_DELETED}`, [req.params.id, req.clientId]);
  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  await batch([
    { sql: 'DELETE FROM leads WHERE contact_id = $1', params: [c.id] },
    { sql: 'DELETE FROM contact_dates WHERE contact_id = $1', params: [c.id] },
    {
      sql: `UPDATE messages SET status = 'cancelled', error_message = 'Customer was deleted'
             WHERE contact_id = $1 AND status IN ('queued', 'retrying')`,
      params: [c.id],
    },
    {
      // Chats (customer replies and staff answers) are not part of any offer report.
      sql: `DELETE FROM messages WHERE contact_id = $1 AND campaign_id IS NULL AND occasion_id IS NULL
              AND id NOT IN (SELECT message_id FROM redemptions)`,
      params: [c.id],
    },
    { sql: 'UPDATE messages SET body = NULL, template_values = NULL, variables = NULL WHERE contact_id = $1', params: [c.id] },
    {
      sql: `UPDATE contacts SET name = 'Deleted customer', phone = 'deleted:' || id, city = NULL, birthday = NULL, anniversary = NULL,
              last_purchase = NULL, interests = NULL, tags = '[]', whatsapp_opt_in = 0, sms_opt_in = 0, opt_in_at = NULL,
              opt_in_source = NULL, opted_out_at = NULL, updated_at = ${NOW}
             WHERE id = $1`,
      params: [c.id],
    },
  ]);
  res.json({ ok: true });
});

// ---- Import. The browser reads Excel/CSV/contacts files and builds the preview; the server
// ---- says which numbers already exist and saves the accepted rows in chunks.

router.post('/import/existing', canEdit, async (req, res) => {
  const phones = (Array.isArray(req.body?.phones) ? req.body.phones : []).slice(0, 5000).map(String);
  if (!phones.length) return res.json({ existing: [] });
  const { rows } = await query(
    `SELECT phone FROM contacts WHERE client_id = $1 AND phone IN (SELECT value FROM json_each($2))`,
    [req.clientId, phones],
  );
  res.json({ existing: rows.map((r) => r.phone) });
});

// Google Sheets can't be read from the browser directly, so the server fetches the CSV.
router.post('/import/sheet', canEdit, async (req, res) => {
  const url = sheetsCsvUrl(req.body?.sheetUrl);
  let r;
  try {
    r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new ImportError('Could not reach Google Sheets. Check the internet connection and try again.');
  }
  if (!r.ok || !(r.headers.get('content-type') || '').includes('text/csv')) {
    throw new ImportError('Google did not share this sheet. In Google Sheets, click Share and set it to "Anyone with the link can view", then try again.');
  }
  const text = await r.text();
  if (text.length > 15 * 1024 * 1024) throw new ImportError('That sheet is too large (15 MB limit).');
  res.type('text/csv').send(text);
});

// Saves up to 500 accepted rows per request (the browser sends a large import in chunks).
router.post('/import/commit', canEdit, async (req, res) => {
  const { rows = [], optIn = {}, updateExisting = false, source = 'import', tags = [], defaultCity = '' } = req.body || {};
  if (!Array.isArray(rows) || rows.length > 500) return res.status(400).json({ error: 'Send at most 500 rows at a time.' });
  // Every customer needs a city: rows without one take the city chosen for the whole import.
  const fallbackCity = clean(defaultCity);
  const noCity = rows.filter((r) => !clean(r.city)).length;
  if (noCity && !fallbackCity) {
    return res.status(400).json({ error: `${noCity} ${noCity === 1 ? 'row has' : 'rows have'} no city. Choose a city for them.`, noCity });
  }
  if ((optIn.value || optIn.sms) && !optIn.confirmed) {
    return res.status(400).json({ error: 'Please confirm these customers agreed to receive messages, or untick opt-in.' });
  }
  const extraTags = tagsFrom(tags);
  const valid = [];
  let skipped = 0;
  for (const r of rows) {
    const phone = normalizePhone(r.phone);
    if (!phone.ok) {
      skipped += 1;
      continue;
    }
    valid.push({ ...r, phone: phone.e164 });
  }
  const { rows: before } = valid.length
    ? await query(`SELECT phone FROM contacts WHERE client_id = $1 AND phone IN (SELECT value FROM json_each($2))`, [req.clientId, valid.map((r) => r.phone)])
    : { rows: [] };
  const existed = new Set(before.map((r) => r.phone));
  const src = String(source).slice(0, 120);
  const statements = valid
    .filter((r) => updateExisting || !existed.has(r.phone))
    .map((r) => {
      const wa = r.opt_in === null || r.opt_in === undefined ? Boolean(optIn.value) : Boolean(r.opt_in);
      const sms = r.sms_opt_in === null || r.sms_opt_in === undefined ? Boolean(optIn.sms) : Boolean(r.sms_opt_in);
      return {
        sql: `INSERT INTO contacts (client_id, name, phone, city, birthday, anniversary, last_purchase, interests, tags,
                                    whatsapp_opt_in, opt_in_at, opt_in_source, sms_opt_in)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10 THEN ${NOW} END, $11, $12)
              ON CONFLICT (client_id, phone) DO UPDATE SET
                name = COALESCE(excluded.name, contacts.name),
                city = COALESCE(excluded.city, contacts.city),
                birthday = COALESCE(excluded.birthday, contacts.birthday),
                anniversary = COALESCE(excluded.anniversary, contacts.anniversary),
                last_purchase = COALESCE(excluded.last_purchase, contacts.last_purchase),
                interests = COALESCE(excluded.interests, contacts.interests),
                tags = (SELECT json_group_array(DISTINCT value) FROM (SELECT value FROM json_each(contacts.tags) UNION SELECT value FROM json_each(excluded.tags))),
                updated_at = ${NOW}`,
        params: [req.clientId, clean(r.name), r.phone, clean(r.city) || fallbackCity, r.birthday || null, r.anniversary || null, clean(r.last_purchase),
          clean(r.interests), extraTags, wa, wa || sms ? src : null, sms],
      };
    });
  await batch(statements);
  const created = statements.filter((s) => !existed.has(s.params[2])).length;
  const updated = statements.length - created;
  res.json({ created, updated, skipped: skipped + (valid.length - statements.length) });
});

/** The customer's extra special days from the form: [{ kind, label, date }], dates checked. */
function datesFrom(list, errors) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const d of list.slice(0, 10)) {
    const kind = DATE_KINDS.includes(d?.kind) ? d.kind : 'other';
    const date = parseDate(d?.date);
    if (!date) {
      errors.dates = 'Use a real date for each special day.';
      continue;
    }
    out.push({ kind, label: clean(d?.label), date });
  }
  return out;
}

async function saveDates(clientId, contactId, dates) {
  await batch([
    { sql: 'DELETE FROM contact_dates WHERE contact_id = $1', params: [contactId] },
    ...dates.map((d) => ({
      sql: 'INSERT INTO contact_dates (client_id, contact_id, kind, label, date) VALUES ($1, $2, $3, $4, $5)',
      params: [clientId, contactId, d.kind, d.label, d.date],
    })),
  ]);
}

function clean(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 200) : null;
}

function tagsFrom(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

function titleCase(s) {
  return String(s || '').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

export default router;
