// Who gets a campaign and launching it.
// Launch is one INSERT ... SELECT: the database creates one queued message per customer
// (with its unique key), so even 30,000 customers take one statement. Each message is
// personalised when it is sent (see sender.js).
import { query, ago, NOW } from '../db/index.js';
import { config } from '../config.js';
import { extractVariables } from './template.js';
import { kick } from './dispatch.js';
import { shopValues, SHOP_KEYS } from './shop.js';

/**
 * Builds the WHERE clause for an audience. Placeholders continue from `params`
 * (pass the array you are building; it is appended to).
 * audience = { mode: 'all' | 'filter' | 'selected', cities: [], tags: [], search: '', contactIds: [], excludeIds: [] }
 * excludeIds: customers unticked by hand in "Pick customers" (ignored when picking by hand).
 */
export function audienceWhere(clientId, audience = {}, params = []) {
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  // Deleted customers keep their row (for past reports) but never get messages.
  const where = [`c.client_id = ${p(clientId)}`, "c.phone NOT LIKE 'deleted:%'"];
  const mode = audience.mode || 'all';
  if (mode === 'selected') {
    where.push(`c.id IN (SELECT value FROM json_each(${p((audience.contactIds || []).map(Number))}))`);
  } else {
    // Staff test phones (see POST /api/campaigns/test) only get messages when picked by hand.
    where.push(`NOT EXISTS (SELECT 1 FROM json_each(c.tags) t WHERE t.value = '${TEST_PHONE_TAG}')`);
  }
  const excluded = (audience.excludeIds || []).map(Number).filter(Boolean);
  if (mode !== 'selected' && excluded.length) where.push(`c.id NOT IN (SELECT value FROM json_each(${p(excluded)}))`);
  if (mode === 'filter') {
    const cities = (audience.cities || []).map((s) => String(s).toLowerCase()).filter(Boolean);
    if (cities.length) where.push(`lower(c.city) IN (SELECT value FROM json_each(${p(cities)}))`);
    const tags = (audience.tags || []).filter(Boolean);
    if (tags.length) where.push(`EXISTS (SELECT 1 FROM json_each(c.tags) t WHERE t.value IN (SELECT value FROM json_each(${p(tags)})))`);
    if (audience.search) {
      const s = p(`%${audience.search}%`);
      where.push(`(c.interests LIKE ${s} OR c.last_purchase LIKE ${s})`);
    }
  }
  return { where: where.join(' AND '), params };
}

export const TEST_PHONE_TAG = 'test-phone';

export const ELIGIBLE ='c.whatsapp_opt_in = 1 AND c.opted_out_at IS NULL';
// Bulk SMS goes to customers who agreed to SMS.
export const SMS_ELIGIBLE = 'c.sms_opt_in = 1 AND c.opted_out_at IS NULL';
export const eligibleFor = (channel) => (channel === 'sms' ? SMS_ELIGIBLE : ELIGIBLE);
/** The text a channel sends: the SMS version for SMS, the WhatsApp message otherwise. */
export const bodyFor = (template, channel) => (channel === 'sms' ? template?.sms_body : template?.body) || '';

// Customer fields behind each placeholder; offer_code and days_left are filled in at send time.
const CUSTOMER_KEYS = { name: 'name', full_name: 'name', city: 'city', last_purchase: 'last_purchase', interests: 'interests' };
const GENERATED = new Set(['offer_code', 'days_left']);

// "Send a test to my phone" messages never count as offers a customer got.
const NOT_A_TEST = `NOT EXISTS (SELECT 1 FROM campaigns tc WHERE tc.id = mm.campaign_id AND tc.name LIKE 'Test · %')`;

/** SQL: how many WhatsApp offers customer `c` got in the last 7 days (what the weekly limit counts). */
export function offersThisWeekSql() {
  return `(SELECT count(*) FROM messages mm JOIN templates tt ON tt.id = mm.template_id
            WHERE mm.contact_id = c.id AND mm.channel = 'whatsapp' AND tt.category = 'marketing' AND ${NOT_A_TEST}
              AND mm.status IN ('queued', 'retrying', 'sending', 'sent', 'delivered', 'read')
              AND mm.created_at > ${ago('7 days')})`;
}

/** SQL: the name and time of the last offer customer `c` got, as "name|time". */
export function lastOfferSql() {
  return `(SELECT COALESCE(cc.name, tt.name) || '|' || mm.created_at FROM messages mm
             JOIN templates tt ON tt.id = mm.template_id LEFT JOIN campaigns cc ON cc.id = mm.campaign_id
            WHERE mm.contact_id = c.id AND mm.channel = 'whatsapp' AND tt.category = 'marketing' AND ${NOT_A_TEST}
              AND mm.status IN ('queued', 'retrying', 'sending', 'sent', 'delivered', 'read')
            ORDER BY mm.created_at DESC LIMIT 1)`;
}

