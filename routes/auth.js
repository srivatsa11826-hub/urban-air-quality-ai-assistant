const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, uuid: user.uuid, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'name, email, and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const uuid = uuidv4();

    const result = db.prepare(
      'INSERT INTO users (uuid, email, password, name) VALUES (?, ?, ?, ?)'
    ).run(uuid, email.toLowerCase(), hash, name);

    const user = { id: result.lastInsertRowid, uuid, email, name };
    const token = signToken(user);

    // Update last login
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
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'email and password are required' });

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.uuid, email: user.email, name: user.name }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me  (validate token & get user)
const auth = require('../middleware/auth');
router.get('/me', auth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT uuid, email, name, avatar, created_at, last_login FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// POST /api/auth/change-password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'New password must be 6+ characters' });

    const db = getDb();
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
