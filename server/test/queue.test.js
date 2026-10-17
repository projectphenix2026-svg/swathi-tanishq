import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMemoryQueue } from '../src/queue/memory.js';
import { setQueue } from '../src/queue/index.js';
import { initDb, closeDb, query, ensureClient } from '../src/db/index.js';
import { setProvider } from '../src/providers/index.js';
import { ProviderError } from '../src/providers/errors.js';
import { processSendJob, enqueueMessage, requeuePending } from '../src/lib/sender.js';
import { launchCampaign } from '../src/lib/campaigns.js';
import { applyStatus } from '../src/lib/messages.js';

describe('memory queue', () => {
  it('runs a job id only once, even if added twice', async () => {
    const seen = [];
    const q = createMemoryQueue({ handler: async (d) => seen.push(d.n), ratePerSecond: 0 });
    expect(q.add('a', { n: 1 })).toBe(true);
    expect(q.add('a', { n: 2 })).toBe(false);
    q.add('b', { n: 3 });
    await q.onIdle();
    expect(seen).toEqual([1, 3]);
  });

  it('retries retryable errors with back-off, up to maxAttempts', async () => {
    let calls = 0;
    const q = createMemoryQueue({
      handler: async () => {
        calls += 1;
        throw Object.assign(new Error('timeout'), { retryable: true });
      },
      ratePerSecond: 0,
      maxAttempts: 3,
      backoffMs: () => 5,
    });
    q.add('x', {});
    await q.onIdle();
    expect(calls).toBe(3);
    expect(q.stats).toMatchObject({ retried: 2, failed: 1 });
  });

  it('does not retry permanent errors', async () => {
    let calls = 0;
    const q = createMemoryQueue({ handler: async () => { calls += 1; throw new Error('bad number'); }, ratePerSecond: 0, backoffMs: () => 1 });
    q.add('x', {});
    await q.onIdle();
    expect(calls).toBe(1);
  });

  it('keeps to the send-rate limit', async () => {
    const times = [];
    const q = createMemoryQueue({ handler: async () => times.push(Date.now()), ratePerSecond: 20, concurrency: 5 });
    for (let i = 0; i < 5; i++) q.add(String(i), {});
    await q.onIdle();
    expect(times[4] - times[0]).toBeGreaterThanOrEqual(190); // 4 gaps of 50 ms
  });

  it('waits for delayed (scheduled) jobs', async () => {
    const start = Date.now();
    let ranAt = 0;
    const q = createMemoryQueue({ handler: async () => { ranAt = Date.now(); }, ratePerSecond: 0 });
    q.add('later', {}, { delay: 80 });
    await q.onIdle();
    expect(ranAt - start).toBeGreaterThanOrEqual(75);
  });
});

