const express = require('express');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

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

// Deterministic, domain-accurate rule-based health advisory generator
function generateFallbackAdvisory(userPrompt, profile = {}, aqiData = {}) {
  const safePrompt = typeof userPrompt === 'string' ? userPrompt.toLowerCase() : '';
  const city = profile?.city || aqiData?.city || 'your city';
  const aqi = aqiData?.aqi || 185;
  const pm25 = aqiData?.pm25 || 115;
  const pm10 = aqiData?.pm10 || 160;
  const familySize = profile?.family_size || '3-4';
  const healthConcerns = profile?.health_concerns || 'none';
  const whoMultiplier = parseFloat((pm25 / 15).toFixed(1));

  // Determine severity tier based on CPCB / scientific standards
  let severityStatus = 'Moderate';
  let severityIcon = '⚠️';
  if (aqi <= 50) { severityStatus = 'Good'; severityIcon = '✅'; }
  else if (aqi <= 100) { severityStatus = 'Satisfactory'; severityIcon = '✅'; }
  else if (aqi <= 200) { severityStatus = 'Moderate'; severityIcon = '⚠️'; }
  else if (aqi <= 300) { severityStatus = 'Poor'; severityIcon = '🔴'; }
  else if (aqi <= 400) { severityStatus = 'Very Poor'; severityIcon = '🔴'; }
  else { severityStatus = 'Severe'; severityIcon = '🚨'; }

  // Check query intents
  const isRunning = /run|jog|workout|exercise|walk|outdoor|play|sports|cricket|marathon|cycle/.test(safePrompt);
  const isChildOrAsthma = /child|kid|baby|infant|asthma|bronchitis|elderly|senior|pregnant|heart|chest|cough|inhaler|respiratory/.test(safePrompt);
  const isVentilation = /window|ventilat|fresh air|morning air|inversion|air out|timing/.test(safePrompt);
  const isWhyHigh = /why|high|spike|reason|cause|inversion|source|stubble|smog/.test(safePrompt);
  const isPurifier = /purifier|hepa|filter|corsi|plant|indoor|kitchen|cook|smoke/.test(safePrompt);

  let coreAdvice = '';
  let familyImpact = '';
  let quickWin = '';

  if (isRunning) {
    if (aqi > 150) {
      coreAdvice = `🔴 **Outdoor Aerobic Exercise Not Recommended Today in ${city}**\n` +
        `- At current AQI **${aqi}** (PM2.5: **${pm25} µg/m³**, **${whoMultiplier}x WHO 24h limit**), running or high-intensity cardiovascular training increases minute respiratory ventilation by **400% to 600%**.\n` +
        `- Deep inhalation bypasses upper nasal cilia and deposits ultrafine combustion soot directly into bronchioles and capillary beds.\n` +
        `- **Safe Alternative:** Transition to indoor strength, mobility, or stationary cycling in a room with air filtration operating on Medium or High speed.`;
    } else {
      coreAdvice = `✅ **Modified Outdoor Activity Permitted in ${city}**\n` +
        `- Current AQI **${aqi}** allows light outdoor cardio, but schedule activity strictly between **12:30 PM and 4:00 PM** when daytime solar convection elevates the atmospheric boundary layer and disperses trapped ground soot.\n` +
        `- Avoid early dawn (6:00 AM – 9:00 AM) and evening hours when thermal inversion concentrates exhaust.`;
    }
    familyImpact = `Avoiding peak-pollution exertion cuts pulmonary soot deposition by **~75%** and prevents exercise-induced bronchospasm.`;
    quickWin = `Do 30 minutes of indoor bodyweight exercise and keep bedroom windows sealed during dawn and dusk.`;
  } else if (isChildOrAsthma) {
    coreAdvice = `⚠️ **High-Vulnerability Pediatric & Asthma Action Protocol**\n` +
      `- Children breathe **50% more air per pound of body weight** than adults, and their developing lung tissue is vulnerable to PM2.5-induced chronic alveolar inflammation.\n` +
      `- **Commute & School Defense:** Ensure well-fitted N95/KF94 respirators during morning travel; request school administration to suspend unvented outdoor morning assemblies.\n` +
      `- **Asthma Management:** Keep bronchodilator rescue inhalers easily accessible; cold smog triggers bronchoconstriction in **~60%** of asthmatic children.`;
    familyImpact = `Creating an indoor clean-air sanctuary with HEPA/MERV-13 filtration drops bedtime respiratory resistance and nighttime coughing episodes by **~55%**.`;
    quickWin = `Place your primary air purifier directly in the children's or elderly family member's bedroom running continuously on low-noise mode.`;
  } else if (isVentilation) {
    coreAdvice = `🪟 **Calibrated Ventilation Windows for ${city} (Thermal Inversion Science)**\n` +
      `- **🔴 DO NOT OPEN:** 06:00 AM – 09:30 AM (Morning smog inversion peak) and after 07:00 PM (Nocturnal boundary layer collapse).\n` +
      `- **✅ OPTIMAL VENTILATION WINDOW:** Between **12:30 PM and 3:30 PM**.\n` +
      `- Ground solar heating breaks nocturnal cold inversion, diluting surface particulate concentrations by up to **40%**.\n` +
      `- Run a quick 15-minute cross-ventilation burst to evacuate indoor CO₂, then reseal and cycle indoor filtration.`;
    familyImpact = `Timed ventilation eliminates stale indoor CO₂ build-up without contaminating living spaces with dangerous traffic soot.`;
    quickWin = `Set an alarm for 1:30 PM for a 15-minute home air cycle, then turn vehicle AC to internal recirculation.`;
  } else if (isWhyHigh) {
    coreAdvice = `🌫️ **Atmospheric Inversion & Emission Dynamics in ${city}**\n` +
      `- Current PM2.5 stands at **${pm25} µg/m³** (${whoMultiplier}x WHO 24h limit) and PM10 at **${pm10} µg/m³**.\n` +
      `- **Winter Thermal Inversion:** Rapid nocturnal radiation cooling creates a warm air "lid" at 100m–300m elevation, trapping urban exhaust (vehicular tailpipe soot, construction dust, cooking combustion) near ground level.\n` +
      `- **Calm Winds:** Low horizontal wind speeds (<6 km/h) prevent dispersion, causing particulate matter to accumulate day-over-day.`;
    familyImpact = `Understanding inversion cycles enables your household to schedule travel and ventilation when ambient exposure is lowest.`;
    quickWin = `Avoid burning incense, dhoop, or open mosquito coils indoors today—indoor combustion adds up to 300 µg/m³ of toxic VOCs.`;
  } else if (isPurifier) {
    coreAdvice = `🏠 **Indoor Air Quality & Economical Filtration Upgrades**\n` +
      `- **Purifier Placement:** Position filtration units at least 0.5m away from walls in the center of occupied spaces for continuous laminar flow.\n` +
      `- **Economical Corsi-Rosenthal Box:** A standard 20-inch box fan taped to four MERV-13 filters costs under ₹2,500 and achieves a Clean Air Delivery Rate (CADR) equivalent to ₹20,000 commercial HEPA units.\n` +
      `- **Kitchen Hazard:** High-temperature frying produces up to **450 µg/m³** of indoor particulate. Keep kitchen exhaust fans active and close connecting doors.`;
    familyImpact = `HEPA filtration in the main living space reduces 24-hour inhaled particulate mass by **65% to 80%**.`;
    quickWin = `Damp-wipe surfaces with a microfiber cloth instead of dry dusting or sweeping, which re-suspends settled toxic dust into breathing zones.`;
  } else {
    coreAdvice = `${severityIcon} **Clean Air Advisory for ${city} (AQI: ${aqi} — ${severityStatus})**\n` +
      `- Active atmospheric readings indicate PM2.5 is **${pm25} µg/m³** (${whoMultiplier}x WHO 24-hour benchmark).\n` +
      `- **Travel:** Wear a certified N95 mask for transit; adjust car ventilation to internal recirculation.\n` +
      `- **Household Health:** Family members (${familySize} people, health priority: ${healthConcerns}) should minimize prolonged outdoor exposure during dawn and late night hours.`;
    familyImpact = `Proactive behavioral adjustments eliminate **~60%** of peak particulate lung intake during high-smog periods.`;
    quickWin = `Drink warm fluids, use saline nasal rinses after commuting, and ensure air purifiers run throughout sleep hours.`;
  }

  return `## ${severityIcon} AirGuard Clinical Advisory — ${city}\n\n` +
    `Current Atmospheric Telemetry: **AQI ${aqi} (${severityStatus})** | PM2.5: **${pm25} µg/m³** (**${whoMultiplier}x WHO 24h limit**)\n\n` +
    `${coreAdvice}\n\n` +
    `## 💚 Impact on Your Family\n` +
    `${familyImpact}\n\n` +
    `## ⚡ Quick Win for Today\n` +
    `${quickWin}`;
}

