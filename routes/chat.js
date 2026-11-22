/**
 * @fileoverview Chat & Clean Air Advisory Generation Router
 * Provides conversational guidance with Google Gemini models, chat history sessions,
 * and deterministic, clinical-grade rule-based fallbacks for winter smog mitigation.
 */

const express = require('express');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const auth = require('../middleware/auth');
const { callPythonService } = require('../services/pythonClient');
const {
  DEFAULT_CITY,
  DEFAULT_FAMILY_SIZE,
  DEFAULT_HEALTH_CONCERNS,
  DEFAULT_TRANSPORT,
  DEFAULT_WORK_STYLE,
  DEFAULT_BUDGET,
} = require('../config/constants');

const router = express.Router();
router.use(auth);

// ============================================================
//  System Prompt Builder
// ============================================================

/**
 * Builds the personalized system prompt for Gemini LLM.
 * @param {object} profile - Household profile
 * @param {object|null} aqiInfo - Active atmospheric telemetry
 * @returns {string} System prompt string
 */
function buildSystemPrompt(profile, aqiInfo) {
  return `You are AirGuard, an expert urban air quality AI assistant specialized in helping families navigate air pollution in Indian and Asian cities.

USER PROFILE:
- City: ${profile.city}, ${profile.country || 'India'}
- Household size: ${profile.family_size} people
- Health concerns: ${profile.health_concerns}
- Primary transport: ${profile.transport}
- Work style: ${profile.work_style}
- Budget for eco-upgrades: ${profile.budget}
- Specific concerns: ${profile.specific_concerns || 'None specified'}
${aqiInfo ? `- Current AQI: ${aqiInfo.aqi} (${aqiInfo.category || 'Unknown'}) — ${aqiInfo.dominant || 'PM2.5'} dominant` : ''}

YOUR ROLE:
1. Give hyper-personalized advice based on this profile
2. Always explain the DIRECT HEALTH IMPACT with numbers/percentages
3. Suggest LOW-EMISSION DAILY ROUTINES tailored to their lifestyle
4. Provide INDOOR AIR QUALITY HACKS appropriate to their budget
5. Recommend SUSTAINABLE ALTERNATIVES with concrete savings (Indian market context)
6. Use data: e.g. "switching from gas stove to induction reduces indoor VOCs by ~40%"
7. Be empathetic — air pollution is a daily stress for families
8. November context: peak winter smog season in North India (crop burning, temperature inversion)

FORMATTING:
- Bold **key numbers** and facts
- ✅ safe actions, ⚠️ cautions, 🔴 high-risk items
- Use ## for section headers, bullet points
- Always include "💚 Impact on Your Family" section
- End with "⚡ Quick Win for Today"
- Keep responses under 400 words unless detail is explicitly requested`;
}

// ============================================================
//  Domain Advisory Rule-Based Builders (<35 lines each)
// ============================================================

/**
 * Resolves severity label and icon according to CPCB NAQI.
 * @param {number} aqi - Numeric AQI
 * @returns {{ status: string, icon: string }} Severity details
 */
function resolveSeverityDetails(aqi) {
  if (aqi <= 50) return { status: 'Good', icon: '✅' };
  if (aqi <= 100) return { status: 'Satisfactory', icon: '✅' };
  if (aqi <= 200) return { status: 'Moderate', icon: '⚠️' };
  if (aqi <= 300) return { status: 'Poor', icon: '🔴' };
  if (aqi <= 400) return { status: 'Very Poor', icon: '🔴' };
  return { status: 'Severe', icon: '🚨' };
}

/**
 * Build exercise / running advice block.
 */
