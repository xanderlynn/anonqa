const express = require('express');
const db = require('../config/db');
const router = express.Router();

// Get all questions for a session
router.get('/sessions/:sessionId/questions', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM questions WHERE session_id = $1 ORDER BY upvotes DESC',
      [sessionId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new question to a session
router.post('/sessions/:sessionId/questions', async (req, res) => {
  const { sessionId } = req.params;
  const { content } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO questions (session_id, content, upvotes, is_hidden) VALUES ($1, $2, 0, false) RETURNING *',
      [sessionId, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upvote a question
router.post('/questions/:questionId/upvote', async (req, res) => {
  const { questionId } = req.params;
  try {
    const result = await db.query(
      'UPDATE questions SET upvotes = upvotes + 1 WHERE id = $1 RETURNING *',
      [questionId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle question visibility
router.post('/questions/:questionId/toggle-visibility', async (req, res) => {
  const { questionId } = req.params;
  try {
    const result = await db.query(
      'UPDATE questions SET is_hidden = NOT is_hidden WHERE id = $1 RETURNING *',
      [questionId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a moderator comment
router.post('/questions/:questionId/add-moderator-comment', async (req, res) => {
  const { questionId } = req.params;
  const { comment } = req.body;
  try {
    const result = await db.query(
      'UPDATE questions SET moderator_comment = $1 WHERE id = $2 RETURNING *',
      [comment, questionId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Take action on a question
router.post('/questions/:questionId/take-action', async (req, res) => {
  const { questionId } = req.params;
  const { action } = req.body;
  try {
    const result = await db.query(
      'UPDATE questions SET action_taken = $1 WHERE id = $2 RETURNING *',
      [action, questionId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
