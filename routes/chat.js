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

async function callGemini(messages, systemInstruction, apiKey) {
  // Model priority list: try preferred model first, then gracefully fall back
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
        timeout: 30000,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        // If model not found (404), try next model in fallback list
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
});

router.post('/sessions', (req, res) => {
  const db = getDb();
  const uuid = uuidv4();
  const title = req.body.title || 'New Conversation';
  const result = db.prepare('INSERT INTO chat_sessions (uuid, user_id, title) VALUES (?, ?, ?)').run(uuid, req.user.id, title);
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ session });
});

router.delete('/sessions/:uuid', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM chat_sessions WHERE uuid = ? AND user_id = ?').run(req.params.uuid, req.user.id);
  res.json({ message: 'Deleted' });
});

router.get('/sessions/:uuid/messages', (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT * FROM chat_sessions WHERE uuid = ? AND user_id = ?').get(req.params.uuid, req.user.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(session.id);
  res.json({ session, messages });
});

// ---- SEND MESSAGE ----

router.post('/sessions/:uuid/message', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  const db = getDb();
  const session = db.prepare('SELECT * FROM chat_sessions WHERE uuid = ? AND user_id = ?').get(req.params.uuid, req.user.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
  if (!profile) return res.status(400).json({ error: 'Please complete your profile first' });

  const apiKey = profile.gemini_api_key || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here')
    return res.status(400).json({ error: 'Gemini API key not configured. Add it in Profile Settings.' });

  const aqiData = db.prepare('SELECT * FROM aqi_readings WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1').get(req.user.id);

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

  try {
    const aiResponse = await callGemini(geminiMessages, buildSystemPrompt(profile, aqiData), apiKey);
    db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(session.id, 'assistant', aiResponse);
    res.json({ message: aiResponse, session_uuid: session.uuid, aqi_context: aqiData?.aqi || null });
  } catch (err) {
    console.error('Gemini error:', err);
    res.status(502).json({ error: `AI error: ${err.message}` });
  }
});

// ---- ONE-SHOT GENERATE ----

router.post('/generate', async (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });

  const db = getDb();
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
  if (!profile) return res.status(400).json({ error: 'Please complete your profile first' });

  const apiKey = profile.gemini_api_key || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here')
    return res.status(400).json({ error: 'Gemini API key not configured' });

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
{"id":2,"time":"08:00 AM","title":"Commute Defense","action":"Wear well-fitted N95 respirator; set vehicle AC to internal recirculation mode.","category":"Transport","co2":1.5,"completed":false},
...]`,

    aqi_insight: `Write a 3-4 sentence health advisory for AQI ${aqiVal} (${aqiCat}) in ${profile.city} for a family of ${profile.family_size} with health concern: ${profile.health_concerns}. Include what this AQI level means, what to avoid today, and one protective action. Use emojis. November winter smog context. Plain text only.`,
  };

  if (!prompts[type]) return res.status(400).json({ error: 'Invalid type' });

  try {
    const raw = await callGemini(
      [{ role: 'user', parts: [{ text: prompts[type] }] }],
      buildSystemPrompt(profile, aqiData),
      apiKey
    );

    if (['routines', 'indoor', 'alternatives', 'room_audit', 'family_plan'].includes(type)) {
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return res.status(502).json({ error: 'AI returned invalid format. Try again.', raw: raw.substring(0, 200) });
      const parsed = JSON.parse(match[0]);
      const typeMap = { routines: 'routine', indoor: 'indoor', alternatives: 'alternative', room_audit: 'room_audit', family_plan: 'family_plan' };
      db.prepare('INSERT INTO recommendations (user_id, type, title, content, aqi_context) VALUES (?, ?, ?, ?, ?)').run(
        req.user.id, typeMap[type] || type,
        `${type} — ${new Date().toLocaleDateString()}`,
        JSON.stringify(parsed), aqiData?.aqi || null
      );
      return res.json({ data: parsed, type, aqi: aqiData?.aqi });
    }

    res.json({ data: raw, type });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(502).json({ error: `Generation failed: ${err.message}` });
  }
});

// ---- RECOMMENDATIONS ----

router.get('/recommendations', (req, res) => {
  const db = getDb();
  const { type, bookmarked } = req.query;
  let q = 'SELECT * FROM recommendations WHERE user_id = ?';
  const params = [req.user.id];
  if (type)        { q += ' AND type = ?'; params.push(type); }
  if (bookmarked === '1') { q += ' AND is_bookmarked = 1'; }
  q += ' ORDER BY generated_at DESC LIMIT 20';
  res.json({ recommendations: db.prepare(q).all(...params) });
});

router.patch('/recommendations/:id/bookmark', (req, res) => {
  const db = getDb();
  const rec = db.prepare('SELECT * FROM recommendations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  const newVal = rec.is_bookmarked ? 0 : 1;
  db.prepare('UPDATE recommendations SET is_bookmarked = ? WHERE id = ?').run(newVal, rec.id);
  res.json({ bookmarked: !!newVal });
});

module.exports = router;
