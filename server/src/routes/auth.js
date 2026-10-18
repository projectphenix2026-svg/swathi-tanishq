import express from 'express';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../lib/security.js';

const COOKIE = 'st_session';
const router = express.Router();

// At most 20 sign-in attempts per address per 15 minutes. No timers, so it also runs on
// Cloudflare Workers (each Worker instance keeps its own count).
const WINDOW = 15 * 60 * 1000;
const attempts = new Map();
function loginLimiter(req, res, next) {
  const key = req.get('cf-connecting-ip') || req.ip || 'unknown';
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < WINDOW);
  if (recent.length >= 20) return res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes and try again.' });
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 5000) attempts.clear();
  next();
}

// The website and API share one address (Cloudflare passes /api to the API), so the
// session cookie is first-party: SameSite=Lax, and Secure whenever the site is on HTTPS.
function cookieOptions(req) {
  const https = req.secure || req.get('x-forwarded-proto') === 'https' || config.nodeEnv === 'production';
  return { httpOnly: true, sameSite: 'lax', secure: https, maxAge: 12 * 3600 * 1000, path: '/' };
}

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const { rows: [user] } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const ok = user && (await verifyPassword(password, user.password_hash));
  if (!ok) return res.status(401).json({ error: 'That email and password do not match.' });
  const token = await signToken({ sub: user.id, cid: user.client_id }, config.jwtSecret, 12 * 3600);
  res.cookie(COOKIE, token, cookieOptions(req));
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined });
  res.json({ ok: true });
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

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: 'Please sign in.' });
    const payload = await verifyToken(token, config.jwtSecret);
    if (!payload) return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    const { rows: [user] } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    req.user = user;
    req.clientId = user.client_id;
    next();
  } catch {
    res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
  }
}

// Roles: admin (everything, approves big sends, manages staff), manager (customers,
// templates, campaigns), viewer (reads reports and the inbox, answers replies).
export const ROLES = ['admin', 'manager', 'viewer'];

export function requireRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user?.role)) return next();
    res.status(403).json({ error: 'Your login cannot do this. Ask the owner (an admin) to change your role.' });
  };
}

// Staff management (admins only).
router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, name, role, created_at FROM users WHERE client_id = $1 ORDER BY created_at',
    [req.clientId],
  );
  res.json({ users: rows });
});

router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { email, name, password, role = 'manager' } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a role: Owner, Staff or View only.' });
  if (!/^\S+@\S+\.\S+$/.test(String(email || ''))) return res.status(400).json({ error: 'Enter a valid email address.' });
  const { rows: [taken] } = await query('SELECT client_id FROM users WHERE email = $1', [email]);
  if (taken) return res.status(409).json({ error: 'That email already has a login.' });
  try {
    const user = await createUser({ clientId: req.clientId, email, name, password, role });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { role, password } = req.body || {};
  const { rows: [u] } = await query('SELECT * FROM users WHERE id = $1 AND client_id = $2', [req.params.id, req.clientId]);
  if (!u) return res.status(404).json({ error: 'Staff member not found.' });
  if (role) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a role: Owner, Staff or View only.' });
    if (u.role === 'admin' && role !== 'admin') {
      const { rows: [{ n }] } = await query(`SELECT count(*) AS n FROM users WHERE client_id = $1 AND role = 'admin'`, [req.clientId]);
      if (n <= 1) return res.status(409).json({ error: 'Keep at least one owner.' });
    }
    await query('UPDATE users SET role = $2 WHERE id = $1', [u.id, role]);
  }
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [u.id, await hashPassword(String(password))]);
  }
  res.json({ ok: true });
});

export async function createUser({ clientId, email, name, password, role = 'admin' }) {
  if (!email || !password) throw new Error('Email and password are required.');
  if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
  const hash = await hashPassword(password);
  const { rows: [user] } = await query(
    `INSERT INTO users (client_id, email, name, password_hash, role) VALUES ($1, lower($2), $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name
     RETURNING *`,
    [clientId, email.trim(), name || email, hash, role],
  );
  return user;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, language: u.language || 'en' };
}

export default router;
