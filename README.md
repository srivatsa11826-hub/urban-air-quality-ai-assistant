# 🌬️ AirGuard – Urban Air Quality Assistant

> A full-stack GenAI-powered assistant helping families navigate urban air pollution with personalized routines, indoor air quality hacks, and sustainable alternatives.

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Edit `.env` file and add your API keys:
```env
GEMINI_API_KEY=your_gemini_api_key_here    # https://aistudio.google.com/app/apikey
WAQI_API_TOKEN=demo                         # https://aqicn.org/data-platform/token/ (optional, for real AQI)
JWT_SECRET=change_this_to_a_random_string
```

### 3. Start the server
```bash
npm start
# or for development with auto-restart:
npm run dev
```

### 4. Open your browser
Visit **http://localhost:3000**

---

## 🏗 Architecture

```
urban quality air/
├── server.js              # Express server entry point
├── package.json
├── .env                   # Environment config
├── airguard.db            # SQLite database (auto-created)
│
├── db/
│   └── database.js        # SQLite schema & connection
│
├── routes/
│   ├── auth.js            # Register, login, JWT
│   ├── profile.js         # User preferences
│   ├── aqi.js             # AQI data (WAQI API + cache)
│   ├── chat.js            # Gemini AI chat + content generation
│   └── impact.js          # Eco-action logging
│
├── middleware/
│   └── auth.js            # JWT verification middleware
│
└── public/                # Static frontend (served by Express)
    ├── index.html         # Single-page app shell
    ├── css/style.css
    └── js/
        ├── api.js         # Backend API client
        └── app.js         # Frontend application logic
```

## 🗄 Database Schema (SQLite)

| Table | Description |
|-------|-------------|
| `users` | Authentication (email, hashed password, JWT) |
| `profiles` | Lifestyle preferences (city, transport, health, budget) |
| `chat_sessions` | Grouped conversations with auto-titles |
| `chat_messages` | Full message history per session |
| `aqi_readings` | Cached AQI data with 30-min TTL |
| `recommendations` | AI-generated routines/tips (bookmarkable) |
| `impact_log` | User-logged eco-actions with CO₂ tracking |

## ✨ Features

| Feature | Description |
|---------|-------------|
| **🔐 Auth** | Register/login with JWT, password change |
| **👤 Profile** | Personalized setup (city, health, transport, budget) |
| **💬 AI Chat** | Multi-turn Gemini conversations with memory |
| **📊 AQI Dashboard** | Live/simulated AQI gauge + 7-day history chart |
| **🗓 Routines** | AI-generated low-emission daily routines |
| **🏠 Indoor Tips** | Personalized indoor air quality hacks |
| **♻ Alternatives** | Before/after green swap comparisons with savings |
| **🌱 Impact Log** | Track eco-actions and CO₂ saved |
| **📱 Responsive** | Works on mobile and desktop |

## 🔑 API Keys

| Key | Required | Where to get |
|-----|----------|-------------|
| `GEMINI_API_KEY` | **Yes** | [aistudio.google.com](https://aistudio.google.com/app/apikey) — Free |
| `WAQI_API_TOKEN` | Optional | [aqicn.org](https://aqicn.org/data-platform/token/) — Free; uses `demo` token otherwise |

> Users can also supply their own Gemini API key in their profile settings.

## 🛡 Security
- Passwords hashed with bcrypt (12 rounds)
- JWT tokens (7-day expiry)
- Rate limiting: 200 req/15min (API), 20 req/15min (auth)
- Helmet.js security headers
- Input sanitization

## 📡 API Endpoints

```
POST /api/auth/register        — Create account
POST /api/auth/login           — Sign in → JWT token
GET  /api/auth/me              — Get current user
GET  /api/profile              — Get user profile
PUT  /api/profile              — Update profile
GET  /api/aqi/current          — Fetch AQI (cached 30 min)
GET  /api/aqi/history?days=7   — Historical readings
GET  /api/chat/sessions        — List conversations
POST /api/chat/sessions        — New conversation
POST /api/chat/sessions/:id/message — Send message → AI response
POST /api/chat/generate        — Generate routines/indoor/alternatives
GET  /api/impact               — Get impact log
POST /api/impact               — Log eco-action
```