/** SQL true when the customer already got `cap` marketing messages in the last 7 days. */
function atCapSql(cap) {
  return `${offersThisWeekSql()} >= ${Number(cap)}`;
}

export async function clientSettings(clientId) {
  const { rows: [s] } = await query('SELECT weekly_cap, approval_threshold FROM clients WHERE id = $1', [clientId]);
  return s || { weekly_cap: 2, approval_threshold: 500 };
}

/** The extra conditions a customer must meet to receive this template now. */
export async function sendConditions(clientId, template, variables, { ignoreCap = false, channel = 'whatsapp' } = {}) {
  const keys = extractVariables(bodyFor(template, channel));
  const conds = keys
    .map((k) => CUSTOMER_KEYS[k])
    .filter(Boolean)
    .map((col) => `c.${col} IS NOT NULL AND trim(c.${col}) <> ''`);
  // The shop's name, address and phone come from Settings, so only those details can be missing here.
  const shop = await shopValues(clientId);
  const blankOf = (k) => (SHOP_KEYS.has(k) ? !String(shop[k] || '').trim() : !String(variables?.[k] || '').trim());
  const campaignBlank = keys.some((k) => !CUSTOMER_KEYS[k] && !GENERATED.has(k) && blankOf(k));
  const { weekly_cap: cap } = await clientSettings(clientId);
  // The weekly limit protects the WhatsApp number; bulk SMS is not counted. Before a message is
  // picked (step 1 of Send an offer) it is counted as an offer, so the first number shown is already right.
  const marketing = template ? template.category === 'marketing' : true;
  const capped = !ignoreCap && channel !== 'sms' && marketing && cap > 0 ? atCapSql(cap) : null;
  return { keys, conds, campaignBlank, capped, blankOf };
}

/** Numbers for the builder: how many match, how many can be sent to, and why the rest cannot. */
export async function previewAudience(clientId, { audience, template, variables, channel = 'whatsapp', ignoreCap = false }) {
  const { where, params } = audienceWhere(clientId, audience);
  const ELIGIBLE = eligibleFor(channel);
  const consent = channel === 'sms' ? 'c.sms_opt_in' : 'c.whatsapp_opt_in';
  const { rows: [counts] } = await query(
    `SELECT count(*) AS matched,
            count(*) FILTER (WHERE ${ELIGIBLE}) AS eligible,
            count(*) FILTER (WHERE c.opted_out_at IS NOT NULL) AS opted_out,
            count(*) FILTER (WHERE ${consent} = 0 AND c.opted_out_at IS NULL) AS no_opt_in
       FROM contacts c WHERE ${where}`,
    params,
  );
  const { keys, conds, campaignBlank, capped, blankOf } = await sendConditions(clientId, template, variables, { channel, ignoreCap });
  // Which placeholders some customers have no value for (they are left out).
  const missing = {};
  const missingCols = [...new Set(keys.map((k) => CUSTOMER_KEYS[k]).filter(Boolean))];
  if (missingCols.length) {
    const { rows: [m] } = await query(
      `SELECT ${missingCols.map((col) => `count(*) FILTER (WHERE c.${col} IS NULL OR trim(c.${col}) = '') AS ${col}`).join(', ')}
         FROM contacts c WHERE ${where} AND ${ELIGIBLE}`,
      params,
    );
    for (const k of keys) if (CUSTOMER_KEYS[k] && m[CUSTOMER_KEYS[k]]) missing[k] = m[CUSTOMER_KEYS[k]];
  }
  for (const k of keys) if (!CUSTOMER_KEYS[k] && !GENERATED.has(k) && blankOf(k)) missing[k] = counts.eligible;

  let atCap = 0;
  let atCapPeople = [];
  if (capped) {
    const { rows: [m] } = await query(`SELECT count(*) AS n FROM contacts c WHERE ${where} AND ${ELIGIBLE} AND ${capped}`, params);
    atCap = m.n;
    // Name them, so staff see exactly who already got offers and when.
    const { rows } = await query(
      `SELECT c.id, c.name, c.phone, ${offersThisWeekSql()} AS offers, ${lastOfferSql()} AS last
         FROM contacts c WHERE ${where} AND ${ELIGIBLE} AND ${capped} ORDER BY c.name LIMIT 10`,
      params,
    );
    atCapPeople = rows.map(({ last, ...r }) => {
      const [lastOffer, lastAt] = String(last || '').split('|');
      return { ...r, lastOffer: lastOffer || null, lastAt: lastAt || null };
    });
  }
  let sendable = 0;
  if (!campaignBlank) {
    const all = [...conds, ...(capped ? [`NOT ${capped}`] : [])];
    const { rows: [s] } = await query(
      `SELECT count(*) AS n FROM contacts c WHERE ${where} AND ${ELIGIBLE}${all.length ? ' AND ' + all.join(' AND ') : ''}`,
      params,
    );
    sendable = s.n;
  }
  const { rows: sample } = await query(
    `SELECT c.id, c.name, c.phone, c.city, c.last_purchase, c.interests, c.sms_opt_in FROM contacts c
      WHERE ${where} AND ${ELIGIBLE} ORDER BY c.name IS NULL, c.name, c.id LIMIT 50`,
    params,
  );
  const { approval_threshold: threshold, weekly_cap: weeklyCap } = await clientSettings(clientId);
  const costPerMessage = channel === 'sms' ? config.sms.costPerSms : config.costPerMessage;
  return {
    ...counts,
    channel,
    missing,
    atCap,
    atCapPeople,
    sendable,
    approvalThreshold: threshold,
    weeklyCap,
    costPerMessage,
    estimatedCost: round2(sendable * costPerMessage),
    smsReady: Boolean(template?.sms_body),
    sample,
  };
}

