const express = require('express');
const { getDb } = require('../db/database');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// POST /api/impact — log a user action
router.post('/', (req, res) => {
  const { action, category, co2_saved, aqi_impact } = req.body;
  if (!action) return res.status(400).json({ error: 'action is required' });

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO impact_log (user_id, action, category, co2_saved, aqi_impact)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, action, category || null, co2_saved || 0, aqi_impact || null);

  res.status(201).json({ id: result.lastInsertRowid });
});

// GET /api/impact — get user's impact log
router.get('/', (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days) || 30;

  const logs = db.prepare(`
    SELECT * FROM impact_log
    WHERE user_id = ?
      AND datetime(logged_at) > datetime('now', '-${days} days')
    ORDER BY logged_at DESC
    LIMIT 100
  `).all(req.user.id);

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_actions,
      ROUND(SUM(co2_saved), 2) as total_co2_saved,
      COUNT(DISTINCT category) as categories
    FROM impact_log
    WHERE user_id = ?
  `).get(req.user.id);

  res.json({ logs, totals });
});

module.exports = router;