function buildExerciseAdvice(city, aqi, pm25, whoMultiplier) {
  if (aqi > 150) {
    return {
      core: `🔴 **Outdoor Aerobic Exercise Not Recommended Today in ${city}**\n` +
        `- At current AQI **${aqi}** (PM2.5: **${pm25} µg/m³**, **${whoMultiplier}x WHO 24h limit**), running or high-intensity cardiovascular training increases minute respiratory ventilation by **400% to 600%**.\n` +
        `- Deep inhalation bypasses upper nasal cilia and deposits ultrafine combustion soot directly into bronchioles and capillary beds.\n` +
        `- **Safe Alternative:** Transition to indoor strength, mobility, or stationary cycling in a room with air filtration operating on Medium or High speed.`,
      family: `Avoiding peak-pollution exertion cuts pulmonary soot deposition by **~75%** and prevents exercise-induced bronchospasm.`,
      quick: `Do 30 minutes of indoor bodyweight exercise and keep bedroom windows sealed during dawn and dusk.`,
    };
  }
  return {
    core: `✅ **Modified Outdoor Activity Permitted in ${city}**\n` +
      `- Current AQI **${aqi}** allows light outdoor cardio, but schedule activity strictly between **12:30 PM and 4:00 PM** when daytime solar convection elevates the atmospheric boundary layer and disperses trapped ground soot.\n` +
      `- Avoid early dawn (6:00 AM – 9:00 AM) and evening hours when thermal inversion concentrates exhaust.`,
    family: `Scheduling activities during midday dispersion cuts particulate exposure by up to **40%**.`,
    quick: `Complete outdoor workouts before 4:00 PM and switch to indoor recovery afterwards.`,
  };
}

/**
 * Build child, infant, and asthma safety advice block.
 */
function buildPediatricAdvice() {
  return {
    core: `⚠️ **High-Vulnerability Pediatric & Asthma Action Protocol**\n` +
      `- Children breathe **50% more air per pound of body weight** than adults, and their developing lung tissue is vulnerable to PM2.5-induced chronic alveolar inflammation.\n` +
      `- **Commute & School Defense:** Ensure well-fitted N95/KF94 respirators during morning travel; request school administration to suspend unvented outdoor morning assemblies.\n` +
      `- **Asthma Management:** Keep bronchodilator rescue inhalers easily accessible; cold smog triggers bronchoconstriction in **~60%** of asthmatic children.`,
    family: `Creating an indoor clean-air sanctuary with HEPA/MERV-13 filtration drops bedtime respiratory resistance and nighttime coughing episodes by **~55%**.`,
    quick: `Place your primary air purifier directly in the children's or elderly family member's bedroom running continuously on low-noise mode.`,
  };
}

/**
 * Build thermal inversion and timed ventilation advice block.
 */
function buildVentilationAdvice(city) {
  return {
    core: `🪟 **Calibrated Ventilation Windows for ${city} (Thermal Inversion Science)**\n` +
      `- **🔴 DO NOT OPEN:** 06:00 AM – 09:30 AM (Morning smog inversion peak) and after 07:00 PM (Nocturnal boundary layer collapse).\n` +
      `- **✅ OPTIMAL VENTILATION WINDOW:** Between **12:30 PM and 3:30 PM**.\n` +
      `- Ground solar heating breaks nocturnal cold inversion, diluting surface particulate concentrations by up to **40%**.\n` +
      `- Run a quick 15-minute cross-ventilation burst to evacuate indoor CO₂, then reseal and cycle indoor filtration.`,
    family: `Timed ventilation eliminates stale indoor CO₂ build-up without contaminating living spaces with dangerous traffic soot.`,
    quick: `Set an alarm for 1:30 PM for a 15-minute home air cycle, then turn vehicle AC to internal recirculation.`,
  };
}

/**
 * Build atmospheric inversion / why air quality is high advice block.
 */
