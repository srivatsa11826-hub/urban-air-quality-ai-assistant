/**
 * @fileoverview Authentication Router
 * Handles user registration, JWT token generation, credential login,
 * authenticated session verification (/me), and password changes.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const auth = require('../middleware/auth');
const { JWT_EXPIRY, BCRYPT_ROUNDS } = require('../config/constants');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_airguard_jwt_secret_fallback_key';

/**
 * Sign a signed JSON Web Token with claims.
 * @param {object} user - User record
 * @returns {string} Signed JWT token string
 */
function signToken(user) {
  return jwt.sign(
    { id: user.id, uuid: user.uuid, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    let { name, email, password } = req.body || {};
    name = typeof name === 'string' ? name.trim() : '';
    email = typeof email === 'string' ? email.trim().toLowerCase() : '';
    password = typeof password === 'string' ? password : '';

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const uuid = uuidv4();
    const result = db.prepare('INSERT INTO users (uuid, email, password, name) VALUES (?, ?, ?, ?)').run(uuid, email, hash, name);
    const user = { id: result.lastInsertRowid, uuid, email, name };
    const token = signToken(user);

    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
    res.status(201).json({ token, user: { id: user.uuid, email, name } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    let { email, password } = req.body || {};
    email = typeof email === 'string' ? email.trim().toLowerCase() : '';
    password = typeof password === 'string' ? password : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
    const token = signToken(user);
    res.json({ token, user: { id: user.uuid, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT uuid, email, name, created_at, last_login FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (err) {
    console.error('Auth /me error:', err);
    res.status(500).json({ error: 'Failed to retrieve user data' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords required' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be 6+ characters' });
    }

    const db = getDb();
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change-password error:', err);
    res.status(500).json({ error: 'Password update failed' });
  }
});

module.exports = router;
