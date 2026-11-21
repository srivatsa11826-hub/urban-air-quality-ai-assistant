const express = require('express');
const { getDb } = require('../db/database');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// GET /api/profile
router.get('/', (req, res) => {
  const db = getDb();
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
  res.json({ profile: profile || null });
});

// PUT /api/profile  (upsert)
router.put('/', (req, res) => {
  const {
    city, country, lat, lon,
    family_size, health_concerns, transport, work_style,
    budget, specific_concerns, gemini_api_key
  } = req.body;

  if (!city) return res.status(400).json({ error: 'City is required' });

  const db = getDb();
  db.prepare(`
    INSERT INTO profiles
      (user_id, city, country, lat, lon, family_size, health_concerns, transport, work_style, budget, specific_concerns, gemini_api_key, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      city = excluded.city,
      country = excluded.country,
      lat = excluded.lat,
      lon = excluded.lon,
      family_size = excluded.family_size,
      health_concerns = excluded.health_concerns,
      transport = excluded.transport,
      work_style = excluded.work_style,
      budget = excluded.budget,
      specific_concerns = excluded.specific_concerns,
      gemini_api_key = COALESCE(excluded.gemini_api_key, profiles.gemini_api_key),
      updated_at = datetime('now')
  `).run(
    req.user.id,
    city, country || 'India', lat || null, lon || null,
    family_size || '3-4',
    health_concerns || 'none',
    transport || 'car',
    work_style || 'office',
    budget || 'low',
    specific_concerns || null,
    gemini_api_key || null
  );

  const updated = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
  res.json({ profile: updated });
});

// GET /api/profile/stats
router.get('/stats', (req, res) => {
  const db = getDb();
  const stats = {
    total_chats: db.prepare('SELECT COUNT(*) as c FROM chat_sessions WHERE user_id = ?').get(req.user.id).c,
    total_messages: db.prepare(`
      SELECT COUNT(*) as c FROM chat_messages cm
      JOIN chat_sessions cs ON cm.session_id = cs.id
      WHERE cs.user_id = ?
    `).get(req.user.id).c,
    total_aqi_readings: db.prepare('SELECT COUNT(*) as c FROM aqi_readings WHERE user_id = ?').get(req.user.id).c,
    bookmarked_tips: db.prepare('SELECT COUNT(*) as c FROM recommendations WHERE user_id = ? AND is_bookmarked = 1').get(req.user.id).c,
    co2_saved: db.prepare('SELECT COALESCE(SUM(co2_saved),0) as s FROM impact_log WHERE user_id = ?').get(req.user.id).s,
    avg_aqi: db.prepare('SELECT ROUND(AVG(aqi),0) as a FROM aqi_readings WHERE user_id = ?').get(req.user.id).a,
  };
  res.json(stats);
});

module.exports = router;
