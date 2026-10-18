// Local / Node entry point. (On Cloudflare, cloudflare/worker.js runs the same app.)
import { config, assertConfig } from './config.js';
import { initDb, ensureClient } from './db/index.js';
import { createApp } from './app.js';
import { setup, everyMinute } from './runtime.js';

assertConfig();
const database = await initDb();
const clientId = await ensureClient(config.businessName);
await setup(clientId);

// The outbox runner and the occasion check, like Cloudflare's once-a-minute Cron.
const timers = [];
if (config.dispatchSeconds > 0) {
  timers.push(setInterval(() => everyMinute({ occasions: false }).catch((e) => console.warn('[dispatch]', e.message)), config.dispatchSeconds * 1000));
}
timers.push(setInterval(() => everyMinute({ send: false }).catch((e) => console.warn('[tick]', e.message)), 60 * 1000));

const server = createApp().listen(config.port, () => {
  console.log(`[api] ${database.kind} database, listening on http://localhost:${config.port}`);
});

async function shutdown() {
  timers.forEach(clearInterval);
  server.close();
  await database.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
