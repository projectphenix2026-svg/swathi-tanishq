// Customer tags: tidy names, filters (any / all / except), bulk tagging, the Excel Tags column.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { assertConfig } from '../src/config.js';
import { initDb, closeDb, ensureClient, query } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';
import { audienceWhere } from '../src/lib/campaigns.js';
import { tagsFrom, normalizeTag } from '../src/lib/tags.js';
import { parseFile, buildPreview, guessMapping } from '../src/lib/importer.js';

let agent;
let clientId;
const ids = {};

beforeAll(async () => {
  assertConfig();
  await initDb({ memory: true });
  clientId = await ensureClient('Test Store');
  await createUser({ clientId, email: 'owner@example.com', password: 'owner-password-1', name: 'Owner', role: 'owner' });
  agent = request.agent(createApp());
  await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'owner-password-1' });
  for (const [name, phone, tags] of [['Asha', '+919000010001', '["vip","bridal-2026"]'], ['Bala', '+919000010002', '["vip"]'], ['Chitra', '+919000010003', '["bridal-2026","test-phone"]']]) {
    const { rows: [c] } = await query(
      `INSERT INTO contacts (client_id, name, phone, city, whatsapp_opt_in, tags) VALUES ($1, $2, $3, 'Warangal', 1, $4) RETURNING id`,
      [clientId, name, phone, tags],
    );
    ids[name] = c.id;
  }
});
afterAll(() => closeDb());

const names = (res) => res.body.customers.map((c) => c.name).sort();

describe('Tags', () => {
  it('tidies tag names', () => {
    expect(normalizeTag('  Bridal 2026 ')).toBe('bridal-2026');
    expect(tagsFrom('VIP, bridal 2026; vip')).toEqual(['vip', 'bridal-2026']);
  });

  it('filters customers by any, all, or except tags', async () => {
    expect(names(await agent.get('/api/customers?tags=vip,bridal-2026'))).toEqual(['Asha', 'Bala', 'Chitra']);
    expect(names(await agent.get('/api/customers?tags=vip,bridal-2026&tagMode=all'))).toEqual(['Asha']);
    expect(names(await agent.get('/api/customers?notTags=vip'))).toEqual(['Chitra']);
    const summary = (await agent.get('/api/customers/summary')).body.tags;
    expect(summary).toEqual(expect.arrayContaining([{ tag: 'vip', count: 2, auto: false }, { tag: 'bridal-2026', count: 2, auto: false }]));
    expect(summary.some((t) => t.tag === 'test-phone')).toBe(false);
  });

  it('picks customers for a message by all of some tags, leaving others out', async () => {
    const pick = async (audience) => {
      const { where, params } = audienceWhere(clientId, audience);
      return (await query(`SELECT c.name FROM contacts c WHERE ${where} ORDER BY c.name`, params)).rows.map((r) => r.name);
    };
    expect(await pick({ mode: 'filter', tags: ['vip', 'bridal-2026'], tagMode: 'all' })).toEqual(['Asha']);
    expect(await pick({ mode: 'filter', tags: ['vip'], notTags: ['bridal-2026'] })).toEqual(['Bala']);
  });

  it('adds and removes several tags at once', async () => {
    await agent.post('/api/customers/bulk').send({ action: 'tag', ids: [ids.Bala], tags: ['Diwali 2026', 'gold'] }).expect(200);
    expect((await query('SELECT tags FROM contacts WHERE id = $1', [ids.Bala])).rows[0].tags).toEqual(['vip', 'diwali-2026', 'gold']);
    await agent.post('/api/customers/bulk').send({ action: 'untag', ids: [ids.Bala], tags: ['gold'] }).expect(200);
    expect((await query('SELECT tags FROM contacts WHERE id = $1', [ids.Bala])).rows[0].tags).toEqual(['vip', 'diwali-2026']);
  });

  it('editing tags keeps Sandesh’s own hidden tags', async () => {
    await agent.patch(`/api/customers/${ids.Chitra}`).send({ tags: ['vip'] }).expect(200);
    expect((await query('SELECT tags FROM contacts WHERE id = $1', [ids.Chitra])).rows[0].tags.sort()).toEqual(['test-phone', 'vip']);
  });

  it('reads a Tags column from Excel: none, one or several', () => {
    const ws = XLSX.utils.aoa_to_sheet([['Name', 'Phone *', 'City *', 'Tags'], ['A', '9876543210', 'X', 'VIP, Bridal 2026'], ['B', '9123456789', 'Y', '']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    const grid = parseFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'c.xlsx');
    const { rows } = buildPreview({ ...grid, mapping: guessMapping(grid.columns, grid.rows) });
    expect(rows.map((r) => r.tags)).toEqual([['vip', 'bridal-2026'], []]);
  });

  it('saves imported tags with the import-wide tag', async () => {
    const res = await agent.post('/api/customers/import/commit').send({
      rows: [{ name: 'Devi', phone: '9000010009', city: 'Warangal', tags: ['nri'] }], tags: ['Diwali list'], optIn: { value: false },
    });
    expect(res.status).toBe(200);
    expect((await query("SELECT tags FROM contacts WHERE phone = '+919000010009'")).rows[0].tags.sort()).toEqual(['diwali-list', 'nri']);
  });
});
