/**
 * @fileoverview Full Route Test Coverage & Edge Case Verification Suite
 * Thoroughly exercises all Express routes, controllers, middleware, security headers,
 * input validation, authentication guards, and fallback error paths using Node.js built-in test runner.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Socket } = require('node:net');
const app = require('../server');
const { getDb } = require('../db/database');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_airguard_jwt_secret_fallback_key';

/**
 * In-process mock dispatcher for Express testing with zero network socket dependency.
 */
function makeRequest(appInstance, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve) => {
    const sock = new Socket();
    Object.defineProperty(sock, 'remoteAddress', { value: '127.0.0.1' });

    const req = new http.IncomingMessage(sock);
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost', ...headers };

    let bodyStr = '';
    if (body !== null && body !== undefined) {
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
        headers: res.getHeaders(),
        body: parsed,
        raw,
      });
    };

    appInstance(req, res);

    if (bodyStr) {
      req.push(bodyStr);
    }
    req.push(null);
  });
}

describe('Comprehensive Route Test Suite & Edge Cases', () => {
  let userToken = null;
  let userRecord = null;
  const testEmail = `coverage_${Date.now()}@airguard.test`;
  const testPassword = 'password123';

  // ============================================================
  //  1. Security Headers & Global Middlewares
  // ============================================================
  describe('Security Headers & Global Middlewares', () => {
    it('should set all strict security headers on every response', async () => {
      const res = await makeRequest(app, { method: 'GET', url: '/api/health' });
      assert.equal(res.status, 200);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['x-frame-options'], 'DENY');
      assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
      assert.ok(res.headers['content-security-policy'], 'Content-Security-Policy header must be present');
      assert.ok(res.headers['content-security-policy'].includes("default-src 'self'"));
    });

    it('should return 404 for unknown /api/* endpoints', async () => {
      const res = await makeRequest(app, { method: 'GET', url: '/api/nonexistent-service' });
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: 'API endpoint not found' });
    });

    it('should reject requests exceeding payload size limit with 413 Payload Too Large', async () => {
      // Create a payload larger than 100kb (e.g. 110kb string)
      const oversizedPayload = { data: 'X'.repeat(110 * 1024) };
      const res = await makeRequest(app, {
        method: 'POST',
        url: '/api/auth/register',
        body: oversizedPayload,
      });
      assert.equal(res.status, 413);
      assert.ok(res.body.error.includes('Payload too large'));
    });
  });

  // ============================================================
  //  2. Authentication Routes (/api/auth)
  // ============================================================
  describe('Authentication Routes (/api/auth)', () => {
    it('POST /api/auth/register: should register a new user successfully', async () => {
      const res = await makeRequest(app, {
        method: 'POST',
        url: '/api/auth/register',
        body: { name: 'Coverage User', email: testEmail, password: testPassword },
      });
      assert.equal(res.status, 201);
      assert.ok(res.body.token, 'Token should be returned');
      assert.equal(res.body.user.email, testEmail.toLowerCase());
      assert.equal(res.body.user.name, 'Coverage User');
      userToken = res.body.token;
      userRecord = res.body.user;
    });

    it('POST /api/auth/register: should return 409 conflict when email already exists', async () => {
      const res = await makeRequest(app, {
        method: 'POST',
        url: '/api/auth/register',
        body: { name: 'Duplicate User', email: testEmail, password: testPassword },
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, 'Email already registered');
    });

    it('POST /api/auth/login: should login successfully with correct credentials', async () => {
      const res = await makeRequest(app, {
        method: 'POST',
        url: '/api/auth/login',
        body: { email: testEmail, password: testPassword },
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.token);
      assert.equal(res.body.user.email, testEmail.toLowerCase());
    });

    it('POST /api/auth/login: should return 401 for wrong password or non-existent user', async () => {
      const wrongPassRes = await makeRequest(app, {
        method: 'POST',
        url: '/api/auth/login',
        body: { email: testEmail, password: 'wrong_password_xyz' },
      });
      assert.equal(wrongPassRes.status, 401);
      assert.equal(wrongPassRes.body.error, 'Invalid credentials');

      const nonUserRes = await makeRequest(app, {
        method: 'POST',
        url: '/api/auth/login',
        body: { email: 'nonexistent_user@example.com', password: 'password123' },
      });
      assert.equal(nonUserRes.status, 401);
    });

    it('GET /api/auth/me: should return user information for authenticated token', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.user);
      assert.equal(res.body.user.email, testEmail.toLowerCase());
      assert.equal(res.body.user.name, 'Coverage User');
    });

    it('GET /api/auth/me: should return 404 if user no longer exists in database', async () => {
      const phantomToken = jwt.sign({ id: 999999, uuid: 'phantom', email: 'ghost@test.com' }, JWT_SECRET);
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${phantomToken}` },
      });
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'User not found');
    });

    it('POST /api/auth/change-password: should validate and update password', async () => {
      // 400 when fields missing
      const badReq = await makeRequest(app, {
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: `Bearer ${userToken}` },
        body: { currentPassword: testPassword }, // missing newPassword
      });
      assert.equal(badReq.status, 400);

      // 400 when new password is under 6 chars
      const shortReq = await makeRequest(app, {
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: `Bearer ${userToken}` },
        body: { currentPassword: testPassword, newPassword: '123' },
      });
      assert.equal(shortReq.status, 400);

      // 401 when current password incorrect
      const wrongCurr = await makeRequest(app, {
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: `Bearer ${userToken}` },
        body: { currentPassword: 'incorrectPassword', newPassword: 'newValidPassword123' },
      });
      assert.equal(wrongCurr.status, 401);

      // 200 success
      const successReq = await makeRequest(app, {
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: `Bearer ${userToken}` },
        body: { currentPassword: testPassword, newPassword: 'updatedSecurePass123' },
      });
      assert.equal(successReq.status, 200);
      assert.equal(successReq.body.message, 'Password updated successfully');
    });
  });

  // ============================================================
  //  3. Profile Routes (/api/profile)
  // ============================================================
  describe('Profile Routes (/api/profile)', () => {
    it('GET /api/profile: should return profile (or null initially)', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/profile',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.ok('profile' in res.body);
    });

    it('PUT /api/profile: should return 400 when city is missing or empty', async () => {
      const res = await makeRequest(app, {
        method: 'PUT',
        url: '/api/profile',
        headers: { authorization: `Bearer ${userToken}` },
        body: { family_size: '4' }, // missing city
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'City is required');
    });

    it('PUT /api/profile: should upsert user profile successfully', async () => {
      const res = await makeRequest(app, {
        method: 'PUT',
        url: '/api/profile',
        headers: { authorization: `Bearer ${userToken}` },
        body: {
          city: 'New Delhi',
          country: 'India',
          family_size: '4',
          health_concerns: 'asthma',
          transport: 'car',
          work_style: 'office',
          budget: 'low',
        },
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.profile);
      assert.equal(res.body.profile.city, 'New Delhi');
      assert.equal(res.body.profile.health_concerns, 'asthma');
    });

    it('GET /api/profile/stats: should return user activity counters', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/profile/stats',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.ok('total_chats' in res.body);
      assert.ok('total_messages' in res.body);
      assert.ok('total_aqi_readings' in res.body);
      assert.ok('co2_saved' in res.body);
    });
  });

  // ============================================================
  //  4. AQI Telemetry & History Routes (/api/aqi)
  // ============================================================
  describe('AQI Routes (/api/aqi)', () => {
    it('GET /api/aqi/current: should fetch current AQI using user profile city fallback', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/aqi/current',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.city, 'New Delhi');
      assert.ok(res.body.aqi > 0);
      assert.ok(res.body.standards);
      assert.ok(res.body.cpcb);
      assert.ok(res.body.who);
    });

    it('GET /api/aqi/current: should support explicit city query parameter', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/aqi/current?city=Bengaluru',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.city, 'Bengaluru');
    });

    it('GET /api/aqi/history: should return readings within given days', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/aqi/history?days=14',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.readings));
    });

    it('GET /api/aqi/stats: should return statistical aggregates for the active city', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/aqi/stats',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.stats);
    });

    it('GET /api/aqi/forecast: should return 6-hour rolling forecast curve', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/aqi/forecast?city=Delhi',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.city, 'Delhi');
      assert.equal(res.body.forecast_hours, 6);
      assert.ok(Array.isArray(res.body.forecast));
      assert.equal(res.body.forecast.length, 6);
      assert.ok(res.body.forecast[0].predicted_aqi > 0);
      assert.ok(res.body.forecast[0].activity_state);
    });
  });

  // ============================================================
  //  5. Chat, One-Shot Generators & Recommendations (/api/chat)
  // ============================================================
  describe('Chat & AI Recommendation Routes (/api/chat)', () => {
    let sessionUuid = null;

    it('GET /api/chat/sessions: should list chat sessions', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/chat/sessions',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.sessions));
    });

    it('POST /api/chat/sessions: should create a new conversation session', async () => {
      const res = await makeRequest(app, {
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { authorization: `Bearer ${userToken}` },
        body: { title: 'Winter Inversion Safeguards' },
      });
      assert.equal(res.status, 201);
      assert.ok(res.body.session.uuid);
      assert.equal(res.body.session.title, 'Winter Inversion Safeguards');
      sessionUuid = res.body.session.uuid;
    });

    it('GET /api/chat/sessions/:uuid/messages: should return session messages or 404', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: `/api/chat/sessions/${sessionUuid}/messages`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.messages));

      const notFoundRes = await makeRequest(app, {
        method: 'GET',
        url: '/api/chat/sessions/nonexistent-session-uuid/messages',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(notFoundRes.status, 404);
    });

    it('POST /api/chat/sessions/:uuid/message: should return domain advisory when sending message', async () => {
      const res = await makeRequest(app, {
        method: 'POST',
        url: `/api/chat/sessions/${sessionUuid}/message`,
        headers: { authorization: `Bearer ${userToken}` },
        body: { message: 'Is it safe for evening run today in Delhi?' },
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.message.length > 50);
      assert.ok(res.body.source);
    });

    it('POST /api/chat/generate: should validate type and produce fallback content', async () => {
      // 400 when type is missing
      const noType = await makeRequest(app, {
        method: 'POST',
        url: '/api/chat/generate',
        headers: { authorization: `Bearer ${userToken}` },
        body: {},
      });
      assert.equal(noType.status, 400);

      // 400 when type is invalid
      const invalidType = await makeRequest(app, {
        method: 'POST',
        url: '/api/chat/generate',
        headers: { authorization: `Bearer ${userToken}` },
        body: { type: 'unknown_generator_type' },
      });
      assert.equal(invalidType.status, 400);

      // 200 for aqi_insight
      const insight = await makeRequest(app, {
        method: 'POST',
        url: '/api/chat/generate',
        headers: { authorization: `Bearer ${userToken}` },
        body: { type: 'aqi_insight' },
      });
      assert.equal(insight.status, 200);
      assert.ok(insight.body.data);

      // 200 for routines
      const routines = await makeRequest(app, {
        method: 'POST',
        url: '/api/chat/generate',
        headers: { authorization: `Bearer ${userToken}` },
        body: { type: 'routines' },
      });
      assert.equal(routines.status, 200);
      assert.ok(routines.body.data);
    });

    it('GET /api/chat/recommendations: should return recommendations and support bookmarks', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/chat/recommendations',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.recommendations));

      // 404 for non-existent bookmark
      const bookmark404 = await makeRequest(app, {
        method: 'PATCH',
        url: '/api/chat/recommendations/999999/bookmark',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(bookmark404.status, 404);
    });

    it('DELETE /api/chat/sessions/:uuid: should delete chat session', async () => {
      const res = await makeRequest(app, {
        method: 'DELETE',
        url: `/api/chat/sessions/${sessionUuid}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.message, 'Deleted');
    });
  });

  // ============================================================
  //  6. Environmental Impact Ledger (/api/impact)
  // ============================================================
  describe('Environmental Impact Ledger (/api/impact)', () => {
    it('POST /api/impact: should validate and log action', async () => {
      // 400 when action missing
      const badRes = await makeRequest(app, {
        method: 'POST',
        url: '/api/impact',
        headers: { authorization: `Bearer ${userToken}` },
        body: { co2_saved: 3.5 },
      });
      assert.equal(badRes.status, 400);

      // 201 success
      const successRes = await makeRequest(app, {
        method: 'POST',
        url: '/api/impact',
        headers: { authorization: `Bearer ${userToken}` },
        body: {
          action: 'Switched frying to single-burner induction',
          category: 'Kitchen',
          co2_saved: 2.8,
          aqi_impact: '-60% indoor VOCs',
        },
      });
      assert.equal(successRes.status, 201);
      assert.ok(successRes.body.id > 0);
      assert.ok(successRes.body.analytics);
      assert.equal(successRes.body.analytics.co2_saved_kg, 2.8);
    });

    it('POST /api/impact/calculate: should estimate sustainability metrics and health benefits', async () => {
      const res = await makeRequest(app, {
        method: 'POST',
        url: '/api/impact/calculate',
        headers: { authorization: `Bearer ${userToken}` },
        body: {
          action: 'Installed high-efficiency bedroom HEPA filter',
          category: 'Home',
          co2_saved: 1.5,
          aqi: 210,
        },
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.analytics);
      assert.equal(res.body.analytics.co2_saved_kg, 1.5);
      assert.ok(res.body.analytics.pm25_avoided_ug > 0);
      assert.ok(res.body.analytics.trees_equivalent > 0);
      assert.ok(res.body.analytics.health_benefit);
    });

    it('GET /api/impact: should return impact entries and cumulative totals', async () => {
      const res = await makeRequest(app, {
        method: 'GET',
        url: '/api/impact?days=30',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.logs));
      assert.ok(res.body.totals);
      assert.ok(res.body.totals.total_actions >= 1);
      assert.ok(res.body.totals.total_co2_saved >= 2.8);
    });
  });
});