async function callGemini(messages, systemInstruction, apiKey) {
  const modelsToTry = [
    process.env.GEMINI_MODEL,
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-exp'
  ].filter(Boolean);

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const body = {
        contents: messages,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 2048 },
      };
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeout: 20000,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (resp.status === 404 || err.error?.status === 'NOT_FOUND') {
          console.warn(`Model ${model} not available (404), trying fallback...`);
          lastError = new Error(err.error?.message || `Model ${model} not found`);
          continue;
        }
        throw new Error(err.error?.message || `Gemini API error ${resp.status}`);
      }

      const data = await resp.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (e) {
      lastError = e;
      if (e.message && e.message.includes('not found')) continue;
      throw e;
    }
  }

  throw lastError || new Error('All Gemini models failed. Please check your API key.');
}

// ---- SESSIONS ----

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

// ---- SEND MESSAGE (With Resilient Rule-Based Fallback) ----

router.post('/sessions/:uuid/message', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const db = getDb();
    const session = db.prepare('SELECT * FROM chat_sessions WHERE uuid = ? AND user_id = ?').get(req.params.uuid, req.user.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id) || {
      city: 'New Delhi',
      family_size: '3-4',
      health_concerns: 'none',
      transport: 'car',
      work_style: 'office',
      budget: 'low'
    };

    const aqiData = db.prepare('SELECT * FROM aqi_readings WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1').get(req.user.id) || {
      aqi: 185,
      city: profile.city || 'New Delhi',
      pm25: 115,
      pm10: 160,
      category: 'Unhealthy'
    };

    // Last 20 messages for context
    const history = db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 20').all(session.id).reverse();
    const geminiMessages = [
      ...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      { role: 'user', parts: [{ text: message }] }
    ];

    // Save user message
    db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(session.id, 'user', message);

    // Auto-title on first message
    if (!history.length) {
      db.prepare("UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
        message.length > 52 ? message.substring(0, 52) + '…' : message, session.id
      );
    } else {
      db.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?").run(session.id);
    }

    const apiKey = profile.gemini_api_key || process.env.GEMINI_API_KEY;

    // Resilient invocation: Attempt Gemini if key available, otherwise smoothly invoke domain rule engine
    let aiResponse = null;
    let isFallback = false;

    if (apiKey && apiKey !== 'your_gemini_api_key_here') {
      try {
        aiResponse = await callGemini(geminiMessages, buildSystemPrompt(profile, aqiData), apiKey);
      } catch (geminiErr) {
        console.warn('Gemini API call failed or timed out. Gracefully activating rule-based advisory fallback:', geminiErr.message);
        aiResponse = generateFallbackAdvisory(message, profile, aqiData);
        isFallback = true;
      }
    } else {
      aiResponse = generateFallbackAdvisory(message, profile, aqiData);
      isFallback = true;
    }

    db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(session.id, 'assistant', aiResponse);
    res.json({
      message: aiResponse,
      session_uuid: session.uuid,
      aqi_context: aqiData?.aqi || null,
      fallback: isFallback,
      source: isFallback ? 'rule-based-fallback' : 'gemini'
    });
  } catch (err) {
    console.error('Send message outer error:', err);
    res.status(500).json({ error: 'Internal chat error' });
  }
});

