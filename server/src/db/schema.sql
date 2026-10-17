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

-- ===================== Phases 2-5 (additive, safe on existing databases) =====================

-- Phase 2: Meta template approval status
ALTER TABLE templates ADD COLUMN IF NOT EXISTS provider_status TEXT;   -- PENDING | APPROVED | REJECTED (from Meta)
ALTER TABLE templates ADD COLUMN IF NOT EXISTS provider_reason TEXT;

-- Phase 4: SMS backup
ALTER TABLE contacts  ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS sms_body TEXT;          -- same placeholders, in the DLT-registered wording
ALTER TABLE templates ADD COLUMN IF NOT EXISTS sms_dlt_template_id TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sms_fallback BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages  ADD COLUMN IF NOT EXISTS fallback_of BIGINT;

-- Phase 3: occasions (birthdays, anniversaries, festivals)
CREATE TABLE IF NOT EXISTS occasions (
  id            SERIAL PRIMARY KEY,
  client_id     INT NOT NULL REFERENCES clients(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,                 -- birthday | anniversary | festival
  festival_date DATE,                          -- festivals only
  days_before   INT[] NOT NULL DEFAULT '{0}',  -- e.g. {7,0} = a week before and on the day
  send_hour     INT NOT NULL DEFAULT 10,       -- India time
  template_id   INT NOT NULL REFERENCES templates(id),
  variables     JSONB NOT NULL DEFAULT '{}',
  audience      JSONB NOT NULL DEFAULT '{"mode":"all"}',
  sms_fallback  BOOLEAN NOT NULL DEFAULT false,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS occasion_id INT REFERENCES occasions(id);

-- Phase 5: offer codes, redemptions, hot leads, limits, roles and approvals
ALTER TABLE messages  ADD COLUMN IF NOT EXISTS offer_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS messages_offer_code_idx ON messages (client_id, offer_code) WHERE offer_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS redemptions (
  id          SERIAL PRIMARY KEY,
  client_id   INT NOT NULL REFERENCES clients(id),
  message_id  BIGINT NOT NULL REFERENCES messages(id),
  contact_id  INT NOT NULL REFERENCES contacts(id),
  code        TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  note        TEXT,
  redeemed_by INT REFERENCES users(id),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, code)
);

CREATE TABLE IF NOT EXISTS leads (
  id          SERIAL PRIMARY KEY,
  client_id   INT NOT NULL REFERENCES clients(id),
  contact_id  INT NOT NULL REFERENCES contacts(id),
  message_id  BIGINT REFERENCES messages(id),    -- the customer's reply that created it
  campaign_id INT REFERENCES campaigns(id),
  reason      TEXT NOT NULL,                     -- e.g. "Interested", "Book a visit"
  status      TEXT NOT NULL DEFAULT 'new',       -- new | called | won | lost
  note        TEXT,
  updated_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_open_idx ON leads (client_id, status, created_at);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS weekly_cap INT NOT NULL DEFAULT 2;            -- marketing messages per customer per 7 days
ALTER TABLE clients ADD COLUMN IF NOT EXISTS approval_threshold INT NOT NULL DEFAULT 500;  -- sends this big need an admin's approval
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_by INT REFERENCES users(id);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS expected_count INT;
