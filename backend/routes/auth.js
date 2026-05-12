const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { signToken } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

router.post(
  '/register',
  body('username')
    .isAlphanumeric()
    .isLength({ min: 3, max: 50 })
    .trim()
    .escape(),
  body('password').isLength({ min: 10, max: 128 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { username, password } = req.body;
    try {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const result = await db.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
        [username, passwordHash, 'user'] // role always forced to 'user' on self-registration
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Username already taken' });
      }
      console.error('Register error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/login',
  body('username').trim().escape().notEmpty(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { username, password } = req.body;
    try {
      const result = await db.query(
        'SELECT id, username, password_hash, role FROM users WHERE username = $1',
        [username]
      );
      const user = result.rows[0];

      // Use constant-time comparison to prevent timing attacks (bcrypt provides this).
      // Always run bcrypt even if user is not found to prevent user enumeration via timing.
      const dummyHash = '$2b$12$invalidhashpaddingtomakeconstanttimexxxxxxxxxxxxxxxxxxx';
      const hashToCompare = user ? user.password_hash : dummyHash;
      const valid = await bcrypt.compare(password, hashToCompare);

      if (!user || !valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = signToken(
        { userId: user.id, username: user.username, role: user.role },
        JWT_EXPIRY
      );
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
