// Turns an uploaded Excel/CSV file or pasted text into reviewed customer rows.
// Step 1: parse into a grid. Step 2: guess which column is which.
// Step 3: build a preview that flags invalid numbers and duplicates.
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { normalizePhone } from './phone.js';
import { parseDate, parseOptIn, sheetsCsvUrl, ImportError } from './import-basics.js';

export { parseDate, parseOptIn, sheetsCsvUrl, ImportError };

export const FIELDS = [
  { key: 'name', label: 'Name', synonyms: ['name', 'customer name', 'full name', 'customer', 'client name', 'first name', 'contact name'] },
  { key: 'country_code', label: 'Country code', synonyms: ['country code', 'isd code', 'isd', 'dial code', 'calling code', 'country calling code'] },
  { key: 'phone', label: 'Phone', synonyms: ['phone', 'mobile', 'mobile number', 'mobile no', 'phone number', 'phone no', 'whatsapp', 'whatsapp number', 'contact', 'contact number', 'cell', 'number', 'ph', 'mob'] },
  { key: 'city', label: 'City', synonyms: ['city', 'town', 'location', 'area', 'place'] },
  { key: 'birthday', label: 'Birthday', synonyms: ['birthday', 'dob', 'date of birth', 'birth date', 'birthdate', 'bday'] },
  { key: 'anniversary', label: 'Anniversary', synonyms: ['anniversary', 'wedding anniversary', 'anniversary date', 'wedding date', 'marriage date'] },
  { key: 'last_purchase', label: 'Last purchase', synonyms: ['last purchase', 'last item', 'last bought', 'purchase', 'product', 'last product', 'item'] },
  { key: 'interests', label: 'Interests', synonyms: ['interests', 'interest', 'category', 'preference', 'preferences', 'likes'] },
  { key: 'opt_in', label: 'WhatsApp opt-in', synonyms: ['opt in', 'optin', 'opt-in', 'whatsapp opt-in', 'whatsapp opt in', 'consent', 'whatsapp consent', 'subscribed'] },
  { key: 'sms_opt_in', label: 'SMS opt-in', synonyms: ['sms opt-in', 'sms opt in', 'sms optin', 'sms consent'] },
];

export const MAX_ROWS = 50000;

/** Reads .xlsx, .xls or .csv into { columns, rows } where rows are arrays of cells. */
/** data: ArrayBuffer or Uint8Array (a Node Buffer works too), so this runs in the browser and in Node. */
export function parseFile(data, filename = '') {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const asText = () => new TextDecoder('utf-8').decode(bytes);
  const ext = filename.toLowerCase().split('.').pop();
  let grid;
  if (ext === 'csv' || ext === 'txt') {
    const text = asText().replace(/^﻿/, '');
    const parsed = Papa.parse(text, { skipEmptyLines: 'greedy' });
    grid = parsed.data;
  } else if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new ImportError('The file has no sheets.');
    grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false });
  } else if (ext === 'vcf') {
    grid = parseVcard(asText());
  } else {
    throw new ImportError('Please upload an Excel (.xlsx, .xls), CSV (.csv) or phone contacts (.vcf) file.');
  }
  return gridToTable(grid);
}

/**
 * Phone contacts exported as a vCard file (.vcf): one row per contact with a name,
 * the first mobile number and the birthday if saved.
 */
export function parseVcard(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const grid = [['Name', 'Phone', 'Birthday']];
  let card = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('BEGIN:VCARD')) card = { name: '', phones: [], bday: '' };
    else if (upper.startsWith('END:VCARD') && card) {
      const mobile = card.phones.find((p) => p.mobile) || card.phones[0];
      if (mobile) grid.push([card.name, mobile.value, card.bday]);
      card = null;
    } else if (card) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = upper.slice(0, idx);
      const value = line.slice(idx + 1).trim();
      if (key === 'FN' || key.startsWith('FN;')) card.name = value;
      else if ((key === 'N' || key.startsWith('N;')) && !card.name) card.name = value.split(';').slice(0, 2).reverse().filter(Boolean).join(' ');
      else if (key.startsWith('TEL')) card.phones.push({ value, mobile: /CELL|MOBILE|IPHONE/.test(key) });
      else if (key.startsWith('BDAY') && /^\d{4}-?\d{2}-?\d{2}/.test(value)) card.bday = value.replace(/^(\d{4})-?(\d{2})-?(\d{2}).*/, '$1-$2-$3');
    }
  }
  return grid;
}

