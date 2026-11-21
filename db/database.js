// Uses Node.js built-in sqlite module (available in Node >=22.5, stable in Node >=24)
// Zero native compilation required!
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './airguard.db';

let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync(path.resolve(DB_PATH));
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user    ON chat_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_aqi_user_city         ON aqi_readings(user_id, city);
    CREATE INDEX IF NOT EXISTS idx_recommendations_user  ON recommendations(user_id, type);
    CREATE INDEX IF NOT EXISTS idx_impact_user           ON impact_log(user_id);
  `);

  console.log('✅ Database schema ready (node:sqlite)');
}

module.exports = { getDb };
