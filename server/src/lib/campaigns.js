// Who gets a campaign, what each person receives, and launching it onto the queue.
import { query, db } from '../db/index.js';
import { config } from '../config.js';
import { extractVariables, render, valuesFor } from './template.js';
import { enqueueMessage } from './sender.js';

/**
 * audience = { mode: 'all' | 'filter' | 'selected', cities: [], tags: [], search: '', contactIds: [] }
 * Only customers who opted in to WhatsApp and have not opted out are ever included.
 */
function audienceWhere(clientId, audience = {}) {
  const params = [clientId];
  const where = ['c.client_id = $1'];
  const mode = audience.mode || 'all';
  if (mode === 'selected') {
    params.push((audience.contactIds || []).map(Number));
    where.push(`c.id = ANY($${params.length}::int[])`);
  } else if (mode === 'filter') {
    const cities = (audience.cities || []).map((s) => String(s).toLowerCase()).filter(Boolean);
    if (cities.length) {
      params.push(cities);
      where.push(`lower(c.city) = ANY($${params.length}::text[])`);
    }
    const tags = (audience.tags || []).filter(Boolean);
    if (tags.length) {
      params.push(tags);
      where.push(`c.tags && $${params.length}::text[]`);
    }
    if (audience.search) {
      params.push(`%${audience.search}%`);
      where.push(`(c.interests ILIKE $${params.length} OR c.last_purchase ILIKE $${params.length})`);
    }
  }
  return { where: where.join(' AND '), params };
}

const ELIGIBLE = 'c.whatsapp_opt_in = true AND c.opted_out_at IS NULL';

/** Numbers for the builder: how many match, how many can be sent to, and why the rest cannot. */
export async function previewAudience(clientId, { audience, templateBody, variables }) {
  const { where, params } = audienceWhere(clientId, audience);
  const { rows: [counts] } = await query(
    `SELECT count(*)::int AS matched,
            count(*) FILTER (WHERE ${ELIGIBLE})::int AS eligible,
            count(*) FILTER (WHERE c.opted_out_at IS NOT NULL)::int AS opted_out,
            count(*) FILTER (WHERE c.whatsapp_opt_in = false AND c.opted_out_at IS NULL)::int AS no_opt_in
       FROM contacts c WHERE ${where}`,
    params,
  );
  // Which placeholders some customers have no value for (they are left out).
  const keys = extractVariables(templateBody || '');
  const customerKeys = { name: 'name', full_name: 'name', city: 'city', last_purchase: 'last_purchase', interests: 'interests' };
  const missing = {};
  for (const k of keys) {
    const col = customerKeys[k];
    if (col) {
      const { rows: [m] } = await query(
        `SELECT count(*)::int AS n FROM contacts c
          WHERE ${where} AND ${ELIGIBLE} AND (c.${col} IS NULL OR btrim(c.${col}) = '')`,
        params,
      );
      if (m.n) missing[k] = m.n;
    } else if (!String(variables?.[k] || '').trim()) {
      missing[k] = counts.eligible; // a campaign value (offer, store...) that is still empty
    }
  }
  const conds = keys
    .map((k) => customerKeys[k])
    .filter(Boolean)
    .map((col) => `c.${col} IS NOT NULL AND btrim(c.${col}) <> ''`);
  const campaignBlank = keys.some((k) => !customerKeys[k] && !String(variables?.[k] || '').trim());
  let sendable = 0;
  if (!campaignBlank) {
    const { rows: [s] } = await query(
      `SELECT count(*)::int AS n FROM contacts c WHERE ${where} AND ${ELIGIBLE}${conds.length ? ' AND ' + conds.join(' AND ') : ''}`,
      params,
    );
    sendable = s.n;
  }
  const { rows: sample } = await query(
    `SELECT c.id, c.name, c.phone, c.city, c.last_purchase, c.interests FROM contacts c
      WHERE ${where} AND ${ELIGIBLE} ORDER BY c.name NULLS LAST, c.id LIMIT 50`,
    params,
  );
  return {
    ...counts,
    missing,
    sendable,
    costPerMessage: config.costPerMessage,
    estimatedCost: round2(sendable * config.costPerMessage),
    sample,
  };
}

