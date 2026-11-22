const express = require('express');
const fetch = require('node-fetch');
const { getDb, getCachedAqi, setCachedAqi } = require('../db/database');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// ============================================================
//  1. CPCB NAQI (Indian Standard: 0–500 scale)
// ============================================================
const CPCB_CATEGORIES = [
  { min: 0,   max: 50,  label: 'Good',         color: '#14532d', bg: '#dcfce7', level: 'good',         description: 'Minimal impact' },
  { min: 51,  max: 100, label: 'Satisfactory', color: '#047857', bg: '#d1fae5', level: 'satisfactory', description: 'Minor breathing discomfort to sensitive people' },
  { min: 101, max: 200, label: 'Moderate',     color: '#78350f', bg: '#fef3c7', level: 'moderate',     description: 'Breathing discomfort to people with lungs, asthma and heart disease' },
  { min: 201, max: 300, label: 'Poor',         color: '#7c2d12', bg: '#ffedd5', level: 'poor',         description: 'Breathing discomfort to most people on prolonged exposure' },
  { min: 301, max: 400, label: 'Very Poor',    color: '#7f1d1d', bg: '#fee2e2', level: 'very_poor',    description: 'Respiratory illness on prolonged exposure' },
  { min: 401, max: 500, label: 'Severe',       color: '#581c87', bg: '#f3e8ff', level: 'severe',       description: 'Affects healthy people and seriously impacts those with existing diseases' },
];

// CPCB 24-hour National Ambient Air Quality Reference Thresholds (µg/m³)
const CPCB_THRESHOLDS = {
  pm25: 60,  // 24-hour standard (µg/m³)
  pm10: 100, // 24-hour standard (µg/m³)
  no2:  80,  // 24-hour standard (µg/m³)
  o3:   100, // 8-hour standard (µg/m³)
  co:   2,   // 8-hour standard (mg/m³)
  so2:  80,  // 24-hour standard (µg/m³)
};

function getCPCBCategory(aqi) {
  const numericAqi = Math.max(0, Number(aqi) || 0);
  return CPCB_CATEGORIES.find(c => numericAqi <= c.max) || CPCB_CATEGORIES[CPCB_CATEGORIES.length - 1];
}

// ============================================================
//  2. WHO 2021 Global Air Quality Guidelines (24-hour limits)
// ============================================================
const WHO_THRESHOLDS = {
  pm25: 15,  // 24-hour guideline (µg/m³)
  pm10: 45,  // 24-hour guideline (µg/m³)
  no2:  25,  // 24-hour guideline (µg/m³)
  o3:   60,  // 8-hour peak-season guideline (µg/m³)
  co:   4,   // 24-hour guideline (mg/m³)
  so2:  40,  // 24-hour guideline (µg/m³)
};

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
    status: exceeded ? (multiplier >= 4 ? 'severe' : multiplier >= 2 ? 'high' : 'moderate') : 'compliant'
  };
}

// Legacy / US EPA standard categories (kept for complete backward compatibility with existing tests)
const AQI_CATEGORIES = [
  { max: 50,  label: 'Good',                           color: '#15803d', level: 'good' },
  { max: 100, label: 'Moderate',                       color: '#b45309', level: 'moderate' },
  { max: 150, label: 'Unhealthy for Sensitive Groups', color: '#c2410c', level: 'sensitive' },
  { max: 200, label: 'Unhealthy',                      color: '#b91c1c', level: 'unhealthy' },
  { max: 300, label: 'Very Unhealthy',                 color: '#7f1d1d', level: 'very_unhealthy' },
  { max: 500, label: 'Hazardous',                      color: '#450a0a', level: 'hazardous' },
];

function getCategory(aqi) {
  const numericAqi = Number(aqi) || 0;
  return AQI_CATEGORIES.find(c => numericAqi <= c.max) || AQI_CATEGORIES[AQI_CATEGORIES.length - 1];
}

function classifyReading(reading, standard = 'cpcb') {
  if (standard === 'who') {
    const pm25Assess = getWHOAssessment('pm25', reading?.pm25);
    const pm10Assess = getWHOAssessment('pm10', reading?.pm10);
    const no2Assess  = getWHOAssessment('no2',  reading?.no2);
    const o3Assess   = getWHOAssessment('o3',   reading?.o3);
    return {
      standard: 'who',
      pm25: pm25Assess,
      pm10: pm10Assess,
      no2:  no2Assess,
      o3:   o3Assess,
      summary: pm25Assess?.exceeded ? `${pm25Assess.multiplier}x WHO 24h Guideline` : 'Within WHO 2021 Guidelines'
    };
  }

  const cpcbCat = getCPCBCategory(reading?.aqi);
  return {
    standard: 'cpcb',
    category: cpcbCat,
    thresholds: CPCB_THRESHOLDS,
    summary: `${cpcbCat.label} (CPCB NAQI ${reading?.aqi || 0})`
  };
}

