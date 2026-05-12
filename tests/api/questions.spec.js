'use strict';

const { test, expect } = require('@playwright/test');
const { resetDb, createUser, createSession, postQuestion, getSessionToken } = require('../helpers/api');

// ─── GET /api/sessions/:sessionId/questions ───────────────────────────────────

test.describe('GET /api/sessions/:sessionId/questions', () => {
  let token, publicSessionId, privateSessionId, sessionToken;

  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    ({ token } = await createUser(request, 'gq'));
    const pub = await createSession(request, token, { name: 'Public', visibility: true });
    publicSessionId = pub.id;
    const priv = await createSession(request, token, { name: 'Private', visibility: false, passcode: 'testpass123' });
    privateSessionId = priv.id;
    await postQuestion(request, publicSessionId, 'Public question?');
    sessionToken = await getSessionToken(request, privateSessionId, 'testpass123');
  });

  test('200: anonymous user can read public session questions', async ({ request }) => {
    const res = await request.get(`/api/sessions/${publicSessionId}/questions`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].content).toBe('Public question?');
  });

  test('403: anonymous user cannot read private session questions', async ({ request }) => {
    const res = await request.get(`/api/sessions/${privateSessionId}/questions`);
    expect(res.status()).toBe(403);
  });

  test('200: session access token grants read access to private session', async ({ request }) => {
    const res = await request.get(`/api/sessions/${privateSessionId}/questions`, {
      headers: { 'X-Session-Token': sessionToken },
    });
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('200: session owner can read private session questions via Bearer token', async ({ request }) => {
    const res = await request.get(`/api/sessions/${privateSessionId}/questions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  test('403: non-owner authenticated user cannot read private session', async ({ request }) => {
    const { token: otherToken } = await createUser(request, 'gq2');
    const res = await request.get(`/api/sessions/${privateSessionId}/questions`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('visibility: anonymous only sees non-hidden; owner sees all', async ({ request }) => {
    // Post a question then hide it as owner
    const qRes = await postQuestion(request, publicSessionId, 'Will be hidden', {
      Authorization: `Bearer ${token}`,
    });
    const q = await qRes.json();
    await request.post(`/api/questions/${q.id}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Anonymous should not see hidden question
    const anonBody = await (await request.get(`/api/sessions/${publicSessionId}/questions`)).json();
    expect(anonBody.map((x) => x.id)).not.toContain(q.id);

    // Owner sees all questions including hidden
    const ownerBody = await (
      await request.get(`/api/sessions/${publicSessionId}/questions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    const hiddenQ = ownerBody.find((x) => x.id === q.id);
    expect(hiddenQ).toBeDefined();
    expect(hiddenQ.is_hidden).toBe(true);
  });

  test('404: non-existent session', async ({ request }) => {
    const res = await request.get('/api/sessions/99999/questions');
    expect(res.status()).toBe(404);
  });

  test('400: non-numeric session ID', async ({ request }) => {
    const res = await request.get('/api/sessions/abc/questions');
    expect(res.status()).toBe(400);
  });
});

// ─── POST /api/sessions/:sessionId/questions ──────────────────────────────────

test.describe('POST /api/sessions/:sessionId/questions', () => {
  let token, publicSessionId, privateSessionId, sessionToken;

  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    ({ token } = await createUser(request, 'pq'));
    const pub = await createSession(request, token, { visibility: true });
    publicSessionId = pub.id;
    const priv = await createSession(request, token, { visibility: false, passcode: 'testpass456' });
    privateSessionId = priv.id;
    sessionToken = await getSessionToken(request, privateSessionId, 'testpass456');
  });

  test('201: anonymous user can submit to public session', async ({ request }) => {
    const res = await postQuestion(request, publicSessionId, 'My question?');
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.content).toBe('My question?');
    expect(body.upvotes).toBe(0);
    expect(body.is_hidden).toBe(false);
  });

  test('403: anonymous user cannot submit to private session', async ({ request }) => {
    const res = await postQuestion(request, privateSessionId, 'Sneaky question');
    expect(res.status()).toBe(403);
  });

  test('201: session access token allows submitting to private session', async ({ request }) => {
    const res = await postQuestion(request, privateSessionId, 'Private question', {
      'X-Session-Token': sessionToken,
    });
    expect(res.status()).toBe(201);
  });

  test('400: empty content is rejected', async ({ request }) => {
    const res = await postQuestion(request, publicSessionId, '');
    expect(res.status()).toBe(400);
  });

  test('400: content exceeding 1000 characters is rejected', async ({ request }) => {
    const res = await postQuestion(request, publicSessionId, 'a'.repeat(1001));
    expect(res.status()).toBe(400);
  });

  test('200: content of exactly 1000 characters is accepted', async ({ request }) => {
    const res = await postQuestion(request, publicSessionId, 'a'.repeat(1000));
    expect(res.status()).toBe(201);
  });

  test('404: non-existent session', async ({ request }) => {
    const res = await postQuestion(request, 99999, 'Question?');
    expect(res.status()).toBe(404);
  });

  test('400: non-numeric session ID', async ({ request }) => {
    const res = await postQuestion(request, 'abc', 'Question?');
    expect(res.status()).toBe(400);
  });
});

// ─── POST /api/questions/:questionId/upvote ───────────────────────────────────

test.describe('POST /api/questions/:questionId/upvote', () => {
  let token, questionId;

  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    ({ token } = await createUser(request, 'uv'));
    const s = await createSession(request, token, { visibility: true });
    const qRes = await postQuestion(request, s.id, 'Upvotable question?');
    questionId = (await qRes.json()).id;
  });

  test('200: increments upvote count by 1', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/upvote`);
    expect(res.status()).toBe(200);
    expect((await res.json()).upvotes).toBe(1);
  });

  test('200: multiple upvotes accumulate correctly', async ({ request }) => {
    await request.post(`/api/questions/${questionId}/upvote`);
    await request.post(`/api/questions/${questionId}/upvote`);
    const res = await request.post(`/api/questions/${questionId}/upvote`);
    expect((await res.json()).upvotes).toBe(3);
  });

  test('404: non-existent question', async ({ request }) => {
    const res = await request.post('/api/questions/99999/upvote');
    expect(res.status()).toBe(404);
  });

  test('404: hidden question cannot be upvoted', async ({ request }) => {
    // Hide the question
    await request.post(`/api/questions/${questionId}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await request.post(`/api/questions/${questionId}/upvote`);
    expect(res.status()).toBe(404);
  });

  test('400: non-numeric question ID', async ({ request }) => {
    const res = await request.post('/api/questions/abc/upvote');
    expect(res.status()).toBe(400);
  });
});

// ─── POST /api/questions/:questionId/toggle-visibility ────────────────────────

test.describe('POST /api/questions/:questionId/toggle-visibility', () => {
  let ownerToken, otherToken, questionId;

  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    ({ token: ownerToken } = await createUser(request, 'tv'));
    ({ token: otherToken } = await createUser(request, 'tv2'));
    const s = await createSession(request, ownerToken, { visibility: true });
    const qRes = await postQuestion(request, s.id, 'Toggle me');
    questionId = (await qRes.json()).id;
  });

  test('200: owner can hide a question', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).is_hidden).toBe(true);
  });

  test('200: owner can unhide a question (toggle twice)', async ({ request }) => {
    await request.post(`/api/questions/${questionId}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const res = await request.post(`/api/questions/${questionId}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect((await res.json()).is_hidden).toBe(false);
  });

  test('403: non-owner is forbidden', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/toggle-visibility`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('401: unauthenticated request is rejected', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/toggle-visibility`);
    expect(res.status()).toBe(401);
  });

  test('404: non-existent question', async ({ request }) => {
    const res = await request.post('/api/questions/99999/toggle-visibility', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status()).toBe(404);
  });

  test('400: non-numeric question ID', async ({ request }) => {
    const res = await request.post('/api/questions/xyz/toggle-visibility', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── POST /api/questions/:questionId/add-moderator-comment ────────────────────

test.describe('POST /api/questions/:questionId/add-moderator-comment', () => {
  let ownerToken, otherToken, questionId;

  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    ({ token: ownerToken } = await createUser(request, 'mc'));
    ({ token: otherToken } = await createUser(request, 'mc2'));
    const s = await createSession(request, ownerToken, { visibility: true });
    const qRes = await postQuestion(request, s.id, 'Comment on me');
    questionId = (await qRes.json()).id;
  });

  test('200: owner can add a moderator comment', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/add-moderator-comment`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { comment: 'This has been addressed.' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).moderator_comment).toBe('This has been addressed.');
  });

  test('200: owner can update existing moderator comment', async ({ request }) => {
    await request.post(`/api/questions/${questionId}/add-moderator-comment`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { comment: 'First comment.' },
    });
    const res = await request.post(`/api/questions/${questionId}/add-moderator-comment`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { comment: 'Updated comment.' },
    });
    expect((await res.json()).moderator_comment).toBe('Updated comment.');
  });

  test('403: non-owner is forbidden', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/add-moderator-comment`, {
      headers: { Authorization: `Bearer ${otherToken}` },
      data: { comment: 'Sneaky comment' },
    });
    expect(res.status()).toBe(403);
  });

  test('401: unauthenticated request is rejected', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/add-moderator-comment`, {
      data: { comment: 'No auth' },
    });
    expect(res.status()).toBe(401);
  });

  test('400: empty comment is rejected', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/add-moderator-comment`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { comment: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('400: comment exceeding 2000 characters is rejected', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/add-moderator-comment`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { comment: 'x'.repeat(2001) },
    });
    expect(res.status()).toBe(400);
  });

  test('404: non-existent question', async ({ request }) => {
    const res = await request.post('/api/questions/99999/add-moderator-comment', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { comment: 'comment' },
    });
    expect(res.status()).toBe(404);
  });

  test('400: non-numeric question ID', async ({ request }) => {
    const res = await request.post('/api/questions/bad/add-moderator-comment', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { comment: 'comment' },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── POST /api/questions/:questionId/take-action ──────────────────────────────

test.describe('POST /api/questions/:questionId/take-action', () => {
  let ownerToken, otherToken, questionId;

  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    ({ token: ownerToken } = await createUser(request, 'ta'));
    ({ token: otherToken } = await createUser(request, 'ta2'));
    const s = await createSession(request, ownerToken, { visibility: true });
    const qRes = await postQuestion(request, s.id, 'Take action on me');
    questionId = (await qRes.json()).id;
  });

  test('200: owner can record action taken', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/take-action`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { action: 'Answered during session.' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).action_taken).toBe('Answered during session.');
  });

  test('200: owner can update existing action', async ({ request }) => {
    await request.post(`/api/questions/${questionId}/take-action`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { action: 'First action.' },
    });
    const res = await request.post(`/api/questions/${questionId}/take-action`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { action: 'Revised action.' },
    });
    expect((await res.json()).action_taken).toBe('Revised action.');
  });

  test('403: non-owner is forbidden', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/take-action`, {
      headers: { Authorization: `Bearer ${otherToken}` },
      data: { action: 'Sneaky action' },
    });
    expect(res.status()).toBe(403);
  });

  test('401: unauthenticated request is rejected', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/take-action`, {
      data: { action: 'No auth action' },
    });
    expect(res.status()).toBe(401);
  });

  test('400: empty action is rejected', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/take-action`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { action: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('400: action exceeding 500 characters is rejected', async ({ request }) => {
    const res = await request.post(`/api/questions/${questionId}/take-action`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { action: 'a'.repeat(501) },
    });
    expect(res.status()).toBe(400);
  });

  test('404: non-existent question', async ({ request }) => {
    const res = await request.post('/api/questions/99999/take-action', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { action: 'action' },
    });
    expect(res.status()).toBe(404);
  });

  test('400: non-numeric question ID', async ({ request }) => {
    const res = await request.post('/api/questions/bad/take-action', {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { action: 'action' },
    });
    expect(res.status()).toBe(400);
  });
});
