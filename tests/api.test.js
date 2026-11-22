const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Socket } = require('node:net');
const app = require('../server');
const { getCategory, AQI_CATEGORIES, simulateAQI } = require('../routes/aqi');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_airguard_jwt_secret_fallback_key';

// In-process mock dispatcher: zero network sockets required (runs reliably in any environment)
function makeRequest(appInstance, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
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

describe('Express API Route & AQI Logic Tests', () => {
  // Test 1: Health check
  it('GET /api/health should return 200 with status ok and version', async () => {
    const res = await makeRequest(app, { method: 'GET', url: '/api/health' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.app, 'AirGuard API');
    assert.equal(res.body.version, '1.0.0');
    assert.ok(res.body.timestamp, 'Timestamp should be present');
  });

  // Test 2: 404 for unknown API endpoints
  it('GET /api/unknown-endpoint should return 404 with error message', async () => {
    const res = await makeRequest(app, { method: 'GET', url: '/api/unknown-endpoint' });
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'API endpoint not found' });
  });

  // Test 3: AQI category calculation and boundary validation
  it('getCategory() should calculate correct category and severity across standard boundaries', () => {
    // 0-50 Good
    assert.equal(getCategory(0).label, 'Good');
    assert.equal(getCategory(25).label, 'Good');
    assert.equal(getCategory(50).label, 'Good');

    // 51-100 Moderate
    assert.equal(getCategory(51).label, 'Moderate');
    assert.equal(getCategory(75).label, 'Moderate');
    assert.equal(getCategory(100).label, 'Moderate');

    // 101-150 Unhealthy for Sensitive Groups
    assert.equal(getCategory(101).label, 'Unhealthy for Sensitive Groups');
    assert.equal(getCategory(135).label, 'Unhealthy for Sensitive Groups');
    assert.equal(getCategory(150).label, 'Unhealthy for Sensitive Groups');

    // 151-200 Unhealthy
    assert.equal(getCategory(151).label, 'Unhealthy');
    assert.equal(getCategory(180).label, 'Unhealthy');
    assert.equal(getCategory(200).label, 'Unhealthy');

    // 201-300 Very Unhealthy
    assert.equal(getCategory(201).label, 'Very Unhealthy');
    assert.equal(getCategory(270).label, 'Very Unhealthy');
    assert.equal(getCategory(300).label, 'Very Unhealthy');

    // 301+ Hazardous
    assert.equal(getCategory(301).label, 'Hazardous');
    assert.equal(getCategory(450).label, 'Hazardous');
    assert.equal(getCategory(999).label, 'Hazardous');
  });

  // Test 4: Registration input validation
  it('POST /api/auth/register should return 400 when required fields are missing', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/auth/register',
      body: { email: 'test@example.com' } // missing name and password
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'name, email, and password are required');
  });

  it('POST /api/auth/register should return 400 when password is under 6 characters', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/auth/register',
      body: { name: 'Aisha', email: 'aisha2@example.com', password: '123' }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Password must be at least 6 characters');
  });

  // Test 5: Login input validation
  it('POST /api/auth/login should return 400 when credentials are empty', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/auth/login',
      body: {}
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'email and password are required');
  });

  // Test 6: Protected route authentication requirement
  it('GET /api/aqi/current should return 401 when token is missing', async () => {
    const res = await makeRequest(app, { method: 'GET', url: '/api/aqi/current' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'No token provided');
  });

  // Test 7: Chat input validation on empty message prompt
  it('POST /api/chat/sessions/:uuid/message should return 400 when message prompt is empty or whitespace', async () => {
    const testToken = jwt.sign({ id: 1, uuid: 'user-1', email: 'test@airguard.com', name: 'Tester' }, JWT_SECRET);

    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/chat/sessions/mock-session-uuid/message',
      headers: {
        authorization: `Bearer ${testToken}`
      },
      body: { message: '   ' } // Empty / whitespace
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Message is required');
  });

  // Test 8: Impact logging input validation
  it('POST /api/impact should return 400 when action is omitted', async () => {
    const testToken = jwt.sign({ id: 1, uuid: 'user-1', email: 'test@airguard.com', name: 'Tester' }, JWT_SECRET);

    const res = await makeRequest(app, {
      method: 'POST',
      url: '/api/impact',
      headers: {
        authorization: `Bearer ${testToken}`
      },
      body: { co2_saved: 2.5 } // missing action
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'action is required');
  });

  // Test 9: Graceful error handling and simulation fallback
  it('simulateAQI() should produce valid fallback telemetry when external APIs fail', () => {
    const sim = simulateAQI('New Delhi');
    assert.ok(sim, 'Simulation result must be returned');
    assert.ok(sim.aqi > 0, 'AQI must be a positive number');
    assert.ok(sim.pm25 > 0, 'PM2.5 must be positive');
    assert.ok(sim.pm10 > 0, 'PM10 must be positive');
    assert.ok(sim.temperature.includes('°C'), 'Temperature must include Celsius unit');
    assert.equal(sim.source, 'simulated');
  });
});
