/**
 * @fileoverview AirGuard Application Constants & Standard Environmental Thresholds
 * Centralizes all magic numbers, CPCB NAQI breakpoints, WHO 2021 guidelines,
 * city baselines, cache TTLs, and rate limiting thresholds.
 */

// ============================================================
//  Cache & Network Limits
// ============================================================

/** Cache TTL in milliseconds (15 minutes) */
const CACHE_TTL_MS = 15 * 60 * 1000;

/** Express request payload size limit */
const PAYLOAD_LIMIT = '100kb';

/** Global rate limiter window (15 minutes) */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Maximum requests allowed per rate limit window for general API */
const API_RATE_LIMIT_MAX = 200;

/** Maximum authentication attempts allowed per window */
const AUTH_RATE_LIMIT_MAX = 20;

/** Maximum AI chat / advice requests allowed per window */
const CHAT_RATE_LIMIT_MAX = 60;

/** Default JWT expiration duration */
const JWT_EXPIRY = '7d';

/** Salt rounds for password hashing with bcrypt */
const BCRYPT_ROUNDS = 12;

/** Python FastAPI microservice URL */
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';

/** Short timeout (1500ms) for Python microservice RPCs to guarantee zero latency degradation */
const PYTHON_SERVICE_TIMEOUT_MS = 1500;

// ============================================================
//  Profile & Query Defaults
// ============================================================

const DEFAULT_CITY = 'New Delhi';
const DEFAULT_COUNTRY = 'India';
const DEFAULT_FAMILY_SIZE = '3-4';
const DEFAULT_HEALTH_CONCERNS = 'none';
const DEFAULT_TRANSPORT = 'car';
const DEFAULT_WORK_STYLE = 'office';
const DEFAULT_BUDGET = 'low';

const DEFAULT_HISTORY_DAYS = 7;
const MAX_HISTORY_DAYS = 90;

const DEFAULT_IMPACT_DAYS = 30;
const MAX_IMPACT_DAYS = 365;

// ============================================================
//  1. Indian CPCB NAQI Standards (0–500 scale)
// ============================================================

const CPCB_CATEGORIES = [
  { min: 0,   max: 50,  label: 'Good',         color: '#14532d', bg: '#dcfce7', level: 'good',         description: 'Minimal impact' },
  { min: 51,  max: 100, label: 'Satisfactory', color: '#047857', bg: '#d1fae5', level: 'satisfactory', description: 'Minor breathing discomfort to sensitive people' },
  { min: 101, max: 200, label: 'Moderate',     color: '#78350f', bg: '#fef3c7', level: 'moderate',     description: 'Breathing discomfort to people with lungs, asthma and heart disease' },
  { min: 201, max: 300, label: 'Poor',         color: '#7c2d12', bg: '#ffedd5', level: 'poor',         description: 'Breathing discomfort to most people on prolonged exposure' },
  { min: 301, max: 400, label: 'Very Poor',    color: '#7f1d1d', bg: '#fee2e2', level: 'very_poor',    description: 'Respiratory illness on prolonged exposure' },
  { min: 401, max: 500, label: 'Severe',       color: '#581c87', bg: '#f3e8ff', level: 'severe',       description: 'Affects healthy people and seriously impacts those with existing diseases' },
];

/**
 * CPCB 24-hour National Ambient Air Quality Reference Thresholds (µg/m³)
 */
const CPCB_THRESHOLDS = {
  pm25: 60,  // 24-hour standard (µg/m³)
  pm10: 100, // 24-hour standard (µg/m³)
  no2:  80,  // 24-hour standard (µg/m³)
  o3:   100, // 8-hour standard (µg/m³)
  co:   2,   // 8-hour standard (mg/m³)
  so2:  80,  // 24-hour standard (µg/m³)
};

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

// ============================================================
//  3. Legacy US EPA AQI Categories (For backward compatibility)
// ============================================================

const AQI_CATEGORIES = [
  { max: 50,  label: 'Good',                           color: '#15803d', level: 'good' },
  { max: 100, label: 'Moderate',                       color: '#b45309', level: 'moderate' },
  { max: 150, label: 'Unhealthy for Sensitive Groups', color: '#c2410c', level: 'sensitive' },
  { max: 200, label: 'Unhealthy',                      color: '#b91c1c', level: 'unhealthy' },
  { max: 300, label: 'Very Unhealthy',                 color: '#7f1d1d', level: 'very_unhealthy' },
  { max: 500, label: 'Hazardous',                      color: '#450a0a', level: 'hazardous' },
];

// ============================================================
//  4. Calibrated City Baselines for Resilient Demo Fallback
// ============================================================

const CITY_BASELINES = {
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

module.exports = {
  CACHE_TTL_MS,
  PAYLOAD_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  API_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_MAX,
  CHAT_RATE_LIMIT_MAX,
  JWT_EXPIRY,
  BCRYPT_ROUNDS,
  DEFAULT_CITY,
  DEFAULT_COUNTRY,
  DEFAULT_FAMILY_SIZE,
  DEFAULT_HEALTH_CONCERNS,
  DEFAULT_TRANSPORT,
  DEFAULT_WORK_STYLE,
  DEFAULT_BUDGET,
  DEFAULT_HISTORY_DAYS,
  MAX_HISTORY_DAYS,
  DEFAULT_IMPACT_DAYS,
  MAX_IMPACT_DAYS,
  CPCB_CATEGORIES,
  CPCB_THRESHOLDS,
  WHO_THRESHOLDS,
  AQI_CATEGORIES,
  CITY_BASELINES,
  PYTHON_SERVICE_URL,
  PYTHON_SERVICE_TIMEOUT_MS,
};
