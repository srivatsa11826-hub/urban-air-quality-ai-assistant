const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_airguard_jwt_secret_fallback_key';

describe('Authentication & JWT Tests', () => {
  it('should generate and verify a valid JWT token with user claims', () => {
    const payload = {
      id: 42,
      uuid: 'test-uuid-1234',
      email: 'aisha@example.com',
      name: 'Dr. Aisha'
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    assert.ok(typeof token === 'string' && token.length > 20, 'Token should be a non-empty string');

    const decoded = jwt.verify(token, JWT_SECRET);
    assert.equal(decoded.id, 42);
    assert.equal(decoded.uuid, 'test-uuid-1234');
    assert.equal(decoded.email, 'aisha@example.com');
    assert.equal(decoded.name, 'Dr. Aisha');
    assert.ok(decoded.exp > decoded.iat, 'Token expiration should exceed issued time');
  });

  it('authMiddleware: should allow request with a valid Bearer token and attach req.user', (t, done) => {
    const userPayload = { id: 1, uuid: 'user-001', email: 'test@airguard.com', name: 'Tester' };
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1h' });

    const req = {
      headers: {
        authorization: `Bearer ${token}`
      }
    };
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.data = data;
        return this;
      }
    };

    authMiddleware(req, res, () => {
      assert.ok(req.user, 'req.user should be populated');
      assert.equal(req.user.id, 1);
      assert.equal(req.user.email, 'test@airguard.com');
      done();
    });
  });

  it('authMiddleware: should return 401 when authorization header is missing', () => {
    const req = { headers: {} };
    let respondedStatus = null;
    let respondedBody = null;

    const res = {
      status(code) {
        respondedStatus = code;
        return this;
      },
      json(data) {
        respondedBody = data;
        return this;
      }
    };

    authMiddleware(req, res, () => {
      assert.fail('next() should not be called when token is missing');
    });

    assert.equal(respondedStatus, 401);
    assert.deepEqual(respondedBody, { error: 'No token provided' });
  });

  it('authMiddleware: should return 401 when authorization header does not start with Bearer', () => {
    const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
    let respondedStatus = null;
    let respondedBody = null;

    const res = {
      status(code) {
        respondedStatus = code;
        return this;
      },
      json(data) {
        respondedBody = data;
        return this;
      }
    };

    authMiddleware(req, res, () => {
      assert.fail('next() should not be called with Basic auth header');
    });

    assert.equal(respondedStatus, 401);
    assert.deepEqual(respondedBody, { error: 'No token provided' });
  });

  it('authMiddleware: should return 401 when token is empty after Bearer prefix', () => {
    const req = { headers: { authorization: 'Bearer    ' } };
    let respondedStatus = null;
    let respondedBody = null;

    const res = {
      status(code) {
        respondedStatus = code;
        return this;
      },
      json(data) {
        respondedBody = data;
        return this;
      }
    };

    authMiddleware(req, res, () => {
      assert.fail('next() should not be called with empty token');
    });

    assert.equal(respondedStatus, 401);
    assert.deepEqual(respondedBody, { error: 'No token provided' });
  });

  it('authMiddleware: should return 401 when token is malformed', () => {
    const req = { headers: { authorization: 'Bearer definitely.invalid.token' } };
    let respondedStatus = null;
    let respondedBody = null;

    const res = {
      status(code) {
        respondedStatus = code;
        return this;
      },
      json(data) {
        respondedBody = data;
        return this;
      }
    };

    authMiddleware(req, res, () => {
      assert.fail('next() should not be called with malformed token');
    });

    assert.equal(respondedStatus, 401);
    assert.deepEqual(respondedBody, { error: 'Invalid or expired token' });
  });

  it('authMiddleware: should return 401 when token is signed with a different secret', () => {
    const foreignToken = jwt.sign({ id: 99 }, 'different_secret_key_12345');
    const req = { headers: { authorization: `Bearer ${foreignToken}` } };
    let respondedStatus = null;
    let respondedBody = null;

    const res = {
      status(code) {
        respondedStatus = code;
        return this;
      },
      json(data) {
        respondedBody = data;
        return this;
      }
    };

    authMiddleware(req, res, () => {
      assert.fail('next() should not be called with wrongly signed token');
    });

    assert.equal(respondedStatus, 401);
    assert.deepEqual(respondedBody, { error: 'Invalid or expired token' });
  });

  it('authMiddleware: should return 401 when token has expired', () => {
    // Generate an expired token (expiresIn: -1s)
    const expiredToken = jwt.sign({ id: 5 }, JWT_SECRET, { expiresIn: -1 });
    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    let respondedStatus = null;
    let respondedBody = null;

    const res = {
      status(code) {
        respondedStatus = code;
        return this;
      },
      json(data) {
        respondedBody = data;
        return this;
      }
    };

    authMiddleware(req, res, () => {
      assert.fail('next() should not be called with expired token');
    });

    assert.equal(respondedStatus, 401);
    assert.deepEqual(respondedBody, { error: 'Invalid or expired token' });
  });
});
