const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Socket } = require('node:net');
const app = require('../server');
const { getDb, closeDb, getCachedAqi, setCachedAqi } = require('../db/database');
const {
  getCPCBCategory,
  getWHOAssessment,
  classifyReading,
  CPCB_THRESHOLDS,
  WHO_THRESHOLDS,
  simulateAQI
} = require('../routes/aqi');
const { generateFallbackAdvisory } = require('../routes/chat');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_airguard_jwt_secret_fallback_key';

// In-process mock dispatcher for Express testing
function makeRequest(appInstance, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve) => {
    const sock = new Socket();
    Object.defineProperty(sock, 'remoteAddress', { value: '127.0.0.1' });

    const req = new http.IncomingMessage(sock);
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost', ...headers };

    let bodyStr = '';
    if (body) {
      bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      if (!req.headers['content-type']) {
        req.headers['content-type'] = 'application/json';
      }
      req.headers['content-length'] = Buffer.byteLength(bodyStr);
    }

    const res = new http.ServerResponse(req);
    let raw = '';

    res.write = (chunk) => {
      if (chunk) raw += chunk.toString();
      return true;
    };

    res.end = (chunk) => {
      if (chunk) raw += chunk.toString();
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        parsed = raw;
      }
      resolve({
        statusCode: res.statusCode,
        status: res.statusCode,
        body: parsed,
        raw
      });
    };

    appInstance(req, res);

    if (bodyStr) {
      req.push(bodyStr);
    }
    req.push(null);
  });
}

describe('Indian CPCB NAQI & WHO 2021 Dual Standards Tests', () => {
  it('should categorize AQI accurately using official CPCB NAQI breakpoints (0-500 scale)', () => {
    // 0–50: Good
    assert.equal(getCPCBCategory(0).label, 'Good');
    assert.equal(getCPCBCategory(25).label, 'Good');
    assert.equal(getCPCBCategory(50).label, 'Good');

    // 51–100: Satisfactory
    assert.equal(getCPCBCategory(51).label, 'Satisfactory');
    assert.equal(getCPCBCategory(80).label, 'Satisfactory');
    assert.equal(getCPCBCategory(100).label, 'Satisfactory');

    // 101–200: Moderate
    assert.equal(getCPCBCategory(101).label, 'Moderate');
    assert.equal(getCPCBCategory(150).label, 'Moderate');
    assert.equal(getCPCBCategory(200).label, 'Moderate');

    // 201–300: Poor
    assert.equal(getCPCBCategory(201).label, 'Poor');
    assert.equal(getCPCBCategory(260).label, 'Poor');
    assert.equal(getCPCBCategory(300).label, 'Poor');

    // 301–400: Very Poor
    assert.equal(getCPCBCategory(301).label, 'Very Poor');
    assert.equal(getCPCBCategory(350).label, 'Very Poor');
    assert.equal(getCPCBCategory(400).label, 'Very Poor');

    // 401–500+: Severe
    assert.equal(getCPCBCategory(401).label, 'Severe');
    assert.equal(getCPCBCategory(480).label, 'Severe');
    assert.equal(getCPCBCategory(500).label, 'Severe');
    assert.equal(getCPCBCategory(700).label, 'Severe');
  });

  it('should evaluate WHO 2021 24-hour guidelines and calculate exceedance multipliers', () => {
    // PM2.5: limit is 15 µg/m³
    const pm25Exceeded = getWHOAssessment('pm25', 36);
    assert.equal(pm25Exceeded.limit, 15);
    assert.equal(pm25Exceeded.multiplier, 2.4);
    assert.equal(pm25Exceeded.exceeded, true);
    assert.ok(pm25Exceeded.label.includes('2.4x WHO limit'));

    const pm25Within = getWHOAssessment('pm25', 12);
    assert.equal(pm25Within.multiplier, 0.8);
    assert.equal(pm25Within.exceeded, false);
    assert.ok(pm25Within.label.includes('Within WHO limit'));

    // PM10: limit is 45 µg/m³
    const pm10Exceeded = getWHOAssessment('pm10', 90);
    assert.equal(pm10Exceeded.limit, 45);
    assert.equal(pm10Exceeded.multiplier, 2.0);
    assert.equal(pm10Exceeded.exceeded, true);

    // NO2: limit is 25 µg/m³
    const no2Exceeded = getWHOAssessment('no2', 65);
    assert.equal(no2Exceeded.limit, 25);
    assert.equal(no2Exceeded.multiplier, 2.6);
    assert.equal(no2Exceeded.exceeded, true);

    // O3: limit is 60 µg/m³
    const o3Within = getWHOAssessment('o3', 45);
    assert.equal(o3Within.limit, 60);
    assert.equal(o3Within.multiplier, 0.8);
    assert.equal(o3Within.exceeded, false);
  });

  it('classifyReading() should provide complete CPCB and WHO assessment structures', () => {
    const sample = { aqi: 245, pm25: 115, pm10: 160, no2: 55, o3: 40 };

    const cpcbResult = classifyReading(sample, 'cpcb');
    assert.equal(cpcbResult.standard, 'cpcb');
    assert.equal(cpcbResult.category.label, 'Poor');
    assert.equal(cpcbResult.thresholds.pm25, 60);

    const whoResult = classifyReading(sample, 'who');
    assert.equal(whoResult.standard, 'who');
    assert.equal(whoResult.pm25.exceeded, true);
    assert.equal(whoResult.pm25.multiplier, 7.7);
  });
});

