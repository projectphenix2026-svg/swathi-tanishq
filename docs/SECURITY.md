# Security review: Swathi Tanishq WhatsApp app

Review date: 18 October 2026. Scope: the website, the API (Cloudflare Worker), the database (Cloudflare D1), the WhatsApp (Meta) connection, the deployment and the code repository.

## Summary

Customer data is kept to the shop's own login, sign-in is protected against guessing, every database query is parameterised, and the WhatsApp key is stored encrypted. This review found and fixed six issues (below). Five items need an action from the owner or from us at go-live; they are listed under "Still to do".

## What was checked, and the result

| Threat | How the app is protected | Result |
|---|---|---|
| Someone reading another shop's data | Every query is limited to the signed-in person's shop (`client_id`). All lookups by id were checked. | OK |
| Guessing passwords | After 10 wrong passwords for one email, or 30 from one address, in 15 minutes, sign-in waits. The count is kept in the database, so all server copies share it. | **Fixed** (it was counted per server copy) |
| Finding out which emails have a login | Wrong email and wrong password get the same answer and take the same time. | **Fixed** |
| Stolen or old sessions | Sessions are in an HttpOnly, Secure, SameSite cookie that lasts 12 hours. A password change, role change or removed login now ends that person's other sessions at once. | **Fixed** |
| An ex-employee keeping access | The owner can remove a staff login in Settings → Staff. The person is signed out at once, and past reports still show their name. | **Fixed** (there was no way to remove a login) |
| The owner keeping the handover password | Everyone can change their own password in Settings → My account. The current password is needed. | **Fixed** |
| Database injection (SQL) | Every value goes in as a parameter. The dynamic parts (sort order, limits, filters) come from fixed lists or are converted to numbers. | OK |
| Scripts injected into pages (XSS) | React escapes all text. No raw HTML is used. Customer messages and replies are shown as text. A Content-Security-Policy now allows only the app's own scripts. | **Fixed** (the website had no policy; the API did) |
| The app shown inside another site (clickjacking) | `frame-ancestors 'none'` and `X-Frame-Options: DENY` on the website. | **Fixed** |
| Requests forged from another site (CSRF) | SameSite cookie, JSON-only API, and CORS limited to the app's own address. | OK |
| Fake WhatsApp replies, ticks or STOP messages | Meta's signature (HMAC-SHA256 with the App secret) is checked on every webhook. Unsigned calls are refused. | OK (`VALIDATE_WEBHOOK_SIGNATURES` is on in production) |
| WhatsApp key leaking | The key is stored encrypted (AES-GCM) and never sent back to the browser. Only the owner can see or change the connection. | OK, but see "Still to do" 2 |
| Secrets in the code | The `.env`, `.dev.vars` and login notes are git-ignored. The git history was searched for keys and passwords, and none were found. Live secrets are Cloudflare secrets. | OK |
| Exports | Only the owner can download the data. | OK |
| Uploaded photos | Only JPG, PNG and WebP up to 600 KB. Each is served from a 32-character random link (WhatsApp needs a public link to fetch it). | OK: don't upload anything private as a photo |
| Error messages leaking details | Server errors show a plain "Something went wrong"; details stay in the server log. | OK |
| Known flaws in libraries | `npm audit`: React Router had a moderate open-redirect issue. It has been upgraded to 7.18.4, and there are now 0 known vulnerabilities. | **Fixed** |
| HTTPS | HSTS on both the website and the API. | OK |
| Losing data | Cloudflare D1 can restore to any minute of the last 7 days. The owner can also download everything to Excel in Settings → Your data. | OK |
| Personal data law (India, DPDP Act 2023) | Consent is recorded per customer with where and when they agreed. STOP is honoured automatically. Deleting a customer removes their details. Access is limited by role. | OK; see "Still to do" 5 |

## Fixed in this review

1. Sign-in lockout is shared across all server copies, per email and per address.
2. Sign-in gives no hint about which emails exist.
3. A password change, role change or removal signs that person out everywhere.
4. The owner can remove a staff login.
5. Everyone can change their own password.
6. The website sends browser protections: CSP, frame blocking, HSTS, nosniff, referrer and permissions policies.
7. React Router was upgraded to fix a known open-redirect issue.

All of these have automated tests in `server/test/security.test.js`. There are 128 server tests in total, and they pass.

## Still to do (actions)

1. **Owner: change the handover password** (Settings → My account) after the first sign-in.
2. **Us, at go-live: a separate `SETTINGS_KEY` secret.** The WhatsApp key is currently encrypted with a key made from `JWT_SECRET`, so changing `JWT_SECRET` would make the saved WhatsApp key unreadable. The fix is to set `SETTINGS_KEY` before the shop's real key is entered. If it is set later, the key must be pasted again.
3. **Two-step sign-in for the owner (recommended).** Cloudflare Access (free for up to 50 people) can ask for a code sent to email before anyone reaches the app.
4. **Cloudflare and GitHub accounts.** Turn on two-step login for both. Also disconnect the second Cloudflare account that is linked to the repository (it builds every push and sends emails): sign in to that Cloudflare account, go to Workers & Pages → swathi-tanishq → Settings → Build, and click Disconnect.
5. **Privacy notice.** Show a short line at the counter or on the bill, for example "We send offers and wishes on WhatsApp; reply STOP any time". This also documents consent.

## Accepted limits

- **Password hashing** uses PBKDF2-SHA256 with 20,000 rounds, which fits Cloudflare's free plan time limit per request. The sign-in lockout makes guessing slow anyway. On the paid Workers plan (about $5 a month) this can be raised to 100,000 rounds or more.
- **"Send a test to my phone"** lets staff send a template to any number. This is intended for testing; each test is recorded under Sent messages.
- **The `workers.dev` address** serves the same app as `pages.dev`. Both have the same protections.
