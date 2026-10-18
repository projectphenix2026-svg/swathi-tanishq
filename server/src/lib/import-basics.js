// Import helpers with no file-format libraries, so the server (Cloudflare Worker) can use them.

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
    // Excel stores dates as days since 30 Dec 1899.
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 864e5);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
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

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
  }
}
