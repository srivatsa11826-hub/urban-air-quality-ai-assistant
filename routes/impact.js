const express = require('express');
const { getDb } = require('../db/database');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// POST /api/impact — log a user action
router.post('/', (req, res) => {
  try {
    const { action, category, co2_saved, aqi_impact } = req.body || {};
    const cleanAction = typeof action === 'string' ? action.trim() : '';
    if (!cleanAction) {
      return res.status(400).json({ error: 'action is required' });
    }

    const numericCO2 = typeof co2_saved === 'number' ? Math.max(0, co2_saved) : parseFloat(co2_saved) || 0;

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO impact_log (user_id, action, category, co2_saved, aqi_impact)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, cleanAction, category || 'Lifestyle', numericCO2, aqi_impact || null);

    res.status(201).json({ id: result.lastInsertRowid, message: 'Impact logged successfully' });
  } catch (err) {
    console.error('Log impact error:', err);
    res.status(500).json({ error: 'Failed to record impact action' });
  }
});

// GET /api/impact — get user's impact log
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

    const logs = db.prepare(`
      SELECT * FROM impact_log
      WHERE user_id = ?
        AND datetime(logged_at) > datetime('now', '-' || ? || ' days')
      ORDER BY logged_at DESC
      LIMIT 100
    `).all(req.user.id, days);

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_actions,
        ROUND(COALESCE(SUM(co2_saved), 0), 2) as total_co2_saved,
        COUNT(DISTINCT category) as categories
      FROM impact_log
      WHERE user_id = ?
    `).get(req.user.id);

    res.json({ logs, totals });
  } catch (err) {
    console.error('Get impact error:', err);
    res.status(500).json({ error: 'Failed to retrieve impact logs' });
  }
});

module.exports = router;
