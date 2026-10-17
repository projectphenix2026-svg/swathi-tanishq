// Adds (or resets) a staff login.
// Usage: npm run create-user -- staff@example.com "Staff Name"
// The password is read from the STAFF_PASSWORD environment variable, never from the command line history.
import { config } from '../config.js';
import { initDb, ensureClient, closeDb } from '../db/index.js';
import { createUser } from '../routes/auth.js';

const [email, name] = process.argv.slice(2);
const password = process.env.STAFF_PASSWORD;
if (!email || !password) {
  console.error('Usage: STAFF_PASSWORD=... npm run create-user -- email@example.com "Name"');
  process.exit(1);
}
await initDb();
const clientId = await ensureClient(config.businessName);
const user = await createUser({ clientId, email, name, password });
console.log(`Staff login ready for ${user.email}`);
await closeDb();
