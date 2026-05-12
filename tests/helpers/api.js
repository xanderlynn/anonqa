'use strict';

/**
 * Shared test helpers for the anonqa API test suite.
 * All functions accept an APIRequestContext (`request` from Playwright fixtures).
 */

async function resetDb(request) {
  const res = await request.post('/__test__/reset');
  if (!res.ok()) throw new Error(`DB reset failed: ${res.status()}`);
}

/**
 * Register a user and return the response.
 */
async function register(request, username, password = 'validpassword123') {
  return request.post('/api/auth/register', { data: { username, password } });
}

/**
 * Login and return { res, token, user }.
 */
async function login(request, username, password = 'validpassword123') {
  const res = await request.post('/api/auth/login', { data: { username, password } });
  const body = await res.json();
  return { res, token: body.token, user: body.user };
}

/**
 * Register + login a fresh user. Returns { token, user, username }.
 * `tag` is mixed into the username to make it unique within a test.
 */
async function createUser(request, tag = '') {
  const username = `u${tag}${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await register(request, username);
  const { token, user } = await login(request, username);
  return { token, user, username };
}

/**
 * Create a session as an authenticated user. Returns the session body.
 */
async function createSession(request, token, opts = {}) {
  const res = await request.post('/api/sessions', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: opts.name || `Session-${Date.now()}`,
      visibility: opts.visibility !== undefined ? opts.visibility : true,
      ...(opts.passcode ? { passcode: opts.passcode } : {}),
    },
  });
  return res.json();
}

/**
 * Post a question to a session. Returns the full response.
 */
async function postQuestion(request, sessionId, content = 'Test question?', extraHeaders = {}) {
  return request.post(`/api/sessions/${sessionId}/questions`, {
    headers: extraHeaders,
    data: { content },
  });
}

/**
 * Obtain a session-scoped access token by submitting the passcode.
 */
async function getSessionToken(request, sessionId, passcode) {
  const res = await request.post(`/api/sessions/${sessionId}/verify-passcode`, {
    data: { passcode },
  });
  const body = await res.json();
  return body.sessionAccessToken;
}

module.exports = { resetDb, register, login, createUser, createSession, postQuestion, getSessionToken };