/**
 * Creates one message row per customer (with its unique key) and queues them.
 * Customers missing a placeholder value are skipped, never sent a broken message.
 */
export async function launchCampaign(clientId, campaign, template) {
  const { where, params } = audienceWhere(clientId, campaign.audience);
  const { rows: contacts } = await query(
    `SELECT c.* FROM contacts c WHERE ${where} AND ${ELIGIBLE} ORDER BY c.id`,
    params,
  );
  const toInsert = [];
  let skipped = 0;
  for (const contact of contacts) {
    const values = valuesFor(contact, campaign.variables);
    const { text, missing } = render(template.body, values);
    if (missing.length) {
      skipped += 1;
      continue;
    }
    toInsert.push({
      contact_id: contact.id,
      key: `campaign:${campaign.id}:contact:${contact.id}`,
      body: text,
      values,
    });
  }

  const inserted = [];
  await db().transaction(async (tx) => {
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const vals = [];
      const p = [];
      chunk.forEach((m, j) => {
        const b = j * 9;
        vals.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, 'queued')`);
        p.push(
          clientId,
          campaign.id,
          m.contact_id,
          template.id,
          JSON.stringify(m.values),
          m.key,
          m.body,
          JSON.stringify(template.buttons || []),
          template.image_url || null,
        );
      });
      const { rows } = await tx.query(
        `INSERT INTO messages (client_id, campaign_id, contact_id, template_id, template_values,
                               idempotency_key, body, buttons, image_url, status)
         VALUES ${vals.join(', ')}
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, idempotency_key`,
        p,
      );
      inserted.push(...rows);
    }
  });

  const delay = campaign.scheduled_at ? new Date(campaign.scheduled_at).getTime() - Date.now() : 0;
  // Queue in the background so a 30,000-customer launch returns at once.
  // If the app stops half-way, requeuePending() picks up the rest on start-up.
  const enqueued = (async () => {
    for (const m of inserted) await enqueueMessage(m, delay);
  })().catch((err) => console.error('[campaign] enqueue failed', err));
  if (!inserted.length) {
    await query(`UPDATE campaigns SET status = 'completed', completed_at = now() WHERE id = $1`, [campaign.id]);
  } else if (delay <= 0) {
    await query(`UPDATE campaigns SET status = 'sending', started_at = now() WHERE id = $1`, [campaign.id]);
  }
  return { queued: inserted.length, skipped, enqueued };
}

/** Delivery report for one campaign. Counts are cumulative: "delivered" includes those read. */
export async function campaignReport(campaignId) {
  const { rows: [r] } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('queued', 'retrying', 'sending'))::int AS pending,
            count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read'))::int AS sent,
            count(*) FILTER (WHERE status IN ('delivered', 'read'))::int AS delivered,
            count(*) FILTER (WHERE status = 'read')::int AS read,
            count(*) FILTER (WHERE status = 'failed')::int AS failed,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            COALESCE(sum(cost) FILTER (WHERE status IN ('sent', 'delivered', 'read')), 0)::float AS cost
       FROM messages WHERE campaign_id = $1`,
    [campaignId],
  );
  const { rows: reasons } = await query(
    `SELECT COALESCE(error_message, 'Unknown reason') AS reason, count(*)::int AS count
       FROM messages WHERE campaign_id = $1 AND status = 'failed'
      GROUP BY 1 ORDER BY 2 DESC`,
    [campaignId],
  );
  const { rows: [replies] } = await query(
    `SELECT count(DISTINCT i.contact_id)::int AS n FROM messages i
       JOIN messages o ON o.contact_id = i.contact_id AND o.campaign_id = $1
      WHERE i.direction = 'inbound' AND i.created_at > o.sent_at`,
    [campaignId],
  );
  return { ...r, cost: round2(r.cost), replied: replies.n, failureReasons: reasons };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
