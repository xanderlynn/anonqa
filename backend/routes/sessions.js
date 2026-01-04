const express = require('express');
const db = require('../config/db');
const router = express.Router();

// Get all sessions
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sessions');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new session
router.post('/', async (req, res) => {
  const { name, visibility, passcode } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO sessions (name, visibility, passcode) VALUES ($1, $2, $3) RETURNING *',
      [name, visibility, passcode]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle session visibility
router.post('/:sessionId/toggle-visibility', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const result = await db.query(
      'UPDATE sessions SET visibility = NOT visibility WHERE id = $1 RETURNING *',
      [sessionId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set or update session passcode
router.post('/:sessionId/set-passcode', async (req, res) => {
  const { sessionId } = req.params;
  const { passcode } = req.body;
  try {
    const result = await db.query(
      'UPDATE sessions SET passcode = $1 WHERE id = $2 RETURNING *',
      [passcode, sessionId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;