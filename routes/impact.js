/**
 * @fileoverview Environmental Impact & Carbon Reduction Ledger Router
 * Tracks completed user actions, calculates cumulative CO2 emissions saved,
 * and maintains personalized sustainability records with Python FastAPI integration.
 */

const express = require('express');
const { getDb } = require('../db/database');
const auth = require('../middleware/auth');
const { callPythonService } = require('../services/pythonClient');
const { DEFAULT_IMPACT_DAYS, MAX_IMPACT_DAYS } = require('../config/constants');

const router = express.Router();
router.use(auth);

/**
 * Compute local deterministic impact metrics when Python microservice is offline.
 * @param {string} action - Sustainability action description
 * @param {string} category - Action category (Transport, Home, Kitchen, Lifestyle)
 * @param {number} co2Saved - Estimated CO2 reduction in kilograms
 * @param {number|null} aqi - Active localized AQI
 * @returns {object} Calculated metrics object
 */
function computeLocalImpact(action, category, co2Saved, aqi) {
  const numericCo2 = Math.max(0, Number(co2Saved) || 0);
  const safeAqi = Math.max(15, Number(aqi) || 120);
  const pm25Avoided = parseFloat(((safeAqi * 0.45) * 0.15).toFixed(1));
  const trees = parseFloat((numericCo2 / 21.7).toFixed(2));
  return {
    action,
    category: category || 'Lifestyle',
    co2_saved_kg: numericCo2,
    pm25_avoided_ug: pm25Avoided,
    trees_equivalent: trees,
    health_benefit: safeAqi > 200 ? 'Avoided high alveolar inflammatory cytokine induction' : 'Decreased airway oxidative burden',
    air_quality_impact: numericCo2 > 2 ? '-20% localized emission contribution' : '-10% emission contribution',
    source: 'local_node_fallback',
  };
}

/**
 * Fetch impact analytics from Python microservice with graceful local fallback.
 * @param {string} action - Sustainability action description
 * @param {string} category - Action category
 * @param {number} co2Saved - Estimated CO2 reduction in kg
 * @param {number|null} aqi - Active localized AQI
 * @returns {Promise<object>} Analytics object
 */
async function resolveImpactAnalytics(action, category, co2Saved, aqi) {
  const pyResult = await callPythonService('/calculate-impact', {
    action,
    category: category || 'Lifestyle',
    co2_saved: co2Saved,
    aqi: aqi || 150,
  });
  if (pyResult && pyResult.impact) {
    return { ...pyResult.impact, source: 'python_service' };
  }
  return computeLocalImpact(action, category, co2Saved, aqi);
}

// POST /api/impact/calculate — estimate impact before logging
router.post('/calculate', async (req, res) => {
  try {
    const { action, category, co2_saved, aqi } = req.body || {};
    const cleanAction = typeof action === 'string' && action.trim() ? action.trim() : 'Sustainable habit';
    const numericCO2 = typeof co2_saved === 'number' ? Math.max(0, co2_saved) : parseFloat(co2_saved) || 0;
    const analytics = await resolveImpactAnalytics(cleanAction, category, numericCO2, aqi);
    res.json({ analytics });
  } catch (err) {
    console.error('Calculate impact error:', err);
    res.status(500).json({ error: 'Failed to calculate impact' });
  }
});

// POST /api/impact — log a user action
router.post('/', async (req, res) => {
  try {
    const { action, category, co2_saved, aqi_impact, aqi } = req.body || {};
    const cleanAction = typeof action === 'string' ? action.trim() : '';
    if (!cleanAction) {
      return res.status(400).json({ error: 'action is required' });
    }

    const numericCO2 = typeof co2_saved === 'number' ? Math.max(0, co2_saved) : parseFloat(co2_saved) || 0;
    const analytics = await resolveImpactAnalytics(cleanAction, category, numericCO2, aqi);

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO impact_log (user_id, action, category, co2_saved, aqi_impact)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, cleanAction, category || 'Lifestyle', numericCO2, aqi_impact || analytics.air_quality_impact);

    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Impact logged successfully',
      analytics,
    });
  } catch (err) {
    console.error('Log impact error:', err);
    res.status(500).json({ error: 'Failed to record impact action' });
  }
});

// GET /api/impact — get user's impact log
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || DEFAULT_IMPACT_DAYS, 1), MAX_IMPACT_DAYS);

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
