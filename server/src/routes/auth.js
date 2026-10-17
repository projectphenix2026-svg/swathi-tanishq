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
