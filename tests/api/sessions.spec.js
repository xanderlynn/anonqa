'use strict';

const { test, expect } = require('@playwright/test');
const { resetDb, createUser, createSession, getSessionToken } = require('../helpers/api');

// ─── GET /api/sessions ────────────────────────────────────────────────────────

test.describe('GET /api/sessions', () => {
  test.beforeEach(({ request }) => resetDb(request));

  test('200: empty array when no sessions exist', async ({ request }) => {
    const res = await request.get('/api/sessions');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test('200: returns only public sessions', async ({ request }) => {
    const { token } = await createUser(request, 'a');
    await createSession(request, token, { name: 'Public Session', visibility: true });
    await createSession(request, token, { name: 'Private Session', visibility: false });

    const res = await request.get('/api/sessions');
    const body = await res.json();
    const names = body.map((s) => s.name);
    expect(names).toContain('Public Session');
    expect(names).not.toContain('Private Session');
  });

  test('200: response never includes passcode hash', async ({ request }) => {
    const { token } = await createUser(request, 'b');
    await createSession(request, token, { name: 'Protected', visibility: true, passcode: 'secretpasscode1' });
    const body = await (await request.get('/api/sessions')).json();
    body.forEach((s) => expect(s).not.toHaveProperty('passcode'));
  });

  test('200: response includes owner_user_id and other public fields', async ({ request }) => {
    const { token } = await createUser(request, 'c');
    await createSession(request, token, { name: 'Field Check', visibility: true });
    const body = await (await request.get('/api/sessions')).json();
    const session = body.find((s) => s.name === 'Field Check');
    expect(session).toHaveProperty('id');
    expect(session).toHaveProperty('owner_user_id');
    expect(session).toHaveProperty('created_at');
  });
});

// ─── POST /api/sessions ───────────────────────────────────────────────────────

test.describe('POST /api/sessions', () => {
  test.beforeEach(({ request }) => resetDb(request));

  test('201: creates public session with correct fields', async ({ request }) => {
    const { token, user } = await createUser(request, 'd');
    const res = await request.post('/api/sessions', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'My Session', visibility: true },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ name: 'My Session', visibility: true });
    expect(body).toHaveProperty('id');
    expect(body.owner_user_id).toBe(user.id);
    expect(body).not.toHaveProperty('passcode');
  });

  test('201: creates private session with passcode (hash never returned)', async ({ request }) => {
    const { token } = await createUser(request, 'e');
    const res = await request.post('/api/sessions', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Private', visibility: false, passcode: 'secretcode1' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.visibility).toBe(false);
    expect(body).not.toHaveProperty('passcode');
  });

  test('401: unauthenticated request is rejected', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      data: { name: 'Anon', visibility: true },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('Authentication required');
  });

  test('401: invalid Bearer token is rejected', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      headers: { Authorization: 'Bearer not.a.real.token' },
      data: { name: 'Bad Token', visibility: true },
    });
    expect(res.status()).toBe(401);
  });

  test('400: missing name', async ({ request }) => {
    const { token } = await createUser(request, 'f');
    const res = await request.post('/api/sessions', {
      headers: { Authorization: `Bearer ${token}` },
      data: { visibility: true },
    });
    expect(res.status()).toBe(400);
  });

  test('400: missing visibility', async ({ request }) => {
    const { token } = await createUser(request, 'g');
    const res = await request.post('/api/sessions', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'No Visibility' },
    });
    expect(res.status()).toBe(400);
  });

  test('400: passcode shorter than 6 characters', async ({ request }) => {
    const { token } = await createUser(request, 'h');
    const res = await request.post('/api/sessions', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Short Passcode', visibility: false, passcode: 'abc' },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── POST /api/sessions/:id/verify-passcode ───────────────────────────────────

test.describe('POST /api/sessions/:id/verify-passcode', () => {
  let token, privateSessionId, publicSessionId;

  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    ({ token } = await createUser(request, 'i'));
    const priv = await createSession(request, token, { visibility: false, passcode: 'correctpass1' });
    privateSessionId = priv.id;
    const pub = await createSession(request, token, { name: 'Open', visibility: true });
    publicSessionId = pub.id;
  });

  test('200: correct passcode returns sessionAccessToken', async ({ request }) => {
    const res = await request.post(`/api/sessions/${privateSessionId}/verify-passcode`, {
      data: { passcode: 'correctpass1' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json())).toHaveProperty('sessionAccessToken');
  });

  test('401: wrong passcode is rejected', async ({ request }) => {
    const res = await request.post(`/api/sessions/${privateSessionId}/verify-passcode`, {
      data: { passcode: 'wrongpasscode' },
    });
    expect(res.status()).toBe(401);
  });

  test('400: session has no passcode', async ({ request }) => {
    const res = await request.post(`/api/sessions/${publicSessionId}/verify-passcode`, {
      data: { passcode: 'anything' },
    });
    expect(res.status()).toBe(400);
  });

  test('404: session does not exist', async ({ request }) => {
    const res = await request.post('/api/sessions/99999/verify-passcode', {
      data: { passcode: 'test1234' },
    });
    expect(res.status()).toBe(404);
  });

  test('400: non-numeric session ID', async ({ request }) => {
    const res = await request.post('/api/sessions/abc/verify-passcode', {
      data: { passcode: 'test1234' },
    });
    expect(res.status()).toBe(400);
  });

  test('400: missing passcode in body', async ({ request }) => {
    const res = await request.post(`/api/sessions/${privateSessionId}/verify-passcode`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

// ─── POST /api/sessions/:id/toggle-visibility ─────────────────────────────────

test.describe('POST /api/sessions/:id/toggle-visibility', () => {
  let ownerToken, otherToken, sessionId;

  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    ({ token: ownerToken } = await createUser(request, 'j'));
    ({ token: otherToken } = await createUser(request, 'k'));
    const s = await createSession(request, ownerToken, { name: 'Toggle Test', visibility: true });
    sessionId = s.id;
  });

  test('200: owner can toggle visibility', async ({ request }) => {
    const res = await request.post(`/api/sessions/${sessionId}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).visibility).toBe(false);
  });

  test('200: toggling twice restores original state', async ({ request }) => {
    await request.post(`/api/sessions/${sessionId}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const res = await request.post(`/api/sessions/${sessionId}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect((await res.json()).visibility).toBe(true);
  });

  test('403: non-owner is forbidden', async ({ request }) => {
    const res = await request.post(`/api/sessions/${sessionId}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('401: unauthenticated request is rejected', async ({ request }) => {
    const res = await request.post(`/api/sessions/${sessionId}/toggle-visibility`);
    expect(res.status()).toBe(401);
  });

  test('404: non-existent session', async ({ request }) => {
    const res = await request.post('/api/sessions/99999/toggle-visibility', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status()).toBe(404);
  });

  test('400: non-numeric session ID', async ({ request }) => {
    const res = await request.post('/api/sessions/abc/toggle-visibility', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── POST /api/sessions/:id/set-passcode ─────────────────────────────────────

test.describe('POST /api/sessions/:id/set-passcode', () => {
  let ownerToken, otherToken, sessionId;

  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    ({ token: ownerToken } = await createUser(request, 'l'));
    ({ token: otherToken } = await createUser(request, 'm'));
    const s = await createSession(request, ownerToken, { visibility: true });
    sessionId = s.id;
  });

  test('200: owner sets passcode (hash never returned)', async ({ request }) => {
    const res = await request.post(`/api/sessions/${sessionId}/set-passcode`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { passcode: 'newpasscode12' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('passcode');
    expect(body).toHaveProperty('id');
  });

  test('integration: new passcode can be verified after setting', async ({ request }) => {
    await request.post(`/api/sessions/${sessionId}/set-passcode`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { passcode: 'mynewpasscode1' },
    });
    // Make session private so passcode verification is meaningful
    await request.post(`/api/sessions/${sessionId}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const verifyRes = await request.post(`/api/sessions/${sessionId}/verify-passcode`, {
      data: { passcode: 'mynewpasscode1' },
    });
    expect(verifyRes.status()).toBe(200);
    expect(await verifyRes.json()).toHaveProperty('sessionAccessToken');
  });

  test('403: non-owner is forbidden', async ({ request }) => {
    const res = await request.post(`/api/sessions/${sessionId}/set-passcode`, {
      headers: { Authorization: `Bearer ${otherToken}` },
      data: { passcode: 'newpasscode12' },
    });
    expect(res.status()).toBe(403);
  });

  test('401: unauthenticated request is rejected', async ({ request }) => {
    const res = await request.post(`/api/sessions/${sessionId}/set-passcode`, {
      data: { passcode: 'newpasscode12' },
    });
    expect(res.status()).toBe(401);
  });

  test('400: passcode shorter than 6 characters', async ({ request }) => {
    const res = await request.post(`/api/sessions/${sessionId}/set-passcode`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { passcode: 'abc' },
    });
    expect(res.status()).toBe(400);
  });

  test('400: missing passcode', async ({ request }) => {
    const res = await request.post(`/api/sessions/${sessionId}/set-passcode`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('404: non-existent session', async ({ request }) => {
    const res = await request.post('/api/sessions/99999/set-passcode', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { passcode: 'validpasscode1' },
    });
    expect(res.status()).toBe(404);
  });

  test('400: non-numeric session ID', async ({ request }) => {
    const res = await request.post('/api/sessions/xyz/set-passcode', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { passcode: 'validpasscode1' },
    });
    expect(res.status()).toBe(400);
  });
});
