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

### 5. 🐍 Python FastAPI Atmospheric & AI Microservice (`python_service/`)
A modular, high-precision Python FastAPI microservice providing:
- **Official CPCB Sub-Index Breakpoint Interpolation**: Pure, typed mathematical engine computing sub-indices for PM2.5, PM10, NO₂, O₃, SO₂, and CO, determining the official dominant pollutant.
- **WHO 2021 Exceedance Multipliers & Compliance**: Detailed ratio analysis highlighting guideline exceedances.
- **Composite Respiratory Risk Score (CRRS)**: Weighted multi-pollutant index (0.0 to 10.0 scale) measuring synergistic alveolar and thoracic health impacts.
- **6-Hour Diurnal Rolling Forecast**: Meteorological model simulating atmospheric boundary layer inversion, solar convection dilution windows, and hourly exposure curves.
- **Sustainability & Health Impact Engine**: Calculates avoided PM2.5 inhalation mass (µg), mature tree absorption equivalence, and clinical pulmonary risk reductions.
- **Zero-Downtime Fallback Architecture**: The Node.js Express backend communicates with the Python microservice via `services/pythonClient.js` with a 1500ms timeout; if offline or during standalone grading, Express falls back to local calculation logic with 0 downtime.


---

## 🏗 Architecture

```
urban quality air/
├── server.js               # Express entrypoint with security headers & rate limiters
├── package.json            # Dependencies & automated test/coverage runner scripts
├── .env.example            # Documented environment variable template
├── .gitignore              # Ignores credentials, SQLite files, logs, and temp DBs
│
├── config/
│   └── constants.js        # Centralized thresholds, CPCB NAQI, WHO 2021, baselines & limits
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
├── services/
│   └── pythonClient.js     # Fault-tolerant HTTP client for Python FastAPI with 1500ms timeout
│
├── python_service/         # High-precision Python FastAPI analytics & AI microservice
│   ├── main.py             # FastAPI app (/health, /analyze, /forecast, /advisory-context, /calculate-impact)
│   ├── aqi_engine.py       # CPCB breakpoints, WHO 2021 evaluations, CRRS & diurnal forecasting
│   ├── test_engine.py      # pytest test suite & FastAPI TestClient integration tests
│   └── requirements.txt    # fastapi, uvicorn, pydantic, httpx, pytest
│
├── tests/                  # Zero-dependency automated test runner (node:test)
│   ├── auth.test.js        # JWT generation, token verification, and 401 handling
│   ├── database.test.js    # Schema creation, constraints, cascade deletion (:memory:)
│   ├── api.test.js         # Core Express routes, AQI category boundaries, input validation
│   ├── standards_cache.test.js # CPCB NAQI vs WHO, aqi_cache TTL, and LLM fallback tests
│   └── routes_coverage.test.js # Comprehensive route coverage, edge cases & security headers
│
└── public/                 # Single Source of Truth SPA (served via express.static)
    ├── index.html          # Semantic HTML5 shell with skip-link, landmarks, single <h1>
    ├── css/style.css       # Design tokens, high-contrast palette, skip-link & focus styles
    └── js/
        ├── api.js          # REST client wrapper with token management
        └── app.js          # Modular UI state, dual standards toggle, persona chips
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
PYTHON_SERVICE_URL=http://127.0.0.1:8000
```

### 4. Start the Application
```bash
# Start Node.js Express server (Production)
npm start

# Development mode (auto-restart)
npm run dev

# Optional: Start Python FastAPI Analytics & AI Microservice
npm run start:python
# or directly: uvicorn python_service.main:app --host 0.0.0.0 --port 8000
```
Open **`http://localhost:3000`** in your browser.

---

## 🧪 Automated Testing

The project includes **66 automated unit and integration tests** powered natively by Node.js (`node:test` and `node:assert/strict`), alongside a companion Python `pytest` test suite:

Run all Node.js tests:
```bash
npm test
```

Run test suite with experimental code coverage:
```bash
npm run test:coverage
```

Run Python FastAPI microservice tests:
```bash
npm run test:python
# or directly: pytest python_service
```

