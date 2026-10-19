# Handover: Tanishq Warangal WhatsApp app

## What is delivered
- The app (website + API + database + the every-minute sender) running on the client's own Cloudflare free plan.
- Four logins (below), the shop's own details entered in the app, and test mode on (`MESSAGING_PROVIDER=mock`): nothing reaches real customers until WhatsApp is connected and the owner switches on.
- Birthday and anniversary wishes start **off**, with the offer wording blank, until the store owner fills it in.

## The four roles
| Role | Who | Can | Cannot |
|---|---|---|---|
| App owner | builds and supports the app | everything | (cannot be created inside the app) |
| Store owner | the shop's owner | connect WhatsApp, shop details, limits, approve big sends, manage manager/staff logins, download data | |
| Store manager | runs the day | send messages, templates, special days, import/delete customers | settings, WhatsApp keys, logins; big sends wait for the owner |
| Staff | the counter | add/edit customers, answer replies, record sales codes, reports | send messages |

Logins are listed in the private file `handover/Tanishq-Warangal-LOGINS.txt` (never committed). Replace the placeholder emails with real ones in Settings > Logins and roles, hand the store owner their password in person, and ask them to change it under My account.

## Shop details
Name, address, phone and Google review link: Settings > Shop details. Nothing about the shop is fixed in the code; messages use the current values at send time. `BUSINESS_NAME` in `wrangler.jsonc` is only the starting name.

## Go-live checklist
1. Store owner connects WhatsApp (Settings > WhatsApp; see the owner guide). Four values: access token, phone number ID, WhatsApp Business account ID, app secret.
2. Switch `MESSAGING_PROVIDER` to `meta` and redeploy; set `PUBLIC_BASE_URL` and the webhook in Meta.
3. Submit templates for Meta approval (Templates > WhatsApp approval).
4. Send to the owner's own number first, then a small group, then everyone.
5. Fill in the offer wording and switch on birthday/anniversary wishes when ready.

## Secrets and backups
- Secrets (`JWT_SECRET`, `SETTINGS_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, provider keys) are Cloudflare secrets, never in git. Keep `JWT_SECRET` and `SETTINGS_KEY` unchanged when moving accounts (`docs/MOVE-CLOUDFLARE-ACCOUNT.md`).
- Back up D1 with `wrangler d1 export` before any big change. Store owners can also download their customers and messages (Settings > Your data).

## Costs
Cloudflare free plan covers the app. WhatsApp charges per marketing message (about 0.86 rupees plus GST in India, Oct 2026); SMS backup costs extra once registered.

## Where things live
`server/` Express API, `web/` React site, `pages/` front door, `docs/` security and account move notes, `wrangler.jsonc` non-secret settings.
