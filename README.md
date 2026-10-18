# Swathi Tanishq: WhatsApp messaging

A web app for a jewellery franchise to send **personal, relevant WhatsApp offers** to its customers (up to 30,000 a month), track who received and read them, and answer replies in one shared inbox. SMS backup (MSG91) and automatic birthday/anniversary greetings come in later phases.

> **Phase 1: core sending**: staff login · customers from Excel, CSV, a form or pasted numbers · templates with placeholders and up to 2 buttons · 4-step campaign builder with live preview and cost · sending queue with retries and no double sends · delivered/read/failed report · shared inbox.

## Phases 2–5

| Phase | What it adds | Where in the app |
|---|---|---|
| **2 · Go live on Meta** | Submit a template to Meta for approval from the template page and check its status; Meta sends are blocked until approved. Needs `META_WABA_ID`. | Templates → WhatsApp approval |
| **3 · Occasions** | Birthday, anniversary and festival greetings sent every morning (India time) with no one touching the app; choose a week before, 3 days, the day before and/or on the day. Each greeting is keyed by occasion + customer + date, so it goes out once. `{{days_left}}` works in these messages. | Occasions |
| **4 · SMS backup** | If WhatsApp says a number is not on WhatsApp, customers with SMS consent get the SMS version of the template (DLT wording + DLT template ID). `SMS_MODE=preview` (default) records the exact SMS without sending until DLT registration is approved; `SMS_MODE=msg91` sends through MSG91. | Templates → SMS version; campaign step 3; Occasions |
| **5 · Sales-linked extras** | `{{offer_code}}` gives each customer a unique code (PRIYA-DIWALI-4821); staff enter it at billing with the bill amount, and reports show sales and return per campaign. Replies like “Interested” or a quick-reply tap open a **hot lead** to call. Weekly limit on marketing messages per customer. Import phone contacts (.vcf) and Google Sheets links. Roles: admin, manager, viewer; big sends by managers wait for an admin’s approval. | Offer codes · Hot leads · Settings · Add customers |

Settings for these phases (all in `server/.env`, see `.env.example`): `META_WABA_ID`, `SMS_MODE`, `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `SMS_COST_INR`, `OCCASION_CHECK_MINUTES`. The weekly limit (default 2) and approval size (default 500) are set by an admin under **Settings**.

## How it fits together

Everything runs on **Cloudflare's free plan**, so the site stays up with no laptop or server of our own:

```
Browser ──► Cloudflare Worker ──► pages and files (web/dist, React)
                │
                ├─► /api, /webhooks: the Express API (server/) running on Workers
                │        └─► Cloudflare D1 (SQLite): customers, templates, campaigns, messages, occasions…
                │
                └─► Cron, every minute: send due messages (outbox) · birthday / anniversary / festival check
                         └─► Provider ──► WhatsApp (Meta Cloud API; Twilio and test mode too) · SMS (MSG91)
Provider webhooks (delivered / read / failed, customer replies) ──► /webhooks ──► reports and inbox
```

- **One provider interface** (`server/src/providers/`). `MESSAGING_PROVIDER=mock | twilio | meta` is the only switch.
- **The messages table is the sending queue** (an outbox). A campaign launch is one `INSERT … SELECT`, so 30,000 customers take one statement; each message is personalised (name, purchase, offer code) when it is sent. The Cron sends 20 due messages a minute (about 28,000 a day), and a launch or reply starts sending at once.
- **Nothing is sent twice.** Every message has a unique key, and a message can only be claimed while it is queued or retrying, so overlapping runs, double-clicks and re-launches do nothing.
- **Retries.** Temporary errors (timeouts, 429, 5xx) wait 30 s, 1 min, 2 min… up to `SEND_MAX_ATTEMPTS`. Permanent errors fail at once with a plain-language reason.
- **Only consenting customers**, and **no blank personalisation**: a customer missing a value the message needs is skipped, never sent “Hi {{name}}”.
- **Fits the free plan** (Cloudflare limits, Oct 2026: 100,000 requests a day, 10 ms CPU per request, D1 5 GB with 100,000 row writes a day, 5 Cron triggers). Excel/CSV files are read in the browser and saved 500 rows per request; launches are one SQL statement; passwords use WebCrypto.

## Deploy to Cloudflare (one time)

```bash
npx wrangler login
```

```bash
npx wrangler d1 create swathi-tanishq
```

Put the printed `database_id` into `wrangler.jsonc`, then set the secrets (each command asks for the value): `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

```bash
npx wrangler secret put JWT_SECRET
```

