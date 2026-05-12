'use strict';

const { test, expect } = require('@playwright/test');
const { resetDb, register, login, createUser } = require('../helpers/api');

// ─── POST /api/auth/register ──────────────────────────────────────────────────

test.describe('POST /api/auth/register', () => {
  test.beforeEach(({ request }) => resetDb(request));

  test('201: creates user and returns public fields', async ({ request }) => {
    const res = await register(request, 'newuser01');
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ username: 'newuser01', role: 'user' });
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('created_at');
    expect(body).not.toHaveProperty('password_hash');
  });

  test('201: role is always "user" regardless of payload role field', async ({ request }) => {
    const res = await request.post('/api/auth/register', {
      data: { username: 'hacker01', password: 'validpassword123', role: 'admin' },
    });
    if (res.status() === 201) {
      const body = await res.json();
      expect(body.role).toBe('user');
    }
  });

  test('409: duplicate username', async ({ request }) => {
    await register(request, 'dupuser01');
    const res = await register(request, 'dupuser01');
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/already taken/i);
  });

  test('400: username too short (< 3 chars)', async ({ request }) => {
    const res = await register(request, 'ab');
    expect(res.status()).toBe(400);
  });

  test('400: username too long (> 50 chars)', async ({ request }) => {
    const res = await register(request, 'a'.repeat(51));
    expect(res.status()).toBe(400);
  });

  test('400: non-alphanumeric username', async ({ request }) => {
    const res = await register(request, 'bad user!');
    expect(res.status()).toBe(400);
  });

  test('400: password too short (< 10 chars)', async ({ request }) => {
    const res = await register(request, 'validuser1', 'short');
    expect(res.status()).toBe(400);
  });

  test('400: missing username', async ({ request }) => {
    const res = await request.post('/api/auth/register', { data: { password: 'validpassword123' } });
    expect(res.status()).toBe(400);
  });

  test('400: missing password', async ({ request }) => {
    const res = await request.post('/api/auth/register', { data: { username: 'validuser2' } });
    expect(res.status()).toBe(400);
  });

  test('400: empty body', async ({ request }) => {
    const res = await request.post('/api/auth/register', { data: {} });
    expect(res.status()).toBe(400);
  });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

test.describe('POST /api/auth/login', () => {
  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    await register(request, 'loginuser1');
  });

  test('200: returns token and safe user object on valid credentials', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: 'loginuser1', password: 'validpassword123' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('token');
    expect(body.user).toMatchObject({ username: 'loginuser1', role: 'user' });
    expect(body.user).not.toHaveProperty('password_hash');
  });

  test('200: JWT contains correct issuer, audience, role, and expiry claims', async ({ request }) => {
    const { token } = await login(request, 'loginuser1');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload.username).toBe('loginuser1');
    expect(payload.role).toBe('user');
    expect(payload.iss).toBe('anonqa');
    expect(payload.aud).toBe('anonqa-api');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload).toHaveProperty('userId');
  });

  test('401: wrong password returns generic error', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: 'loginuser1', password: 'wrongpassword' },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('Invalid credentials');
  });

  test('401: non-existent user returns same error as wrong password (no enumeration)', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: 'doesnotexist', password: 'anypassword123' },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('Invalid credentials');
  });

  test('400: missing username and password', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('400: missing password', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { username: 'loginuser1' } });
    expect(res.status()).toBe(400);
  });

  test('400: missing username', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { password: 'validpassword123' } });
    expect(res.status()).toBe(400);
  });

  test('200: returned token is reusable for authenticated requests', async ({ request }) => {
    const { token } = await login(request, 'loginuser1');
    // Use the token to create a session (requires auth)
    const sessionRes = await request.post('/api/sessions', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Token test session', visibility: true },
    });
    expect(sessionRes.status()).toBe(201);
  });
});
