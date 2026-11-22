const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getDb, closeDb } = require('../db/database');

describe('SQLite Database Initialization & Schema Tests', () => {
  let testDb = null;

  before(() => {
    // Isolated in-memory database instance — airguard.db is completely untouched
    testDb = getDb(':memory:');
    assert.ok(testDb, 'In-memory test database should be initialized');
  });

  after(() => {
    if (testDb) {
      closeDb(testDb);
    }
  });

  it('should initialize all required tables in schema', () => {
    const tables = testDb.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC
    `).all().map(r => r.name);

    const requiredTables = [
      'aqi_readings',
      'chat_messages',
      'chat_sessions',
      'impact_log',
      'profiles',
      'recommendations',
      'users'
    ];

    for (const table of requiredTables) {
      assert.ok(tables.includes(table), `Table '${table}' must exist in schema`);
    }
  });

  it('should insert a user and query with case-insensitive email (NOCASE)', () => {
    const insertStmt = testDb.prepare(`
      INSERT INTO users (uuid, email, password, name)
      VALUES (?, ?, ?, ?)
    `);

    const result = insertStmt.run('user-uuid-1', 'Family.Defense@AirGuard.com', 'hashed_pass_123', 'Aisha Khan');
    assert.ok(result.lastInsertRowid > 0, 'Insert should produce positive row ID');

    // Case-insensitive query
    const userLower = testDb.prepare('SELECT * FROM users WHERE email = ?').get('family.defense@airguard.com');
    assert.ok(userLower, 'User must be retrievable by lowercase email');
    assert.equal(userLower.name, 'Aisha Khan');

    const userUpper = testDb.prepare('SELECT * FROM users WHERE email = ?').get('FAMILY.DEFENSE@AIRGUARD.COM');
    assert.ok(userUpper, 'User must be retrievable by uppercase email');
  });

  it('should enforce UNIQUE constraint on user email', () => {
    const insertStmt = testDb.prepare(`
      INSERT INTO users (uuid, email, password, name)
      VALUES (?, ?, ?, ?)
    `);

    assert.throws(
      () => {
        insertStmt.run('user-uuid-2', 'family.defense@airguard.com', 'another_pass', 'Duplicate Aisha');
      },
      /UNIQUE constraint failed/i,
      'Duplicate email must violate UNIQUE constraint'
    );
  });

  it('should insert profile with user foreign key relationship', () => {
    const user = testDb.prepare('SELECT id FROM users WHERE email = ?').get('family.defense@airguard.com');
    assert.ok(user, 'User should exist');

    testDb.prepare(`
      INSERT INTO profiles (user_id, city, country, family_size, health_concerns, transport, work_style, budget)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, 'New Delhi', 'India', '4', 'asthma', 'car', 'office', 'low');

    const profile = testDb.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
    assert.ok(profile, 'Profile should be created');
    assert.equal(profile.city, 'New Delhi');
    assert.equal(profile.health_concerns, 'asthma');
  });

  it('should cascade delete profile, chat sessions, and messages when user is deleted', () => {
    const user = testDb.prepare('SELECT id FROM users WHERE email = ?').get('family.defense@airguard.com');
    assert.ok(user, 'User must exist');

    // Create session & message
    const sessRes = testDb.prepare(`
      INSERT INTO chat_sessions (uuid, user_id, title)
      VALUES (?, ?, ?)
    `).run('session-uuid-1', user.id, 'Winter Smog Routine');

    testDb.prepare(`
      INSERT INTO chat_messages (session_id, role, content)
      VALUES (?, ?, ?)
    `).run(sessRes.lastInsertRowid, 'user', 'What mask is best for school commute?');

    // Delete user
    testDb.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    // Verify cascade deletions
    const profile = testDb.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
    assert.equal(profile, undefined, 'Profile must be deleted via cascade');

    const session = testDb.prepare('SELECT * FROM chat_sessions WHERE user_id = ?').get(user.id);
    assert.equal(session, undefined, 'Chat session must be deleted via cascade');

    const messages = testDb.prepare('SELECT * FROM chat_messages WHERE session_id = ?').all(sessRes.lastInsertRowid);
    assert.equal(messages.length, 0, 'Chat messages must be deleted via cascade');
  });
});
