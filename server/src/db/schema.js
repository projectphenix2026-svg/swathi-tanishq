// Database schema for SQLite: Cloudflare D1 in production, Node's built-in SQLite locally.
// Times are ISO-8601 text in UTC (2026-10-18T04:30:00.000Z); dates are YYYY-MM-DD text.
// JSON columns (buttons, audience, variables, template_values, tags, days_before) hold JSON text.
// Every business record carries client_id so the app can serve more than one client later.

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// The shop's own WhatsApp (Meta) account, added by the owner in Settings. The key and app secret
// are stored encrypted (lib/secretbox.js). live = 1 means real messages go out through it.
export const CONNECTION_TABLE = `
CREATE TABLE IF NOT EXISTS whatsapp_connection (
  client_id        INTEGER PRIMARY KEY REFERENCES clients(id),
  phone_number_id  TEXT NOT NULL,
  waba_id          TEXT NOT NULL,
  token_sealed     TEXT NOT NULL,
  app_secret_sealed TEXT,
  verify_token     TEXT NOT NULL,
  display_phone    TEXT,
  verified_name    TEXT,
  quality          TEXT,
  token_expires_at TEXT,
  token_hint       TEXT,
  live             INTEGER NOT NULL DEFAULT 0,
  checked_at       TEXT,
  updated_by       INTEGER REFERENCES users(id),
  updated_at       TEXT NOT NULL DEFAULT ${NOW}
);`;

// Offer photos (small JPEGs, base64), served publicly at /media/<id> for WhatsApp to fetch.
export const MEDIA_TABLE = `
CREATE TABLE IF NOT EXISTS media (
  id         TEXT PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id),
  mime       TEXT NOT NULL,
  data       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);`;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  weekly_cap         INTEGER NOT NULL DEFAULT 2,     -- marketing messages per customer per 7 days
  approval_threshold INTEGER NOT NULL DEFAULT 500,   -- sends this big need an admin's approval
  created_at         TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id),
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',          -- admin | manager | viewer
  created_at    TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS contacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL REFERENCES clients(id),
  name            TEXT,
  phone           TEXT NOT NULL,                        -- E.164, e.g. +919876543210
  city            TEXT,
  birthday        TEXT,                                 -- YYYY-MM-DD
  anniversary     TEXT,
  last_purchase   TEXT,
  interests       TEXT,
  tags            TEXT NOT NULL DEFAULT '[]',
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
  opt_in_at       TEXT,
  opt_in_source   TEXT,
  sms_opt_in      INTEGER NOT NULL DEFAULT 0,
  opted_out_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT ${NOW},
  updated_at      TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (client_id, phone)
);
CREATE INDEX IF NOT EXISTS contacts_client_idx ON contacts (client_id, created_at);
CREATE INDEX IF NOT EXISTS contacts_birthday_idx ON contacts (client_id, substr(birthday, 6, 5));
CREATE INDEX IF NOT EXISTS contacts_anniversary_idx ON contacts (client_id, substr(anniversary, 6, 5));

CREATE TABLE IF NOT EXISTS templates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id           INTEGER NOT NULL REFERENCES clients(id),
  name                TEXT NOT NULL,
  category            TEXT NOT NULL DEFAULT 'marketing',
  language            TEXT NOT NULL DEFAULT 'en',
  body                TEXT NOT NULL,
  image_url           TEXT,
  buttons             TEXT NOT NULL DEFAULT '[]',
  status              TEXT NOT NULL DEFAULT 'draft',    -- draft | approved | rejected
  provider_ref        TEXT,                             -- Meta template name / Twilio content SID
  provider_status     TEXT,                             -- PENDING | APPROVED | REJECTED (Meta)
  provider_reason     TEXT,
  sms_body            TEXT,
  sms_dlt_template_id TEXT,
  created_at          TEXT NOT NULL DEFAULT ${NOW},
  updated_at          TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS campaigns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id        INTEGER NOT NULL REFERENCES clients(id),
  name             TEXT NOT NULL,
  template_id      INTEGER NOT NULL REFERENCES templates(id),
  audience         TEXT NOT NULL DEFAULT '{}',
  variables        TEXT NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'scheduled',   -- pending_approval | scheduled | sending | completed | cancelled
  scheduled_at     TEXT,
  started_at       TEXT,
  completed_at     TEXT,
  cost_per_message REAL NOT NULL,
  provider         TEXT NOT NULL,
  sms_fallback     INTEGER NOT NULL DEFAULT 0,
  expected_count   INTEGER,
  created_by       INTEGER REFERENCES users(id),
  approved_by      INTEGER REFERENCES users(id),
  approved_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS occasions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,                          -- birthday | anniversary | festival
  festival_date TEXT,
  days_before   TEXT NOT NULL DEFAULT '[0]',
  send_hour     INTEGER NOT NULL DEFAULT 10,            -- India time
  template_id   INTEGER NOT NULL REFERENCES templates(id),
  variables     TEXT NOT NULL DEFAULT '{}',
  audience      TEXT NOT NULL DEFAULT '{"mode":"all"}',
  sms_fallback  INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT ${NOW},
  updated_at    TEXT NOT NULL DEFAULT ${NOW}
);

