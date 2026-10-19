// Adds (or resets) a login with one of the four roles: app_owner, owner, manager, staff.
// Usage: STAFF_PASSWORD=... npm run create-user -- email@example.com "Name" owner
// The password is read from the STAFF_PASSWORD environment variable, never from the command line history.
import { config } from '../config.js';
import { initDb, ensureClient, closeDb } from '../db/index.js';
import { createUser } from '../routes/auth.js';
import { ROLES } from '../lib/roles.js';

const [email, name, role = 'staff'] = process.argv.slice(2);
const password = process.env.STAFF_PASSWORD;
if (!email || !password) {
  console.error('Usage: STAFF_PASSWORD=... npm run create-user -- email@example.com "Name" [app_owner|owner|manager|staff]');
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`Role must be one of: ${ROLES.join(', ')}`);
  process.exit(1);
}
await initDb();
const clientId = await ensureClient(config.businessName);
const user = await createUser({ clientId, email, name, password, role });
console.log(`${role} login ready for ${user.email}`);
await closeDb();
