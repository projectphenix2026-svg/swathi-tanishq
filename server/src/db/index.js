import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let impl = null;

/**
 * Opens the database once. Uses real PostgreSQL when DATABASE_URL is set,
 * otherwise embedded Postgres (PGlite). Pass { memory: true } for tests.
 */
export async function initDb({ memory = false } = {}) {
  if (impl) return impl;
  if (config.databaseUrl && !memory) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    impl = {
      kind: 'postgres',
      query: (text, params) => pool.query(text, params),
      exec: (text) => pool.query(text),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    let pglite;
    if (memory) {
      pglite = new PGlite();
    } else {
      const dataDir = path.resolve(config.pgliteDir);
      fs.mkdirSync(dataDir, { recursive: true });
      pglite = new PGlite(dataDir);
    }
    await pglite.waitReady;
    impl = {
      kind: memory ? 'pglite-memory' : 'pglite',
      query: (text, params) => pglite.query(text, params),
      exec: (text) => pglite.exec(text),
      transaction: (fn) => pglite.transaction((tx) => fn({ query: (t, p) => tx.query(t, p) })),
      close: () => pglite.close(),
    };
  }
  await impl.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return impl;
}

export function db() {
  if (!impl) throw new Error('Database not initialised: call initDb() first.');
  return impl;
}

export const query = (text, params) => db().query(text, params);

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
