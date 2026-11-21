const express = require('express');
const fetch = require('node-fetch');
const { getDb } = require('../db/database');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

const AQI_CATEGORIES = [
  { max: 50,  label: 'Good',                           color: '#34d399' },
  { max: 100, label: 'Moderate',                       color: '#fbbf24' },
  { max: 150, label: 'Unhealthy for Sensitive Groups', color: '#fb923c' },
  { max: 200, label: 'Unhealthy',                      color: '#f87171' },
  { max: 300, label: 'Very Unhealthy',                 color: '#c084fc' },
  { max: 500, label: 'Hazardous',                      color: '#7c3aed' },
];

function getCategory(aqi) {
  return AQI_CATEGORIES.find(c => aqi <= c.max) || AQI_CATEGORIES[AQI_CATEGORIES.length - 1];
}

// GET /api/aqi/current
router.get('/current', async (req, res) => {
  try {
    const db = getDb();
    const profile = db.prepare('SELECT city FROM profiles WHERE user_id = ?').get(req.user.id);
    const city = req.query.city || profile?.city;
    if (!city) return res.status(400).json({ error: 'City required — set up your profile first' });

    // 30-min cache check
    const cached = db.prepare(`
      SELECT * FROM aqi_readings
      WHERE user_id = ? AND city = ?
        AND datetime(recorded_at) > datetime('now', '-30 minutes')
      ORDER BY recorded_at DESC LIMIT 1
    `).get(req.user.id, city);

    if (cached) {
      return res.json({ ...cached, cached: true, category: getCategory(cached.aqi) });
    }

    // Try live WAQI API
    let aqiData = null;
    const waqiToken = process.env.WAQI_API_TOKEN;
    if (waqiToken && waqiToken !== 'your_waqi_token_here') {
      try {
        const url = `https://api.waqi.info/feed/${encodeURIComponent(city)}/?token=${waqiToken}`;
        const resp = await fetch(url, { timeout: 8000 });
        const data = await resp.json();
        if (data.status === 'ok') {
          const d = data.data;
          aqiData = {
            aqi: d.aqi, city,
            pm25: d.iaqi?.pm25?.v ?? null, pm10: d.iaqi?.pm10?.v ?? null,
            no2:  d.iaqi?.no2?.v  ?? null, o3:   d.iaqi?.o3?.v   ?? null,
            co:   d.iaqi?.co?.v   ?? null, so2:  d.iaqi?.so2?.v  ?? null,
            temperature: d.iaqi?.t?.v ? `${d.iaqi.t.v}°C` : null,
            humidity:    d.iaqi?.h?.v ? `${d.iaqi.h.v}%`  : null,
            dominant: d.dominentpol || 'PM2.5', source: 'waqi',
          };
        }
      } catch (e) { console.warn('WAQI failed, using simulation:', e.message); }
    }

    if (!aqiData) aqiData = simulateAQI(city);

    const cat = getCategory(aqiData.aqi);
    db.prepare(`
      INSERT INTO aqi_readings
        (user_id, city, aqi, pm25, pm10, no2, o3, co, so2, temperature, humidity, dominant, category, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      req.user.id, aqiData.city, aqiData.aqi,
      aqiData.pm25, aqiData.pm10, aqiData.no2, aqiData.o3,
      aqiData.co, aqiData.so2, aqiData.temperature, aqiData.humidity,
      aqiData.dominant, cat.label, aqiData.source
    );

    res.json({ ...aqiData, category: cat, cached: false });
  } catch (err) {
    console.error('AQI error:', err);
    res.status(500).json({ error: 'Failed to fetch AQI data' });
  }
});

// GET /api/aqi/history
router.get('/history', (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days) || 7;
  const profile = db.prepare('SELECT city FROM profiles WHERE user_id = ?').get(req.user.id);
  const readings = db.prepare(`
    SELECT aqi, pm25, pm10, category, recorded_at FROM aqi_readings
    WHERE user_id = ? AND city = ?
      AND datetime(recorded_at) > datetime('now', '-${days} days')
    ORDER BY recorded_at ASC
  `).all(req.user.id, profile?.city || '');
  res.json({ readings, city: profile?.city });
});

// GET /api/aqi/stats
router.get('/stats', (req, res) => {
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
});

function simulateAQI(city) {
  const cityMap = {
    'delhi':     { base: 290, pm25: 165, pm10: 230, no2: 72, temp: '14°C', hum: '72%' },
    'mumbai':    { base: 145, pm25: 68,  pm10: 112, no2: 48, temp: '28°C', hum: '78%' },
    'kolkata':   { base: 210, pm25: 118, pm10: 165, no2: 55, temp: '22°C', hum: '68%' },
    'bangalore': { base: 95,  pm25: 42,  pm10: 72,  no2: 32, temp: '22°C', hum: '58%' },
    'bengaluru': { base: 95,  pm25: 42,  pm10: 72,  no2: 32, temp: '22°C', hum: '58%' },
    'chennai':   { base: 108, pm25: 52,  pm10: 89,  no2: 38, temp: '30°C', hum: '75%' },
    'hyderabad': { base: 118, pm25: 58,  pm10: 95,  no2: 36, temp: '26°C', hum: '55%' },
    'pune':      { base: 128, pm25: 62,  pm10: 98,  no2: 40, temp: '24°C', hum: '56%' },
    'ahmedabad': { base: 168, pm25: 85,  pm10: 128, no2: 52, temp: '26°C', hum: '48%' },
    'lucknow':   { base: 258, pm25: 142, pm10: 198, no2: 68, temp: '13°C', hum: '75%' },
    'beijing':   { base: 195, pm25: 108, pm10: 158, no2: 68, temp: '5°C',  hum: '45%' },
    'shanghai':  { base: 142, pm25: 72,  pm10: 118, no2: 55, temp: '12°C', hum: '62%' },
  };
  const key = city.toLowerCase().trim().replace(/\s+/g, '');
  const d = cityMap[key] || {
    base: 160 + Math.round(Math.random() * 80),
    pm25: 85 + Math.round(Math.random() * 50),
    pm10: 130 + Math.round(Math.random() * 70),
    no2:  42 + Math.round(Math.random() * 30),
    temp: `${16 + Math.round(Math.random() * 12)}°C`,
    hum:  `${52 + Math.round(Math.random() * 28)}%`,
  };
  const jitter = n => Math.max(1, n + Math.round((Math.random() - 0.5) * 24));
  return {
    aqi: jitter(d.base), city,
    pm25: jitter(d.pm25), pm10: jitter(d.pm10),
    no2:  jitter(d.no2),  o3: 32 + Math.round(Math.random() * 28),
    co:   parseFloat((0.8 + Math.random() * 1.2).toFixed(2)),
    so2:  14 + Math.round(Math.random() * 18),
    temperature: d.temp, humidity: d.hum,
    wind_speed: `${4 + Math.round(Math.random() * 8)} km/h`,
    dominant: 'PM2.5', source: 'simulated',
  };
}

module.exports = router;
