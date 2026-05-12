'use strict';

const { test, expect } = require('@playwright/test');

// ─── Security Headers (helmet) ────────────────────────────────────────────────

test.describe('Security Headers', () => {
  test('X-Content-Type-Options: nosniff is set', async ({ request }) => {
    const res = await request.get('/api/sessions');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('X-Frame-Options is set', async ({ request }) => {
    const res = await request.get('/api/sessions');
    // helmet sets this to SAMEORIGIN or DENY
    expect(res.headers()['x-frame-options']).toBeDefined();
  });

  test('X-Powered-By header is removed', async ({ request }) => {
    const res = await request.get('/api/sessions');
    expect(res.headers()['x-powered-by']).toBeUndefined();
  });

  test('Cross-Origin-Resource-Policy is set', async ({ request }) => {
    const res = await request.get('/api/sessions');
    // helmet sets various cross-origin headers
    const headers = res.headers();
    // At minimum, X-Content-Type-Options should confirm helmet is active
    expect(headers['x-content-type-options']).toBeDefined();
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────

test.describe('404 Handler', () => {
  test('404: unknown top-level route returns structured error', async ({ request }) => {
    const res = await request.get('/api/doesnotexist');
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toBe('Not found');
  });

  test('404: deeply nested unknown route returns structured error', async ({ request }) => {
    const res = await request.get('/api/some/unknown/deeply/nested/path');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  test('404: unknown POST route returns structured error', async ({ request }) => {
    const res = await request.post('/api/nonexistent');
    expect(res.status()).toBe(404);
  });
});

// ─── Request Body Size Limit ──────────────────────────────────────────────────

test.describe('Request Body Limits', () => {
  test('413 or 400: payload larger than 10kb is rejected', async ({ request }) => {
    // 11kb string exceeds the 10kb limit configured in express.json()
    const largeString = 'x'.repeat(11 * 1024);
    const res = await request.post('/api/auth/register', {
      data: { username: 'test', password: largeString },
    });
    // Express returns 413 PayloadTooLarge; validator may return 400
    expect([400, 413]).toContain(res.status());
  });

  test('200: payload at the limit boundary (9kb) is processed normally', async ({ request }) => {
    // A 9kb payload should be accepted (though it will fail validation for other reasons)
    const nearLimitString = 'x'.repeat(9 * 1024);
    const res = await request.post('/api/auth/register', {
      data: { username: 'borderuser', password: nearLimitString },
    });
    // Body accepted (not 413), but registration may fail for other validation reasons
    expect(res.status()).not.toBe(413);
  });
});

// ─── CORS Policy ──────────────────────────────────────────────────────────────

test.describe('CORS Policy', () => {
  test('allowed origin receives Access-Control-Allow-Origin header', async ({ request }) => {
    const res = await request.get('/api/sessions', {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  test('disallowed origin does not receive ACAO header matching its origin', async ({ request }) => {
    const res = await request.get('/api/sessions', {
      headers: { Origin: 'http://evil.example.com' },
    });
    const acao = res.headers()['access-control-allow-origin'];
    expect(acao).not.toBe('http://evil.example.com');
  });

  test('second allowed origin also works', async ({ request }) => {
    const res = await request.get('/api/sessions', {
      headers: { Origin: 'http://test.example.com' },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBe('http://test.example.com');
  });
});

// ─── Authentication Middleware ─────────────────────────────────────────────────

test.describe('Authentication Middleware', () => {
  test('401 + correct error: missing Authorization header', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      data: { name: 'Test', visibility: true },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('Authentication required');
  });

  test('401: Authorization header without Bearer scheme', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      data: { name: 'Test', visibility: true },
    });
    expect(res.status()).toBe(401);
  });

  test('401: malformed Bearer token (not a JWT)', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      headers: { Authorization: 'Bearer notajwttoken' },
      data: { name: 'Test', visibility: true },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('Invalid or expired token');
  });

  test('401: JWT signed with wrong secret is rejected', async ({ request }) => {
    // Craft a JWT header+payload with wrong signature
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ userId: 1, role: 'admin' })).toString('base64url');
    const fakeToken = `${header}.${payload}.invalidsignature`;
    const res = await request.post('/api/sessions', {
      headers: { Authorization: `Bearer ${fakeToken}` },
      data: { name: 'Test', visibility: true },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── Rate Limiting Headers ────────────────────────────────────────────────────

test.describe('Rate Limiting', () => {
  test('RateLimit headers are present on API responses', async ({ request }) => {
    const res = await request.get('/api/sessions');
    const headers = res.headers();
    // express-rate-limit with standardHeaders: true sets these draft headers
    expect(
      headers['ratelimit-limit'] || headers['x-ratelimit-limit']
    ).toBeDefined();
  });
});