function buildInversionAdvice(city, pm25, pm10, whoMultiplier) {
  return {
    core: `🌫️ **Atmospheric Inversion & Emission Dynamics in ${city}**\n` +
      `- Current PM2.5 stands at **${pm25} µg/m³** (${whoMultiplier}x WHO 24h limit) and PM10 at **${pm10} µg/m³**.\n` +
      `- **Winter Thermal Inversion:** Rapid nocturnal radiation cooling creates a warm air "lid" at 100m–300m elevation, trapping urban exhaust (vehicular tailpipe soot, construction dust, cooking combustion) near ground level.\n` +
      `- **Calm Winds:** Low horizontal wind speeds (<6 km/h) prevent dispersion, causing particulate matter to accumulate day-over-day.`,
    family: `Understanding inversion cycles enables your household to schedule travel and ventilation when ambient exposure is lowest.`,
    quick: `Avoid burning incense, dhoop, or open mosquito coils indoors today—indoor combustion adds up to 300 µg/m³ of toxic VOCs.`,
  };
}

/**
 * Build air purifier and indoor filtration advice block.
 */
function buildPurifierAdvice() {
  return {
    core: `🏠 **Indoor Air Quality & Economical Filtration Upgrades**\n` +
      `- **Purifier Placement:** Position filtration units at least 0.5m away from walls in the center of occupied spaces for continuous laminar flow.\n` +
      `- **Economical Corsi-Rosenthal Box:** A standard 20-inch box fan taped to four MERV-13 filters costs under ₹2,500 and achieves a Clean Air Delivery Rate (CADR) equivalent to ₹20,000 commercial HEPA units.\n` +
      `- **Kitchen Hazard:** High-temperature frying produces up to **450 µg/m³** of indoor particulate. Keep kitchen exhaust fans active and close connecting doors.`,
    family: `HEPA filtration in the main living space reduces 24-hour inhaled particulate mass by **65% to 80%**.`,
    quick: `Damp-wipe surfaces with a microfiber cloth instead of dry dusting or sweeping, which re-suspends settled toxic dust into breathing zones.`,
  };
}

/**
 * Build generic clinical advisory block.
 */
function buildGeneralAdvice(city, aqi, pm25, whoMultiplier, familySize, healthConcerns, severityIcon, severityStatus) {
  return {
    core: `${severityIcon} **Clean Air Advisory for ${city} (AQI: ${aqi} — ${severityStatus})**\n` +
      `- Active atmospheric readings indicate PM2.5 is **${pm25} µg/m³** (${whoMultiplier}x WHO 24-hour benchmark).\n` +
      `- **Travel:** Wear a certified N95 mask for transit; adjust car ventilation to internal recirculation.\n` +
      `- **Household Health:** Family members (${familySize} people, health priority: ${healthConcerns}) should minimize prolonged outdoor exposure during dawn and late night hours.`,
    family: `Proactive behavioral adjustments eliminate **~60%** of peak particulate lung intake during high-smog periods.`,
    quick: `Drink warm fluids, use saline nasal rinses after commuting, and ensure air purifiers run throughout sleep hours.`,
  };
}

/**
 * Deterministic, domain-accurate rule-based health advisory generator.
 * @param {string} userPrompt - User's chat question
 * @param {object} profile - Household profile
 * @param {object} aqiData - Atmospheric telemetry data
 * @returns {string} Formatted clinical advisory markdown
 */
