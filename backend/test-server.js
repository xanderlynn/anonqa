'use strict';

// ─── Environment must be configured BEFORE any app modules are loaded ─────────
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.TEST_PORT || '5001';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars-long!!';
process.env.JWT_ISSUER = 'anonqa';
process.env.JWT_AUDIENCE = 'anonqa-api';
process.env.JWT_EXPIRY = '1h';
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000,http://test.example.com';
process.env.TRUST_PROXY = 'false';
process.env.DB_SSL = 'false';

// ─── In-memory PostgreSQL (pg-mem) ────────────────────────────────────────────
const { newDb } = require('pg-mem');

const mem = newDb();

// Minimal schema — no FK constraints to avoid pg-mem compatibility issues.
// The app's SQL queries are validated against this schema.
mem.public.none(`
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    visibility BOOLEAN NOT NULL DEFAULT true,
    passcode TEXT,
    owner_user_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE questions (
    id SERIAL PRIMARY KEY,
    session_id INT,
    content TEXT NOT NULL,
    upvotes INT DEFAULT 0,
    is_hidden BOOLEAN DEFAULT FALSE,
    moderator_comment TEXT,
    action_taken TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Patch pg.Pool BEFORE any app modules load db.js ──────────────────────────
const pgModule = require('pg');
const pgMemAdapter = mem.adapters.createPg();
pgModule.Pool = pgMemAdapter.Pool;

// ─── App factory (routes load here, picking up the patched pg.Pool) ───────────
const createApp = require('./app');
const express = require('express');

// Reset route: truncates all tables — called by tests in beforeEach
const resetRouter = express.Router();
const resetPool = new pgMemAdapter.Pool();

resetRouter.get('/__test__/health', (_req, res) => res.json({ ok: true }));

resetRouter.post('/__test__/reset', async (_req, res) => {
  try {
    await resetPool.query('DELETE FROM questions');
    await resetPool.query('DELETE FROM sessions');
    await resetPool.query('DELETE FROM users');
    res.json({ ok: true });
  } catch (err) {
    console.error('Test reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

const app = createApp({ extraRoutes: resetRouter });

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
});
