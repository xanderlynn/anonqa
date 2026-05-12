const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, verifySessionAccessToken } = require('../middleware/auth');

const router = express.Router();

// Stricter rate limit for upvote to prevent vote inflation
const upvoteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upvotes, please try again later' },
});

function isValidId(id) {
  return /^\d+$/.test(id);
}

// Returns the session row or null; used to gate access to private sessions
async function getSession(sessionId) {
  const result = await db.query(
    'SELECT id, visibility, passcode, owner_user_id FROM sessions WHERE id = $1',
    [sessionId]
  );
  return result.rows[0] || null;
}

// Checks whether a request is authorized to access a (potentially private) session.
// Access is granted if: session is public, OR requester is the session owner/admin,
// OR a valid session-scoped access token for this session is provided.
function canAccessSession(session, req) {
  if (session.visibility) return true;
  if (req.user && (req.user.role === 'admin' || req.user.userId === session.owner_user_id)) {
    return true;
  }
  const sessionToken = req.headers['x-session-token'];
  if (sessionToken && verifySessionAccessToken(sessionToken, session.id)) {
    return true;
  }
  return false;
}

function isOwnerOrAdmin(user, session) {
  return user && (user.role === 'admin' || user.userId === session.owner_user_id);
}

const QUESTION_PUBLIC_FIELDS =
  'id, session_id, content, upvotes, is_hidden, moderator_comment, action_taken, created_at';

// GET /api/sessions/:sessionId/questions
// Public sessions: anyone can read; private sessions require a session access token or ownership
router.get('/sessions/:sessionId/questions', async (req, res) => {
  const { sessionId } = req.params;
  if (!isValidId(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  // Populate req.user from Bearer token if present (optional auth)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const jwt = require('jsonwebtoken');
    try {
      req.user = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER || 'anonqa',
        audience: process.env.JWT_AUDIENCE || 'anonqa-api',
      });
    } catch {
      // Ignore invalid tokens for optional auth — they will simply not grant access
    }
  }

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (!canAccessSession(session, req)) {
      return res.status(403).json({ error: 'Access denied: session requires a valid passcode token' });
    }

    // Non-owners only see visible questions; owners/admins see all
    const showHidden = isOwnerOrAdmin(req.user, session);
    const query = showHidden
      ? `SELECT ${QUESTION_PUBLIC_FIELDS} FROM questions WHERE session_id = $1 ORDER BY upvotes DESC`
      : `SELECT ${QUESTION_PUBLIC_FIELDS} FROM questions WHERE session_id = $1 AND is_hidden = false ORDER BY upvotes DESC`;

    const result = await db.query(query, [sessionId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Get questions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sessions/:sessionId/questions — submit a question (respects session access control)
router.post(
  '/sessions/:sessionId/questions',
  body('content').isString().isLength({ min: 1, max: 1000 }).trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { sessionId } = req.params;
    if (!isValidId(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    // Optional auth — populate req.user if Bearer token provided
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      try {
        req.user = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET, {
          algorithms: ['HS256'],
          issuer: process.env.JWT_ISSUER || 'anonqa',
          audience: process.env.JWT_AUDIENCE || 'anonqa-api',
        });
      } catch {
        // Non-fatal — treat as anonymous
      }
    }

    const { content } = req.body;
    try {
      const session = await getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      if (!canAccessSession(session, req)) {
        return res.status(403).json({ error: 'Access denied: session requires a valid passcode token' });
      }

      const result = await db.query(
        `INSERT INTO questions (session_id, content, upvotes, is_hidden)
         VALUES ($1, $2, 0, false)
         RETURNING ${QUESTION_PUBLIC_FIELDS}`,
        [sessionId, content]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('Add question error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/questions/:questionId/upvote — public but rate limited
router.post('/questions/:questionId/upvote', upvoteLimiter, async (req, res) => {
  const { questionId } = req.params;
  if (!isValidId(questionId)) {
    return res.status(400).json({ error: 'Invalid question ID' });
  }
  try {
    const result = await db.query(
      `UPDATE questions SET upvotes = upvotes + 1
       WHERE id = $1 AND is_hidden = false
       RETURNING ${QUESTION_PUBLIC_FIELDS}`,
      [questionId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Upvote error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/questions/:questionId/toggle-visibility — session owner or admin only
router.post('/questions/:questionId/toggle-visibility', authenticate, async (req, res) => {
  const { questionId } = req.params;
  if (!isValidId(questionId)) {
    return res.status(400).json({ error: 'Invalid question ID' });
  }
  try {
    const qResult = await db.query('SELECT session_id FROM questions WHERE id = $1', [questionId]);
    if (!qResult.rows.length) {
      return res.status(404).json({ error: 'Question not found' });
    }
    const session = await getSession(qResult.rows[0].session_id);
    if (!isOwnerOrAdmin(req.user, session)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await db.query(
      `UPDATE questions SET is_hidden = NOT is_hidden WHERE id = $1 RETURNING ${QUESTION_PUBLIC_FIELDS}`,
      [questionId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Toggle question visibility error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/questions/:questionId/add-moderator-comment — session owner or admin only
router.post(
  '/questions/:questionId/add-moderator-comment',
  authenticate,
  body('comment').isString().isLength({ min: 1, max: 2000 }).trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { questionId } = req.params;
    if (!isValidId(questionId)) {
      return res.status(400).json({ error: 'Invalid question ID' });
    }
    const { comment } = req.body;
    try {
      const qResult = await db.query('SELECT session_id FROM questions WHERE id = $1', [questionId]);
      if (!qResult.rows.length) {
        return res.status(404).json({ error: 'Question not found' });
      }
      const session = await getSession(qResult.rows[0].session_id);
      if (!isOwnerOrAdmin(req.user, session)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const result = await db.query(
        `UPDATE questions SET moderator_comment = $1 WHERE id = $2 RETURNING ${QUESTION_PUBLIC_FIELDS}`,
        [comment, questionId]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Add moderator comment error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/questions/:questionId/take-action — session owner or admin only
router.post(
  '/questions/:questionId/take-action',
  authenticate,
  body('action').isString().isLength({ min: 1, max: 500 }).trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { questionId } = req.params;
    if (!isValidId(questionId)) {
      return res.status(400).json({ error: 'Invalid question ID' });
    }
    const { action } = req.body;
    try {
      const qResult = await db.query('SELECT session_id FROM questions WHERE id = $1', [questionId]);
      if (!qResult.rows.length) {
        return res.status(404).json({ error: 'Question not found' });
      }
      const session = await getSession(qResult.rows[0].session_id);
      if (!isOwnerOrAdmin(req.user, session)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const result = await db.query(
        `UPDATE questions SET action_taken = $1 WHERE id = $2 RETURNING ${QUESTION_PUBLIC_FIELDS}`,
        [action, questionId]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Take action error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