describe('sending pipeline', () => {
  let clientId;
  let provider;
  let queue;
  let template;

  beforeAll(async () => {
    await initDb({ memory: true });
    clientId = await ensureClient('Test Store');
  });
  afterAll(() => closeDb());

  beforeEach(async () => {
    await query('DELETE FROM messages');
    await query('DELETE FROM campaigns');
    await query('DELETE FROM templates');
    await query('DELETE FROM contacts');
    provider = fakeProvider();
    setProvider(provider);
    queue = createMemoryQueue({ handler: processSendJob, ratePerSecond: 0, maxAttempts: 3, backoffMs: () => 5 });
    setQueue(queue);
    ({ rows: [template] } = await query(
      `INSERT INTO templates (client_id, name, body, buttons, status)
       VALUES ($1, 't', 'Hi {{name}}, enjoy {{offer}} on your next {{last_purchase}}.', '[{"type":"quick_reply","text":"Interested"}]', 'approved') RETURNING *`,
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

  async function campaign(audience = { mode: 'all' }) {
    const { rows: [c] } = await query(
      `INSERT INTO campaigns (client_id, name, template_id, audience, variables, cost_per_message, provider)
       VALUES ($1, 'Diwali', $2, $3, $4, 0.8631, 'fake') RETURNING *`,
      [clientId, template.id, JSON.stringify(audience), JSON.stringify({ offer: '10% off' })],
    );
    return c;
  }

  it('sends one personalised message per opted-in customer and skips the rest', async () => {
    await addContact('PRIYA sharma', '+919876543210');
    await addContact('Ravi', '+919123456789');
    await addContact('No Consent', '+919988776655', { optIn: false });
    await addContact('No Purchase', '+919988776600', { last_purchase: null });
    const c = await campaign();
    const result = await launchCampaign(clientId, c, template);
    await result.enqueued;
    await queue.onIdle();

    expect(result).toMatchObject({ queued: 2, skipped: 1 });
    expect(provider.sent.map((m) => m.to).sort()).toEqual(['+919123456789', '+919876543210']);
    expect(provider.sent.find((m) => m.to === '+919876543210').body).toBe('Hi Priya, enjoy 10% off on your next gold chain.');
    const { rows } = await query(`SELECT status, cost FROM messages WHERE campaign_id = $1`, [c.id]);
    expect(rows.every((r) => r.status === 'sent' && Number(r.cost) === 0.8631)).toBe(true);
    const { rows: [after] } = await query('SELECT status FROM campaigns WHERE id = $1', [c.id]);
    expect(after.status).toBe('completed');
  });

  it('never sends the same message twice, however often it is queued or launched', async () => {
    await addContact('Priya', '+919876543210');
    const c = await campaign();
    const first = await launchCampaign(clientId, c, template);
    await first.enqueued;
    const again = await launchCampaign(clientId, c, template); // e.g. a double-click
    await again.enqueued;
    const { rows: [m] } = await query('SELECT * FROM messages WHERE campaign_id = $1', [c.id]);
    await enqueueMessage(m); // same idempotency key: ignored by the queue
    await queue.onIdle();
    await processSendJob({ messageId: m.id }); // even a stray direct job finds nothing to do
    await requeuePending();
    await queue.onIdle();

    expect(again.queued).toBe(0);
    expect(provider.sent).toHaveLength(1);
  });

  it('retries a temporary failure and then succeeds', async () => {
    await addContact('Priya', '+919876543210');
    provider.failNext = [new ProviderError('Twilio is busy', { retryable: true, status: 503 })];
    const c = await campaign();
    await (await launchCampaign(clientId, c, template)).enqueued;
    await queue.onIdle();
    const { rows: [m] } = await query('SELECT status, attempts FROM messages WHERE campaign_id = $1', [c.id]);
    expect(m).toMatchObject({ status: 'sent', attempts: 2 });
    expect(provider.sent).toHaveLength(1);
  });

  it('marks a permanent failure with a plain reason and does not retry', async () => {
    await addContact('Priya', '+919876543210');
    provider.failNext = [new ProviderError('This number is not on WhatsApp.', { code: 63003 })];
    const c = await campaign();
    await (await launchCampaign(clientId, c, template)).enqueued;
    await queue.onIdle();
    const { rows: [m] } = await query('SELECT * FROM messages WHERE campaign_id = $1', [c.id]);
    expect(m).toMatchObject({ status: 'failed', attempts: 1, error_code: '63003', error_message: 'This number is not on WhatsApp.' });
  });

  it('gives up after the last attempt', async () => {
    await addContact('Priya', '+919876543210');
    const busy = () => new ProviderError('Twilio is busy', { retryable: true, status: 503 });
    provider.failNext = [busy(), busy(), busy()];
    const c = await campaign();
    await (await launchCampaign(clientId, c, template)).enqueued;
    await queue.onIdle();
    const { rows: [m] } = await query('SELECT status, attempts FROM messages WHERE campaign_id = $1', [c.id]);
    expect(m).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('does not send queued messages of a cancelled campaign', async () => {
    await addContact('Priya', '+919876543210');
    const c = await campaign();
    await query(`UPDATE campaigns SET scheduled_at = now() + interval '1 hour' WHERE id = $1`, [c.id]);
    const scheduled = { ...c, scheduled_at: new Date(Date.now() + 50) };
    await (await launchCampaign(clientId, scheduled, template)).enqueued;
    await query(`UPDATE campaigns SET status = 'cancelled' WHERE id = $1`, [c.id]);
    await queue.onIdle();
    expect(provider.sent).toHaveLength(0);
  });

  it('moves statuses forward only (sent -> delivered -> read)', async () => {
    await addContact('Priya', '+919876543210');
    const c = await campaign();
    await (await launchCampaign(clientId, c, template)).enqueued;
    await queue.onIdle();
    const id = provider.sent[0].id;
    await applyStatus({ providerMessageId: id, status: 'read' });
    await applyStatus({ providerMessageId: id, status: 'delivered' }); // arrives late
    const { rows: [m] } = await query('SELECT status, read_at, delivered_at FROM messages WHERE provider_message_id = $1', [id]);
    expect(m.status).toBe('read');
    expect(m.read_at).toBeTruthy();
    expect(m.delivered_at).toBeTruthy();
  });
});

function fakeProvider() {
  const p = {
    name: 'fake',
    label: 'Fake',
    sent: [],
    failNext: [],
    missingConfig: () => [],
    async send(msg) {
      if (p.failNext.length) throw p.failNext.shift();
      const id = `FAKE${p.sent.length + 1}`;
      p.sent.push({ id, ...msg });
      return { providerMessageId: id, status: 'sent' };
    },
    async sendText(msg) {
      return p.send(msg);
    },
    fetchStatus: null,
    verifyWebhook: () => true,
    parseWebhook: () => ({ statuses: [], inbound: [] }),
  };
  return p;
}
