# Swathi Tanishq: WhatsApp messaging

A web app for a jewellery franchise to send **personal, relevant WhatsApp offers** to its customers (up to 30,000 a month), track who received and read them, and answer replies in one shared inbox. SMS backup (MSG91) and automatic birthday/anniversary greetings come in later phases.

> **Phase 1: core sending** (this version): staff login · customers from Excel, CSV, a form or pasted numbers · templates with placeholders and up to 2 buttons · 4-step campaign builder with live preview and cost · sending queue with retries and no double sends · delivered/read/failed report · shared inbox.

## How it fits together

```
React web app (web/)  ──►  Express API (server/)  ──►  PostgreSQL (customers, templates, campaigns, messages)
                                   │
                                   └─►  Sending queue (BullMQ on Redis) ──►  Provider ──►  WhatsApp
                                                                            (Twilio now, Meta Cloud API later)
Provider webhooks (delivered / read / failed, customer replies)  ──►  API  ──►  reports and inbox
```

- **One provider interface** (`server/src/providers/`). `MESSAGING_PROVIDER=mock | twilio | meta` in `.env` is the only switch. Twilio works today (sandbox included); the Meta Cloud API adapter is written to Meta's documentation but is a **stub until the Meta app exists**.
- **Nothing is sent twice.** Every message row has a unique key (`campaign:<id>:contact:<id>`) and the worker can only claim a message that is still queued. Repeated jobs, double-clicks, restarts and re-launches find nothing to do.
- **Retries.** Temporary errors (timeouts, 429, 5xx) are retried with exponential back-off, up to `SEND_MAX_ATTEMPTS`. Permanent errors (number not on WhatsApp, not opted in to the sandbox...) fail at once with a plain-language reason.
- **Only consenting customers.** Campaigns go only to customers with WhatsApp opt-in who have not replied STOP. Opt-in date and source are stored per customer.
- **No blank personalisation.** A customer missing a value the message needs (e.g. no last purchase) is skipped, never sent “Hi {{name}}”.
- **Runs anywhere.** With no `DATABASE_URL` it uses embedded Postgres (PGlite); with no `REDIS_URL` it uses an in-process queue. Production should set both.

## Run it locally

Needs Node.js 20 or newer (tested on 24).

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

## Switching to Meta's WhatsApp Cloud API later

1. Create the Meta app and WhatsApp Business account; note the phone number ID, a permanent access token and the app secret.
2. Submit each template to Meta for approval; put the approved template name in the template's **Meta template name** field (More options). Placeholders are sent to Meta in the order they appear.
3. In `.env`: `MESSAGING_PROVIDER=meta` and the `META_*` values. Point the Meta webhook to `<PUBLIC_BASE_URL>/webhooks/meta` with `META_WEBHOOK_VERIFY_TOKEN`.

No other code changes. Test with a small send first: this adapter has not yet run against a live Meta account.

## Tests

```bash
npm test
```

74 tests across `server/test/`:

| File | Covers |
|---|---|
| `phone.test.js` | +91 E.164 normalisation: spaces, dashes, 0 / 91 / 0091 prefixes, Excel numbers and scientific notation, landlines, too short / long |
| `importer.test.js` | CSV (BOM, quoted commas, no header), .xlsx and .xls, column guessing, Indian date formats, opt-in words, duplicates in file and already saved, pasted lists |
| `queue.test.js` | queue de-duplication, back-off retries, rate limit, scheduled jobs; the full send pipeline: personalisation, skips, no double sends, temporary vs permanent failures, cancelled campaigns, status order |
| `providers.test.js` | Twilio request, error mapping, signature check, webhook parsing; Meta template payload, signature check, webhook parsing |
| `api.test.js` | sign-in, import preview/commit, form, template validation, campaign preview and send, audience-changed guard, inbox, STOP opt-out, double-click reply |

## Project layout

```
server/            Express API
  src/config.js    all settings (from environment variables)
  src/db/          schema.sql and the Postgres / PGlite connection
  src/lib/         phone, importer, template, campaigns, sender (queue worker), messages (statuses, inbox)
  src/providers/   twilio.js, meta.js (stub), mock.js, index.js (the switch)
  src/queue/       BullMQ or in-process queue
  src/routes/      auth, customers, templates, campaigns, inbox, dashboard, webhooks
  test/
web/               React app (Vite)
  src/pages/       Login, Dashboard, Customers, AddCustomers, Templates, TemplateEditor,
                   Campaigns, CampaignBuilder, CampaignReport, Inbox
index.html         the original starter page
```

## Deploying (outline)

- **Web:** Cloudflare Pages with root directory `web`, build command `npm run build`, output `dist`, and `VITE_API_URL` set to the API's address. (Today the Pages project serves the starter `index.html` from the repo root; change its build settings when moving to the app.)
- **API:** Render, Railway or a small VM with `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN` = the Pages address, `PUBLIC_BASE_URL` = the API address. Cookies are `Secure; SameSite=None` in production, so both must be on HTTPS.
- Keep secrets in the host's secret settings, never in the repo.
