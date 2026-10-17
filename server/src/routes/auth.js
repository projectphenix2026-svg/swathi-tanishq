import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { query } from '../db/index.js';

const COOKIE = 'st_session';
const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
});

function cookieOptions() {
  const crossSite = config.nodeEnv === 'production';
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite,
    maxAge: 12 * 3600 * 1000,
    path: '/',
  };
}

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const { rows: [user] } = await query('SELECT * FROM users WHERE lower(email) = $1', [email]);
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) return res.status(401).json({ error: 'That email and password do not match.' });
  const token = jwt.sign({ sub: user.id, cid: user.client_id }, config.jwtSecret, { expiresIn: '12h' });
  res.cookie(COOKIE, token, cookieOptions());
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: 'Please sign in.' });
    const payload = jwt.verify(token, config.jwtSecret);
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
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a role: admin, manager or viewer.' });
  if (!/^\S+@\S+\.\S+$/.test(String(email || ''))) return res.status(400).json({ error: 'Enter a valid email address.' });
  const { rows: [taken] } = await query('SELECT client_id FROM users WHERE lower(email) = lower($1)', [email]);
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
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a role: admin, manager or viewer.' });
    if (u.role === 'admin' && role !== 'admin') {
      const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM users WHERE client_id = $1 AND role = 'admin'`, [req.clientId]);
      if (n <= 1) return res.status(409).json({ error: 'Keep at least one admin.' });
    }
    await query('UPDATE users SET role = $2 WHERE id = $1', [u.id, role]);
  }
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [u.id, await bcrypt.hash(String(password), 10)]);
  }
  res.json({ ok: true });
});

export async function createUser({ clientId, email, name, password, role = 'admin' }) {
  if (!email || !password) throw new Error('Email and password are required.');
  if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
  const hash = await bcrypt.hash(password, 10);
  const { rows: [user] } = await query(
    `INSERT INTO users (client_id, email, name, password_hash, role) VALUES ($1, lower($2), $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name
     RETURNING *`,
    [clientId, email.trim(), name || email, hash, role],
  );
  return user;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export default router;
