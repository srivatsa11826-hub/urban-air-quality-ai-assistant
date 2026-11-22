/**
 * @fileoverview AQI Routing & Dual Environmental Standards Engine
 * Supports Indian CPCB NAQI (0–500 scale) and WHO 2021 24-hour guidelines with
 * SQLite caching (15-min TTL), live WAQI integration, and resilient city baselines.
 */

const express = require('express');
const fetch = require('node-fetch');
const { getDb, getCachedAqi, setCachedAqi } = require('../db/database');
const auth = require('../middleware/auth');
const { callPythonService } = require('../services/pythonClient');
const {
  CACHE_TTL_MS,
  CPCB_CATEGORIES,
  CPCB_THRESHOLDS,
  WHO_THRESHOLDS,
  AQI_CATEGORIES,
  CITY_BASELINES,
  DEFAULT_HISTORY_DAYS,
  MAX_HISTORY_DAYS,
} = require('../config/constants');

const router = express.Router();
router.use(auth);

// ============================================================
//  Standards Assessment Functions
// ============================================================

/**
 * Determine the official CPCB NAQI category for a given AQI value.
 * @param {number|string} aqi - Atmospheric Air Quality Index
 * @returns {object} CPCB category descriptor
 */
function getCPCBCategory(aqi) {
  const numericAqi = Math.max(0, Number(aqi) || 0);
  return CPCB_CATEGORIES.find(c => numericAqi <= c.max) || CPCB_CATEGORIES[CPCB_CATEGORIES.length - 1];
}

/**
 * Evaluate a single pollutant against WHO 2021 24-hour guidelines.
 * @param {string} pollutant - Pollutant key (pm25, pm10, no2, o3, etc.)
 * @param {number|string} value - Current measured concentration in µg/m³
 * @returns {object|null} WHO assessment object with multiplier and compliance status
 */