// Realistic baseline readings for major Indian cities
function simulateAQI(city = 'New Delhi') {
  const cityMap = {
    'chennai':   { base: 108, pm25: 52,  pm10: 89,  no2: 38, temp: '30°C', hum: '75%' },
    'delhi':     { base: 290, pm25: 165, pm10: 230, no2: 72, temp: '14°C', hum: '72%' },
    'newdelhi':  { base: 290, pm25: 165, pm10: 230, no2: 72, temp: '14°C', hum: '72%' },
    'bengaluru': { base: 95,  pm25: 42,  pm10: 72,  no2: 32, temp: '22°C', hum: '58%' },
    'bangalore': { base: 95,  pm25: 42,  pm10: 72,  no2: 32, temp: '22°C', hum: '58%' },
    'mumbai':    { base: 145, pm25: 68,  pm10: 112, no2: 48, temp: '28°C', hum: '78%' },
    'hyderabad': { base: 118, pm25: 58,  pm10: 95,  no2: 36, temp: '26°C', hum: '55%' },
    'kolkata':   { base: 210, pm25: 118, pm10: 165, no2: 55, temp: '22°C', hum: '68%' },
    'pune':      { base: 128, pm25: 62,  pm10: 98,  no2: 40, temp: '24°C', hum: '56%' },
    'ahmedabad': { base: 168, pm25: 85,  pm10: 128, no2: 52, temp: '26°C', hum: '48%' },
    'lucknow':   { base: 258, pm25: 142, pm10: 198, no2: 68, temp: '13°C', hum: '75%' },
    'beijing':   { base: 195, pm25: 108, pm10: 158, no2: 68, temp: '5°C',  hum: '45%' },
    'shanghai':  { base: 142, pm25: 72,  pm10: 118, no2: 55, temp: '12°C', hum: '62%' },
  };

  const safeCity = typeof city === 'string' && city.trim() ? city.trim() : 'New Delhi';
  const key = safeCity.toLowerCase().replace(/[\s\-_]+/g, '');
  const d = cityMap[key] || {
    base: 160 + Math.round(Math.random() * 80),
    pm25: 85 + Math.round(Math.random() * 50),
    pm10: 130 + Math.round(Math.random() * 70),
    no2:  42 + Math.round(Math.random() * 30),
    temp: `${16 + Math.round(Math.random() * 12)}°C`,
    hum:  `${52 + Math.round(Math.random() * 28)}%`,
  };

  const jitter = n => Math.max(1, n + Math.round((Math.random() - 0.5) * 16));
  const aqiVal = jitter(d.base);
  const pm25Val = jitter(d.pm25);
  const pm10Val = jitter(d.pm10);
  const no2Val = jitter(d.no2);
  const o3Val = 32 + Math.round(Math.random() * 28);
  const coVal = parseFloat((0.8 + Math.random() * 1.2).toFixed(2));
  const so2Val = 14 + Math.round(Math.random() * 18);

  return {
    aqi: aqiVal,
    city: safeCity,
    pm25: pm25Val,
    pm10: pm10Val,
    no2:  no2Val,
    o3:   o3Val,
    co:   coVal,
    so2:  so2Val,
    temperature: d.temp,
    humidity: d.hum,
    wind_speed: `${4 + Math.round(Math.random() * 8)} km/h`,
    dominant: 'PM2.5',
    source: 'simulated',
    cpcb: getCPCBCategory(aqiVal),
    who: {
      pm25: getWHOAssessment('pm25', pm25Val),
      pm10: getWHOAssessment('pm10', pm10Val),
      no2:  getWHOAssessment('no2',  no2Val),
      o3:   getWHOAssessment('o3',   o3Val),
    }
  };
}