/**
 * Pasted text: one customer per line ("Priya, 98765 43210" or just "9876543210"),
 * or several bare numbers on one line separated by commas or semicolons.
 */
export function parsePasted(text) {
  const rows = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/[\t,;|]/).map((p) => p.trim()).filter(Boolean);
    const phoneLike = parts.map((p) => normalizePhone(p).ok);
    if (parts.length > 1 && phoneLike.every(Boolean)) {
      for (const p of parts) rows.push(['', p]);
      continue;
    }
    const phoneIdx = phoneLike.indexOf(true);
    if (phoneIdx === -1) {
      // No valid number: keep the line so the preview can show why.
      const guess = parts.find((p) => /\d/.test(p)) ?? line;
      const name = parts.filter((p) => p !== guess).join(' ');
      rows.push([name, guess]);
    } else {
      const name = parts.filter((_, i) => i !== phoneIdx).join(' ');
      rows.push([name, parts[phoneIdx]]);
    }
  }
  return { columns: ['Name', 'Phone'], rows, mapping: { name: 0, phone: 1 } };
}

function gridToTable(grid) {
  const nonEmpty = grid.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  if (!nonEmpty.length) throw new ImportError('The file is empty.');
  const first = nonEmpty[0];
  const looksLikeHeader = !first.some((c) => normalizePhone(c).ok) &&
    first.some((c) => typeof c === 'string' && /[a-z]/i.test(c));
  const width = Math.max(...nonEmpty.map((r) => r.length));
  let columns;
  let rows;
  if (looksLikeHeader) {
    columns = Array.from({ length: width }, (_, i) => String(first[i] ?? '').trim() || `Column ${colLetter(i)}`);
    rows = nonEmpty.slice(1);
  } else {
    columns = Array.from({ length: width }, (_, i) => `Column ${colLetter(i)}`);
    rows = nonEmpty;
  }
  if (rows.length > MAX_ROWS) throw new ImportError(`Please split the file: it has ${rows.length} rows (limit ${MAX_ROWS}).`);
  const mapping = guessMapping(columns, rows);
  return { columns, rows, mapping };
}

function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// "Phone *" and "Name (optional)" read as phone and name.
const clean = (s) => String(s).toLowerCase().replace(/\((required|mandatory|optional)\)|\*/g, ' ').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Guesses { field: columnIndex } from header names, falling back to the data itself for the phone column. */
export function guessMapping(columns, rows = []) {
  const mapping = {};
  const used = new Set();
  // Exact synonym matches first, then "contains" matches.
  for (const pass of ['exact', 'contains']) {
    for (const field of FIELDS) {
      if (mapping[field.key] !== undefined) continue;
      const idx = columns.findIndex((c, i) => {
        if (used.has(i)) return false;
        const h = clean(c);
        return field.synonyms.some((s) => (pass === 'exact' ? h === s : h.includes(s)));
      });
      if (idx !== -1) {
        mapping[field.key] = idx;
        used.add(idx);
      }
    }
  }
  if (mapping.phone === undefined) {
    // Pick the column where most sample values are valid phone numbers.
    const sample = rows.slice(0, 50);
    let best = -1;
    let bestScore = 0;
    columns.forEach((_, i) => {
      if (used.has(i)) return;
      const score = sample.filter((r) => normalizePhone(r[i]).ok).length;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best !== -1) mapping.phone = best;
  }
  return mapping;
}

/**
 * Builds the reviewed rows. existingPhones: Set of E.164 numbers already saved.
 * Statuses: ok | invalid | duplicate (repeated in this file) | exists (already a customer).
 */
export function buildPreview({ rows, mapping }, existingPhones = new Set()) {
  if (mapping.phone === undefined) throw new ImportError('Choose which column holds the phone number.');
  const seen = new Map();
  const out = rows.map((r, i) => {
    const get = (key) => (mapping[key] === undefined ? '' : r[mapping[key]]);
    const phoneRaw = get('phone');
    const phone = normalizePhone(withCountryCode(phoneRaw, get('country_code')));
    const warnings = [];
    const row = {
      row: i + 1,
      name: cleanText(get('name')),
      phoneRaw: phoneRaw instanceof Date ? '' : String(phoneRaw ?? '').trim(),
      phone: phone.ok ? phone.e164 : null,
      phoneDisplay: phone.ok ? phone.display : null,
      city: cleanText(get('city')),
      birthday: parseDate(get('birthday'), 'Birthday', warnings),
      anniversary: parseDate(get('anniversary'), 'Anniversary', warnings),
      last_purchase: cleanText(get('last_purchase')),
      interests: cleanText(get('interests')),
      opt_in: parseOptIn(get('opt_in')),
      sms_opt_in: parseOptIn(get('sms_opt_in')),
      status: 'ok',
      reason: null,
      warnings,
    };
    if (!phone.ok) {
      row.status = 'invalid';
      row.reason = phone.reason;
    } else if (seen.has(phone.e164)) {
      row.status = 'duplicate';
      row.reason = `Same number as row ${seen.get(phone.e164)}`;
    } else {
      seen.set(phone.e164, row.row);
      if (existingPhones.has(phone.e164)) {
        row.status = 'exists';
        row.reason = 'Already a customer';
      }
    }
    if (phone.ok && phone.international) warnings.push('Not an Indian number');
    return row;
  });
  const summary = { total: out.length, ok: 0, invalid: 0, duplicate: 0, exists: 0 };
  for (const r of out) summary[r.status] += 1;
  return { rows: out, summary };
}

/** The phone with the Country code column put in front, unless the phone already has its own +code. */
export function withCountryCode(phone, code) {
  const cc = String(code ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!cc || phone === null || phone === undefined || phone instanceof Date) return phone;
  const raw = String(phone).trim().replace(/\.0+$/, '');
  if (!raw || /^(\+|00)/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '').replace(/^0/, '');
  // Already starts with the same code and is longer than a bare number (e.g. 919876543210).
  if (digits.startsWith(cc) && digits.length > 10) return `+${digits}`;
  return `+${cc}${digits}`;
}

function cleanText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim().slice(0, 200);
}

