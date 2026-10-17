// Who gets a campaign, what each person receives, and launching it onto the queue.
import { query, db } from '../db/index.js';
import { config } from '../config.js';
import { extractVariables, render, valuesFor } from './template.js';
import { enqueueMessage } from './sender.js';
import { cleanPrefix, makeOfferCode, takenCodes } from './offers.js';

/**
 * audience = { mode: 'all' | 'filter' | 'selected', cities: [], tags: [], search: '', contactIds: [] }
 * Only customers who opted in to WhatsApp and have not opted out are ever included.
 */
export function audienceWhere(clientId, audience = {}) {
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

export const ELIGIBLE = 'c.whatsapp_opt_in = true AND c.opted_out_at IS NULL';

// Customer fields behind each placeholder; offer_code is generated, so never missing.
const CUSTOMER_KEYS = { name: 'name', full_name: 'name', city: 'city', last_purchase: 'last_purchase', interests: 'interests' };
const GENERATED = new Set(['offer_code']);

/** SQL true when the customer already got `cap` marketing messages in the last 7 days. */
function atCapSql(cap) {
  return `(SELECT count(*) FROM messages mm JOIN templates tt ON tt.id = mm.template_id
            WHERE mm.contact_id = c.id AND mm.channel = 'whatsapp' AND tt.category = 'marketing'
              AND mm.status IN ('queued', 'retrying', 'sending', 'sent', 'delivered', 'read')
              AND mm.created_at > now() - interval '7 days') >= ${Number(cap)}`;
}

export async function clientSettings(clientId) {
  const { rows: [s] } = await query('SELECT weekly_cap, approval_threshold FROM clients WHERE id = $1', [clientId]);
  return s || { weekly_cap: 2, approval_threshold: 500 };
}

/** The conditions a customer must meet to receive this template now. */
async function sendConditions(clientId, template, variables) {
  const keys = extractVariables(template?.body || '');
  const conds = keys
    .map((k) => CUSTOMER_KEYS[k])
    .filter(Boolean)
    .map((col) => `c.${col} IS NOT NULL AND btrim(c.${col}) <> ''`);
  const campaignBlank = keys.some((k) => !CUSTOMER_KEYS[k] && !GENERATED.has(k) && !String(variables?.[k] || '').trim());
  const { weekly_cap: cap } = await clientSettings(clientId);
  const capped = template?.category === 'marketing' && cap > 0 ? atCapSql(cap) : null;
  return { keys, conds, campaignBlank, capped };
}

/** Numbers for the builder: how many match, how many can be sent to, and why the rest cannot. */
export async function previewAudience(clientId, { audience, template, variables }) {
  const { where, params } = audienceWhere(clientId, audience);
  const { rows: [counts] } = await query(
    `SELECT count(*)::int AS matched,
            count(*) FILTER (WHERE ${ELIGIBLE})::int AS eligible,
            count(*) FILTER (WHERE c.opted_out_at IS NOT NULL)::int AS opted_out,
            count(*) FILTER (WHERE c.whatsapp_opt_in = false AND c.opted_out_at IS NULL)::int AS no_opt_in
       FROM contacts c WHERE ${where}`,
    params,
  );
  const { keys, conds, campaignBlank, capped } = await sendConditions(clientId, template, variables);
  // Which placeholders some customers have no value for (they are left out).
  const missing = {};
  for (const k of keys) {
    const col = CUSTOMER_KEYS[k];
    if (col) {
      const { rows: [m] } = await query(
        `SELECT count(*)::int AS n FROM contacts c WHERE ${where} AND ${ELIGIBLE} AND (c.${col} IS NULL OR btrim(c.${col}) = '')`,
        params,
      );
      if (m.n) missing[k] = m.n;
    } else if (!GENERATED.has(k) && !String(variables?.[k] || '').trim()) {
      missing[k] = counts.eligible; // a campaign value (offer, store...) that is still empty
    }
  }
  let atCap = 0;
  if (capped) {
    const { rows: [m] } = await query(`SELECT count(*)::int AS n FROM contacts c WHERE ${where} AND ${ELIGIBLE} AND ${capped}`, params);
    atCap = m.n;
  }
  let sendable = 0;
  if (!campaignBlank) {
    const all = [...conds, ...(capped ? [`NOT ${capped}`] : [])];
    const { rows: [s] } = await query(
      `SELECT count(*)::int AS n FROM contacts c WHERE ${where} AND ${ELIGIBLE}${all.length ? ' AND ' + all.join(' AND ') : ''}`,
      params,
    );
    sendable = s.n;
  }
  const { rows: sample } = await query(
    `SELECT c.id, c.name, c.phone, c.city, c.last_purchase, c.interests, c.sms_opt_in FROM contacts c
      WHERE ${where} AND ${ELIGIBLE} ORDER BY c.name NULLS LAST, c.id LIMIT 50`,
    params,
  );
  const { approval_threshold: threshold } = await clientSettings(clientId);
  return {
    ...counts,
    missing,
    atCap,
    sendable,
    approvalThreshold: threshold,
    costPerMessage: config.costPerMessage,
    estimatedCost: round2(sendable * config.costPerMessage),
    sample,
  };
}

/**
 * Builds the message rows for a list of customers: personal text, unique key, offer code.
 * Customers missing a placeholder value are skipped, never sent a broken message.
 * keyFor(contact) gives each message's idempotency key.
 */
export async function buildMessages(clientId, contacts, template, variables, { keyFor, codePrefix, campaignId = null, occasionId = null }) {
  const usesCode = extractVariables(template.body).includes('offer_code');
  const prefix = cleanPrefix(codePrefix);
  const taken = usesCode ? await takenCodes(clientId, prefix) : null;
  const rows = [];
  let skipped = 0;
  for (const contact of contacts) {
    const values = valuesFor(contact, variables);
    if (usesCode) values.offer_code = makeOfferCode(contact.name, prefix, taken);
    const { text, missing } = render(template.body, values);
    if (missing.length) {
      skipped += 1;
      continue;
    }
    rows.push({
      client_id: clientId,
      campaign_id: campaignId,
      occasion_id: occasionId,
      contact_id: contact.id,
      template_id: template.id,
      template_values: JSON.stringify(values),
      idempotency_key: keyFor(contact),
      body: text,
      buttons: JSON.stringify(template.buttons || []),
      image_url: template.image_url || null,
      offer_code: usesCode ? values.offer_code : null,
    });
  }
  return { rows, skipped };
}

const MSG_COLS = ['client_id', 'campaign_id', 'occasion_id', 'contact_id', 'template_id', 'template_values', 'idempotency_key', 'body', 'buttons', 'image_url', 'offer_code'];

/** Inserts queued messages in chunks; an existing key is left alone (no double send). */
export async function insertMessages(rows) {
  const inserted = [];
  await db().transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400);
      const vals = [];
      const p = [];
      chunk.forEach((m, j) => {
        const b = j * MSG_COLS.length;
        vals.push(`(${MSG_COLS.map((_, k) => `$${b + k + 1}`).join(', ')}, 'queued')`);
        p.push(...MSG_COLS.map((c) => m[c]));
      });
      const { rows: out } = await tx.query(
        `INSERT INTO messages (${MSG_COLS.join(', ')}, status) VALUES ${vals.join(', ')}
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, idempotency_key`,
        p,
      );
      inserted.push(...out);
    }
  });
  return inserted;
}

