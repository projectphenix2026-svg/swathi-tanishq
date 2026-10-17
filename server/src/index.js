import { config, assertConfig } from './config.js';
import { initDb, ensureClient, query } from './db/index.js';
import { createApp } from './app.js';
import { startQueue, stopQueue } from './queue/index.js';
import { processSendJob, requeuePending } from './lib/sender.js';
import { pollStatuses } from './lib/messages.js';
import { getProvider } from './providers/index.js';
import { createUser } from './routes/auth.js';

assertConfig();
const database = await initDb();
const clientId = await ensureClient(config.businessName);

// First run: create the admin login from ADMIN_EMAIL / ADMIN_PASSWORD.
const { rows: [{ n: users }] } = await query('SELECT count(*)::int AS n FROM users');
if (!users) {
  if (config.adminEmail && config.adminPassword) {
    await createUser({ clientId, email: config.adminEmail, password: config.adminPassword, name: config.adminName });
    console.log(`[setup] created staff login for ${config.adminEmail}`);
  } else {
    console.warn('[setup] no staff logins yet: set ADMIN_EMAIL and ADMIN_PASSWORD in server/.env, or run npm run create-user');
  }
}

const provider = getProvider();
const missing = provider.missingConfig();
console.log(`[provider] ${provider.label}${provider.stub ? ' (stub)' : ''}${missing.length ? ` - missing ${missing.join(', ')}` : ''}`);

await startQueue(processSendJob);
const requeued = await requeuePending();
if (requeued) console.log(`[queue] re-queued ${requeued} unsent message(s)`);

let poller = null;
if (provider.fetchStatus && config.statusPollSeconds > 0) {
  poller = setInterval(() => pollStatuses().catch((e) => console.warn('[status-poll]', e.message)), config.statusPollSeconds * 1000);
}

const server = createApp().listen(config.port, () => {
  console.log(`[api] ${database.kind} database, listening on http://localhost:${config.port}`);
});

async function shutdown() {
  clearInterval(poller);
  server.close();
  await stopQueue();
  await database.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
