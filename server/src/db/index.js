// One small database API for both places the app runs:
//   Cloudflare Workers -> D1 (SQLite as a service), passed in as a binding
//   Node (local dev, tests) -> Node's built-in SQLite (node:sqlite), a file or in memory
// query(sql, params) uses $1, $2... placeholders and returns { rows, rowCount }.
// JSON columns come back parsed and true/false columns come back as booleans.
import { SCHEMA, CONNECTION_TABLE, MEDIA_TABLE, DATES_TABLE, DATES_INDEX, LOGIN_ATTEMPTS_TABLE, EXTRA_COLUMNS } from './schema.js';

let impl = null;

const JSON_COLS = new Set(['buttons', 'template_buttons', 'audience', 'variables', 'template_values', 'tags', 'days_before', 'dates', 'approved_version']);
const BOOL_COLS = new Set(['whatsapp_opt_in', 'sms_opt_in', 'enabled', 'sms_fallback', 'repeat_yearly', 'sales_codes']);

/** SQL for "now" and "N units ago" as ISO text, matching how times are stored. */
export const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
export const ago = (amount) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${amount}')`;

const toSqlite = (sql) => sql.replace(/\$(\d+)/g, '?$1');

function encode(params = []) {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    if (v !== null && typeof v === 'object') return JSON.stringify(v);
    return v;
  });
}

function decode(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (JSON_COLS.has(k) && typeof v === 'string') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else if (BOOL_COLS.has(k) && (v === 0 || v === 1)) {
      out[k] = v === 1;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Splits the schema into single statements (D1 runs one statement per prepare). */
function statements(sql) {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/--[^\n]*\n?/g, '\n').trim())
    .filter(Boolean);
}

function nodeAdapter(DatabaseSync, file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const run = (sql, params) => {
    const stmt = db.prepare(toSqlite(sql));
    const rows = stmt.all(...encode(params));
    const { c } = db.prepare('SELECT changes() AS c').get();
    return { rows: rows.map(decode), rowCount: c };
  };
  return {
    kind: file === ':memory:' ? 'sqlite-memory' : 'sqlite',
    async query(sql, params) {
      return run(sql, params);
    },
    async batch(list) {
      db.exec('BEGIN');
      try {
        const out = list.map(({ sql, params }) => run(sql, params));
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}

function d1Adapter(d1) {
  const prep = (sql, params) => d1.prepare(toSqlite(sql)).bind(...encode(params));
  const shape = (r) => ({ rows: (r.results || []).map(decode), rowCount: r.meta?.changes ?? 0 });
  return {
    kind: 'd1',
    async query(sql, params) {
      return shape(await prep(sql, params).all());
    },
    async batch(list) {
      if (!list.length) return [];
      return (await d1.batch(list.map(({ sql, params }) => prep(sql, params)))).map(shape);
    },
    async exec(sql) {
      await d1.batch(statements(sql).map((s) => d1.prepare(s)));
    },
    async close() {},
  };
}

/**
 * Opens the database once. Pass { d1 } on Cloudflare, { memory: true } for tests,
 * otherwise a local SQLite file at SQLITE_FILE (default ./.data/swathi.db).
 */
export async function initDb({ memory = false, d1 = null, file } = {}) {
  if (impl) return impl;
  if (d1) {
    impl = d1Adapter(d1);
  } else {
    // Loaded without an import statement, so Cloudflare's bundler never sees node:sqlite.
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    let path = ':memory:';
    if (!memory) {
      const fs = process.getBuiltinModule('node:fs');
      const nodePath = process.getBuiltinModule('node:path');
      path = nodePath.resolve(file || process.env.SQLITE_FILE || './.data/swathi.db');
      fs.mkdirSync(nodePath.dirname(path), { recursive: true });
    }
    impl = nodeAdapter(DatabaseSync, path);
  }
  await ensureSchema();
  return impl;
}

async function ensureSchema() {
  let ready = false;
  try {
    await impl.query('SELECT 1 FROM leads LIMIT 1');
    ready = impl.kind === 'd1';
  } catch {
    /* first run: create the tables */
  }
  if (ready) {
    // Already set up. Tables added after the first deploy are created here (cheap if they exist).
    for (const table of [CONNECTION_TABLE, MEDIA_TABLE, DATES_TABLE, DATES_INDEX, LOGIN_ATTEMPTS_TABLE]) await impl.query(table.trim().replace(/;$/, ''));
  } else {
    await impl.exec(SCHEMA);
  }
  await ensureColumns();
  // Earlier versions had admin, manager and viewer. An admin is a store owner; a viewer becomes staff.
  await impl.query("UPDATE users SET role = 'owner' WHERE role = 'admin'");
  await impl.query("UPDATE users SET role = 'staff' WHERE role = 'viewer'");
}

/** Adds columns introduced after the first deploy to older databases (SQLite has no ADD COLUMN IF NOT EXISTS). */
async function ensureColumns() {
  for (const [table, columns] of Object.entries(EXTRA_COLUMNS)) {
    const { rows } = await impl.query(`PRAGMA table_info(${table})`);
    const have = new Set(rows.map((r) => r.name));
    for (const [name, type] of columns) {
      if (!have.has(name)) await impl.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

export function db() {
  if (!impl) throw new Error('Database not initialised: call initDb() first.');
  return impl;
}

export const query = (text, params) => db().query(text, params);
export const batch = (list) => db().batch(list);

export async function closeDb() {
  if (impl) await impl.close();
  impl = null;
}

/** Returns the id of the single client this install serves (created on first run). */
export async function ensureClient(name) {
  const existing = await query('SELECT id FROM clients ORDER BY id LIMIT 1');
  if (existing.rows.length) return existing.rows[0].id;
  const created = await query('INSERT INTO clients (name) VALUES ($1) RETURNING id', [name]);
  return created.rows[0].id;
}

/** ISO time (UTC) for the start of today / this month in India, for "this month" reports. */
export function indiaStartOf(unit, now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = unit === 'month' ? 1 : ist.getUTCDate();
  return new Date(Date.UTC(y, m, d) - 5.5 * 3600 * 1000).toISOString();
}
