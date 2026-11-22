/**
 * @fileoverview User Household Profile Router
 * Stores and updates city, family vulnerability settings, commuting habits,
 * budget preferences, and custom Gemini API keys for environmental calibration.
 */

const express = require('express');
const { getDb } = require('../db/database');
const auth = require('../middleware/auth');
const {
  DEFAULT_COUNTRY,
  DEFAULT_FAMILY_SIZE,
  DEFAULT_HEALTH_CONCERNS,
  DEFAULT_TRANSPORT,
  DEFAULT_WORK_STYLE,
  DEFAULT_BUDGET,
} = require('../config/constants');

const router = express.Router();
router.use(auth);

/**
 * Validates and sanitizes incoming profile payload.
 * @param {object} body - Request body
 * @returns {object|null} Sanitized profile parameters or null if invalid
 */
function sanitizeProfileInput(body) {
  const { city, country, lat, lon, family_size, health_concerns, transport, work_style, budget, specific_concerns, gemini_api_key } = body || {};
  const cleanCity = typeof city === 'string' ? city.trim() : '';
  if (!cleanCity) return null;

  return {
    city: cleanCity,
    country: country || DEFAULT_COUNTRY,
    lat: lat || null,
    lon: lon || null,
    family_size: family_size || DEFAULT_FAMILY_SIZE,
    health_concerns: health_concerns || DEFAULT_HEALTH_CONCERNS,
    transport: transport || DEFAULT_TRANSPORT,
    work_style: work_style || DEFAULT_WORK_STYLE,
    budget: budget || DEFAULT_BUDGET,
    specific_concerns: specific_concerns || null,
    gemini_api_key: gemini_api_key || null,
  };
}

/**
 * Upsert sanitized profile in SQLite database.
 * @param {DatabaseSync} db - Active database connection
 * @param {number} userId - Active user ID
 * @param {object} p - Sanitized profile data
 */
function upsertProfile(db, userId, p) {
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
    userId, p.city, p.country, p.lat, p.lon,
    p.family_size, p.health_concerns, p.transport, p.work_style,
    p.budget, p.specific_concerns, p.gemini_api_key
  );
}

// GET /api/profile
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
    res.json({ profile: profile || null });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

// PUT /api/profile
router.put('/', (req, res) => {
  try {
    const sanitized = sanitizeProfileInput(req.body);
    if (!sanitized) {
      return res.status(400).json({ error: 'City is required' });
    }

    const db = getDb();
    upsertProfile(db, req.user.id, sanitized);
    const updated = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
    res.json({ profile: updated });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// GET /api/profile/stats
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const stats = {
      total_chats: db.prepare('SELECT COUNT(*) as c FROM chat_sessions WHERE user_id = ?').get(req.user.id)?.c || 0,
      total_messages: db.prepare(`
        SELECT COUNT(*) as c FROM chat_messages cm
        JOIN chat_sessions cs ON cm.session_id = cs.id
        WHERE cs.user_id = ?
      `).get(req.user.id)?.c || 0,
      total_aqi_readings: db.prepare('SELECT COUNT(*) as c FROM aqi_readings WHERE user_id = ?').get(req.user.id)?.c || 0,
      bookmarked_tips: db.prepare('SELECT COUNT(*) as c FROM recommendations WHERE user_id = ? AND is_bookmarked = 1').get(req.user.id)?.c || 0,
      co2_saved: db.prepare('SELECT COALESCE(SUM(co2_saved),0) as s FROM impact_log WHERE user_id = ?').get(req.user.id)?.s || 0,
      avg_aqi: db.prepare('SELECT ROUND(AVG(aqi),0) as a FROM aqi_readings WHERE user_id = ?').get(req.user.id)?.a || null,
    };
    res.json(stats);
  } catch (err) {
    console.error('Profile stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

module.exports = router;
