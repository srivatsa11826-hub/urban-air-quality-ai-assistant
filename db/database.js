// Uses Node.js built-in sqlite module (available in Node >=22.5, stable in Node >=24)
// Zero native compilation required!
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DEFAULT_DB_PATH = process.env.DB_PATH || './airguard.db';

let db = null;

function getDb(customPath = null) {
  // If customPath is explicitly provided (e.g. ':memory:' or temporary file for tests)
  if (customPath) {
    const targetPath = customPath === ':memory:' ? ':memory:' : path.resolve(customPath);
    const customDb = new DatabaseSync(targetPath);
    customDb.exec('PRAGMA busy_timeout = 5000');
    if (customPath !== ':memory:') {
      try {
        customDb.exec('PRAGMA journal_mode = WAL');
      } catch (_) {}
    }
    customDb.exec('PRAGMA foreign_keys = ON');
    initSchema(customDb);
    return customDb;
  }

  // Singleton instance for the application
  if (!db) {
    db = new DatabaseSync(path.resolve(DEFAULT_DB_PATH));
    db.exec('PRAGMA busy_timeout = 5000');
    try {
      db.exec('PRAGMA journal_mode = WAL');
    } catch (_) {}
    db.exec('PRAGMA foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function closeDb(customInstance = null) {
  if (customInstance) {
    try {
      customInstance.close();
    } catch (_) {}
    return;
  }
  if (db) {
    try {
      db.close();
    } catch (_) {}
    db = null;
  }
}

function initSchema(targetDb = db) {
  if (!targetDb) return;

  try {
    targetDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid        TEXT    UNIQUE NOT NULL,
      email       TEXT    UNIQUE NOT NULL COLLATE NOCASE,
      password    TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now')),
      last_login  TEXT
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      city              TEXT    NOT NULL,
      country           TEXT    DEFAULT 'India',
      lat               REAL,
      lon               REAL,
      family_size       TEXT    DEFAULT '3-4',
      health_concerns   TEXT    DEFAULT 'none',
      transport         TEXT    DEFAULT 'car',
      work_style        TEXT    DEFAULT 'office',
      budget            TEXT    DEFAULT 'low',
      specific_concerns TEXT,
      gemini_api_key    TEXT,
      updated_at        TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid        TEXT    UNIQUE NOT NULL,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL DEFAULT 'New Conversation',
      aqi_at_time INTEGER,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role        TEXT    NOT NULL CHECK(role IN ('user','assistant')),
      content     TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS aqi_readings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      city          TEXT    NOT NULL,
      aqi           INTEGER NOT NULL,
      pm25          REAL,
      pm10          REAL,
      no2           REAL,
      o3            REAL,
      co            REAL,
      so2           REAL,
      temperature   TEXT,
      humidity      TEXT,
      wind_speed    TEXT,
      category      TEXT,
      dominant      TEXT,
      source        TEXT    DEFAULT 'simulated',
      recorded_at   TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type          TEXT    NOT NULL,
      title         TEXT,
      content       TEXT    NOT NULL,
      aqi_context   INTEGER,
      is_bookmarked INTEGER DEFAULT 0,
      generated_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS impact_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action      TEXT    NOT NULL,
      category    TEXT,
      co2_saved   REAL    DEFAULT 0,
      aqi_impact  TEXT,
      logged_at   TEXT    DEFAULT (datetime('now'))
    );

    -- Resilient City AQI Cache Table (15-min TTL with stale-cache fallback)
    CREATE TABLE IF NOT EXISTS aqi_cache (
      city       TEXT PRIMARY KEY COLLATE NOCASE,
      payload    TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user    ON chat_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_aqi_user_city         ON aqi_readings(user_id, city);
    CREATE INDEX IF NOT EXISTS idx_recommendations_user  ON recommendations(user_id, type);
    CREATE INDEX IF NOT EXISTS idx_impact_user           ON impact_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_aqi_cache_fetched     ON aqi_cache(fetched_at);
  `);
  } catch (err) {
    if (!err.message || !err.message.includes('locked')) {
      throw err;
    }
  }
}

/**
 * Retrieve cached AQI payload for a city from SQLite.
 * @param {string} city - Name of city
 * @param {number|null} maxAgeMs - Maximum acceptable cache age in milliseconds (defaults to 900,000 ms = 15 mins).
 *                                Pass null or Infinity to retrieve stale entries.
 * @param {object|null} targetDb - Optional DatabaseSync instance (e.g. for in-memory tests)
 * @returns {object|null} Parsed payload object with cachedAt metadata, or null if missing/expired
 */
function getCachedAqi(city, maxAgeMs = 900000, targetDb = null) {
  if (!city || typeof city !== 'string') return null;
  const activeDb = targetDb || getDb();
  const normalizedCity = city.trim();
  const row = activeDb.prepare('SELECT payload, fetched_at FROM aqi_cache WHERE city = ?').get(normalizedCity);
  if (!row) return null;

  const now = Date.now();
  const age = now - row.fetched_at;
  if (maxAgeMs != null && maxAgeMs !== Infinity && age > maxAgeMs) {
    return null; // Expired past TTL
  }

  try {
    const data = JSON.parse(row.payload);
    return {
      ...data,
      cachedAt: row.fetched_at,
      cacheAgeMs: age,
      isFresh: maxAgeMs == null || age <= maxAgeMs,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Store AQI payload in SQLite cache with current timestamp.
 * @param {string} city - Name of city
 * @param {object|string} payload - AQI data object or JSON string
 * @param {object|null} targetDb - Optional DatabaseSync instance
 */
function setCachedAqi(city, payload, targetDb = null) {
  if (!city || typeof city !== 'string' || !payload) return;
  const activeDb = targetDb || getDb();
  const normalizedCity = city.trim();
  const now = Date.now();
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

  activeDb.prepare(`
    INSERT INTO aqi_cache (city, payload, fetched_at)
    VALUES (?, ?, ?)
    ON CONFLICT(city) DO UPDATE SET
      payload = excluded.payload,
      fetched_at = excluded.fetched_at
  `).run(normalizedCity, payloadStr, now);
}

module.exports = {
  getDb,
  closeDb,
  initSchema,
  getCachedAqi,
  setCachedAqi,
};