function generateFallbackAdvisory(userPrompt, profile = {}, aqiData = {}) {
  const safePrompt = typeof userPrompt === 'string' ? userPrompt.toLowerCase() : '';
  const city = profile?.city || aqiData?.city || DEFAULT_CITY;
  const aqi = aqiData?.aqi || 185;
  const pm25 = aqiData?.pm25 || 115;
  const pm10 = aqiData?.pm10 || 160;
  const familySize = profile?.family_size || DEFAULT_FAMILY_SIZE;
  const healthConcerns = profile?.health_concerns || DEFAULT_HEALTH_CONCERNS;
  const whoMultiplier = parseFloat((pm25 / 15).toFixed(1));

  const { status: severityStatus, icon: severityIcon } = resolveSeverityDetails(aqi);

  let advice = null;
  if (/run|jog|workout|exercise|walk|outdoor|play|sports|cricket|marathon|cycle/.test(safePrompt)) {
    advice = buildExerciseAdvice(city, aqi, pm25, whoMultiplier);
  } else if (/child|kid|baby|infant|asthma|bronchitis|elderly|senior|pregnant|heart|chest|cough|inhaler|respiratory/.test(safePrompt)) {
    advice = buildPediatricAdvice();
  } else if (/window|ventilat|fresh air|morning air|inversion|air out|timing/.test(safePrompt)) {
    advice = buildVentilationAdvice(city);
  } else if (/why|high|spike|reason|cause|inversion|source|stubble|smog/.test(safePrompt)) {
    advice = buildInversionAdvice(city, pm25, pm10, whoMultiplier);
  } else if (/purifier|hepa|filter|corsi|plant|indoor|kitchen|cook|smoke/.test(safePrompt)) {
    advice = buildPurifierAdvice();
  } else {
    advice = buildGeneralAdvice(city, aqi, pm25, whoMultiplier, familySize, healthConcerns, severityIcon, severityStatus);
  }

  return `## ${severityIcon} AirGuard Clinical Advisory — ${city}\n\n` +
    `Current Atmospheric Telemetry: **AQI ${aqi} (${severityStatus})** | PM2.5: **${pm25} µg/m³** (**${whoMultiplier}x WHO 24h limit**)\n\n` +
    `${advice.core}\n\n` +
    `## 💚 Impact on Your Family\n` +
    `${advice.family}\n\n` +
    `## ⚡ Quick Win for Today\n` +
    `${advice.quick}`;
}

// ============================================================
//  Gemini API Helpers (<35 lines each)
// ============================================================

/**
 * Execute a single request to Gemini model endpoint.
 */
async function trySingleGeminiModel(model, apiKey, payload) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 20000,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 404 || err.error?.status === 'NOT_FOUND') {
      return { notFound: true };
    }
    throw new Error(err.error?.message || `Gemini API error ${resp.status}`);
  }

  const data = await resp.json();
  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || '' };
}

/**
 * Robust caller for Gemini with multiple model failovers.
 */
async function callGemini(messages, systemInstruction, apiKey) {
  const modelsToTry = [
    process.env.GEMINI_MODEL,
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-exp',
  ].filter(Boolean);

  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const payload = {
        contents: messages,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 2048 },
      };
      const result = await trySingleGeminiModel(model, apiKey, payload);
      if (result.notFound) continue;
      return result.text;
    } catch (e) {
      lastError = e;
      if (e.message && e.message.includes('not found')) continue;
      throw e;
    }
  }

  throw lastError || new Error('All Gemini models failed. Please check your API key.');
}

// ============================================================
//  Chat Context Helpers (<35 lines each)
// ============================================================

/**
 * Retrieve user profile with safe defaults.
 */
function resolveUserProfile(db, userId) {
  return db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) || {
    city: DEFAULT_CITY,
    family_size: DEFAULT_FAMILY_SIZE,
    health_concerns: DEFAULT_HEALTH_CONCERNS,
    transport: DEFAULT_TRANSPORT,
    work_style: DEFAULT_WORK_STYLE,
    budget: DEFAULT_BUDGET,
  };
}

/**
 * Retrieve latest user AQI reading with safe defaults.
 */
function resolveLatestAqi(db, userId, city) {
  return db.prepare('SELECT * FROM aqi_readings WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1').get(userId) || {
    aqi: 185,
    city: city || DEFAULT_CITY,
    pm25: 115,
    pm10: 160,
    category: 'Unhealthy',
  };
}

/**
 * Execute AI response or smoothly invoke rule-based fallback.
 */
async function generateAiOrFallback(apiKey, messages, systemPrompt, userMessage, profile, aqiData) {
  if (apiKey && apiKey !== 'your_gemini_api_key_here') {
    try {
      const aiResponse = await callGemini(messages, systemPrompt, apiKey);
      return { message: aiResponse, fallback: false, source: 'gemini' };
    } catch (err) {
      console.warn('Gemini API call failed, activating rule-based advisory fallback:', err.message);
    }
  }
  return {
    message: generateFallbackAdvisory(userMessage, profile, aqiData),
    fallback: true,
    source: 'rule-based-fallback',
  };
}