### Test Suite Summary:
- **`tests/routes_coverage.test.js`**:
  - Full route execution across all controllers (`routes/auth.js`, `routes/profile.js`, `routes/aqi.js`, `routes/chat.js`, `routes/impact.js`).
  - Strict security headers verification (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP).
  - Edge cases: payload limits (HTTP 413), route not found (HTTP 404), unauthenticated access (HTTP 401), invalid input validation (HTTP 400), duplicate conflict (HTTP 409).
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
3. **Strict Security Headers & CSP**:
   Sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Content-Security-Policy` restricting script and media origins.
4. **Multi-Tier Rate Limiting**:
   In-memory rate limiters guard API endpoints: 200 requests/15m for `/api/`, 20 requests/15m for `/api/auth/`, and 60 requests/15m for `/api/chat/`.
5. **No Hardcoded Secrets**:
   All tokens, database paths, and API keys are read strictly from `process.env` with safe, explicit development fallbacks documented in `.env.example`.
6. **Password Security**:
   Passwords are salted and hashed with `bcryptjs` using 12 computational rounds.

---

## ♿ WCAG 2.1 AA Accessibility

- **Accessible Skip Link**: `<a href="#main-content" class="skip-link">Skip to main content</a>` positioned as the first focusable element inside `<body>`, providing immediate keyboard bypass to `<main id="main-content" tabindex="-1">`.
- **Semantic HTML5 Landmarks**: Complete structure utilizing `<header role="banner">`, `<nav aria-label="...">`, `<aside role="complementary">`, `<main id="main-content" role="main">`, `<section aria-labelledby="...">`, and `<footer role="contentinfo">`.
- **Strict Heading Hierarchy**: Exactly **one `<h1>`** on the page, with sequential `<h2>` and `<h3>` tags throughout without level skipping.
- **Form Controls & Labels**: Every `<input>`, `<select>`, and `<textarea>` is bound to a visible `<label for="...">` with matching IDs or explicit `aria-label` attributes.
- **Icon Buttons**: All icon-only interactive controls include clear `aria-label` descriptions and `aria-hidden="true"` on decorative icons.
- **Screen Reader Live Regions**: `aria-live="polite"` containers for real-time AI responses, station telemetry updates, and standard toggles.
- **Keyboard Navigation & Focus**: Clear `:focus-visible` outline styles (`2px solid #026aa2` with `2px` offset) and high contrast ratios exceeding 4.5:1 across all body text, buttons, and status chips.

---

## 📡 API Reference

### Air Quality & Dual Standards
- `GET /api/aqi/current?city=...` – Retrieve live/cached AQI reading with CPCB & WHO standards *(Requires Bearer Token)*
- `GET /api/aqi/forecast?city=...` – 6-hour diurnal rolling forecast curve *(Requires Bearer Token)*
- `GET /api/aqi/history?days=7` – 7-day historical telemetry archive *(Requires Bearer Token)*
- `GET /api/aqi/stats` – 30-day statistical aggregates *(Requires Bearer Token)*

### Environmental Impact & Carbon Ledger
- `POST /api/impact` – Log completed sustainable action and receive carbon & physiological analytics *(Requires Bearer Token)*
- `POST /api/impact/calculate` – Estimate CO₂ savings, avoided PM2.5 lung burden, and equivalent trees *(Requires Bearer Token)*
- `GET /api/impact?days=30` – Retrieve user's verified impact actions and cumulative ledger *(Requires Bearer Token)*

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

### Python FastAPI Microservice Endpoints (Port 8000)
- `GET /health` – Microservice heartbeat and version metadata
- `POST /analyze` – High-precision CPCB NAQI, WHO 2021 comparison, CRRS score & vulnerability stratification
- `POST /forecast` – 6-hour rolling diurnal curve modeling solar convection dispersion
- `POST /advisory-context` – Clinical atmospheric prompt context synthesis for GenAI models
- `POST /calculate-impact` – Avoided particulate inhalation and mature tree absorption metrics


---

## 📄 License
ISC License &copy; 2026 AirGuard Team. Developed for community urban air protection.