function getWHOAssessment(pollutant, value) {
  const key = String(pollutant || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const limit = WHO_THRESHOLDS[key];
  if (limit == null || value == null) return null;

  const numericVal = parseFloat(value) || 0;
  const multiplier = parseFloat((numericVal / limit).toFixed(1));
  const exceeded = numericVal > limit;

  return {
    pollutant: key,
    value: numericVal,
    limit,
    multiplier,
    exceeded,
    label: exceeded ? `${multiplier}x WHO limit` : `Within WHO limit (${multiplier}x)`,
    status: exceeded ? (multiplier >= 4 ? 'severe' : multiplier >= 2 ? 'high' : 'moderate') : 'compliant',
  };
}

/**
 * Legacy US EPA standard classification helper for backwards compatibility.
 * @param {number|string} aqi - AQI numeric value
 * @returns {object} Legacy category object
 */
function getCategory(aqi) {
  const numericAqi = Number(aqi) || 0;
  return AQI_CATEGORIES.find(c => numericAqi <= c.max) || AQI_CATEGORIES[AQI_CATEGORIES.length - 1];
}

/**
 * Classify a telemetry reading against either CPCB or WHO standards.
 * @param {object} reading - Environmental telemetry reading object
 * @param {string} standard - 'cpcb' | 'who'
 * @returns {object} Classification summary
 */
function classifyReading(reading, standard = 'cpcb') {
  if (standard === 'who') {
    const pm25Assess = getWHOAssessment('pm25', reading?.pm25);
    return {
      standard: 'who',
      pm25: pm25Assess,
      pm10: getWHOAssessment('pm10', reading?.pm10),
      no2:  getWHOAssessment('no2',  reading?.no2),
      o3:   getWHOAssessment('o3',   reading?.o3),
      summary: pm25Assess?.exceeded ? `${pm25Assess.multiplier}x WHO 24h Guideline` : 'Within WHO 2021 Guidelines',
    };
  }

  const cpcbCat = getCPCBCategory(reading?.aqi);
  return {
    standard: 'cpcb',
    category: cpcbCat,
    thresholds: CPCB_THRESHOLDS,
    summary: `${cpcbCat.label} (CPCB NAQI ${reading?.aqi || 0})`,
  };
}

// ============================================================
//  Simulation & Telemetry Helpers (<35 lines each)
// ============================================================

/**
 * Look up calibrated baseline for a city or generate a reasonable fallback.
 * @param {string} city - Name of city
 * @returns {object} Baseline configuration
 */
function resolveCityBaseline(city) {
  const key = String(city || '').toLowerCase().replace(/[\s\-_]+/g, '');
  return CITY_BASELINES[key] || {
    base: 160 + Math.round(Math.random() * 80),
    pm25: 85 + Math.round(Math.random() * 50),
    pm10: 130 + Math.round(Math.random() * 70),
    no2:  42 + Math.round(Math.random() * 30),
    temp: `${16 + Math.round(Math.random() * 12)}°C`,
    hum:  `${52 + Math.round(Math.random() * 28)}%`,
  };
}

/**
 * Add realistic variance (+- 8 units) to simulated atmospheric parameters.
 * @param {number} val - Base parameter value
 * @returns {number} Jittered parameter value
 */
function applyTelemetryJitter(val) {
  return Math.max(1, val + Math.round((Math.random() - 0.5) * 16));
}

/**
 * Build a complete telemetry object from baseline data.
 * @param {string} cityName - Formatted city name
 * @param {object} base - City baseline parameters
 * @returns {object} Simulated telemetry reading
 */
function buildSimulatedTelemetry(cityName, base) {
  const aqiVal = applyTelemetryJitter(base.base);
  const pm25Val = applyTelemetryJitter(base.pm25);
  const pm10Val = applyTelemetryJitter(base.pm10);
  const no2Val = applyTelemetryJitter(base.no2);

  return {
    aqi: aqiVal,
    city: cityName,
    pm25: pm25Val,
    pm10: pm10Val,
    no2:  no2Val,
    o3:   32 + Math.round(Math.random() * 28),
    co:   parseFloat((0.8 + Math.random() * 1.2).toFixed(2)),
    so2:  14 + Math.round(Math.random() * 18),
    temperature: base.temp,
    humidity: base.hum,
    wind_speed: `${4 + Math.round(Math.random() * 8)} km/h`,
    dominant: 'PM2.5',
    source: 'simulated',
    cpcb: getCPCBCategory(aqiVal),
    who: {
      pm25: getWHOAssessment('pm25', pm25Val),
      pm10: getWHOAssessment('pm10', pm10Val),
      no2:  getWHOAssessment('no2',  no2Val),
      o3:   getWHOAssessment('o3',   45),
    },
  };
}

/**
 * Generate domain-accurate simulated telemetry for any city.
 * @param {string} city - Target city name
 * @returns {object} Realistic atmospheric telemetry
 */
function simulateAQI(city = 'New Delhi') {
  const safeCity = typeof city === 'string' && city.trim() ? city.trim() : 'New Delhi';
  const baseline = resolveCityBaseline(safeCity);
  return buildSimulatedTelemetry(safeCity, baseline);
}

// ============================================================
//  API Handler Sub-functions (<35 lines each)
// ============================================================

/**
 * Resolves the query or profile-backed city for a request.
 * @param {object} req - Express request
 * @param {DatabaseSync} db - Database instance
 * @returns {string|null} Clean city string or null
 */
function resolveRequestCity(req, db) {
  const profile = db.prepare('SELECT city FROM profiles WHERE user_id = ?').get(req.user.id);
  const city = req.query.city || profile?.city;
  return typeof city === 'string' && city.trim() ? city.trim() : null;
}

/**
 * Formats a cached entry with CPCB and WHO metadata.
 * @param {object} entry - Cached telemetry entry
 * @returns {object} Response JSON payload
 */
function formatCachedAqiPayload(entry) {
  const cpcbCat = getCPCBCategory(entry.aqi);
  const whoData = {
    pm25: getWHOAssessment('pm25', entry.pm25),
    pm10: getWHOAssessment('pm10', entry.pm10),
    no2:  getWHOAssessment('no2',  entry.no2),
    o3:   getWHOAssessment('o3',   entry.o3),
  };
  return {
    ...entry,
    source: 'cache',
    cached: true,
    cachedAt: entry.cachedAt,
    category: getCategory(entry.aqi),
    cpcb: cpcbCat,
    who: whoData,
    standards: {
      cpcb: cpcbCat,
      cpcbThresholds: CPCB_THRESHOLDS,
      who: whoData,
      whoThresholds: WHO_THRESHOLDS,
    },
  };
}

/**
 * Attempts to fetch live data from the World Air Quality Index (WAQI) API.
 * @param {string} city - Target city
 * @param {string} token - WAQI API token
 * @returns {Promise<object|null>} Telemetry object or null if unavailable
 */
async function fetchLiveWaqiTelemetry(city, token) {
  if (!token || token === 'your_waqi_token_here' || token === 'demo') return null;
  try {
    const url = `https://api.waqi.info/feed/${encodeURIComponent(city)}/?token=${token}`;
    const resp = await fetch(url, { timeout: 7000 });
    const data = await resp.json();
    if (data.status === 'ok' && data.data) {
      const d = data.data;
      return {
        aqi: d.aqi,
        city,
        pm25: d.iaqi?.pm25?.v ?? null,
        pm10: d.iaqi?.pm10?.v ?? null,
        no2:  d.iaqi?.no2?.v  ?? null,
        o3:   d.iaqi?.o3?.v   ?? null,
        co:   d.iaqi?.co?.v   ?? null,
        so2:  d.iaqi?.so2?.v  ?? null,
        temperature: d.iaqi?.t?.v ? `${d.iaqi.t.v}°C` : null,
        humidity:    d.iaqi?.h?.v ? `${d.iaqi.h.v}%`  : null,
        dominant: d.dominentpol || 'PM2.5',
        source: 'waqi',
      };
    }
  } catch (err) {
    console.warn('Live WAQI API fetch failed, falling back to cache/simulation:', err.message);
  }
  return null;
}

/**
 * Persists an AQI measurement to the historical readings table.
 * @param {DatabaseSync} db - Active database instance
 * @param {number} userId - Active user ID
 * @param {object} telemetry - Telemetry reading
 * @param {string} categoryLabel - Category label
 */
function persistAqiReading(db, userId, telemetry, categoryLabel) {
  try {
    db.prepare(`
      INSERT INTO aqi_readings
        (user_id, city, aqi, pm25, pm10, no2, o3, co, so2, temperature, humidity, dominant, category, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, telemetry.city, telemetry.aqi,
      telemetry.pm25, telemetry.pm10, telemetry.no2, telemetry.o3,
      telemetry.co, telemetry.so2, telemetry.temperature, telemetry.humidity,
      telemetry.dominant, categoryLabel, telemetry.source
    );
  } catch (_) {}
}

/**
 * Resolves fresh, stale-cached, or simulated telemetry for a city.
 * @param {string} city - City name
 * @param {DatabaseSync} db - Database instance
 * @returns {Promise<object>} Telemetry reading
 */
async function resolveCurrentTelemetry(city, db) {
  let telemetry = await fetchLiveWaqiTelemetry(city, process.env.WAQI_API_TOKEN);
  if (!telemetry) {
    const staleCached = getCachedAqi(city, null, db);
    if (staleCached) {
      telemetry = { ...staleCached, source: 'stale-cache', isStale: true };
    } else {
      telemetry = simulateAQI(city);
    }
  }
  return telemetry;
}

/**
 * Attaches CPCB, WHO, and legacy standards to telemetry object.
 * @param {object} telemetry - Telemetry data
 * @param {object} cat - Category descriptor
 * @returns {object} Formatted response payload
 */
function attachStandardsPayload(telemetry, cat) {
  const cpcbCat = getCPCBCategory(telemetry.aqi);
  const whoData = {
    pm25: getWHOAssessment('pm25', telemetry.pm25),
    pm10: getWHOAssessment('pm10', telemetry.pm10),
    no2:  getWHOAssessment('no2',  telemetry.no2),
    o3:   getWHOAssessment('o3',   telemetry.o3),
  };
  return {
    ...telemetry,
    category: cat,
    cpcb: cpcbCat,
    who: whoData,
    standards: {
      cpcb: cpcbCat,
      cpcbThresholds: CPCB_THRESHOLDS,
      who: whoData,
      whoThresholds: WHO_THRESHOLDS,
    },
    cached: telemetry.source === 'cache' || telemetry.source === 'stale-cache',
  };
}

// ============================================================
//  Routes
// ============================================================

// GET /api/aqi/current
router.get('/current', async (req, res) => {
  try {
    const db = getDb();
    const city = resolveRequestCity(req, db);
    if (!city) {
      return res.status(400).json({ error: 'City required — set up your profile first' });
    }

    const cached = getCachedAqi(city, CACHE_TTL_MS, db);
    if (cached) return res.json(formatCachedAqiPayload(cached));

    const telemetry = await resolveCurrentTelemetry(city, db);
    setCachedAqi(city, telemetry, db);
    const cat = getCategory(telemetry.aqi);
    persistAqiReading(db, req.user.id, telemetry, cat.label);

    const basePayload = attachStandardsPayload(telemetry, cat);
    const pythonAnalytics = await callPythonService('/analyze', telemetry);
    if (pythonAnalytics) {
      basePayload.analytics = pythonAnalytics;
      basePayload.microservice = 'python-fastapi';
    }

    res.json(basePayload);
  } catch (err) {
    console.error('AQI current error:', err);
    res.status(500).json({ error: 'Failed to fetch AQI data' });
  }
});

/**
 * Local 6-hour diurnal forecast generator for zero-downtime offline fallback.
 * @param {number} aqi - Current AQI
 * @param {number} pm25 - Current PM2.5
 * @returns {Array<object>} 6-hour forecast curve
 */
function generateLocalDiurnalForecast(aqi, pm25) {
  const curve = [];
  const factors = [1.25, 0.95, 0.76, 0.92, 1.18, 1.10];
  const now = new Date();
  for (let i = 1; i <= 6; i++) {
    const factor = factors[(now.getHours() + i) % 6];
    const pAqi = Math.max(15, Math.round(aqi * factor));
    const pPm25 = Math.max(5, parseFloat((pm25 * factor).toFixed(1)));
    let activityState = 'Indoor Quarantine Recommended';
    if (pAqi <= 100) activityState = 'Optimal for Outdoor Errands';
    else if (pAqi <= 200) activityState = 'Moderate Caution for Cardio';

    curve.push({
      hour_offset: i,
      target_hour: `${((now.getHours() + i) % 12) || 12}:00 ${((now.getHours() + i) % 24) >= 12 ? 'PM' : 'AM'}`,
      predicted_aqi: pAqi,
      predicted_pm25: pPm25,
      diurnal_factor: factor,
      activity_state: activityState,
      category: getCPCBCategory(pAqi).label,
    });
  }
  return curve;
}

// GET /api/aqi/forecast
router.get('/forecast', async (req, res) => {
  try {
    const db = getDb();
    const city = resolveRequestCity(req, db) || 'New Delhi';
    const latest = db.prepare('SELECT aqi, pm25 FROM aqi_readings WHERE user_id = ? AND city = ? ORDER BY recorded_at DESC LIMIT 1').get(req.user.id, city) || simulateAQI(city);

    const pyForecast = await callPythonService('/forecast', {
      city,
      aqi: latest.aqi,
      pm25: latest.pm25,
    });

    if (pyForecast && pyForecast.forecast) {
      return res.json({ ...pyForecast, source: 'python-microservice' });
    }

    const localForecast = generateLocalDiurnalForecast(latest.aqi, latest.pm25 || 85);
    res.json({
      city,
      current_aqi: latest.aqi,
      current_pm25: latest.pm25,
      forecast_hours: 6,
      forecast: localForecast,
      source: 'local-diurnal-fallback',
    });
  } catch (err) {
    console.error('AQI forecast error:', err);
    res.status(500).json({ error: 'Failed to generate forecast' });
  }
});

// GET /api/aqi/history
router.get('/history', (req, res) => {
  try {
    const db = getDb();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || DEFAULT_HISTORY_DAYS, 1), MAX_HISTORY_DAYS);
    const profile = db.prepare('SELECT city FROM profiles WHERE user_id = ?').get(req.user.id);
    const readings = db.prepare(`
      SELECT aqi, pm25, pm10, category, recorded_at FROM aqi_readings
      WHERE user_id = ? AND city = ?
        AND datetime(recorded_at) > datetime('now', '-' || ? || ' days')
      ORDER BY recorded_at ASC
    `).all(req.user.id, profile?.city || '', days);
    res.json({ readings, city: profile?.city });
  } catch (err) {
    console.error('AQI history error:', err);
    res.status(500).json({ error: 'Failed to retrieve AQI history' });
  }
});

// GET /api/aqi/stats
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const profile = db.prepare('SELECT city FROM profiles WHERE user_id = ?').get(req.user.id);
    const stats = db.prepare(`
      SELECT ROUND(AVG(aqi),0) as avg_aqi, MAX(aqi) as max_aqi,
             MIN(aqi) as min_aqi, COUNT(*) as readings, ROUND(AVG(pm25),1) as avg_pm25
      FROM aqi_readings
      WHERE user_id = ? AND city = ?
        AND datetime(recorded_at) > datetime('now', '-30 days')
    `).get(req.user.id, profile?.city || '');
    res.json({ stats, city: profile?.city });
  } catch (err) {
    console.error('AQI stats error:', err);
    res.status(500).json({ error: 'Failed to calculate AQI statistics' });
  }
});

// Module exports for routing and automated testing
router.getCategory = getCategory;
router.getCPCBCategory = getCPCBCategory;
router.getWHOAssessment = getWHOAssessment;
router.CPCB_CATEGORIES = CPCB_CATEGORIES;
router.CPCB_THRESHOLDS = CPCB_THRESHOLDS;
router.WHO_THRESHOLDS = WHO_THRESHOLDS;
router.AQI_CATEGORIES = AQI_CATEGORIES;
router.simulateAQI = simulateAQI;
router.classifyReading = classifyReading;

module.exports = router;
