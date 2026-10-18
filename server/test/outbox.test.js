// The sending queue is the messages table ("outbox"), processed by processDue().
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initDb, closeDb, query, ensureClient } from '../src/db/index.js';
import { setProvider } from '../src/providers/index.js';
import { ProviderError } from '../src/providers/errors.js';
import { processSendJob, backoffSeconds } from '../src/lib/sender.js';
import { processDue, drain, setBackground } from '../src/lib/dispatch.js';
import { launchCampaign } from '../src/lib/campaigns.js';
import { applyStatus } from '../src/lib/messages.js';

let clientId;
let provider;
let template;

function fakeProvider() {
  const p = {
    name: 'fake', label: 'Fake', sent: [], failNext: [],
    missingConfig: () => [],
    async send(msg) {
      if (p.failNext.length) throw p.failNext.shift();
      const id = `FAKE${p.sent.length + 1}`;
      p.sent.push({ id, ...msg });
      return { providerMessageId: id, status: 'sent' };
    },
    async sendText(msg) { return p.send(msg); },
    fetchStatus: null, verifyWebhook: () => true, parseWebhook: () => ({ statuses: [], inbound: [] }),
  };
  return p;
}

/** Makes retried messages due now, so tests don't wait for the back-off. */
const fastForward = () => query(`UPDATE messages SET due_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second') WHERE status = 'retrying'`);

beforeAll(async () => {
  await initDb({ memory: true });
  clientId = await ensureClient('Test Store');
  setBackground((p) => p); // tests drain explicitly
});
afterAll(() => closeDb());

beforeEach(async () => {
  for (const t of ['messages', 'campaigns', 'templates', 'contacts']) await query(`DELETE FROM ${t}`);
  provider = fakeProvider();
  setProvider(provider);
  ({ rows: [template] } = await query(
    `INSERT INTO templates (client_id, name, body, buttons, status, category)
     VALUES ($1, 't', 'Hi {{name}}, enjoy {{offer}} on your next {{last_purchase}}.', '[{"type":"quick_reply","text":"Interested"}]', 'approved', 'utility') RETURNING *`,
    [clientId],
  ));
});