// The sample's columns: header, required?, what to write, example. "*" marks the required ones.
export const SAMPLE_COLUMNS = [
  ['Name', 'Optional (recommended)', 'Customer’s name, so messages greet them by name.', 'Priya Sharma'],
  ['Country code', 'Optional', 'Digits only, without +. Leave empty for India (91).', '91'],
  ['Phone *', 'Required', 'Mobile number on WhatsApp, without the country code. 10 digits for India.', '98765 43210'],
  ['City *', 'Required', 'City or town. If left empty, Sandesh asks for it before adding the customer.', 'Hyderabad'],
  ['Birthday', 'Optional', 'Day/month/year. For birthday wishes.', '14/02/1992'],
  ['Anniversary', 'Optional', 'Day/month/year. For anniversary wishes.', '20/11/2016'],
  ['Last purchase', 'Optional', 'What they bought last.', 'Gold bangles'],
  ['Interests', 'Optional', 'What they like, separated by commas.', 'Bridal, Gold'],
  ['WhatsApp opt-in', 'Optional', 'Yes if they agreed to get offers on WhatsApp; otherwise No.', 'Yes'],
];

/** A small sample workbook staff can download, fill in and upload, with a "How to fill" sheet. */
export function sampleWorkbook() {
  const rows = [
    SAMPLE_COLUMNS.map((c) => c[0]),
    ['Priya Sharma', '91', '98765 43210', 'Hyderabad', '14/02/1992', '20/11/2016', 'Gold bangles', 'Bridal, Gold', 'Yes'],
    ['Ravi Kumar', '91', '91234 56789', 'Secunderabad', '03/07/1988', '', 'Diamond ring', 'Diamonds', 'Yes'],
    ['Anil Rao', '971', '50 123 4567', 'Dubai', '', '', 'Gold chain', 'Gold', 'Yes'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [18, 13, 16, 14, 12, 12, 16, 16, 16].map((wch) => ({ wch }));
  const help = XLSX.utils.aoa_to_sheet([
    ['How to fill the Customers sheet'],
    ['Columns marked * (Phone and City) are required. Keep the first row (the column names) as it is.'],
    [],
    ['Column', 'Required?', 'What to write', 'Example'],
    ...SAMPLE_COLUMNS,
  ]);
  help['!cols'] = [16, 22, 70, 16].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  XLSX.utils.book_append_sheet(wb, help, 'How to fill');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