describe('SQLite AQI Cache & Resilient Fallback Tests', () => {
  let memoryDb = null;

  before(() => {
    memoryDb = getDb(':memory:');
  });

  after(() => {
    if (memoryDb) {
      closeDb(memoryDb);
    }
  });

  it('getCachedAqi() should return null on cache miss', () => {
    const entry = getCachedAqi('UncachedCity', 900000, memoryDb);
    assert.equal(entry, null);
  });

  it('setCachedAqi() and getCachedAqi() should store and retrieve fresh cache entries within TTL', () => {
    const payload = {
      city: 'Chennai',
      aqi: 108,
      pm25: 52,
      pm10: 89,
      no2: 38,
      source: 'waqi'
    };

    setCachedAqi('Chennai', payload, memoryDb);

    // Retrieve fresh (15-min TTL)
    const fresh = getCachedAqi('Chennai', 900000, memoryDb);
    assert.ok(fresh, 'Fresh cache entry must be returned');
    assert.equal(fresh.city, 'Chennai');
    assert.equal(fresh.aqi, 108);
    assert.equal(fresh.isFresh, true);
    assert.ok(fresh.cachedAt > 0, 'cachedAt timestamp must exist');

    // Case-insensitivity test
    const lower = getCachedAqi('chennai', 900000, memoryDb);
    assert.ok(lower, 'Cache lookup must be case-insensitive');
    assert.equal(lower.city, 'Chennai');
  });

  it('getCachedAqi() should return null when cache entry is expired beyond TTL', () => {
    const payload = { city: 'Bengaluru', aqi: 95 };
    setCachedAqi('Bengaluru', payload, memoryDb);

    // Mock an immediate expiry test by passing a maxAge of -1 ms
    const expired = getCachedAqi('Bengaluru', -1, memoryDb);
    assert.equal(expired, null, 'Expired entry must return null when fresh check is required');
  });

  it('getCachedAqi() with null maxAgeMs should return stale cached entry for resilient fallback', () => {
    const payload = { city: 'Bengaluru', aqi: 95, pm25: 42 };
    setCachedAqi('Bengaluru', payload, memoryDb);

    // Stale retrieval ignores expiry
    const stale = getCachedAqi('Bengaluru', null, memoryDb);
    assert.ok(stale, 'Stale entry must be returned when maxAgeMs is null');
    assert.equal(stale.city, 'Bengaluru');
    assert.equal(stale.aqi, 95);
  });

  it('simulateAQI() should provide realistic baselines for major Indian cities', () => {
    const cities = ['Chennai', 'Delhi', 'Bengaluru', 'Mumbai', 'Hyderabad', 'Kolkata'];
    for (const city of cities) {
      const data = simulateAQI(city);
      assert.ok(data.aqi > 0, `${city} AQI must be positive`);
      assert.ok(data.pm25 > 0, `${city} PM2.5 must be positive`);
      assert.ok(data.pm10 > 0, `${city} PM10 must be positive`);
      assert.equal(data.source, 'simulated');
      assert.ok(data.cpcb && data.cpcb.label, `${city} must include CPCB classification`);
      assert.ok(data.who && data.who.pm25, `${city} must include WHO assessments`);
    }
  });

  it('GET /api/aqi/current should serve cached data with source: "cache" when fresh entry exists', async () => {
    const testToken = jwt.sign({ id: 1, uuid: 'user-1', email: 'test@airguard.com', name: 'Tester' }, JWT_SECRET);

    // Pre-seed cache
    const testCity = 'Mumbai';
    setCachedAqi(testCity, {
      city: testCity,
      aqi: 145,
      pm25: 68,
      pm10: 112,
      source: 'waqi'
    });

    const res = await makeRequest(app, {
      method: 'GET',
      url: `/api/aqi/current?city=${testCity}`,
      headers: { authorization: `Bearer ${testToken}` }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.city, testCity);
    assert.equal(res.body.source, 'cache');
    assert.equal(res.body.cached, true);
    assert.ok(res.body.cachedAt > 0);
    assert.ok(res.body.cpcb, 'Response must include CPCB standards');
    assert.ok(res.body.who, 'Response must include WHO standards');
  });
});

describe('Deterministic Rule-Based LLM Fallback Tests', () => {
  it('generateFallbackAdvisory() should generate clinical-grade, structured health advisory', () => {
    const profile = { city: 'New Delhi', family_size: '4', health_concerns: 'asthma' };
    const aqiData = { city: 'New Delhi', aqi: 285, pm25: 165, pm10: 220 };

    const advisory = generateFallbackAdvisory('General air quality advice', profile, aqiData);
    assert.ok(typeof advisory === 'string' && advisory.length > 150);
    assert.ok(advisory.includes('AirGuard Clinical Advisory'));
    assert.ok(advisory.includes('Impact on Your Family'));
    assert.ok(advisory.includes('Quick Win for Today'));
    assert.ok(advisory.includes('285'));
  });

  it('generateFallbackAdvisory() should detect running/exercise intent and recommend indoor workout on high AQI', () => {
    const profile = { city: 'New Delhi' };
    const aqiData = { city: 'New Delhi', aqi: 290, pm25: 170, pm10: 230 };

    const advisory = generateFallbackAdvisory('Is it safe for evening run today?', profile, aqiData);
    assert.ok(advisory.includes('Outdoor Aerobic Exercise Not Recommended'));
    assert.ok(advisory.includes('400% to 600%') || advisory.includes('ventilation'));
    assert.ok(advisory.includes('indoor'));
  });

  it('generateFallbackAdvisory() should detect child/asthma intent and provide pediatric protocols', () => {
    const profile = { city: 'Chennai', family_size: '4', health_concerns: 'asthma' };
    const aqiData = { city: 'Chennai', aqi: 185, pm25: 110, pm10: 150 };

    const advisory = generateFallbackAdvisory('How to ensure child safety and asthma prevention?', profile, aqiData);
    assert.ok(advisory.includes('Pediatric') || advisory.includes('Asthma'));
    assert.ok(advisory.includes('Children breathe'));
    assert.ok(advisory.includes('sanctuary') || advisory.includes('inhaler'));
  });

  it('generateFallbackAdvisory() should detect ventilation intent and advise on thermal inversion windows', () => {
    const profile = { city: 'Bengaluru' };
    const aqiData = { city: 'Bengaluru', aqi: 120, pm25: 65, pm10: 95 };

    const advisory = generateFallbackAdvisory('When is the best window to ventilate home?', profile, aqiData);
    assert.ok(advisory.includes('Ventilation Windows') || advisory.includes('ventilation'));
    assert.ok(advisory.includes('12:30 PM and 3:30 PM') || advisory.includes('12:30 PM'));
    assert.ok(advisory.includes('Thermal Inversion') || advisory.includes('inversion'));
  });

  it('POST /api/chat/sessions/:uuid/message should invoke rule-based fallback smoothly when Gemini is offline', async () => {
    const testToken = jwt.sign({ id: 1, uuid: 'user-1', email: 'test@airguard.com', name: 'Tester' }, JWT_SECRET);

    // Create session first
    const sessRes = await makeRequest(app, {
      method: 'POST',
      url: '/api/chat/sessions',
      headers: { authorization: `Bearer ${testToken}` },
      body: { title: 'Fallback Test Session' }
    });

    assert.equal(sessRes.status, 201);
    const sessionUuid = sessRes.body.session.uuid;

    // Send message — even without valid Gemini key, it must succeed with 200 and return rule-based fallback
    const msgRes = await makeRequest(app, {
      method: 'POST',
      url: `/api/chat/sessions/${sessionUuid}/message`,
      headers: { authorization: `Bearer ${testToken}` },
      body: { message: 'Is it safe for an evening run today in Delhi?' }
    });

    assert.equal(msgRes.status, 200, 'Chat route should return 200 using deterministic fallback');
    assert.ok(msgRes.body.message.length > 50);
    assert.equal(msgRes.body.source, 'rule-based-fallback');
    assert.equal(msgRes.body.fallback, true);
  });
});
