import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { assertConfig } from '../src/config.js';
import { initDb, closeDb, ensureClient, query } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/routes/auth.js';

let app;
let owner;

beforeAll(async () => {
  assertConfig();
  await initDb({ memory: true });
  const clientId = await ensureClient('Test Store');
  await createUser({ clientId, email: 'owner@example.com', password: 'owner-password-1', name: 'Owner' });
  await createUser({ clientId, email: 'staff@example.com', password: 'staff-password-1', name: 'Staff', role: 'manager' });
  app = createApp();
  owner = request.agent(app);
  await owner.post('/api/auth/login').send({ email: 'owner@example.com', password: 'owner-password-1' });
});
afterAll(() => closeDb());

describe('Sign-in protection', () => {
  it('waits after 10 wrong passwords for one email, across all server copies', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post('/api/auth/login').send({ email: 'staff@example.com', password: `wrong-${i}` })).status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: 'staff@example.com', password: 'staff-password-1' });
    expect(blocked.status).toBe(429);
    const { rows: [n] } = await query("SELECT count(*) AS n FROM login_attempts WHERE email = 'staff@example.com'");
    expect(n.n).toBe(10);
    await query('DELETE FROM login_attempts');
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever-1' });
    const b = await request(app).post('/api/auth/login').send({ email: 'staff@example.com', password: 'whatever-1' });
    expect([a.status, a.body.error]).toEqual([b.status, b.body.error]);
    await query('DELETE FROM login_attempts');
  });

  it('signs a person out everywhere when the owner sets a new password', async () => {
    const staff = request.agent(app);
    await staff.post('/api/auth/login').send({ email: 'staff@example.com', password: 'staff-password-1' });
    expect((await staff.get('/api/auth/me')).status).toBe(200);
    const { rows: [s] } = await query("SELECT id FROM users WHERE email = 'staff@example.com'");
    await owner.patch(`/api/auth/users/${s.id}`).send({ password: 'staff-password-2' });
    expect((await staff.get('/api/auth/me')).status).toBe(401);
    expect((await staff.post('/api/auth/login').send({ email: 'staff@example.com', password: 'staff-password-2' })).status).toBe(200);
    expect((await staff.get('/api/auth/me')).status).toBe(200);
  });

  it('removes a staff login: signed out at once, cannot sign in, email free again', async () => {
    const staff = request.agent(app);
    await staff.post('/api/auth/login').send({ email: 'staff@example.com', password: 'staff-password-2' });
    const { rows: [s] } = await query("SELECT id FROM users WHERE email = 'staff@example.com'");
    expect((await owner.delete(`/api/auth/users/${s.id}`)).body.ok).toBe(true);
    expect((await staff.get('/api/auth/me')).status).toBe(401);
    expect((await staff.post('/api/auth/login').send({ email: 'staff@example.com', password: 'staff-password-2' })).status).toBe(401);
    expect((await owner.get('/api/auth/users')).body.users.map((u) => u.email)).toEqual(['owner@example.com']);
    const { rows: [me] } = await query("SELECT id FROM users WHERE email = 'owner@example.com'");
    expect((await owner.delete(`/api/auth/users/${me.id}`)).status).toBe(400);
    expect((await owner.post('/api/auth/users').send({ email: 'staff@example.com', name: 'New Staff', password: 'new-password-1' })).status).toBe(201);
  });

  it('only the owner manages staff', async () => {
    const other = request.agent(app);
    await other.post('/api/auth/login').send({ email: 'staff@example.com', password: 'new-password-1' });
    expect((await other.get('/api/auth/users')).status).toBe(403);
    expect((await other.get('/api/export/customers')).status).toBe(403);
    expect((await other.post('/api/whatsapp/live').send({ live: true })).status).toBe(403);
  });
});

describe('Changing your own password', () => {
  it('needs the current password, keeps this session, and signs out the others', async () => {
    const other = request.agent(app);
    await other.post('/api/auth/login').send({ email: 'owner@example.com', password: 'owner-password-1' });
    expect((await owner.post('/api/auth/me/password').send({ currentPassword: 'wrong-one-1', newPassword: 'owner-password-2' })).status).toBe(400);
    expect((await owner.post('/api/auth/me/password').send({ currentPassword: 'owner-password-1', newPassword: 'owner-password-2' })).body.ok).toBe(true);
    expect((await owner.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });
});
