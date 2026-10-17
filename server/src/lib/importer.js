// Turns an uploaded Excel/CSV file or pasted text into reviewed customer rows.
// Step 1: parse into a grid. Step 2: guess which column is which.
// Step 3: build a preview that flags invalid numbers and duplicates.
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { normalizePhone } from './phone.js';

export const FIELDS = [
  { key: 'name', label: 'Name', synonyms: ['name', 'customer name', 'full name', 'customer', 'client name', 'first name', 'contact name'] },
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
export function parseFile(buffer, filename = '') {
  const ext = filename.toLowerCase().split('.').pop();
  let grid;
  if (ext === 'csv' || ext === 'txt') {
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const parsed = Papa.parse(text, { skipEmptyLines: 'greedy' });
    grid = parsed.data;
  } else if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new ImportError('The file has no sheets.');
    grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false });
  } else if (ext === 'vcf') {
    grid = parseVcard(buffer.toString('utf8'));
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

/** A Google Sheets link becomes its CSV export link (the sheet must be shared "anyone with the link"). */
export function sheetsCsvUrl(link) {
  const help = 'Paste the full Google Sheets link (it starts with https://docs.google.com/spreadsheets/).';
  let url;
  try {
    url = new URL(String(link || '').trim());
  } catch {
    throw new ImportError(help);
  }
  const m = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !m) throw new ImportError(help);
  const gid = (url.hash.match(/gid=(\d+)/) || url.search.match(/gid=(\d+)/) || [])[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
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

const clean = (s) => String(s).toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

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
    const phone = normalizePhone(phoneRaw);
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

function cleanText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim().slice(0, 200);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Returns YYYY-MM-DD or null. Indian day-first order for 03/04/1990 (3 April). */
export function parseDate(value, label = 'Date', warnings = []) {
  if (value === null || value === undefined || value === '') return null;
  let y;
  let m;
  let d;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // SheetJS dates are local midnight; add 12h so time zones never shift the day.
    const safe = new Date(value.getTime() + 12 * 3600 * 1000);
    [y, m, d] = [safe.getUTCFullYear(), safe.getUTCMonth() + 1, safe.getUTCDate()];
  } else if (typeof value === 'number' && value > 0 && value < 80000) {
    const p = XLSX.SSF.parse_date_code(value);
    [y, m, d] = [p.y, p.m, p.d];
  } else {
    const s = String(value).trim().toLowerCase();
    let mt;
    if ((mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
      [y, m, d] = [+mt[1], +mt[2], +mt[3]];
    } else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
      [d, m, y] = [+mt[1], +mt[2], +mt[3]];
      if (y < 100) y += y > 30 ? 1900 : 2000;
    } else if ((mt = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s,-]+(\d{4})$/))) {
      [d, m, y] = [+mt[1], MONTHS.indexOf(mt[2]) + 1, +mt[3]];
    } else if ((mt = s.match(/^([a-z]{3})[a-z]*[\s-]+(\d{1,2})(?:st|nd|rd|th)?[\s,-]+(\d{4})$/))) {
      [m, d, y] = [MONTHS.indexOf(mt[1]) + 1, +mt[2], +mt[3]];
    } else {
      warnings.push(`${label} "${value}" not understood`);
      return null;
    }
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!y || m < 1 || m > 12 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1900 || y > 2100) {
    warnings.push(`${label} "${value}" is not a real date`);
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** true / false, or null when the cell is empty (the import-wide choice applies). */
export function parseOptIn(value) {
  if (value === true || value === false) return value;
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  if (['yes', 'y', 'true', '1', 'opted in', 'opt in', 'agreed', 'ok'].includes(s)) return true;
  if (['no', 'n', 'false', '0', 'opted out', 'opt out', 'stop'].includes(s)) return false;
  return null;
}

/** A small sample workbook staff can download, fill in and upload. */
export function sampleWorkbook() {
  const rows = [
    ['Name', 'Phone', 'City', 'Birthday', 'Anniversary', 'Last purchase', 'Interests', 'WhatsApp opt-in'],
    ['Priya Sharma', '98765 43210', 'Hyderabad', '14/02/1992', '20/11/2016', 'Gold bangles', 'Bridal, Gold', 'Yes'],
    ['Ravi Kumar', '+91 91234 56789', 'Secunderabad', '03/07/1988', '', 'Diamond ring', 'Diamonds', 'Yes'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [18, 18, 14, 12, 12, 16, 16, 16].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
  }
}
