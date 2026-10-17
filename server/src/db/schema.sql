-- Every business record carries client_id so the app can serve more than one client later.
CREATE TABLE IF NOT EXISTS clients (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  client_id     INT NOT NULL REFERENCES clients(id),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id              SERIAL PRIMARY KEY,
  client_id       INT NOT NULL REFERENCES clients(id),
  name            TEXT,
  phone           TEXT NOT NULL,           -- E.164, e.g. +919876543210
  city            TEXT,
  birthday        DATE,
  anniversary     DATE,
  last_purchase   TEXT,
  interests       TEXT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
  opt_in_at       TIMESTAMPTZ,
  opt_in_source   TEXT,                    -- e.g. "excel:customers.xlsx", "form", "paste"
  opted_out_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, phone)
);

CREATE TABLE IF NOT EXISTS templates (
  id           SERIAL PRIMARY KEY,
  client_id    INT NOT NULL REFERENCES clients(id),
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'marketing',
  language     TEXT NOT NULL DEFAULT 'en',
  body         TEXT NOT NULL,
  image_url    TEXT,
  buttons      JSONB NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft | approved | rejected
  provider_ref TEXT,                            -- Meta template name / Twilio content SID
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id               SERIAL PRIMARY KEY,
  client_id        INT NOT NULL REFERENCES clients(id),
  name             TEXT NOT NULL,
  template_id      INT NOT NULL REFERENCES templates(id),
  audience         JSONB NOT NULL DEFAULT '{}',
  variables        JSONB NOT NULL DEFAULT '{}',   -- campaign-wide values such as offer
  status           TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | sending | completed | cancelled
  scheduled_at     TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  cost_per_message NUMERIC(10,4) NOT NULL,
  provider         TEXT NOT NULL,
  created_by       INT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id                  BIGSERIAL PRIMARY KEY,
  client_id           INT NOT NULL REFERENCES clients(id),
  campaign_id         INT REFERENCES campaigns(id),
  contact_id          INT NOT NULL REFERENCES contacts(id),
  direction           TEXT NOT NULL DEFAULT 'outbound',  -- outbound | inbound
  channel             TEXT NOT NULL DEFAULT 'whatsapp',
  provider            TEXT,
  idempotency_key     TEXT UNIQUE,                       -- one key per intended send
  template_id         INT REFERENCES templates(id),
  template_values     JSONB,          -- placeholder values, for providers that send approved templates
  body                TEXT,           -- the exact text shown in the preview and sent
  buttons             JSONB,
  image_url           TEXT,
  status              TEXT NOT NULL,  -- queued|retrying|sending|sent|delivered|read|failed|cancelled|received
  attempts            INT NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  error_code          TEXT,
  error_message       TEXT,
  cost                NUMERIC(10,4),
  sent_by             INT REFERENCES users(id),
  seen_at             TIMESTAMPTZ,    -- inbound: when staff opened it
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS messages_provider_id_idx ON messages (provider_message_id);
CREATE INDEX IF NOT EXISTS messages_campaign_status_idx ON messages (campaign_id, status);
CREATE INDEX IF NOT EXISTS messages_contact_idx ON messages (contact_id, created_at);
CREATE INDEX IF NOT EXISTS contacts_client_idx ON contacts (client_id, created_at);
