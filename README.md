# 🌬️ AirGuard – Urban Air Quality & Family Protection Platform

> A production-grade, full-stack GenAI-powered platform designed to help families and communities navigate severe winter smog and urban air pollution with personalized low-emission daily routines, indoor air quality hacks, and sustainable alternatives.

---

## 📋 Table of Contents
1. [Overview](#-overview)
2. [High-Value Product Features](#-high-value-product-features)
3. [Architecture](#-architecture)
4. [Quick Start & Setup](#-quick-start--setup)
5. [Automated Testing](#-automated-testing)
6. [Resilience & Fallback Engine](#-resilience--fallback-engine)
7. [Security & Hardening](#-security--hardening)
8. [WCAG 2.1 AA Accessibility](#-wcag-21-aa-accessibility)
9. [API Reference](#-api-reference)
10. [Environment Variables](#-environment-variables)

---

## 🔍 Overview
Air pollution in metropolitan areas peaks dramatically during winter months due to nocturnal thermal inversion, vehicular congestion, and biomass burning. **AirGuard** bridges atmospheric science and daily family routines by providing:
- Real-time and simulated 6-pollutant air quality telemetry (PM2.5, PM10, NO₂, O₃, CO, SO₂).
- **Dual Assessment Standards**: Switch seamlessly between official **Indian CPCB NAQI (0–500 scale)** and **WHO 2021 Global 24-Hour Guidelines**.
- **One-Click Persona Quick-Prompts**: Instant, context-aware demo triggers for evening workouts, pediatric respiratory safety, and home ventilation windows.
- Low-emission daily action checklists that track avoided particulate exposure and quantify household CO₂ savings.
- Room-by-room indoor micro-environment inspections with low-cost filtration hacks (e.g., Corsi-Rosenthal boxes).
- Transparent, data-backed green swaps with realistic cost-benefit analyses.

---

## 🚀 High-Value Product Features

### 1. 🇮🇳 Indian CPCB NAQI + 🌍 WHO 2021 Dual Standard Toggle
An accessible segmented control (`role="radiogroup"` / `role="radio"`) allows instantaneous toggling between:
- **Indian NAQI (Central Pollution Control Board Standard, 0–500 scale)**:
  - Breakpoints: `0–50 Good`, `51–100 Satisfactory`, `101–200 Moderate`, `201–300 Poor`, `301–400 Very Poor`, `401–500 Severe`.
  - CPCB 24-hour reference standards: `PM2.5: 60 µg/m³`, `PM10: 100 µg/m³`, `NO2: 80 µg/m³`, `O3 (8h): 100 µg/m³`.
- **WHO Global Air Quality Guidelines (2021 24-Hour Limits)**:
  - Compares pollutant concentrations against strict health benchmarks (`PM2.5: 15 µg/m³`, `PM10: 45 µg/m³`, `NO2: 25 µg/m³`, `O3: 60 µg/m³`).
  - Calculates dynamic exceedance multipliers (e.g., `7.7x WHO limit`) with high-contrast alert indicators.

### 2. ⚡ SQLite AQI Caching & Multi-Tier Fallback Engine
- **15-Minute SQLite TTL (`aqi_cache`)**:
  - Live city AQI lookups check `aqi_cache` (`city TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at INTEGER NOT NULL`).
  - Hits within 15 minutes (`900,000 ms`) are served instantly from disk (`source: "cache"`), minimizing external latency and API rate consumption.
- **Stale-Cache Fallback**:
  - If the external station API times out or fails, AirGuard immediately returns the most recent cached telemetry (`source: "stale-cache"`), ensuring the dashboard never crashes.
- **Realistic Indian City Baselines**:
  - If no prior cache entry exists and external feeds are unreachable, AirGuard gracefully activates realistic meteorological baselines for major Indian metros (Chennai, Delhi, Bengaluru, Mumbai, Hyderabad, Kolkata).

### 3. 🧠 Deterministic Rule-Based LLM Fallback
- If the external Generative AI provider is unavailable, times out, or encounters quota exhaustion, AirGuard automatically activates a domain-accurate clinical rule engine.
- Inspects active city telemetry (`AQI`, `PM2.5`, `PM10`) and user question keywords:
  - **Running/Exercise**: Evaluates respiratory minute ventilation (increased 400%–600% during cardio) and advises indoor workout alternatives when AQI > 150.
  - **Pediatric & Asthma**: Analyzes children's respiratory vulnerability (breathing 50% more air per pound of body weight) and sets bedroom clean-air sanctuary goals.
  - **Home Ventilation Windows**: Directs households to ventilate only between **12:30 PM and 3:30 PM** when solar heating breaks the thermal inversion layer.
  - **Particulate Dynamics**: Explains boundary-layer inversion caps and local emissions.

### 4. 🎯 One-Click "Persona" Quick-Prompt Chips
Rendered directly above the chat input bar for effortless live judging demos:
1. `🏃 Safe for evening run?`
2. `🧸 Asthma & child safety`
3. `🪟 Best window to ventilate home`
4. `🌫️ Why is PM2.5 high today?`
Clicking any chip dynamically constructs a location-aware prompt incorporating the user's city and active AQI, and automatically submits the consultation.

---

## 🏗 Architecture

```
urban quality air/
├── server.js               # Express application entry point & middleware pipeline
├── package.json            # Project dependencies & automated test runner scripts
├── .env.example            # Documented environment variable template
├── .gitignore              # Ignores credentials, SQLite files, logs, and temp DBs
│
├── db/
│   └── database.js         # SQLite database schema, aqi_cache, getCachedAqi, setCachedAqi
│
├── middleware/
│   └── auth.js             # JWT verification middleware with safe fallback
│
├── routes/
│   ├── auth.js             # Registration, login, password management (bcrypt + JWT)
│   ├── profile.js          # Household vulnerability intake & telemetry preferences
│   ├── aqi.js              # CPCB NAQI & WHO dual standards, 15-min cache, and simulation
│   ├── chat.js             # Gemini AI consultation & deterministic rule-based fallback
│   └── impact.js           # Verified action logging & CO₂ savings ledger
│
├── tests/                  # Zero-dependency automated test runner (node:test)
│   ├── auth.test.js        # JWT generation, token verification, and 401 handling
│   ├── database.test.js    # Schema creation, constraints, cascade deletion (:memory:)
│   ├── api.test.js         # Core Express routes, AQI category boundaries, input validation
│   └── standards_cache.test.js # CPCB NAQI vs WHO, aqi_cache TTL, and LLM fallback tests
│
└── public/                 # Accessible, light-themed Single-Page Application (SPA)
    ├── index.html          # Semantic HTML5 shell (landmarks, ARIA, single <h1>)
    ├── css/style.css       # Design tokens, high-contrast palette, focus outlines
    └── js/
        ├── api.js          # REST client wrapper with token management
        └── app.js          # State, dual standards toggle, persona chips, speech-to-text
```

---

## 🚀 Quick Start & Setup

### 1. Prerequisites
- **Node.js**: v22.5.0 or higher (Node.js v24+ LTS recommended for built-in `node:sqlite`).

### 2. Installation
```bash
npm install
```

### 3. Configure Environment Variables
```bash
cp .env.example .env
```
Edit `.env` and set your preferred keys:
```env
PORT=3000
NODE_ENV=development
JWT_SECRET=replace_with_a_secure_random_string
GEMINI_API_KEY=your_gemini_api_key_here
WAQI_API_TOKEN=your_waqi_token_here
```

### 4. Start the Application
```bash
# Production start
npm start

# Development mode (auto-restart)
npm run dev
```
Open **`http://localhost:3000`** in your browser.

---

## 🧪 Automated Testing

The project includes 37 automated unit and integration tests powered entirely by Node.js's native test runner (`node:test` and `node:assert/strict`). **Zero third-party test framework dependencies are required.**

Run all tests:
```bash
npm test
```

### Test Suite Summary:
- **`tests/standards_cache.test.js`**:
  - CPCB NAQI 6-tier classification (`0–50 Good` through `401–500 Severe`).
  - WHO 2021 24-hour guidelines and exceedance multiplier math (e.g., 36 µg/m³ PM2.5 = 2.4x).
  - SQLite `aqi_cache` hit validation, TTL expiry (> 15 mins), and stale cache fallback.
  - Baseline simulation stability across Chennai, Delhi, Bengaluru, Mumbai, Hyderabad, Kolkata.
  - Deterministic LLM fallback generator intent matching (running, children/asthma, ventilation, PM2.5 causes).
  - Seamless HTTP 200 fallback behavior during chat requests when Gemini is offline.
- **`tests/auth.test.js`**:
  - Valid JWT signature generation and claims validation.
  - Rejection with HTTP `401` on missing tokens, non-Bearer formats, malformed tokens, wrong secrets, and expired signatures.
- **`tests/database.test.js`**:
  - Schema initialization in isolated in-memory databases (`:memory:`), ensuring `airguard.db` is never modified or polluted.
  - Case-insensitive email indexing (`COLLATE NOCASE`), `UNIQUE` constraints, and cascading deletes (`ON DELETE CASCADE`).
- **`tests/api.test.js`**:
  - `GET /api/health` returns status `200` with API metadata.
  - Fallback `404` error handling for undefined API endpoints.
  - Strict input validation rejecting empty chat messages, missing registration fields, and weak passwords.

---

## 🛡 Security & Hardening

1. **Payload Size Restrictions**:
   `express.json({ limit: '100kb' })` and `express.urlencoded({ limit: '100kb' })` guard against memory exhaustion and denial-of-service attacks.
2. **Defensive Error Handling**:
   Every route handler is wrapped in strict `try / catch` blocks with standardized status codes (`400`, `401`, `404`, `409`, `413`, `500`).
3. **No Hardcoded Secrets**:
   All tokens, database paths, and API keys are read strictly from `process.env` with safe, explicit development fallbacks.
4. **Password Security**:
   Passwords are salted and hashed with `bcryptjs` using 12 computational rounds.
5. **Rate Limiting & Headers**:
   Enforced with `express-rate-limit` (200 req/15min general; 20 req/15min auth) and `helmet`.

---

## ♿ WCAG 2.1 AA Accessibility

- **Semantic HTML5 Landmarks**: Complete structure utilizing `<header role="banner">`, `<nav aria-label="...">`, `<aside role="complementary">`, `<main role="main">`, `<section aria-labelledby="...">`, and `<footer role="contentinfo">`.
- **Strict Heading Hierarchy**: Exactly **one `<h1>`** on the page, with sequential `<h2>` and `<h3>` tags throughout without level skipping.
- **Form Controls & Labels**: Every `<input>`, `<select>`, and `<textarea>` is bound to a visible `<label for="...">` with matching IDs or explicit `aria-label` attributes.
- **Icon Buttons**: All icon-only interactive controls include clear `aria-label` descriptions and `aria-hidden="true"` on decorative icons.
- **Screen Reader Live Regions**: `aria-live="polite"` containers for real-time AI responses, station telemetry updates, and standard toggles.
- **Keyboard Navigation & Focus**: Clear `:focus-visible` outline styles (`2px solid #026aa2` with `2px` offset) and high contrast ratios exceeding 4.5:1 across all body text, buttons, and status chips.

---

## 📡 API Reference

### Air Quality & Dual Standards
- `GET /api/aqi/current?city=...` – Retrieve live/cached AQI reading with CPCB & WHO standards *(Requires Bearer Token)*
- `GET /api/aqi/history?days=7` – 7-day historical telemetry archive *(Requires Bearer Token)*
- `GET /api/aqi/stats` – 30-day statistical aggregates *(Requires Bearer Token)*

### AI Consultation & Generators
- `GET /api/chat/sessions` – List user's consultation sessions *(Requires Bearer Token)*
- `POST /api/chat/sessions` – Create a new consultation session *(Requires Bearer Token)*
- `DELETE /api/chat/sessions/:uuid` – Delete a consultation session *(Requires Bearer Token)*
- `POST /api/chat/sessions/:uuid/message` – Send message and receive Gemini / deterministic fallback response *(Requires Bearer Token)*
- `POST /api/chat/generate` – One-shot structured generators (`family_plan`, `room_audit`, `alternatives`, `indoor`, `routines`) *(Requires Bearer Token)*

### Authentication & Profile
- `POST /api/auth/register` – Register a new account (`{ name, email, password }`)
- `POST /api/auth/login` – Authenticate user and receive JWT (`{ email, password }`)
- `GET /api/auth/me` – Retrieve active user profile *(Requires Bearer Token)*
- `POST /api/auth/change-password` – Update user password *(Requires Bearer Token)*
- `GET /api/profile` & `PUT /api/profile` – Manage household vulnerability settings *(Requires Bearer Token)*

---

## 📄 License
ISC License &copy; 2026 AirGuard Team. Developed for community urban air protection.
