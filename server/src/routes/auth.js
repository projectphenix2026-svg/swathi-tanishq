import express from 'express';
import { config } from '../config.js';
import { query, ago } from '../db/index.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../lib/security.js';
import { ROLES, atLeast, canManageRole, assignableRoles, roleLabel } from '../lib/roles.js';

const COOKIE = 'st_session';
const router = express.Router();

// Failed sign-ins are counted in the database (shared by every server copy): after 10 wrong
// passwords for one email, or 30 from one address, in 15 minutes, sign-in waits.
const ipOf = (req) => req.get('cf-connecting-ip') || req.ip || 'unknown';
async function loginLimiter(req, res, next) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const { rows: [n] } = await query(
    `SELECT count(*) FILTER (WHERE email = $1) AS by_email, count(*) FILTER (WHERE ip = $2) AS by_ip
       FROM login_attempts WHERE created_at > ${ago('15 minutes')} AND (email = $1 OR ip = $2)`,
    [email, ipOf(req)],
  );
  if (n.by_email >= 10 || n.by_ip >= 30) {
    return res.status(429).json({ error: 'Too many wrong passwords. Please wait 15 minutes and try again.' });
  }
  next();
}
// A hash to compare against when the email has no login, so both answers take the same time.
let dummyHash = null;

// The website and API share one address (Cloudflare passes /api to the API), so the
// session cookie is first-party: SameSite=Lax, and Secure whenever the site is on HTTPS.
function cookieOptions(req) {
  const https = req.secure || req.get('x-forwarded-proto') === 'https' || config.nodeEnv === 'production';
  return { httpOnly: true, sameSite: 'lax', secure: https, maxAge: 12 * 3600 * 1000, path: '/' };
}

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const { rows: [found] } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = found && !found.disabled_at ? found : null;
  dummyHash ??= await hashPassword('not-a-real-password');
  const ok = await verifyPassword(password, user ? user.password_hash : dummyHash);
  if (!user || !ok) {
    await query('INSERT INTO login_attempts (ip, email) VALUES ($1, $2)', [ipOf(req), email]);
    await query(`DELETE FROM login_attempts WHERE created_at < ${ago('1 day')}`);
    return res.status(401).json({ error: 'That email and password do not match.' });
  }
  await query('DELETE FROM login_attempts WHERE email = $1', [email]);
  const token = await signToken({ sub: user.id, cid: user.client_id, sv: user.session_version || 0 }, config.jwtSecret, 12 * 3600);
  res.cookie(COOKIE, token, cookieOptions(req));
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined });
  res.json({ ok: true });
});

router.get('/shop-name', async (req, res) => {
  const { rows: [c] } = await query('SELECT name FROM clients ORDER BY id LIMIT 1');
  res.json({ name: c?.name || '' });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// Each person chooses their own app language; it is saved with their login.
const LANGUAGES = ['en', 'te', 'hi'];
router.patch('/me', requireAuth, async (req, res) => {
  const language = req.body?.language;
  if (!LANGUAGES.includes(language)) return res.status(400).json({ error: 'Choose English, Telugu or Hindi.' });
  await query('UPDATE users SET language = $2 WHERE id = $1', [req.user.id, language]);
  res.json({ user: publicUser({ ...req.user, language }) });
});

// Change your own password: the current one is needed. Other sessions are signed out; this one
// gets a fresh cookie.
router.post('/me/password', requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (!(await verifyPassword(current, req.user.password_hash))) return res.status(400).json({ error: 'Your current password is not right.' });
  if (next.length < 8) return res.status(400).json({ error: 'Use a new password of at least 8 characters.' });
  if (next === current) return res.status(400).json({ error: 'Choose a different password from the current one.' });
  const { rows: [u] } = await query(
    'UPDATE users SET password_hash = $2, session_version = session_version + 1 WHERE id = $1 RETURNING *',
    [req.user.id, await hashPassword(next)],
  );
  const token = await signToken({ sub: u.id, cid: u.client_id, sv: u.session_version }, config.jwtSecret, 12 * 3600);
  res.cookie(COOKIE, token, cookieOptions(req));
  res.json({ ok: true });
});

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: 'Please sign in.' });
    const payload = await verifyToken(token, config.jwtSecret);
    if (!payload) return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    const { rows: [user] } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    // Removed logins, and sessions from before a password or role change, no longer work.
    if (!user || user.disabled_at || (payload.sv || 0) !== (user.session_version || 0)) {
      return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    }
    req.user = user;
    req.clientId = user.client_id;
    next();
  } catch {
    res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
  }
}

// Four roles (see lib/roles.js): app owner, store owner, store manager, staff. Each role can do
// everything the roles below it can; guards say the lowest role that may do something.
export { ROLES };

export function requireLevel(min) {
  return (req, res, next) => {
    if (atLeast(req.user?.role, min)) return next();
    res.status(403).json({ error: `This needs a ${roleLabel(min)} login or higher. Ask the store owner to change your role.` });
  };
}