// ============================================================
//  Sessions Routes
// ============================================================

// GET /api/chat/sessions
router.get('/sessions', (req, res) => {
  try {
    const db = getDb();
    const sessions = db.prepare(`
      SELECT cs.id, cs.uuid, cs.title, cs.created_at, cs.updated_at,
             COUNT(cm.id) as message_count
      FROM chat_sessions cs
      LEFT JOIN chat_messages cm ON cm.session_id = cs.id
      WHERE cs.user_id = ?
      GROUP BY cs.id
      ORDER BY cs.updated_at DESC LIMIT 50
    `).all(req.user.id);
    res.json({ sessions });
  } catch (err) {
    console.error('Get sessions error:', err);
    res.status(500).json({ error: 'Failed to retrieve chat sessions' });
  }
});

// POST /api/chat/sessions
router.post('/sessions', (req, res) => {
  try {
    const db = getDb();
    const uuid = uuidv4();
    const title = typeof req.body?.title === 'string' && req.body.title.trim()
      ? req.body.title.trim()
      : 'New Conversation';
    const result = db.prepare('INSERT INTO chat_sessions (uuid, user_id, title) VALUES (?, ?, ?)').run(uuid, req.user.id, title);
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ session });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create chat session' });
  }
});

// DELETE /api/chat/sessions/:uuid
router.delete('/sessions/:uuid', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM chat_sessions WHERE uuid = ? AND user_id = ?').run(req.params.uuid, req.user.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete session error:', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// GET /api/chat/sessions/:uuid/messages
router.get('/sessions/:uuid/messages', (req, res) => {
  try {
    const db = getDb();
    const session = db.prepare('SELECT * FROM chat_sessions WHERE uuid = ? AND user_id = ?').get(req.params.uuid, req.user.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(session.id);
    res.json({ session, messages });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

/**
 * Persist incoming user message and update session metadata.
 * @param {DatabaseSync} db - Active database instance
 * @param {object} session - Chat session record
 * @param {string} message - Message text
 * @param {boolean} hasHistory - Whether previous messages exist
 */
function recordUserChatMessage(db, session, message, hasHistory) {
  db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(session.id, 'user', message);
  if (!hasHistory) {
    const title = message.length > 52 ? message.substring(0, 52) + '…' : message;
    db.prepare("UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, session.id);
  } else {
    db.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?").run(session.id);
  }
}

/**
 * Resolves formatted chat message history for Gemini conversational context.
 * @param {DatabaseSync} db - Active database instance
 * @param {number} sessionId - Chat session ID
 * @param {string} message - Incoming user message
 * @returns {{ history: Array, geminiMessages: Array }}
 */
function buildGeminiHistory(db, sessionId, message) {
  const history = db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 20').all(sessionId).reverse();
  const geminiMessages = [
    ...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
  return { history, geminiMessages };
}

/**
 * Resolves Python advisory context with zero-downtime fallback.
 * @param {string} message - User query
 * @param {object} profile - User profile
 * @param {object} aqiData - Atmospheric telemetry
 * @returns {Promise<object|null>} Python advisory context or null
 */
async function fetchAdvisoryContext(message, profile, aqiData) {
  return await callPythonService('/advisory-context', {
    user_prompt: message,
    city: profile.city,
    aqi: aqiData.aqi,
    pm25: aqiData.pm25,
    pm10: aqiData.pm10,
    family_size: profile.family_size,
    health_concerns: profile.health_concerns,
  });
}

// POST /api/chat/sessions/:uuid/message
router.post('/sessions/:uuid/message', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const db = getDb();
    const session = db.prepare('SELECT * FROM chat_sessions WHERE uuid = ? AND user_id = ?').get(req.params.uuid, req.user.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const profile = resolveUserProfile(db, req.user.id);
    const aqiData = resolveLatestAqi(db, req.user.id, profile.city);
    const { history, geminiMessages } = buildGeminiHistory(db, session.id, message);

    recordUserChatMessage(db, session, message, history.length > 0);

    const apiKey = profile.gemini_api_key || process.env.GEMINI_API_KEY;
    const pyContext = await fetchAdvisoryContext(message, profile, aqiData);
    const { message: aiResponse, fallback: isFallback, source } = await generateAiOrFallback(
      apiKey, geminiMessages, buildSystemPrompt(profile, aqiData), message, profile, aqiData
    );

    db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(session.id, 'assistant', aiResponse);
    res.json({
      message: aiResponse,
      session_uuid: session.uuid,
      aqi_context: aqiData?.aqi || null,
      fallback: isFallback,
      source,
      python_context: pyContext,
    });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Internal chat error' });
  }
});

// ============================================================
//  Generation & Recommendation Routes (<35 lines each)
// ============================================================

/**
 * Returns structured prompt for one-shot generators.
 */
function getStructuredPrompt(type, profile, aqiVal, aqiCat) {
  const prompts = {
    routines: `Create 6 personalized low-emission daily routine cards for:
City: ${profile.city} (AQI: ${aqiVal}, ${aqiCat}) | Family: ${profile.family_size} | Health: ${profile.health_concerns} | Transport: ${profile.transport} | Work: ${profile.work_style} | Budget: ${profile.budget} | November winter smog season.
Return ONLY a valid JSON array:
[{"title":"...","icon":"...","color":"#hex","tips":["...","...","..."],"impact":"..."}]`,

    indoor: `Create 8 indoor air quality improvement tip cards for a ${profile.family_size}-person household in ${profile.city}. Budget: ${profile.budget}. Health: ${profile.health_concerns}.
Return ONLY valid JSON array:
[{"title":"...","icon":"...","tips":["...","...","..."],"cost":"Free|<₹500|₹500-₹2000|₹2000-₹10000|₹10000+"}]`,

    alternatives: `Generate 6 sustainable alternative comparisons for a family in ${profile.city}.
Return ONLY valid JSON array:
[{"badOption":{"name":"...","description":"...","emission":"...","healthRisk":"..."},"goodOption":{"name":"...","description":"...","saving":"..."},"category":"Transport|Energy|Food|Home|Shopping|Lifestyle","difficulty":"Easy|Medium|Hard","monthlySaving":"₹X"}]`,

    room_audit: `Analyze indoor air quality room-by-room for a home in ${profile.city} (AQI: ${aqiVal}).
Return ONLY valid JSON array of 5 room objects:
[{"room":"Living Room","icon":"🛋️","threatLevel":"Moderate","threats":["threat 1"],"hacks":["hack 1"],"pmReduction":"-45% PM2.5"}]`,

    family_plan: `Create a daily Clean Air Action Plan for a family in ${profile.city} (AQI: ${aqiVal}).
Return ONLY a valid JSON array of 8 checklist action items for today:
[{"id":1,"time":"06:30 AM","title":"Morning Air Inversion Check","action":"Keep windows sealed.","category":"Indoor","co2":0.2,"completed":false}]`,

    aqi_insight: `Write a 3-4 sentence health advisory for AQI ${aqiVal} (${aqiCat}) in ${profile.city}. Plain text only.`,
  };
  return prompts[type] || null;
}

/**
 * Persists parsed structured recommendation array.
 * @param {DatabaseSync} db - Database instance
 * @param {number} userId - User ID
 * @param {string} type - Recommendation type
 * @param {string} raw - Raw LLM JSON string
 * @param {number|null} aqiVal - AQI context
 * @returns {Array<object>|null} Parsed recommendations or null
 */
function persistStructuredRecommendations(db, userId, type, raw, aqiVal) {
  if (!raw || !['routines', 'indoor', 'alternatives', 'room_audit', 'family_plan'].includes(type)) return null;
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    db.prepare('INSERT INTO recommendations (user_id, type, title, content, aqi_context) VALUES (?, ?, ?, ?, ?)').run(
      userId, type, `${type} — ${new Date().toLocaleDateString()}`, JSON.stringify(parsed), aqiVal || null
    );
    return parsed;
  } catch (_) {
    return null;
  }
}

/**
 * Attempt to generate content via Gemini LLM if key is configured.
 * @param {string|null} apiKey - Gemini API Key
 * @param {string} prompt - Generation prompt
 * @param {object} profile - Household profile
 * @param {object} aqiData - Active AQI data
 * @returns {Promise<string|null>} Raw output or null
 */
async function fetchGeminiGeneration(apiKey, prompt, profile, aqiData) {
  if (!apiKey || apiKey === 'your_gemini_api_key_here') return null;
  try {
    return await callGemini([{ role: 'user', parts: [{ text: prompt }] }], buildSystemPrompt(profile, aqiData), apiKey);
  } catch (err) {
    console.warn('Gemini generation failed:', err.message);
    return null;
  }
}

// POST /api/chat/generate
router.post('/generate', async (req, res) => {
  try {
    const { type } = req.body || {};
    if (!type || typeof type !== 'string') return res.status(400).json({ error: 'type is required' });

    const db = getDb();
    const profile = resolveUserProfile(db, req.user.id);
    const aqiData = resolveLatestAqi(db, req.user.id, profile.city);
    const prompt = getStructuredPrompt(type, profile, aqiData.aqi, aqiData.category);
    if (!prompt) return res.status(400).json({ error: 'Invalid type' });

    const raw = await fetchGeminiGeneration(profile.gemini_api_key || process.env.GEMINI_API_KEY, prompt, profile, aqiData);

    if (!raw && type === 'aqi_insight') {
      const insight = `⚠️ **AQI ${aqiData.aqi} (${aqiData.category}) in ${profile.city}**: Particulate concentrations exceed safe thresholds. Avoid strenuous exercise. Wear N95 masks during transit.`;
      return res.json({ data: insight, type, fallback: true });
    }

    const parsed = persistStructuredRecommendations(db, req.user.id, type, raw, aqiData?.aqi);
    if (parsed) return res.json({ data: parsed, type, aqi: aqiData?.aqi });
    if (raw) return res.json({ data: raw, type });

    res.json({
      data: generateFallbackAdvisory(`Generate ${type} advice`, profile, aqiData),
      type,
      fallback: true,
    });
  } catch (err) {
    console.error('Generate handler error:', err);
    res.status(500).json({ error: 'Internal generation error' });
  }
});

// GET /api/chat/recommendations
router.get('/recommendations', (req, res) => {
  try {
    const db = getDb();
    const { type, bookmarked } = req.query;
    let q = 'SELECT * FROM recommendations WHERE user_id = ?';
    const params = [req.user.id];
    if (type) { q += ' AND type = ?'; params.push(type); }
    if (bookmarked === '1') { q += ' AND is_bookmarked = 1'; }
    q += ' ORDER BY generated_at DESC LIMIT 20';
    res.json({ recommendations: db.prepare(q).all(...params) });
  } catch (err) {
    console.error('Get recommendations error:', err);
    res.status(500).json({ error: 'Failed to retrieve recommendations' });
  }
});

// PATCH /api/chat/recommendations/:id/bookmark
router.patch('/recommendations/:id/bookmark', (req, res) => {
  try {
    const db = getDb();
    const rec = db.prepare('SELECT * FROM recommendations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    const newVal = rec.is_bookmarked ? 0 : 1;
    db.prepare('UPDATE recommendations SET is_bookmarked = ? WHERE id = ?').run(newVal, rec.id);
    res.json({ bookmarked: !!newVal });
  } catch (err) {
    console.error('Bookmark error:', err);
    res.status(500).json({ error: 'Failed to update bookmark' });
  }
});

router.generateFallbackAdvisory = generateFallbackAdvisory;

module.exports = router;