-- One row per intended send (and per customer reply). The table is also the sending queue:
-- a message is sent when it is due, and can only be claimed while queued or retrying.
CREATE TABLE IF NOT EXISTS messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id           INTEGER NOT NULL REFERENCES clients(id),
  campaign_id         INTEGER REFERENCES campaigns(id),
  occasion_id         INTEGER REFERENCES occasions(id),
  contact_id          INTEGER NOT NULL REFERENCES contacts(id),
  direction           TEXT NOT NULL DEFAULT 'outbound', -- outbound | inbound
  channel             TEXT NOT NULL DEFAULT 'whatsapp', -- whatsapp | sms
  provider            TEXT,
  idempotency_key     TEXT UNIQUE,
  template_id         INTEGER REFERENCES templates(id),
  template_values     TEXT,
  variables           TEXT,                             -- campaign/occasion values, filled in at send time
  body                TEXT,
  buttons             TEXT,
  image_url           TEXT,
  status              TEXT NOT NULL,                    -- queued|retrying|sending|sent|delivered|read|failed|cancelled|preview|received
  attempts            INTEGER NOT NULL DEFAULT 0,
  due_at              TEXT NOT NULL DEFAULT ${NOW},     -- when it may be sent (scheduled sends, retry back-off)
  provider_message_id TEXT,
  error_code          TEXT,
  error_message       TEXT,
  cost                REAL,
  offer_code          TEXT,
  fallback_of         INTEGER,
  sent_by             INTEGER REFERENCES users(id),
  seen_at             TEXT,
  created_at          TEXT NOT NULL DEFAULT ${NOW},
  sent_at             TEXT,
  delivered_at        TEXT,
  read_at             TEXT,
  failed_at           TEXT
);
CREATE INDEX IF NOT EXISTS messages_due_idx ON messages (status, due_at);
CREATE INDEX IF NOT EXISTS messages_provider_id_idx ON messages (provider_message_id);
CREATE INDEX IF NOT EXISTS messages_campaign_status_idx ON messages (campaign_id, status);
CREATE INDEX IF NOT EXISTS messages_contact_idx ON messages (contact_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS messages_offer_code_idx ON messages (client_id, offer_code) WHERE offer_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS redemptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  message_id  INTEGER NOT NULL REFERENCES messages(id),
  contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  code        TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  note        TEXT,
  redeemed_by INTEGER REFERENCES users(id),
  redeemed_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (client_id, code)
);

CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  message_id  INTEGER REFERENCES messages(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new',              -- new | called | won | lost
  note        TEXT,
  updated_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT ${NOW},
  updated_at  TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS leads_open_idx ON leads (client_id, status, created_at);
${CONNECTION_TABLE}
${MEDIA_TABLE}
`;

// Columns added after the first deploy; db/index.js adds any that an older database lacks.
export const EXTRA_COLUMNS = {
  // When a message was put back in the queue after Meta's per-person marketing limit (error 131049).
  messages: [['retried_at', 'TEXT']],
  // Meta's daily limit for this number: new customers it may message in 24 hours (-1 = no limit).
  whatsapp_connection: [['daily_limit', 'INTEGER'], ['limit_tier', 'TEXT'], ['limit_checked_at', 'TEXT']],
  // Last time the owner downloaded all the shop's data.
  clients: [['last_export_at', 'TEXT']],
  // How an offer is sent: 'whatsapp' (optionally with SMS backup) or 'sms' (bulk SMS).
  campaigns: [['channel', "TEXT NOT NULL DEFAULT 'whatsapp'"]],
};