async function addContact(name, phone, extra = {}) {
  const { rows: [c] } = await query(
    `INSERT INTO contacts (client_id, name, phone, last_purchase, whatsapp_opt_in) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [clientId, name, phone, 'last_purchase' in extra ? extra.last_purchase : 'gold chain', extra.optIn ?? true],
  );
  return c;
}

async function campaign(extra = {}) {
  const { rows: [c] } = await query(
    `INSERT INTO campaigns (client_id, name, template_id, audience, variables, cost_per_message, provider, scheduled_at)
     VALUES ($1, 'Diwali', $2, $3, $4, 0.8631, 'fake', $5) RETURNING *`,
    [clientId, template.id, extra.audience || { mode: 'all' }, { offer: '10% off' }, extra.scheduledAt || null],
  );
  return c;
}

describe('outbox sending', () => {
  it('sends one personalised message per opted-in customer and skips the rest', async () => {
    await addContact('PRIYA sharma', '+919876543210');
    await addContact('Ravi', '+919123456789');
    await addContact('No Consent', '+919988776655', { optIn: false });
    await addContact('No Purchase', '+919988776600', { last_purchase: null });
    const c = await campaign();
    const result = await launchCampaign(clientId, c, template);
    await drain();

    expect(result.queued).toBe(2);
    expect(provider.sent.map((m) => m.to).sort()).toEqual(['+919123456789', '+919876543210']);
    expect(provider.sent.find((m) => m.to === '+919876543210').body).toBe('Hi Priya, enjoy 10% off on your next gold chain.');
    const { rows } = await query(`SELECT status, cost, body FROM messages WHERE campaign_id = $1`, [c.id]);
    expect(rows.every((r) => r.status === 'sent' && r.cost === 0.8631 && r.body)).toBe(true);
    const { rows: [after] } = await query('SELECT status FROM campaigns WHERE id = $1', [c.id]);
    expect(after.status).toBe('completed');
  });

  it('never sends the same message twice, however often it is launched or processed', async () => {
    await addContact('Priya', '+919876543210');
    const c = await campaign();
    await launchCampaign(clientId, c, template);
    const again = await launchCampaign(clientId, c, template); // e.g. a double-click
    const { rows: [m] } = await query('SELECT id FROM messages WHERE campaign_id = $1', [c.id]);
    await Promise.all([processDue(), processDue(), processSendJob(m.id)]); // overlapping runs
    await drain();
    await processSendJob(m.id); // a stray late call
    expect(again.queued).toBe(0);
    expect(provider.sent).toHaveLength(1);
  });

  it('retries a temporary failure after a back-off, then succeeds', async () => {
    await addContact('Priya', '+919876543210');
    provider.failNext = [new ProviderError('Twilio is busy', { retryable: true, status: 503 })];
    const c = await campaign();
    await launchCampaign(clientId, c, template);
    await drain();
    let { rows: [m] } = await query('SELECT status, attempts, due_at FROM messages WHERE campaign_id = $1', [c.id]);
    expect(m).toMatchObject({ status: 'retrying', attempts: 1 });
    expect(new Date(m.due_at).getTime()).toBeGreaterThan(Date.now() + 20000); // waits ~30 s
    await fastForward();
    await drain();
    ({ rows: [m] } = await query('SELECT status, attempts FROM messages WHERE campaign_id = $1', [c.id]));
    expect(m).toMatchObject({ status: 'sent', attempts: 2 });
    expect(provider.sent).toHaveLength(1);
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(3)).toBe(120);
  });

  it('marks a permanent failure with a plain reason and does not retry', async () => {
    await addContact('Priya', '+919876543210');
    provider.failNext = [new ProviderError('This number is not on WhatsApp.', { code: 63003 })];
    const c = await campaign();
    await launchCampaign(clientId, c, template);
    await drain();
    const { rows: [m] } = await query('SELECT * FROM messages WHERE campaign_id = $1', [c.id]);
    expect(m).toMatchObject({ status: 'failed', attempts: 1, error_code: '63003', error_message: 'This number is not on WhatsApp.' });
  });

  it('gives up after the last attempt', async () => {
    await addContact('Priya', '+919876543210');
    const busy = () => new ProviderError('Twilio is busy', { retryable: true, status: 503 });
    provider.failNext = [busy(), busy(), busy(), busy()];
    const c = await campaign();
    await launchCampaign(clientId, c, template);
    for (let i = 0; i < 5; i++) {
      await drain();
      await fastForward();
    }
    const { rows: [m] } = await query('SELECT status, attempts FROM messages WHERE campaign_id = $1', [c.id]);
    expect(m).toMatchObject({ status: 'failed', attempts: 4 });
  });

  it('holds scheduled messages until their time, and skips them if the campaign is cancelled', async () => {
    await addContact('Priya', '+919876543210');
    const later = new Date(Date.now() + 3600 * 1000).toISOString();
    const c = await campaign({ scheduledAt: later });
    const r = await launchCampaign(clientId, c, template);
    expect(r.queued).toBe(1);
    await drain();
    expect(provider.sent).toHaveLength(0); // not due yet
    await query(`UPDATE campaigns SET status = 'cancelled' WHERE id = $1`, [c.id]);
    await query(`UPDATE messages SET due_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE campaign_id = $1`, [c.id]);
    await drain();
    expect(provider.sent).toHaveLength(0);
    const { rows: [m] } = await query('SELECT status, error_message FROM messages WHERE campaign_id = $1', [c.id]);
    expect(m).toMatchObject({ status: 'cancelled', error_message: 'Campaign was cancelled' });
  });

  it('moves statuses forward only (sent -> delivered -> read)', async () => {
    await addContact('Priya', '+919876543210');
    const c = await campaign();
    await launchCampaign(clientId, c, template);
    await drain();
    const id = provider.sent[0].id;
    await applyStatus({ providerMessageId: id, status: 'read' });
    await applyStatus({ providerMessageId: id, status: 'delivered' }); // arrives late
    const { rows: [m] } = await query('SELECT status, read_at, delivered_at FROM messages WHERE provider_message_id = $1', [id]);
    expect(m.status).toBe('read');
    expect(m.read_at).toBeTruthy();
    expect(m.delivered_at).toBeTruthy();
  });

  it('launches 5,000 customers with one statement', async () => {
    const values = Array.from({ length: 5000 }, (_, i) => `(${clientId}, 'C${i}', '+9198${String(10000000 + i)}', 'ring', 1)`);
    await query(`INSERT INTO contacts (client_id, name, phone, last_purchase, whatsapp_opt_in) VALUES ${values.join(',')}`);
    const c = await campaign();
    const t0 = Date.now();
    const r = await launchCampaign(clientId, c, template);
    expect(r.queued).toBe(5000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