/**
 * The customers behind "Pick customers": everyone the filters match (ticks ignored), with why a
 * customer cannot get this message (null when they can). Sendable customers come first.
 * reason: 'stop' | 'consent' | 'cap' | 'details'
 */
export async function audienceList(clientId, { audience = {}, template, variables, channel = 'whatsapp', q = '', limit = 50, offset = 0, ignoreCap = false }) {
  const base = { ...audience, mode: audience.mode === 'selected' ? 'all' : audience.mode, excludeIds: [] };
  const { where, params } = audienceWhere(clientId, base);
  const consent = channel === 'sms' ? 'c.sms_opt_in' : 'c.whatsapp_opt_in';
  const { conds, capped } = await sendConditions(clientId, template, variables, { channel, ignoreCap });
  const conditions = [where];
  if (q) {
    params.push(`%${q}%`);
    const digits = String(q).replace(/\D/g, '');
    let phoneCond = '';
    if (digits.length >= 3) {
      params.push(`%${digits}%`);
      phoneCond = ` OR c.phone LIKE $${params.length}`;
    }
    conditions.push(`(c.name LIKE $${params.length - (phoneCond ? 1 : 0)}${phoneCond})`);
  }
  const reason = `CASE WHEN c.opted_out_at IS NOT NULL THEN 'stop'
                       WHEN ${consent} = 0 THEN 'consent'
                       ${capped ? `WHEN ${capped} THEN 'cap'` : ''}
                       ${conds.length ? `WHEN NOT (${conds.join(' AND ')}) THEN 'details'` : ''}
                       ELSE NULL END`;
  const w = conditions.join(' AND ');
  const { rows } = await query(
    `SELECT * FROM (SELECT c.id, c.name, c.phone, c.city, c.interests, c.last_purchase, ${reason} AS reason,
                           ${offersThisWeekSql()} AS offers
                      FROM contacts c WHERE ${w}) x
      ORDER BY reason IS NOT NULL, name IS NULL, name, id LIMIT ${Math.min(Number(limit) || 50, 200)} OFFSET ${Math.max(Number(offset) || 0, 0)}`,
    params,
  );
  const { rows: [{ total }] } = await query(`SELECT count(*) AS total FROM contacts c WHERE ${w}`, params);
  return { customers: rows, total };
}

/**
 * Queues one message per eligible customer in a single statement.
 * keyPrefix + customer id is each message's unique key, so running it twice adds nothing.
 */
export async function queueMessages(clientId, { audience, template, variables, keyPrefix, keySuffix = '', campaignId = null, occasionId = null, dueAt = null, extraWhere = [], extraParams = [], ignoreCap = false, channel = 'whatsapp' }) {
  const params = [];
  const { where } = audienceWhere(clientId, audience, params);
  const ELIGIBLE = eligibleFor(channel);
  if (channel === 'sms' && !template?.sms_body) return 0;
  const { conds, campaignBlank, capped } = await sendConditions(clientId, template, variables, { ignoreCap, channel });
  if (campaignBlank) return 0;
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  // Extra conditions (e.g. birthday on a day) use their own placeholders, renumbered here.
  const extras = extraWhere.map((sql) => sql.replace(/\$X(\d+)/g, (_, i) => p(extraParams[Number(i) - 1])));
  const all = [...conds, ...(capped ? [`NOT ${capped}`] : []), ...extras];
  const sql = `INSERT OR IGNORE INTO messages
      (client_id, campaign_id, occasion_id, contact_id, channel, template_id, variables, idempotency_key, buttons, image_url, status, due_at)
    SELECT c.client_id, ${p(campaignId)}, ${p(occasionId)}, c.id, ${p(channel)}, ${p(template.id)}, ${p(variables || {})},
           ${p(keyPrefix)} || c.id || ${p(keySuffix)}, ${p(channel === 'sms' ? [] : template.buttons || [])}, ${p(channel === 'sms' || !template.image_url ? null : offerFile(variables?.image_url) || template.image_url)}, 'queued',
           COALESCE(${p(dueAt)}, ${NOW})
      FROM contacts c
     WHERE ${where} AND ${ELIGIBLE}${all.length ? ' AND ' + all.join(' AND ') : ''}`;
  const { rowCount } = await query(sql, params);
  return rowCount;
}