const EMAIL = /^\S+@\S+\.\S+$/;
const roleError = (actor) => `Choose a role: ${assignableRoles(actor).map(roleLabel).join(', ')}.`;

// How many logins can still run the shop (store owner or app owner), not counting `exceptId`.
async function ownersLeft(clientId, exceptId) {
  const { rows: [{ n }] } = await query(
    `SELECT count(*) AS n FROM users WHERE client_id = $1 AND role IN ('owner', 'app_owner') AND disabled_at IS NULL AND id <> $2`,
    [clientId, exceptId],
  );
  return n;
}

// Logins (store owner and above). You can only manage logins below your own role; nobody creates
// an app owner login from inside the app.
router.get('/users', requireAuth, requireLevel('owner'), async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, name, role, created_at FROM users WHERE client_id = $1 AND disabled_at IS NULL ORDER BY created_at',
    [req.clientId],
  );
  res.json({
    users: rows.map((u) => ({ ...u, canManage: u.id !== req.user.id && canManageRole(req.user.role, u.role) })),
    assignable: assignableRoles(req.user.role),
  });
});

router.post('/users', requireAuth, requireLevel('owner'), async (req, res) => {
  const { email, name, password, role = 'staff' } = req.body || {};
  if (!assignableRoles(req.user.role).includes(role)) return res.status(400).json({ error: roleError(req.user.role) });
  if (!EMAIL.test(String(email || ''))) return res.status(400).json({ error: 'Enter a valid email address.' });
  const { rows: [taken] } = await query('SELECT client_id FROM users WHERE email = lower($1)', [String(email).trim()]);
  if (taken) return res.status(409).json({ error: 'That email already has a login.' });
  try {
    const user = await createUser({ clientId: req.clientId, email, name, password, role });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/users/:id', requireAuth, requireLevel('owner'), async (req, res) => {
  const { role, password, email, name } = req.body || {};
  const { rows: [u] } = await query('SELECT * FROM users WHERE id = $1 AND client_id = $2 AND disabled_at IS NULL', [req.params.id, req.clientId]);
  if (!u) return res.status(404).json({ error: 'Login not found.' });
  if (u.id === req.user.id || !canManageRole(req.user.role, u.role)) {
    return res.status(403).json({ error: 'You cannot change this login. Use My account for your own, or ask a higher role.' });
  }
  if (role && role !== u.role) {
    if (!assignableRoles(req.user.role).includes(role)) return res.status(400).json({ error: roleError(req.user.role) });
    if (['owner', 'app_owner'].includes(u.role) && !(await ownersLeft(req.clientId, u.id))) return res.status(409).json({ error: 'Keep at least one store owner.' });
    await query('UPDATE users SET role = $2, session_version = session_version + 1 WHERE id = $1', [u.id, role]);
  }
  if (email !== undefined && String(email).trim().toLowerCase() !== u.email) {
    if (!EMAIL.test(String(email || ''))) return res.status(400).json({ error: 'Enter a valid email address.' });
    const { rows: [taken] } = await query('SELECT id FROM users WHERE email = lower($1) AND id <> $2', [String(email).trim(), u.id]);
    if (taken) return res.status(409).json({ error: 'That email already has a login.' });
    await query('UPDATE users SET email = lower($2), session_version = session_version + 1 WHERE id = $1', [u.id, String(email).trim()]);
  }
  if (name !== undefined && String(name).trim()) await query('UPDATE users SET name = $2 WHERE id = $1', [u.id, String(name).trim().slice(0, 80)]);
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    await query('UPDATE users SET password_hash = $2, session_version = session_version + 1 WHERE id = $1', [u.id, await hashPassword(String(password))]);
  }
  res.json({ ok: true });
});

// Remove a login (for example someone who left): they are signed out at once and cannot
// sign in again. The row stays so past reports still show who sent what.
router.delete('/users/:id', requireAuth, requireLevel('owner'), async (req, res) => {
  const { rows: [u] } = await query('SELECT * FROM users WHERE id = $1 AND client_id = $2 AND disabled_at IS NULL', [req.params.id, req.clientId]);
  if (!u) return res.status(404).json({ error: 'Login not found.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot remove your own login.' });
  if (!canManageRole(req.user.role, u.role)) return res.status(403).json({ error: 'You cannot remove this login. Ask a higher role.' });
  await query(
    `UPDATE users SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), session_version = session_version + 1,
            email = 'removed-' || id || '-' || email WHERE id = $1`,
    [u.id],
  );
  res.json({ ok: true });
});

export async function createUser({ clientId, email, name, password, role = 'owner' }) {
  if (!email || !password) throw new Error('Email and password are required.');
  if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
  const hash = await hashPassword(password);
  const { rows: [user] } = await query(
    `INSERT INTO users (client_id, email, name, password_hash, role) VALUES ($1, lower($2), $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, role = excluded.role
     RETURNING *`,
    [clientId, email.trim(), name || email, hash, role],
  );
  return user;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, language: u.language || 'en' };
}

export default router;
