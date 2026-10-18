# Moving the app to another Cloudflare account

About 30–60 minutes. Customers, offers, bill codes, logins and the saved WhatsApp
connection all move with the database.

## 1. Export from the current account

```bash
npx wrangler login
```

```bash
npx wrangler d1 export swathi-tanishq --remote --output swathi-backup.sql
```

Also write down (from the old account's dashboard → Workers → swathi-tanishq → Settings →
Variables and secrets, or from your own records) the values of `JWT_SECRET`, `SETTINGS_KEY`
(if set), `ADMIN_EMAIL` and `ADMIN_PASSWORD`. **Keep `JWT_SECRET` / `SETTINGS_KEY` the same**:
the shop's WhatsApp key is stored encrypted with them. If they change, the owner only needs to
paste the WhatsApp key again in Settings → Connect WhatsApp.

## 2. Create the app in the new account

```bash
npx wrangler logout
```

```bash
npx wrangler login
```

```bash
npx wrangler d1 create swathi-tanishq
```

Put the printed `database_id` into `wrangler.jsonc`, then import the data:

```bash
npx wrangler d1 execute swathi-tanishq --remote --file swathi-backup.sql
```

Set the secrets again (each command asks for the value):

```bash
npx wrangler secret put JWT_SECRET
```

(and `SETTINGS_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` the same way.)

## 3. Deploy

Update `PUBLIC_BASE_URL` in `wrangler.jsonc` to the new address, then:

```bash
npm run deploy
```

```bash
npm run deploy:pages
```

The `swathi-tanishq.pages.dev` name belongs to the old account, so the new account gets a
different pages.dev name unless the old Pages project is deleted first. A custom domain
(e.g. `offers.yourshop.in`, added under the Pages project → Custom domains) avoids any
address change.

## 4. After moving

- In the shop's Meta app → WhatsApp → Configuration → Webhook, update the **Callback URL**
  to the new address (Settings → Connect WhatsApp shows it).
- Sign in and check Home, an offer report and Settings → Connect WhatsApp.
- Delete the old Worker, Pages project and database once everything works.
