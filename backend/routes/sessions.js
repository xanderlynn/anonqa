const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, requireRole, verifySessionAccessToken, signToken } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const SESSION_TOKEN_EXPIRY = '4h';

function isValidId(id) {
  return /^\d+$/.test(id);
}

// Never expose the passcode hash in any response
const SESSION_PUBLIC_FIELDS = 'id, name, visibility, owner_user_id, created_at';

async function fetchSession(sessionId) {
  const result = await db.query(
    `SELECT ${SESSION_PUBLIC_FIELDS}, passcode FROM sessions WHERE id = $1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

function isOwnerOrAdmin(user, session) {
  return user && (user.role === 'admin' || user.userId === session.owner_user_id);
}

// GET /api/sessions — public, but only returns public sessions (no passcode hash ever returned)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ${SESSION_PUBLIC_FIELDS} FROM sessions WHERE visibility = true ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sessions — create a session, requires authentication
router.post(
  '/',
  authenticate,
  body('name').isString().isLength({ min: 1, max: 255 }).trim().escape(),
  body('visibility').isBoolean(),
  body('passcode').optional({ nullable: true }).isString().isLength({ min: 6, max: 128 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { name, visibility, passcode } = req.body;
    try {
      const hashedPasscode = passcode ? await bcrypt.hash(passcode, BCRYPT_ROUNDS) : null;
      const result = await db.query(
        `INSERT INTO sessions (name, visibility, passcode, owner_user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING ${SESSION_PUBLIC_FIELDS}`,
        [name, visibility, hashedPasscode, req.user.userId]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('Create session error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/sessions/:sessionId/verify-passcode — exchange passcode for a session-scoped access token
router.post(
  '/:sessionId/verify-passcode',
  body('passcode').isString().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { sessionId } = req.params;
    if (!isValidId(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    const { passcode } = req.body;
    try {
      const session = await fetchSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      if (!session.passcode) {
        return res.status(400).json({ error: 'This session does not require a passcode' });
      }
      const valid = await bcrypt.compare(passcode, session.passcode);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid passcode' });
      }
      const token = signToken(
        { type: 'session-access', sessionId: parseInt(sessionId, 10) },
        SESSION_TOKEN_EXPIRY
      );
      res.json({ sessionAccessToken: token });
    } catch (err) {
      console.error('Verify passcode error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/sessions/:sessionId/toggle-visibility — owner or admin only
router.post('/:sessionId/toggle-visibility', authenticate, async (req, res) => {
  const { sessionId } = req.params;
  if (!isValidId(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }
  try {
    const session = await fetchSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (!isOwnerOrAdmin(req.user, session)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await db.query(
      `UPDATE sessions SET visibility = NOT visibility WHERE id = $1 RETURNING ${SESSION_PUBLIC_FIELDS}`,
      [sessionId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Toggle session visibility error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sessions/:sessionId/set-passcode — owner or admin only
router.post(
  '/:sessionId/set-passcode',
  authenticate,
  body('passcode').isString().isLength({ min: 6, max: 128 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { sessionId } = req.params;
    if (!isValidId(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    const { passcode } = req.body;
    try {
      const session = await fetchSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      if (!isOwnerOrAdmin(req.user, session)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const hashedPasscode = await bcrypt.hash(passcode, BCRYPT_ROUNDS);
      const result = await db.query(
        `UPDATE sessions SET passcode = $1 WHERE id = $2 RETURNING ${SESSION_PUBLIC_FIELDS}`,
        [hashedPasscode, sessionId]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Set passcode error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;