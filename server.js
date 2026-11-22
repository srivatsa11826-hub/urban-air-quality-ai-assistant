/**
 * @fileoverview AirGuard Full-Stack Server
 * Express application entrypoint with security headers, in-memory rate limiters,
 * SQLite initialization, REST API routes, and static single-page application serving.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const {
  PAYLOAD_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  API_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_MAX,
  CHAT_RATE_LIMIT_MAX,
} = require('./config/constants');

// Initialize SQLite DB on startup
const { getDb } = require('./db/database');
getDb();

const app = express();
const PORT = process.env.PORT || 3000;

// ============ SECURITY HEADERS MIDDLEWARE ============
app.use(helmet({
  contentSecurityPolicy: false, // Handled explicitly below for fine-grained control
  crossOriginEmbedderPolicy: false,
}));

/**
 * Custom security headers ensuring strict compliance across all routes:
 * X-Content-Type-Options: nosniff
 * X-Frame-Options: DENY
 * Referrer-Policy: strict-origin-when-cross-origin
 * Content-Security-Policy: restricted self with external telemetry/AI APIs
 */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.waqi.info https://generativelanguage.googleapis.com; font-src 'self' data:;"
  );
  next();
});

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : '*',
  credentials: true,
}));

// Payload size limit restricted to 100kb for attack surface minimization
app.use(express.json({ limit: PAYLOAD_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: PAYLOAD_LIMIT }));

// ============ RATE LIMITING MIDDLEWARE ============
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: API_RATE_LIMIT_MAX,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: AUTH_RATE_LIMIT_MAX,
  message: { error: 'Too many auth attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: CHAT_RATE_LIMIT_MAX,
  message: { error: 'Too many chat requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/chat/', chatLimiter);

// ============ SERVE STATIC FRONTEND (SINGLE SOURCE OF TRUTH) ============
app.use(express.static(path.join(__dirname, 'public')));

// ============ API ROUTES ============
app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/aqi', require('./routes/aqi'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/impact', require('./routes/impact'));

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    app: 'AirGuard API',
    timestamp: new Date().toISOString(),
  });
});

// ============ SPA FALLBACK & API 404 ============
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ GLOBAL ERROR HANDLER ============
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large (max 100kb allowed)' });
  }
  console.error('Unhandled server error:', err.message || err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ START SERVER ============
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║  🌬️  AirGuard Server Started        ║
║  Port: ${PORT}                           ║
║  Mode: ${process.env.NODE_ENV || 'development'}                  ║
║  URL : http://localhost:${PORT}         ║
╚══════════════════════════════════════╝
    `);
  });
}

module.exports = app;
