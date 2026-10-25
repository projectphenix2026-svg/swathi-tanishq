// Cloudflare Worker: the whole app on Cloudflare's free plan.
// - Pages and files come from web/dist (static assets).
// - /api, /webhooks and /health run the same Express app as locally, on the D1 database.
// - A Cron trigger every minute sends due messages and checks birthdays/anniversaries.
import { env } from 'cloudflare:workers';
import * as workers from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import express from 'express';
import { config, assertConfig } from '../server/src/config.js';
import { initDb, ensureClient } from '../server/src/db/index.js';
import { createApp } from '../server/src/app.js';
import { setup, everyMinute } from '../server/src/runtime.js';
import { setBackground } from '../server/src/lib/dispatch.js';
import { setBlobStore } from '../server/src/lib/blobs.js';

// Database work cannot run at start-up on Workers, so it happens on the first request or cron.
let ready = null;
function ensureReady() {
  if (!ready) {
    ready = (async () => {
      assertConfig();
      await initDb({ d1: env.DB });
      const clientId = await ensureClient(config.businessName);
      await setup(clientId);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

// Videos (too big for D1) live in the MEDIA KV namespace; a value can be up to 25 MB.
if (env.MEDIA) {
  setBlobStore({
    name: 'kv',
    put: (key, bytes, mime) => env.MEDIA.put(key, bytes, { metadata: { mime } }),
    async get(key) {
      const { value, metadata } = await env.MEDIA.getWithMetadata(key, 'arrayBuffer');
      return value ? { bytes: new Uint8Array(value), mime: metadata?.mime } : null;
    },
  });
}

// Background sends after a launch or reply finish after the response is returned.
if (typeof workers.waitUntil === 'function') setBackground((p) => workers.waitUntil(p.catch((e) => console.error(e))));

const app = express();
app.use((req, res, next) => ensureReady().then(() => next(), next));
app.use(createApp());
app.listen(3000);
const http = httpServerHandler({ port: 3000 });

export default {
  fetch: (request, bindings, ctx) => http.fetch(request, bindings, ctx),
  async scheduled(event, bindings, ctx) {
    ctx.waitUntil(ensureReady().then(() => everyMinute()));
  },
};