/** An offer's own photo/video link, if it is a web link (else the template's is used). */
export function offerFile(url) {
  return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/** Queues the campaign's messages; they go out when due (now, or the scheduled time). */
export async function launchCampaign(clientId, campaign, template) {
  const dueAt = campaign.scheduled_at ? new Date(campaign.scheduled_at).toISOString() : null;
  const queued = await queueMessages(clientId, {
    audience: campaign.audience,
    template,
    variables: campaign.variables,
    keyPrefix: `campaign:${campaign.id}:contact:`,
    campaignId: campaign.id,
    dueAt,
    channel: campaign.channel || 'whatsapp',
  });
  const later = dueAt && new Date(dueAt).getTime() > Date.now();
  if (!queued) {
    await query(`UPDATE campaigns SET status = 'completed', completed_at = ${NOW} WHERE id = $1`, [campaign.id]);
  } else if (!later) {
    await query(`UPDATE campaigns SET status = 'sending', started_at = ${NOW} WHERE id = $1`, [campaign.id]);
    kick();
  } else {
    await query(`UPDATE campaigns SET status = 'scheduled' WHERE id = $1`, [campaign.id]);
  }
  return { queued, skipped: Math.max(0, (campaign.expected_count ?? queued) - queued) };
}

/** Delivery report for one campaign. Counts are cumulative: "delivered" includes those read. */
export async function campaignReport(campaignId, channel = 'whatsapp') {
  // The main numbers follow the offer's channel; for bulk SMS a trial-mode SMS counts as sent.
  const ch = channel === 'sms' ? 'sms' : 'whatsapp';
  const sentStates = ch === 'sms' ? "('sent', 'delivered', 'read', 'preview')" : "('sent', 'delivered', 'read')";
  const { rows: [r] } = await query(
    `SELECT count(*) FILTER (WHERE channel = '${ch}') AS total,
            count(*) FILTER (WHERE channel = '${ch}' AND status IN ('queued', 'retrying', 'sending')) AS pending,
            count(*) FILTER (WHERE channel = '${ch}' AND status IN ${sentStates}) AS sent,
            count(*) FILTER (WHERE channel = '${ch}' AND status IN ('delivered', 'read')) AS delivered,
            count(*) FILTER (WHERE channel = '${ch}' AND status = 'read') AS read,
            count(*) FILTER (WHERE channel = '${ch}' AND status = 'failed') AS failed,
            count(*) FILTER (WHERE channel = '${ch}' AND status = 'cancelled') AS cancelled,
            count(*) FILTER (WHERE channel = 'sms') AS sms_total,
            count(*) FILTER (WHERE channel = 'sms' AND status = 'preview') AS sms_preview,
            count(*) FILTER (WHERE channel = 'sms' AND status IN ('sent', 'delivered', 'read')) AS sms_sent,
            COALESCE(sum(cost) FILTER (WHERE status IN ('sent', 'delivered', 'read')), 0) AS cost
       FROM messages WHERE campaign_id = $1`,
    [campaignId],
  );
  const { rows: reasons } = await query(
    `SELECT COALESCE(error_message, 'Unknown reason') AS reason, count(*) AS count
       FROM messages WHERE campaign_id = $1 AND status IN ('failed', 'cancelled') AND error_message IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC`,
    [campaignId],
  );
  const { rows: [replies] } = await query(
    `SELECT count(DISTINCT i.contact_id) AS n FROM messages i
       JOIN messages o ON o.contact_id = i.contact_id AND o.campaign_id = $1
      WHERE i.direction = 'inbound' AND i.created_at > o.sent_at`,
    [campaignId],
  );
  const { rows: [sales] } = await query(
    `SELECT count(*) AS redeemed, COALESCE(sum(r.amount), 0) AS revenue
       FROM redemptions r JOIN messages m ON m.id = r.message_id WHERE m.campaign_id = $1`,
    [campaignId],
  );
  const { rows: [leads] } = await query(`SELECT count(*) AS n FROM leads WHERE campaign_id = $1`, [campaignId]);
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
  return Math.round(Number(n || 0) * 100) / 100;
}
