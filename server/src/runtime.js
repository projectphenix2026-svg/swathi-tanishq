// Shared start-up and the once-a-minute job, used by Node (index.js) and Cloudflare (worker.js).
import { config } from './config.js';
import { query } from './db/index.js';
import { createUser } from './routes/auth.js';
import { getProvider, getSmsProvider } from './providers/index.js';
import { processDue } from './lib/dispatch.js';
import { releaseStuck } from './lib/sender.js';
import { pollStatuses } from './lib/messages.js';
import { runAllOccasions } from './lib/occasions.js';
import { refreshProvider, refreshDailyLimit } from './lib/whatsapp-connection.js';

let setupDone = false;

/** First run: create the admin login from ADMIN_EMAIL / ADMIN_PASSWORD; log the channels. */
export async function setup(clientId) {
  if (setupDone) return;
  setupDone = true;
  const { rows: [{ n: users }] } = await query('SELECT count(*) AS n FROM users');
  if (!users) {
    if (config.adminEmail && config.adminPassword) {
      await createUser({ clientId, email: config.adminEmail, password: config.adminPassword, name: config.adminName });
      console.log(`[setup] created staff login for ${config.adminEmail}`);
    } else {
      console.warn('[setup] no staff logins yet: set ADMIN_EMAIL and ADMIN_PASSWORD, or run npm run create-user');
    }
  }
  const provider = getProvider();
  const missing = provider.missingConfig();
  console.log(`[provider] ${provider.label}${provider.stub ? ' (stub)' : ''}${missing.length ? ` - missing ${missing.join(', ')}` : ''}`);
  console.log(`[sms] ${getSmsProvider().label}`);
}

let minute = 0;

/**
 * Runs every minute: send due messages, every 15 minutes check occasions,
 * and (Twilio without webhooks) ask for delivery statuses.
 */
export async function everyMinute({ send = true, occasions = true } = {}) {
  minute += 1;
  await refreshProvider().catch((err) => console.warn('[whatsapp] could not read the connection:', err.message));
  if (minute % 30 === 1) await refreshDailyLimit().catch(() => {});
  if (send) {
    await processDue();
    if (minute % 10 === 0) await releaseStuck();
  }
  if (occasions && config.occasionCheckMinutes > 0 && minute % config.occasionCheckMinutes === 0) {
    await runAllOccasions();
  }
  // Test mode has no webhooks, so its made-up delivered/read statuses are always fetched.
  const provider = getProvider();
  const noWebhooks = provider.name === 'mock' || (!config.publicBaseUrl && config.statusPollSeconds > 0);
  if (occasions && noWebhooks && provider.fetchStatus) {
    await pollStatuses();
  }
}