// ---- ONE-SHOT GENERATE ----

router.post('/generate', async (req, res) => {
  try {
    const { type } = req.body || {};
    if (!type || typeof type !== 'string') {
      return res.status(400).json({ error: 'type is required' });
    }

    const db = getDb();
    const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id) || {
      city: 'New Delhi', family_size: '3-4', health_concerns: 'none', transport: 'car', budget: 'low'
    };

    const apiKey = profile.gemini_api_key || process.env.GEMINI_API_KEY;
    const aqiData = db.prepare('SELECT * FROM aqi_readings WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1').get(req.user.id);
    const aqiVal = aqiData?.aqi || 185;
    const aqiCat = aqiData?.category || 'Unhealthy';

    const prompts = {
      routines: `Create 6 personalized low-emission daily routine cards for:
City: ${profile.city} (AQI: ${aqiVal}, ${aqiCat}) | Family: ${profile.family_size} | Health: ${profile.health_concerns} | Transport: ${profile.transport} | Work: ${profile.work_style} | Budget: ${profile.budget} | November winter smog season.
Return ONLY a valid JSON array (no markdown, no extra text):
[{"title":"...","icon":"...","color":"#hex","tips":["...","...","..."],"impact":"..."}]
Categories: Morning Routine, Commute Strategy, Work/Study Habits, Meal & Cooking, Evening Wind-Down, Weekly Eco-Action.
Include specific emission savings/health percentages in tips and impact.`,

      indoor: `Create 8 indoor air quality improvement tip cards for a ${profile.family_size}-person household in ${profile.city}. Budget: ${profile.budget}. Health: ${profile.health_concerns}. November — windows closed.
Return ONLY valid JSON array:
[{"title":"...","icon":"...","tips":["...","...","..."],"cost":"Free|<₹500|₹500-₹2000|₹2000-₹10000|₹10000+"}]
Categories: Air Purifier Setup, Indoor Plants, Ventilation Timing, Cooking Practices, Humidity Control, Cleaning Methods, Toxic Product Replacement, Air Quality Monitoring.
Use specific Indian product names and market prices.`,

      alternatives: `Generate 6 sustainable alternative comparisons for a family in ${profile.city}. Transport: ${profile.transport}. Budget: ${profile.budget}. Family: ${profile.family_size}.
Return ONLY valid JSON array:
[{"badOption":{"name":"...","description":"...","emission":"...","healthRisk":"..."},"goodOption":{"name":"...","description":"...","saving":"..."},"category":"Transport|Energy|Food|Home|Shopping|Lifestyle","difficulty":"Easy|Medium|Hard","monthlySaving":"₹X"}]
Use realistic Indian market numbers and local context.`,

      room_audit: `Analyze indoor air quality room-by-room for a ${profile.family_size}-person home in ${profile.city} (AQI: ${aqiVal}, budget: ${profile.budget}, health: ${profile.health_concerns}).
Return ONLY a valid JSON array of 5 room objects:
[{"room":"Living Room","icon":"🛋️","threatLevel":"Moderate|High|Severe","threats":["threat 1","threat 2"],"hacks":["hack 1 with specific cost","hack 2","hack 3"],"pmReduction":"e.g. -45% PM2.5"},
{"room":"Kitchen","icon":"🍳","threatLevel":"Severe","threats":["gas combustion VOCs","cooking particulate"],"hacks":["cross-ventilation timing","induction swap"],"pmReduction":"-60% PM2.5"},
{"room":"Master Bedroom","icon":"🛏️","threatLevel":"Moderate","threats":["sleep inhalation","stale CO2"],"hacks":["night air purifier setting","snake plant"],"pmReduction":"-55% PM2.5"},
{"room":"Children Room","icon":"🧸","threatLevel":"High","threats":["developing lung vulnerability","dust mite reservoirs"],"hacks":["MERV-13 filter","damp wipe protocol"],"pmReduction":"-70% PM2.5"},
{"room":"Home Office / Study","icon":"💻","threatLevel":"Low|Moderate","threats":["high CO2 causing fatigue","closed room stuffiness"],"hacks":["afternoon 15-min air cycle","spider plant"],"pmReduction":"-40% PM2.5"}]`,

      family_plan: `Create a comprehensive daily Clean Air Action Plan for a family of ${profile.family_size} in ${profile.city} (health concern: ${profile.health_concerns}, transport: ${profile.transport}, budget: ${profile.budget}, AQI: ${aqiVal}).
Return ONLY a valid JSON array of 8 checklist action items for today:
[{"id":1,"time":"06:30 AM","title":"Morning Air Inversion Check","action":"Keep windows sealed during dawn smog peak; turn air purifier to Medium.","category":"Indoor","co2":0.2,"completed":false},
{"id":2,"time":"08:00 AM","title":"Commute Defense","action":"Wear well-fitted N95 respirator; set vehicle AC to internal recirculation mode.","category":"Transport","co2":1.5,"completed":false}]`,

      aqi_insight: `Write a 3-4 sentence health advisory for AQI ${aqiVal} (${aqiCat}) in ${profile.city} for a family of ${profile.family_size} with health concern: ${profile.health_concerns}. Include what this AQI level means, what to avoid today, and one protective action. Use emojis. November winter smog context. Plain text only.`,
    };

    if (!prompts[type]) return res.status(400).json({ error: 'Invalid type' });

    let raw = null;
    if (apiKey && apiKey !== 'your_gemini_api_key_here') {
      try {
        raw = await callGemini(
          [{ role: 'user', parts: [{ text: prompts[type] }] }],
          buildSystemPrompt(profile, aqiData),
          apiKey
        );
      } catch (err) {
        console.warn(`Gemini generate failed for ${type}, serving fallback content:`, err.message);
      }
    }

    if (!raw && type === 'aqi_insight') {
      raw = `⚠️ **AQI ${aqiVal} (${aqiCat}) in ${profile.city}**: Particulate concentrations exceed safe thresholds due to cold morning thermal inversion. 🛑 Avoid outdoor running or strenuous exercise. 😷 Ensure well-fitted N95 masks for all family members during transit and run air purifiers indoors.`;
      return res.json({ data: raw, type, fallback: true });
    }

    if (raw && ['routines', 'indoor', 'alternatives', 'room_audit', 'family_plan'].includes(type)) {
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const typeMap = { routines: 'routine', indoor: 'indoor', alternatives: 'alternative', room_audit: 'room_audit', family_plan: 'family_plan' };
        db.prepare('INSERT INTO recommendations (user_id, type, title, content, aqi_context) VALUES (?, ?, ?, ?, ?)').run(
          req.user.id, typeMap[type] || type,
          `${type} — ${new Date().toLocaleDateString()}`,
          JSON.stringify(parsed), aqiData?.aqi || null
        );
        return res.json({ data: parsed, type, aqi: aqiData?.aqi });
      }
    }

    if (raw) {
      return res.json({ data: raw, type });
    }

    // Default structured response fallback for demo if AI offline
    res.json({
      data: generateFallbackAdvisory(`Generate ${type} advice`, profile, aqiData),
      type,
      fallback: true
    });
  } catch (err) {
    console.error('Generate handler error:', err);
    res.status(500).json({ error: 'Internal generation error' });
  }
});

// ---- RECOMMENDATIONS ----

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