Deploy with `npm run deploy` (the trial runs at https://swathi-tanishq.projectphenix2026.workers.dev). The tables are created on the first request, and the first admin login comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Non-secret settings (provider, business name, SMS mode, site address) are the `vars` in `wrangler.jsonc`; Meta, Twilio and MSG91 keys are added as secrets the same way when needed (`META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, …).

To try the Cloudflare version locally (Cloudflare's own runtime with a local D1), put `JWT_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.dev.vars` and run `npm run cf:dev`.

## Run it locally (Node)

Needs Node.js 22.5 or newer (it uses Node's built-in SQLite; tested on 24). Data is kept in `server/.data/swathi.db`.

```bash
npm install
cp server/.env.example server/.env
```

Edit `server/.env`: set `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (the first staff login is created on first start). Leave `MESSAGING_PROVIDER=mock` to try everything without sending anything.

```bash
npm run dev
```

Open http://localhost:5173 and sign in. The API runs on http://localhost:4000.

Optional fake data for a demo (test mode only; the numbers are made up):

```bash
npm run seed-demo -w server
```

More staff logins:

```bash
STAFF_PASSWORD='a-long-password' npm run create-user -w server -- staff@example.com "Staff Name"
```

## Send real WhatsApp messages with the Twilio sandbox

1. On the phone that should receive messages, open WhatsApp and send the sandbox join code (e.g. `join twilio-trial`) to the sandbox number (shown in Twilio Console › Messaging › Try it out › Send a WhatsApp message).
2. In `server/.env` set:
   ```
   MESSAGING_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=...        # Twilio Console › Account info
   TWILIO_AUTH_TOKEN=...
   TWILIO_WHATSAPP_FROM=+1...    # the sandbox number
   TWILIO_SANDBOX_JOIN_CODE=join ...
   ```
3. Restart `npm run dev`, add your own number as a customer (with opt-in), and send a campaign using **Customers I pick**.

Delivery statuses: without a public URL the API asks Twilio for status every `STATUS_POLL_SECONDS`, so the report still fills in. To receive **customer replies** (inbox) and instant statuses, expose the API and tell Twilio where it is:

```bash
npx cloudflared tunnel --url http://localhost:4000
```

Set `PUBLIC_BASE_URL` to the `https://…trycloudflare.com` address, restart, and in Twilio's sandbox settings set **When a message comes in** to `<PUBLIC_BASE_URL>/webhooks/twilio` (POST). Webhook signatures are checked (`VALIDATE_WEBHOOK_SIGNATURES=true`).

The sandbox shows buttons as links under the message; real WhatsApp buttons need approved templates (Meta, or Twilio Content API).

**Senders that only accept templates.** Some Twilio senders (including newer sandboxes) reject free text with error **21654 "ContentSid Required"**. Put the Twilio Content template SID (`HX…`) in the template's **Approved template ID** field (More options): the app then sends `ContentSid` with the placeholders as `{{1}}`, `{{2}}`… in the order they appear. Creating your own Content templates needs an upgraded (paid) Twilio account; trial accounts get error 20003 and can only send Twilio's sample templates.

## Switching to Meta's WhatsApp Cloud API later

1. Create the Meta app and WhatsApp Business account; note the phone number ID, a permanent access token and the app secret.
2. Submit each template to Meta for approval; put the approved template name in the template's **Meta template name** field (More options). Placeholders are sent to Meta in the order they appear.
3. In `.env`: `MESSAGING_PROVIDER=meta` and the `META_*` values. Point the Meta webhook to `<PUBLIC_BASE_URL>/webhooks/meta` with `META_WEBHOOK_VERIFY_TOKEN`.

No other code changes. Test with a small send first: this adapter has not yet run against a live Meta account.

## Tests

```bash
npm test
```

90 tests across `server/test/` (they run on Node's in-memory SQLite, the same SQL as D1):

| File | Covers |
|---|---|
| `phone.test.js` | +91 E.164 normalisation: spaces, dashes, 0 / 91 / 0091 prefixes, Excel numbers and scientific notation, landlines, too short / long |
| `importer.test.js` | CSV (BOM, quoted commas, no header), .xlsx and .xls, column guessing, Indian date formats, opt-in words, duplicates in file and already saved, pasted lists |
| `outbox.test.js` | one personalised message per customer, skips, no double send under overlapping runs and re-launches, retry back-off, permanent failures, last attempt, scheduled and cancelled sends, status order, a 5,000-customer launch in one statement |
| `providers.test.js` | Twilio request, Content templates, error mapping, signature check, webhook parsing; Meta template payload, signature check, webhook parsing |
| `api.test.js` | sign-in, import (existing-number check, 500-row chunks, consent), form, template validation, campaign preview and send, audience-changed guard, inbox, STOP opt-out, double-click reply |
| `phases.test.js` | Meta template submission format; birthday on the day (once only), anniversary N days before, send time, 29 Feb; SMS fallback and SMS consent; unique offer codes and one-time redemption with revenue; hot leads and tags; weekly limit; viewer permissions; admin approval of big sends; staff management; .vcf and Google Sheets import |

## Project layout

```
cloudflare/worker.js   Cloudflare entry: static pages + Express API on D1 + once-a-minute Cron
wrangler.jsonc         Cloudflare settings: D1 binding, Cron, vars
server/                Express API (also runs in Node for development and tests)
  src/config.js        all settings (environment variables, or Cloudflare vars and secrets)
  src/db/              schema.js and the D1 / Node SQLite connection
  src/lib/             phone, import-basics, importer (used by the browser), template, campaigns,
                       dispatch (outbox runner), sender, occasions, messages, offers, security
  src/providers/       twilio.js, meta.js, sms.js (MSG91), mock.js, index.js (the switch)
  src/routes/          auth, customers, templates, campaigns, occasions, inbox, leads, offers, dashboard, webhooks
  src/runtime.js       start-up and the once-a-minute job, shared by Node and Cloudflare
  test/
web/                   React app (Vite)
index.html             the original starter page
```

Keep secrets in Cloudflare secrets (or `server/.env` / `.dev.vars` locally, both git-ignored), never in the repo.