/** Creates one message per customer (with its unique key) and queues them. */
export async function launchCampaign(clientId, campaign, template) {
  const { where, params } = audienceWhere(clientId, campaign.audience);
  const { capped } = await sendConditions(clientId, template, campaign.variables);
  const { rows: contacts } = await query(
    `SELECT c.* FROM contacts c WHERE ${where} AND ${ELIGIBLE}${capped ? ` AND NOT ${capped}` : ''} ORDER BY c.id`,
    params,
  );
  const { rows, skipped } = await buildMessages(clientId, contacts, template, campaign.variables, {
    keyFor: (c) => `campaign:${campaign.id}:contact:${c.id}`,
    codePrefix: campaign.variables?.code_prefix,
    campaignId: campaign.id,
  });
  const inserted = await insertMessages(rows);

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
  } else {
    await query(`UPDATE campaigns SET status = 'scheduled' WHERE id = $1`, [campaign.id]);
  }
  return { queued: inserted.length, skipped, enqueued };
}

/** Delivery report for one campaign. Counts are cumulative: "delivered" includes those read. */
export async function campaignReport(campaignId) {
  const { rows: [r] } = await query(
    `SELECT count(*) FILTER (WHERE channel = 'whatsapp')::int AS total,
            count(*) FILTER (WHERE channel = 'whatsapp' AND status IN ('queued', 'retrying', 'sending'))::int AS pending,
            count(*) FILTER (WHERE channel = 'whatsapp' AND status IN ('sent', 'delivered', 'read'))::int AS sent,
            count(*) FILTER (WHERE channel = 'whatsapp' AND status IN ('delivered', 'read'))::int AS delivered,
            count(*) FILTER (WHERE channel = 'whatsapp' AND status = 'read')::int AS read,
            count(*) FILTER (WHERE channel = 'whatsapp' AND status = 'failed')::int AS failed,
            count(*) FILTER (WHERE channel = 'whatsapp' AND status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE channel = 'sms')::int AS sms_total,
            count(*) FILTER (WHERE channel = 'sms' AND status = 'preview')::int AS sms_preview,
            count(*) FILTER (WHERE channel = 'sms' AND status IN ('sent', 'delivered', 'read'))::int AS sms_sent,
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
  const { rows: [sales] } = await query(
    `SELECT count(*)::int AS redeemed, COALESCE(sum(r.amount), 0)::float AS revenue
       FROM redemptions r JOIN messages m ON m.id = r.message_id WHERE m.campaign_id = $1`,
    [campaignId],
  );
  const { rows: [leads] } = await query(`SELECT count(*)::int AS n FROM leads WHERE campaign_id = $1`, [campaignId]);
  return {
    ...r,
    cost: round2(r.cost),
    replied: replies.n,
    leads: leads.n,
    redeemed: sales.redeemed,
    revenue: round2(sales.revenue),
    failureReasons: reasons,
  };
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}