// ============================================================
//  GET /api/aqi/current
// ============================================================
router.get('/current', async (req, res) => {
  try {
    const db = getDb();
    const profile = db.prepare('SELECT city FROM profiles WHERE user_id = ?').get(req.user.id);
    const city = req.query.city || profile?.city;
    if (!city || typeof city !== 'string' || !city.trim()) {
      return res.status(400).json({ error: 'City required — set up your profile first' });
    }

    const cleanCity = city.trim();

    // 1. Check SQLite aqi_cache first (15-min TTL = 900,000 ms)
    const cachedEntry = getCachedAqi(cleanCity, 900000, db);
    if (cachedEntry) {
      const cpcbCat = getCPCBCategory(cachedEntry.aqi);
      const whoData = {
        pm25: getWHOAssessment('pm25', cachedEntry.pm25),
        pm10: getWHOAssessment('pm10', cachedEntry.pm10),
        no2:  getWHOAssessment('no2',  cachedEntry.no2),
        o3:   getWHOAssessment('o3',   cachedEntry.o3),
      };
      return res.json({
        ...cachedEntry,
        source: 'cache',
        cached: true,
        cachedAt: cachedEntry.cachedAt,
        category: getCategory(cachedEntry.aqi),
        cpcb: cpcbCat,
        who: whoData,
        standards: {
          cpcb: cpcbCat,
          cpcbThresholds: CPCB_THRESHOLDS,
          who: whoData,
          whoThresholds: WHO_THRESHOLDS,
        }
      });
    }

    // 2. Fetch fresh telemetry from live external WAQI API
    let freshData = null;
    const waqiToken = process.env.WAQI_API_TOKEN;
    if (waqiToken && waqiToken !== 'your_waqi_token_here' && waqiToken !== 'demo') {
      try {
        const url = `https://api.waqi.info/feed/${encodeURIComponent(cleanCity)}/?token=${waqiToken}`;
        const resp = await fetch(url, { timeout: 7000 });
        const data = await resp.json();
        if (data.status === 'ok' && data.data) {
          const d = data.data;
          const aqiVal = d.aqi;
          const pm25Val = d.iaqi?.pm25?.v ?? null;
          const pm10Val = d.iaqi?.pm10?.v ?? null;
          const no2Val  = d.iaqi?.no2?.v  ?? null;
          const o3Val   = d.iaqi?.o3?.v   ?? null;
          freshData = {
            aqi: aqiVal,
            city: cleanCity,
            pm25: pm25Val,
            pm10: pm10Val,
            no2:  no2Val,
            o3:   o3Val,
            co:   d.iaqi?.co?.v   ?? null,
            so2:  d.iaqi?.so2?.v  ?? null,
            temperature: d.iaqi?.t?.v ? `${d.iaqi.t.v}°C` : null,
            humidity:    d.iaqi?.h?.v ? `${d.iaqi.h.v}%`  : null,
            dominant: d.dominentpol || 'PM2.5',
            source: 'waqi',
            cpcb: getCPCBCategory(aqiVal),
            who: {
              pm25: getWHOAssessment('pm25', pm25Val),
              pm10: getWHOAssessment('pm10', pm10Val),
              no2:  getWHOAssessment('no2',  no2Val),
              o3:   getWHOAssessment('o3',   o3Val),
            }
          };
        }
      } catch (e) {
        console.warn('Live WAQI API fetch failed, falling back to resilient cache/simulation:', e.message);
      }
    }

    // 3. Resilient Fallbacks: Stale cache -> Deterministic Indian baseline simulation
    if (!freshData) {
      const staleCached = getCachedAqi(cleanCity, null, db);
      if (staleCached) {
        freshData = {
          ...staleCached,
          source: 'stale-cache',
          cached: true,
          isStale: true,
          cpcb: getCPCBCategory(staleCached.aqi),
          who: {
            pm25: getWHOAssessment('pm25', staleCached.pm25),
            pm10: getWHOAssessment('pm10', staleCached.pm10),
            no2:  getWHOAssessment('no2',  staleCached.no2),
            o3:   getWHOAssessment('o3',   staleCached.o3),
          }
        };
      } else {
        freshData = simulateAQI(cleanCity);
      }
    }

    // Store in SQLite cache
    setCachedAqi(cleanCity, freshData, db);

    // Save history record
    const cat = getCategory(freshData.aqi);
    try {
      db.prepare(`
        INSERT INTO aqi_readings
          (user_id, city, aqi, pm25, pm10, no2, o3, co, so2, temperature, humidity, dominant, category, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        req.user.id, freshData.city, freshData.aqi,
        freshData.pm25, freshData.pm10, freshData.no2, freshData.o3,
        freshData.co, freshData.so2, freshData.temperature, freshData.humidity,
        freshData.dominant, cat.label, freshData.source
      );
    } catch (_) {}

    const cpcbCat = getCPCBCategory(freshData.aqi);
    const whoData = {
      pm25: getWHOAssessment('pm25', freshData.pm25),
      pm10: getWHOAssessment('pm10', freshData.pm10),
      no2:  getWHOAssessment('no2',  freshData.no2),
      o3:   getWHOAssessment('o3',   freshData.o3),
    };

    res.json({
      ...freshData,
      category: cat,
      cpcb: cpcbCat,
      who: whoData,
      standards: {
        cpcb: cpcbCat,
        cpcbThresholds: CPCB_THRESHOLDS,
        who: whoData,
        whoThresholds: WHO_THRESHOLDS,
      },
      cached: freshData.source === 'cache' || freshData.source === 'stale-cache'
    });
  } catch (err) {
    console.error('AQI current error:', err);
    res.status(500).json({ error: 'Failed to fetch AQI data' });
  }
});

// GET /api/aqi/history
router.get('/history', (req, res) => {
  try {
    const db = getDb();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
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

// Exports for tests and routing
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
