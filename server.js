require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Initialize DB on startup
const { getDb } = require('./db/database');
getDb();

const app = express();
const PORT = process.env.PORT || 3000;

// ============ SECURITY MIDDLEWARE ============
app.use(helmet({
  contentSecurityPolicy: false,  // Allow inline scripts in our HTML
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : '*',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 mins
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// ============ SERVE STATIC FRONTEND ============
app.use(express.static(path.join(__dirname, 'public')));

// ============ API ROUTES ============
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/aqi',     require('./routes/aqi'));
app.use('/api/chat',    require('./routes/chat'));
app.use('/api/impact',  require('./routes/impact'));

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    app: 'AirGuard API',
    timestamp: new Date().toISOString(),
  });
});

// ============ SPA FALLBACK ============
// All non-API routes → serve index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ GLOBAL ERROR HANDLER ============
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ START ============
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
