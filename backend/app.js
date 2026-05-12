'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

dotenv.config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters');
  process.exit(1);
}

/**
 * Factory that creates and configures the Express application.
 * @param {object} [options]
 * @param {import('express').Router} [options.extraRoutes] - Additional routes mounted
 *   before the 404 handler (used in test environments to inject test-only endpoints).
 */
function createApp(options = {}) {
  const sessionRoutes = require('./routes/sessions');
  const questionRoutes = require('./routes/questions');
  const authRoutes = require('./routes/auth');

  const app = express();
  const isTest = process.env.NODE_ENV === 'test';

  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  app.use(helmet());

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow no-origin requests outside production (server-to-server, curl, test runners)
        if (!origin && process.env.NODE_ENV !== 'production') {
          return callback(null, true);
        }
        if (origin && allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token'],
      credentials: false,
    })
  );

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isTest ? 10000 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
  app.use(globalLimiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isTest ? 10000 : 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again later' },
  });

  app.use(express.json({ limit: '10kb' }));

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api', questionRoutes);

  // Extra routes are injected before the 404 handler (used for test-only endpoints)
  if (options.extraRoutes) {
    app.use(options.extraRoutes);
  }

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Preserve 4xx status codes from body-parser (e.g. 413 PayloadTooLarge) and similar middleware
    const status = err.status || err.statusCode;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ error: err.type || 'Request error' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = createApp;