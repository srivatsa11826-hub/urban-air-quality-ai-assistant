// ============================================================
//  AirGuard – Professional Client Application Engine (Clean Light Mode)
// ============================================================

// ---- Application State ----
let currentUser     = null;
let currentSession  = null;
let aqiData         = null;
let profile         = null;
let roomAuditData   = [];
let currentRoomIdx  = 0;
let alternativesData= [];
let speechRecognizer= null;
let isRecording     = false;
let checklistItems  = [];

// ============================================================
//  INITIALIZATION & BOOTSTRAP
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initSpeechRecognition();

  if (api.token) {
    try {
      const { user } = await api.me();
      currentUser = user;
      await bootApp();
    } catch (e) {
      api.clearToken();
      showScreen('auth');
    }
  } else {
    showScreen('auth');
  }
});

async function bootApp() {
  document.getElementById('headerUser').textContent = currentUser.name;
  showScreen('app');

  // Load profile
  try {
    const res = await api.getProfile();
    profile = res.profile;
    if (!profile) {
      showScreen('setup');
      return;
    }
    populateProfileForm(profile);
  } catch (e) {
    console.warn('Profile load warning:', e);
  }

  // Populate sessions sidebar
  loadSessions();

  // Ensure active consultation session
  await ensureSession();

  // Load Real-time AQI Telemetry
  await loadAQI();

  // Pre-load default modules
  loadImpact();
  loadChecklist();
  loadRoomAudit();
  loadAlternatives();
  loadProfileStats();
}

function showScreen(name) {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById(name + 'Screen').classList.remove('hidden');
}

// ============================================================
//  TOAST SYSTEM
// ============================================================
function toast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  const icons = { info: 'ℹ️', success: '✓', error: '✕', warn: '⚠️' };
  t.className = `toast ${type}`;
  t.innerHTML = `<span style="font-weight:700">${icons[type] || 'ℹ️'}</span> <span>${escHtml(msg)}</span>`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

// ============================================================
//  SPEECH RECOGNITION (Voice Input)
// ============================================================

/**
 * Handle speech recognition start.
 */
function handleSpeechStart() {
  isRecording = true;
  const btn = document.getElementById('micBtn');
  if (btn) btn.classList.add('recording');
  toast('Listening... Speak your question now', 'info');
}

/**
 * Handle incoming speech transcript.
 * @param {SpeechRecognitionEvent} event
 */
function handleSpeechResult(event) {
  const transcript = event.results[0][0].transcript;
  const input = document.getElementById('chatInput');
  if (input) {
    input.value = (input.value ? input.value + ' ' : '') + transcript;
    autoResize(input);
    input.focus();
  }
}

/**
 * Handle speech recognition completion.
 */
function handleSpeechEnd() {
  isRecording = false;
  const btn = document.getElementById('micBtn');
  if (btn) btn.classList.remove('recording');
}

/**
 * Initialize Web Speech API recognizer if supported.
 */
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  speechRecognizer = new SpeechRecognition();
  speechRecognizer.continuous = false;
  speechRecognizer.interimResults = false;
  speechRecognizer.lang = 'en-US';

  speechRecognizer.onstart = handleSpeechStart;
  speechRecognizer.onresult = handleSpeechResult;
  speechRecognizer.onerror = (e) => toast('Microphone input error: ' + e.error, 'warn');
  speechRecognizer.onend = handleSpeechEnd;
}

function toggleSpeech() {
  if (!speechRecognizer) {
    toast('Voice input is not supported in this browser. Please use Chrome or Edge.', 'warn');
    return;
  }
  if (isRecording) {
    speechRecognizer.stop();
  } else {
    try {
      speechRecognizer.start();
    } catch (e) {
      console.warn('Speech start error:', e);
    }
  }
}

// ============================================================
//  AUTHENTICATION CONTROLLER
// ============================================================
function switchAuthTab(tab) {
  document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').style.background = tab === 'login' ? 'var(--primary)' : 'transparent';
  document.getElementById('tab-login').style.color = tab === 'login' ? '#fff' : 'var(--text-muted)';
  document.getElementById('tab-register').style.background = tab === 'register' ? 'var(--primary)' : 'transparent';
  document.getElementById('tab-register').style.color = tab === 'register' ? '#fff' : 'var(--text-muted)';
  document.getElementById('authMsg').innerHTML = '';
}

function showAuthMsg(msg, isError = true) {
  document.getElementById('authMsg').innerHTML = `
    <div style="background:${isError ? 'var(--aqi-severe-bg)' : 'var(--aqi-good-bg)'};
                border:1px solid ${isError ? 'var(--aqi-severe-border)' : 'var(--aqi-good-border)'};
                border-radius:var(--r-sm);padding:.7rem 1rem;font-size:.85rem;font-weight:600;
                color:${isError ? 'var(--aqi-severe)' : 'var(--aqi-good)'};margin-bottom:1.2rem">
      ${isError ? '✕' : '✓'} ${escHtml(msg)}
    </div>`;
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Authenticating…';
  try {
    const { token, user } = await api.login(
      document.getElementById('loginEmail').value,
      document.getElementById('loginPass').value
    );
    api.setToken(token);
    currentUser = user;
    await bootApp();
  } catch (err) {
    showAuthMsg(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In to Dashboard';
  }
}

function fillDemoAndLogin() {
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPass');
  if (emailInput && passInput) {
    emailInput.value = 'demo@airguard.com';
    passInput.value = 'password123';
    document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true }));
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('regBtn');
  btn.disabled = true; btn.textContent = 'Creating Account…';
  try {
    const { token, user } = await api.register(
      document.getElementById('regName').value,
      document.getElementById('regEmail').value,
      document.getElementById('regPass').value
    );
    api.setToken(token);
    currentUser = user;
    showAuthMsg('Account created successfully. Loading intake wizard...', false);
    setTimeout(() => { showScreen('setup'); }, 500);
  } catch (err) {
    showAuthMsg(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

function handleLogout() {
  if (!confirm('Are you sure you want to sign out?')) return;
  api.clearToken();
  currentUser = null; profile = null; currentSession = null; aqiData = null;
  document.getElementById('chatMessages').innerHTML = '';
  showScreen('auth');
}

// ============================================================
//  PROFILE MANAGEMENT
// ============================================================
function togglePass(id, btn) {
  const inp = document.getElementById(id);
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

async function handleProfileSave(e) {
  e.preventDefault();
  const btn = document.getElementById('profileSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving Profile…';
  try {
    const { profile: saved } = await api.saveProfile({
      city: document.getElementById('pCity').value,
      family_size: document.getElementById('pFamily').value,
      health_concerns: document.getElementById('pHealth').value,
      transport: document.getElementById('pTransport').value,
      work_style: document.getElementById('pWork').value,
      budget: document.getElementById('pBudget').value,
      specific_concerns: document.getElementById('pConcerns').value,
      gemini_api_key: document.getElementById('pApiKey').value || null,
    });
    profile = saved;
    toast('Profile configured successfully', 'success');
    await bootApp();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save & Open Dashboard →';
  }
}

function skipProfile() {
  showScreen('app');
  loadSessions();
  ensureSession();
}

function populateProfileForm(p) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  set('upCity', p.city); set('upFamily', p.family_size); set('upHealth', p.health_concerns);
  set('upTransport', p.transport); set('upWork', p.work_style); set('upBudget', p.budget);
  set('upConcerns', p.specific_concerns);

  set('pCity', p.city); set('pFamily', p.family_size); set('pHealth', p.health_concerns);
  set('pTransport', p.transport); set('pWork', p.work_style); set('pBudget', p.budget);
  set('pConcerns', p.specific_concerns);
}

async function handleProfileUpdate(e) {
  e.preventDefault();
  const msgEl = document.getElementById('profileMsg');
  msgEl.innerHTML = '';
  try {
    const { profile: saved } = await api.saveProfile({
      city: document.getElementById('upCity').value,
      family_size: document.getElementById('upFamily').value,
      health_concerns: document.getElementById('upHealth').value,
      transport: document.getElementById('upTransport').value,
      work_style: document.getElementById('upWork').value,
      budget: document.getElementById('upBudget').value,
      specific_concerns: document.getElementById('upConcerns').value,
      gemini_api_key: document.getElementById('upApiKey').value || null,
    });
    profile = saved;
    msgEl.innerHTML = '<div style="background:var(--aqi-good-bg);border:1px solid var(--aqi-good-border);border-radius:var(--r-sm);padding:.6rem .9rem;font-size:.83rem;color:var(--aqi-good);font-weight:600;margin-bottom:1rem">✓ Household profile updated successfully</div>';
    toast('Profile updated successfully', 'success');
    loadAQI(true);
  } catch (err) {
    msgEl.innerHTML = `<div style="background:var(--aqi-severe-bg);border:1px solid var(--aqi-severe-border);border-radius:var(--r-sm);padding:.6rem .9rem;font-size:.83rem;color:var(--aqi-severe);font-weight:600;margin-bottom:1rem">✕ ${escHtml(err.message)}</div>`;
  }
}

async function handlePasswordChange(e) {
  e.preventDefault();
  const msgEl = document.getElementById('pwdMsg');
  try {
    await api.changePassword(
      document.getElementById('curPwd').value,
      document.getElementById('newPwd').value
    );
    msgEl.innerHTML = '<div style="background:var(--aqi-good-bg);border:1px solid var(--aqi-good-border);border-radius:var(--r-sm);padding:.6rem .9rem;font-size:.83rem;color:var(--aqi-good);font-weight:600;margin-bottom:1rem">✓ Password changed securely</div>';
    document.getElementById('curPwd').value = '';
    document.getElementById('newPwd').value = '';
  } catch (err) {
    msgEl.innerHTML = `<div style="background:var(--aqi-severe-bg);border:1px solid var(--aqi-severe-border);border-radius:var(--r-sm);padding:.6rem .9rem;font-size:.83rem;color:var(--aqi-severe);font-weight:600;margin-bottom:1rem">✕ ${escHtml(err.message)}</div>`;
  }
}

// ============================================================
//  NAVIGATION CONTROLLER
// ============================================================
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(n => n.classList.remove('active'));

  const targetPage = document.getElementById(`page-${name}`);
  if (targetPage) targetPage.classList.add('active');

  const navItem = document.getElementById(`nav-${name}`);
  if (navItem) navItem.classList.add('active');

  const mobileItem = document.getElementById(`mn-${name}`);
  if (mobileItem) mobileItem.classList.add('active');

  if (name === 'aqi' && !aqiData) loadAQI();
  if (name === 'routines' && checklistItems.length === 0) loadChecklist();
  if (name === 'indoor' && roomAuditData.length === 0) loadRoomAudit();
  if (name === 'alternatives' && alternativesData.length === 0) loadAlternatives();
  if (name === 'impact') loadImpact();
  if (name === 'profile') loadProfileStats();
}

// ============================================================
//  CONSULTATION SESSIONS
// ============================================================
async function loadSessions() {
  try {
    const { sessions } = await api.getSessions();
    renderSessionList(sessions);
  } catch (e) {
    console.warn('Sessions load warning:', e.message);
  }
}

function renderSessionList(sessions) {
  const list = document.getElementById('sessionList');
  if (!list) return;
  if (!sessions.length) {
    list.innerHTML = '<div style="padding:.5rem .75rem;font-size:.78rem;color:var(--text-muted)">No prior consultations</div>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-item ${currentSession?.uuid === s.uuid ? 'active' : ''}" onclick="switchSession('${s.uuid}')">
      <span class="session-title" title="${escHtml(s.title)}">${escHtml(s.title)}</span>
      <span class="session-del" onclick="deleteSession(event,'${s.uuid}')" title="Delete record">✕</span>
    </div>
  `).join('');
}

async function ensureSession() {
  if (currentSession) return;
  try {
    const { sessions } = await api.getSessions();
    if (sessions.length) {
      await switchSession(sessions[0].uuid);
    } else {
      await newSession();
    }
  } catch (e) {
    console.warn('ensureSession warning:', e);
  }
}

async function newSession() {
  try {
    const { session } = await api.newSession('New Consultation');
    currentSession = session;
    document.getElementById('chatMessages').innerHTML = '';
    renderWelcome();
    loadSessions();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function switchSession(uuid) {
  try {
    const { session, messages } = await api.getMessages(uuid);
    currentSession = session;
    renderMessages(messages);
    loadSessions();
    showPage('chat');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteSession(e, uuid) {
  e.stopPropagation();
  if (!confirm('Delete this consultation thread?')) return;
  try {
    await api.deleteSession(uuid);
    if (currentSession?.uuid === uuid) {
      currentSession = null;
      document.getElementById('chatMessages').innerHTML = '';
    }
    loadSessions();
    await ensureSession();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ============================================================
//  HEALTH CONSULTATION CHAT CONTROLLER
// ============================================================
function renderWelcome() {
  const city = profile?.city || 'your city';
  document.getElementById('chatMessages').innerHTML = `
    <div style="text-align:center;padding:3rem 1.5rem;color:var(--text-muted)">
      <div style="font-size:2.4rem;margin-bottom:.8rem">🛡️</div>
      <div style="font-weight:800;font-size:1.15rem;color:var(--text-main)">Air Quality Health Consultation Active</div>
      <p style="font-size:.88rem;margin-top:.4rem;max-width:440px;margin-inline:auto;line-height:1.6">
        Ready to assist your household in <strong>${escHtml(city)}</strong>. What symptoms, routines, or protective measures can we address?
      </p>
    </div>`;
}

function renderMessages(messages) {
  const container = document.getElementById('chatMessages');
  if (!messages.length) {
    renderWelcome();
    return;
  }
  container.innerHTML = '';
  messages.forEach(m => appendMessage(m.role, m.content, m.created_at));
  container.scrollTop = container.scrollHeight;
  document.getElementById('quickPrompts').style.display = 'none';
}

/**
 * Append interactive action buttons to assistant message bubble.
 * @param {HTMLElement} bubble
 */
function appendAssistantActions(bubble) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.innerHTML = `
    <button class="msg-action-btn" onclick="copyMessageText(this)">Copy Text</button>
    <button class="msg-action-btn" onclick="readAloud(this)">Listen (Audio)</button>
    <button class="msg-action-btn" onclick="chatAbout('Explain the clinical rationale in simpler terms')">Simplify</button>
  `;
  bubble.appendChild(actions);
}

/**
 * Append suggested followup question chips to assistant message bubble.
 * @param {HTMLElement} bubble
 * @param {string} text
 */
function appendFollowupChips(bubble, text) {
  const followups = generateFollowupQuestions(text);
  if (!followups.length) return;

  const fBox = document.createElement('div');
  fBox.className = 'followup-box';
  followups.forEach(q => {
    const chip = document.createElement('button');
    chip.className = 'followup-pill';
    chip.textContent = '→ ' + q;
    chip.onclick = () => chatAbout(q);
    fBox.appendChild(chip);
  });
  bubble.appendChild(fBox);
}

/**
 * Append a chat message to the visual message log.
 * @param {'user'|'assistant'} role
 * @param {string} text
 * @param {string|number|null} time
 * @returns {HTMLElement} Created message element
 */
function appendMessage(role, text, time) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const av = document.createElement('div');
  av.className = 'msg-av';
  av.textContent = role === 'assistant' ? '🛡️' : '👤';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = renderMarkdown(text);

  if (role === 'assistant') {
    appendAssistantActions(bubble);
    appendFollowupChips(bubble, text);
  }

  if (time) {
    const t = document.createElement('div');
    t.style.cssText = 'font-size:.7rem;color:var(--text-subtle);margin-top:.45rem;text-align:right';
    t.textContent = new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    bubble.appendChild(t);
  }

  div.appendChild(av);
  div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function appendTyping() {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typing-msg';

  const av = document.createElement('div');
  av.className = 'msg-av'; av.textContent = '🛡️';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:.84rem;color:var(--text-muted)">Consulting environmental health protocols...</span>
    </div>`;

  div.appendChild(av); div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !currentSession) return;

  input.value = '';
  autoResize(input);
  document.getElementById('sendBtn').disabled = true;
  document.getElementById('quickPrompts').style.display = 'none';

  appendMessage('user', text);
  const typingEl = appendTyping();

  try {
    const { message } = await api.sendMessage(currentSession.uuid, text);
    typingEl.remove();
    appendMessage('assistant', message, new Date().toISOString());
    loadSessions();
  } catch (err) {
    typingEl.querySelector('.msg-bubble').innerHTML = `<span style="color:var(--aqi-severe);font-weight:600">✕ ${escHtml(err.message)}</span>`;
  } finally {
    document.getElementById('sendBtn').disabled = false;
    input.focus();
  }
}

function sendQuick(text) {
  document.getElementById('chatInput').value = text;
  sendMessage();
}

// One-Click Persona Quick-Prompt Chips Controller
function triggerPersonaChip(chipKey) {
  const city = profile?.city || aqiData?.city || 'my city';
  const aqi = aqiData?.aqi || 185;
  const pm25 = aqiData?.pm25 || 115;

  let prompt = '';
  switch (chipKey) {
    case 'run':
      prompt = `I am in ${city} where current AQI is ${aqi} (PM2.5: ${pm25} µg/m³). Is it safe for an outdoor evening run or workout today, and what specific respiratory precautions should I take?`;
      break;
    case 'child':
      prompt = `Given the current air pollution in ${city} (AQI: ${aqi}, PM2.5: ${pm25} µg/m³), what specific precautions should I take to protect children and members with asthma today?`;
      break;
    case 'ventilate':
      prompt = `What is the best time window today to ventilate my home in ${city} to avoid winter smog ingress and toxic particulate accumulation?`;
      break;
    case 'pm25':
      prompt = `Why is PM2.5 high today in ${city} (current AQI: ${aqi}), and what atmospheric inversion or local factors are causing this spike?`;
      break;
    default:
      prompt = `How should our family protect ourselves from current air quality in ${city} (AQI: ${aqi})?`;
  }

  const input = document.getElementById('chatInput');
  if (input) {
    input.value = prompt;
    autoResize(input);
    sendMessage();
  }
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

function copyMessageText(btn) {
  const bubble = btn.closest('.msg-bubble');
  const text = bubble.innerText.replace(/Copy Text|Listen \(Audio\)|Simplify/g, '').trim();
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy Text'; }, 2000);
  });
}

function readAloud(btn) {
  if (!('speechSynthesis' in window)) {
    toast('Text-to-speech not supported on this browser', 'warn');
    return;
  }
  const bubble = btn.closest('.msg-bubble');
  const text = bubble.innerText.replace(/Copy Text|Listen \(Audio\)|Simplify/g, '').trim();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  btn.textContent = 'Playing...';
  utterance.onend = () => { btn.textContent = 'Listen (Audio)'; };
  window.speechSynthesis.speak(utterance);
}

function generateFollowupQuestions(text) {
  const followups = [];
  const lower = text.toLowerCase();
  if (lower.includes('purifier') || lower.includes('filter')) {
    followups.push('What fan speed setting is optimal during sleep?');
    followups.push('How often should the pre-filter be vacuumed?');
  } else if (lower.includes('mask') || lower.includes('n95')) {
    followups.push('How can I test the seal of an N95 on a child?');
    followups.push('Can N95 masks be safely stored and reused?');
  } else if (lower.includes('cooking') || lower.includes('kitchen') || lower.includes('stove')) {
    followups.push('How much particulate is released during high-heat frying?');
    followups.push('What are the most economical portable induction plates?');
  } else {
    followups.push('How does this air level affect asthma and lung recovery?');
    followups.push('What precautions apply during early morning hours?');
  }
  return followups.slice(0, 2);
}

// ============================================================
//  AQI & INVERSION ENGINE WITH CPCB NAQI & WHO DUAL STANDARDS
// ============================================================
let currentStandard = 'cpcb'; // 'cpcb' or 'who'

function setStandard(std) {
  currentStandard = std;
  const btnCpcb = document.getElementById('btn-std-cpcb');
  const btnWho = document.getElementById('btn-std-who');

  if (btnCpcb && btnWho) {
    btnCpcb.classList.toggle('active', std === 'cpcb');
    btnCpcb.setAttribute('aria-checked', std === 'cpcb' ? 'true' : 'false');
    btnCpcb.setAttribute('aria-pressed', std === 'cpcb' ? 'true' : 'false');

    btnWho.classList.toggle('active', std === 'who');
    btnWho.setAttribute('aria-checked', std === 'who' ? 'true' : 'false');
    btnWho.setAttribute('aria-pressed', std === 'who' ? 'true' : 'false');
  }

  if (aqiData) {
    updateAQIUI(aqiData);
  }
  toast(`Switched assessment to ${std === 'cpcb' ? 'Indian CPCB NAQI Standard' : 'WHO 2021 Global Guidelines'}`, 'info');
}

// CPCB Categories and Breakpoints
const CPCB_BREAKPOINTS = [
  { max: 50,  label: 'Good',         chipClass: 'good',         color: '#14532d' },
  { max: 100, label: 'Satisfactory', chipClass: 'satisfactory', color: '#047857' },
  { max: 200, label: 'Moderate',     chipClass: 'mod',          color: '#78350f' },
  { max: 300, label: 'Poor',         chipClass: 'unhealthy',    color: '#7c2d12' },
  { max: 400, label: 'Very Poor',    chipClass: 'severe',       color: '#7f1d1d' },
  { max: 500, label: 'Severe',       chipClass: 'severe',       color: '#581c87' },
];

function getCPCBInfo(aqi) {
  const val = Number(aqi) || 0;
  return CPCB_BREAKPOINTS.find(b => val <= b.max) || CPCB_BREAKPOINTS[CPCB_BREAKPOINTS.length - 1];
}

async function loadAQI(force = false) {
  try {
    const city = profile?.city;
    const data = await api.getAQI(force ? city : null);
    aqiData = data;
    updateAQIUI(data);
    updateHeaderBadge(data);
    loadAQIHistory();
    generateAQIInsight(data);
  } catch (e) {
    console.error('AQI load warning:', e.message);
  }
}

function updateHeaderBadge(data) {
  const badge = document.getElementById('headerAqi');
  const dot = document.getElementById('headerAqiDot');
  const txt = document.getElementById('headerAqiText');

  let color = 'var(--aqi-good)';
  if (data.aqi > 50) color = 'var(--aqi-mod)';
  if (data.aqi > 150) color = 'var(--aqi-unhealthy)';
  if (data.aqi > 250) color = 'var(--aqi-severe)';

  dot.style.background = color;
  txt.textContent = `AQI ${data.aqi}`;
  txt.style.color = 'var(--text-main)';
  badge.style.display = 'flex';
}

/**
 * Update the central AQI gauge value, category label, and risk badge.
 * @param {object} data - AQI data
 * @param {boolean} isCPCB - Whether CPCB mode is active
 * @param {object} cpcbInfo - CPCB category info
 */
function updateAQIGaugeAndRisk(data, isCPCB, cpcbInfo) {
  document.getElementById('gaugeNum').textContent = data.aqi;
  const riskChip = document.getElementById('aqiRiskChip');
  const gaugeLabel = document.getElementById('gaugeLabel');

  if (isCPCB) {
    gaugeLabel.textContent = cpcbInfo.label;
    if (riskChip) {
      riskChip.textContent = `CPCB NAQI: ${cpcbInfo.label}`;
      riskChip.className = `chip ${cpcbInfo.chipClass}`;
    }
  } else {
    const pm25Val = data.pm25 || 0;
    const whoRatio = parseFloat((pm25Val / 15).toFixed(1));
    gaugeLabel.textContent = whoRatio > 1 ? `${whoRatio}× WHO Limit` : 'Within WHO Limit';
    if (riskChip) {
      if (whoRatio > 4) {
        riskChip.textContent = `WHO 2021: ${whoRatio}× Limit (Severe Exceedance)`;
        riskChip.className = 'chip severe';
      } else if (whoRatio > 2) {
        riskChip.textContent = `WHO 2021: ${whoRatio}× Limit (High Exceedance)`;
        riskChip.className = 'chip unhealthy';
      } else if (whoRatio > 1) {
        riskChip.textContent = `WHO 2021: ${whoRatio}× Limit (Moderate Exceedance)`;
        riskChip.className = 'chip mod';
      } else {
        riskChip.textContent = 'WHO 2021: Compliant (Within 15 μg/m³)';
        riskChip.className = 'chip good';
      }
    }
  }
}

/**
 * Update location and telemetry metadata captions.
 * @param {object} data - AQI data
 * @param {boolean} isCPCB - Whether CPCB standard is active
 */
function updateMonitoringLabels(data, isCPCB) {
  const cacheSourceLabel = data.source === 'cache'
    ? '⚡ SQLite Cache (15-min TTL)'
    : data.source === 'stale-cache'
    ? '🔄 Resilient Cache Fallback'
    : data.source === 'waqi'
    ? '📡 Live Central Sensor Feed'
    : '🔬 Calibrated Sensor Baseline';

  document.getElementById('aqiLocation').textContent =
    `Monitoring Station: ${data.city} · ${cacheSourceLabel} · Active Standard: ${isCPCB ? 'Indian CPCB NAQI' : 'WHO 2021 Guidelines'}`;
  document.getElementById('gaugeCitySubtitle').textContent = `${data.city} · ${isCPCB ? 'CPCB NAQI (0–500)' : 'WHO 2021 24h Thresholds'}`;

  document.getElementById('dPM25').textContent = data.pm25 ?? '–';
  document.getElementById('dPM10').textContent = data.pm10 ?? '–';
  document.getElementById('dNO2').textContent  = data.no2  ?? '–';
  document.getElementById('dO3').textContent   = data.o3   ?? '–';
  document.getElementById('dTemp').textContent = data.temperature ?? '–';
  document.getElementById('dHum').textContent  = data.humidity   ?? '–';
}

/**
 * Update pollutant threshold badges comparing against CPCB or WHO limits.
 * @param {object} data - Telemetry data
 * @param {boolean} isCPCB - Whether CPCB is active
 */
function updatePollutantThresholdBadges(data, isCPCB) {
  const whoPM25El = document.getElementById('whoPM25');
  if (whoPM25El && data.pm25 != null) {
    const limit = isCPCB ? 60 : 15;
    const ratio = (data.pm25 / limit).toFixed(1);
    const exceeded = data.pm25 > limit;
    const std = isCPCB ? 'CPCB' : 'WHO';
    whoPM25El.textContent = exceeded ? `${ratio}× ${std} 24h limit (${limit} μg/m³)` : `Within ${std} limit (${limit} μg/m³)`;
    whoPM25El.className = `pol-who ${exceeded ? 'exceeded' : 'compliant'}`;
  }

  const whoPM10El = document.getElementById('whoPM10');
  if (whoPM10El && data.pm10 != null) {
    const limit = isCPCB ? 100 : 45;
    const ratio = (data.pm10 / limit).toFixed(1);
    const exceeded = data.pm10 > limit;
    const std = isCPCB ? 'CPCB' : 'WHO';
    whoPM10El.textContent = exceeded ? `${ratio}× ${std} 24h limit (${limit} μg/m³)` : `Within ${std} limit (${limit} μg/m³)`;
    whoPM10El.className = `pol-who ${exceeded ? 'exceeded' : 'compliant'}`;
  }

  const no2Container = document.getElementById('dNO2')?.parentElement;
  if (no2Container && data.no2 != null) {
    let whoNO2El = no2Container.querySelector('.pol-who') || document.createElement('span');
    whoNO2El.className = 'pol-who';
    if (!whoNO2El.parentElement) no2Container.appendChild(whoNO2El);
    const limit = isCPCB ? 80 : 25;
    const ratio = (data.no2 / limit).toFixed(1);
    const exceeded = data.no2 > limit;
    const std = isCPCB ? 'CPCB' : 'WHO';
    whoNO2El.textContent = exceeded ? `${ratio}× ${std} limit (${limit} μg/m³)` : `Within ${std} limit (${limit} μg/m³)`;
    whoNO2El.className = `pol-who ${exceeded ? 'exceeded' : 'compliant'}`;
  }
}

/**
 * Animate gauge dial arc and rotation.
 * @param {number} aqi - Numeric AQI value
 */
function animateGaugeNeedle(aqi) {
  const pct = Math.min(aqi / 500, 1);
  setTimeout(() => {
    const fill = document.getElementById('gFill');
    const needle = document.getElementById('gNeedle');
    if (fill) fill.style.strokeDasharray = `${pct * 321} 321`;
    if (needle) needle.style.transform = `rotate(${-90 + pct * 180}deg)`;
  }, 100);
}

/**
 * Master UI update orchestrator for AQI dashboard.
 * @param {object} data - Fresh or cached AQI telemetry payload
 */
function updateAQIUI(data) {
  if (!data) return;
  const isCPCB = currentStandard === 'cpcb';
  const cpcbInfo = getCPCBInfo(data.aqi);

  updateAQIGaugeAndRisk(data, isCPCB, cpcbInfo);
  updateMonitoringLabels(data, isCPCB);
  updatePollutantThresholdBadges(data, isCPCB);
  animateGaugeNeedle(data.aqi);
}

async function generateAQIInsight(data) {
  const el = document.getElementById('aqiInsight');
  if (!el) return;
  try {
    const { data: insight } = await api.generate('aqi_insight');
    el.innerHTML = renderMarkdown(insight);
  } catch (e) {
    el.innerHTML = `<strong>AQI ${data.aqi} — ${data.category?.label || data.category}</strong>. Elevated airborne particulate concentration (${data.dominant || 'PM2.5'}). Ensure fitted N95 respirator use during travel and operate domestic air filtration units.`;
  }
}

async function loadAQIHistory() {
  try {
    const { readings } = await api.getAQIHistory(7);
    renderAQIHistoryChart(readings);
  } catch (e) {
    console.warn('History chart warning:', e);
  }
}

function renderAQIHistoryChart(readings) {
  const el = document.getElementById('aqiHistory');
  if (!el) return;
  if (!readings.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:.82rem;margin:auto">Archived telemetry will populate as readings are logged</div>';
    return;
  }

  const maxVal = Math.max(...readings.map(r => r.aqi), 200);
  el.innerHTML = readings.map(r => {
    const pct = Math.max((r.aqi / maxVal) * 100, 10);
    const color = r.aqi < 100 ? 'var(--aqi-good)' : r.aqi < 150 ? 'var(--aqi-mod)' : r.aqi < 200 ? 'var(--aqi-unhealthy)' : 'var(--aqi-severe)';
    const dateStr = r.recorded_at ? new Date(r.recorded_at).toLocaleDateString([], { weekday: 'short', hour: '2-digit' }) : '';
    return `
      <div title="AQI ${r.aqi} on ${dateStr}" style="display:flex;flex-direction:column;align-items:center;gap:.35rem;flex:1;min-width:44px;cursor:pointer">
        <span style="font-size:.72rem;font-weight:700;color:${color}">${r.aqi}</span>
        <div style="width:100%;max-width:28px;background:${color};border-radius:4px;height:${pct}%;opacity:.9"></div>
        <span style="font-size:.65rem;color:var(--text-muted)">${dateStr}</span>
      </div>`;
  }).join('');
}

// ============================================================
//  ACTION CHECKLIST & CLEAN AIR SHIELD ENGINE
// ============================================================
async function loadChecklist() {
  const container = document.getElementById('checklistContainer');
  if (!container) return;

  try {
    const res = await api.generate('family_plan');
    checklistItems = res.data || [];
    renderChecklist();
  } catch (e) {
    checklistItems = [
      { id: 1, time: '06:30 AM', title: 'Winter Boundary Layer Seal', action: 'Keep all windows latched shut during dawn smog peak; set purifier to medium.', category: 'Indoor', co2: 0.2, completed: false },
      { id: 2, time: '08:15 AM', title: 'Commute Respiratory Defense', action: 'Wear fitted N95 respirator; switch car AC to internal cabin recirculation.', category: 'Transport', co2: 1.8, completed: false },
      { id: 3, time: '12:45 PM', title: 'Solar Thermal Ventilation Window', action: 'Open windows for 20 mins while boundary layer opens under peak solar heating.', category: 'Indoor', co2: 0.1, completed: false },
      { id: 4, time: '02:00 PM', title: 'Airway Hydration Protocol', action: 'Warm fluids / steam hydration to clear particulate deposition from upper airways.', category: 'Health', co2: 0.1, completed: false },
      { id: 5, time: '06:30 PM', title: 'Low-Emission Cooking Measures', action: 'Cook on induction or keep kitchen door firmly closed with exhaust on high.', category: 'Food', co2: 0.8, completed: false },
      { id: 6, time: '09:00 PM', title: 'Microfiber Surface Cleanse', action: 'Wipe flat surfaces with damp microfiber to trap settled PM2.5 without aerosolizing.', category: 'Home', co2: 0.3, completed: false },
      { id: 7, time: '10:30 PM', title: 'Night Purifier Placement', action: 'Position air cleaner 3 feet from head of bed at quiet whisper setting.', category: 'Indoor', co2: 0.2, completed: false },
    ];
    renderChecklist();
  }
}

function renderChecklist() {
  const container = document.getElementById('checklistContainer');
  if (!container) return;

  let savedTotal = 0;
  let doneCount = 0;

  container.innerHTML = checklistItems.map((item, idx) => {
    if (item.completed) {
      savedTotal += (item.co2 || 0);
      doneCount++;
    }
    return `
      <div class="check-item ${item.completed ? 'done' : ''}" onclick="toggleCheckItem(${idx})">
        <div class="check-box">${item.completed ? '✓' : ''}</div>
        <div class="check-content">
          <div class="check-title">${item.time ? `<span class="chip" style="font-size:.68rem;padding:.15rem .5rem;margin-right:.4rem">${item.time}</span>` : ''}${escHtml(item.title)}</div>
          <div class="check-desc">${escHtml(item.action)}</div>
        </div>
        <div class="check-reward">+${item.co2 || 0.2} kg CO₂</div>
      </div>
    `;
  }).join('');

  const totalSavedEl = document.getElementById('checklistSavedTotal');
  if (totalSavedEl) totalSavedEl.textContent = `${savedTotal.toFixed(1)} kg`;

  const shieldEl = document.getElementById('shieldScore');
  if (shieldEl) {
    const score = Math.min(60 + Math.round((doneCount / Math.max(checklistItems.length, 1)) * 40), 100);
    shieldEl.textContent = `${score} / 100`;
  }
}

async function toggleCheckItem(idx) {
  const item = checklistItems[idx];
  if (!item) return;

  item.completed = !item.completed;
  renderChecklist();

  if (item.completed) {
    toast(`Completed: ${item.title}! +${item.co2 || 0.2} kg CO₂ recorded`, 'success');
    try {
      await api.logImpact({
        action: item.title + ': ' + item.action,
        category: item.category || 'Routine',
        co2_saved: item.co2 || 0.2
      });
      loadImpact();
    } catch (e) {
      console.warn('Auto impact log error:', e);
    }
  }
}

// ============================================================
//  ROOM-BY-ROOM AIR INSPECTION ENGINE
// ============================================================

/**
 * Returns baseline room air audit profiles for indoor microenvironments.
 * @returns {Array<object>} Room inspection profiles
 */
function getDefaultRoomAudit() {
  return [
    {
      room: 'Living Room', icon: '🛋️', threatLevel: 'Moderate',
      threats: ['Outdoor particulate entry from main doorway', 'VOC emissions from synthetic upholstery and carpet pile'],
      hacks: ['Install a high-density silicone door bottom draft seal (₹300)', 'Maintain a Snake Plant (Sansevieria) near television unit for VOC capture', 'Use damp microfiber mopping instead of dry broom sweeping'],
      pmReduction: '-45% Inhaled PM2.5'
    },
    {
      room: 'Kitchen', icon: '🍳', threatLevel: 'Severe',
      threats: ['Combustion nitrogen dioxide (NO2) and carbon monoxide from LPG burners', 'Aerosolized cooking oil particulates reaching 400+ μg/m³ during frying'],
      hacks: ['Seal interior kitchen door during cooking with exhaust on high', 'Cook on single-burner induction plate (eliminates indoor NO2 completely)', 'Boil with tight-fitting lids to minimize volatile steam plumes'],
      pmReduction: '-65% Toxic VOCs & NO2'
    },
    {
      room: 'Master Bedroom', icon: '🛏️', threatLevel: 'Moderate',
      threats: ['CO2 accumulation (>1200 ppm) with closed windows overnight', 'Dust mite accumulation in heavy winter blankets and curtains'],
      hacks: ['Position air cleaner 3 feet from headboard at Whisper/Sleep mode', 'Wash bed linens in 60°C water weekly to neutralize mite allergens', 'Ventilate for 15 minutes strictly between 1:00 PM and 3:00 PM'],
      pmReduction: '-55% Nighttime Inhalation'
    },
    {
      room: "Children's Room", icon: '🧸', threatLevel: 'High',
      threats: ['Higher inhalation rate per kg body weight in developing lungs', 'Soft plush toy particulate reservoirs'],
      hacks: ['Install a MERV-13 pre-filter sheet over bedroom window intakes (₹450)', 'Store plush toys in closed washable bins', 'Eliminate all aerosol air fresheners, incense sticks, and dhoop'],
      pmReduction: '-70% Pediatric Exposure'
    },
    {
      room: 'Home Office / Study', icon: '💻', threatLevel: 'Low',
      threats: ['Elevated indoor CO2 causing lethargy and mild headache', 'Laser printer ozone and electrostatically-charged dust'],
      hacks: ['Desk Spider Plant (Chlorophytum) for formaldehyde absorption', 'Operate ceiling fan on lowest reverse speed to prevent stagnant thermal pockets', 'Take 5-minute movement breaks near indoor air cleaner'],
      pmReduction: '-40% Fatigue Contaminants'
    }
  ];
}

/**
 * Fetch room-by-room air inspection data from server or load default profile.
 */
async function loadRoomAudit() {
  const container = document.getElementById('roomAuditContent');
  if (!container) return;

  try {
    const res = await api.generate('room_audit');
    roomAuditData = res.data || [];
  } catch (e) {
    roomAuditData = getDefaultRoomAudit();
  }
  renderRoomAudit();
}

/**
 * Switch active room tab in microenvironment audit.
 * @param {number} idx - Index of selected room
 */
function switchRoom(idx) {
  currentRoomIdx = idx;
  document.querySelectorAll('.room-tab').forEach((t, i) => {
    t.classList.toggle('active', i === idx);
  });
  renderRoomAudit();
}

/**
 * Render HTML for contaminant sources list.
 * @param {Array<string>} threats
 * @returns {string} HTML string
 */
function renderThreatsListHtml(threats) {
  return (threats || []).map(t =>
    `<li style="font-size:.86rem;color:var(--text-body);display:flex;gap:.5rem"><span style="color:var(--aqi-severe)">•</span> ${escHtml(t)}</li>`
  ).join('');
}

/**
 * Render HTML for recommended room hacks list.
 * @param {Array<string>} hacks
 * @returns {string} HTML string
 */
function renderHacksListHtml(hacks) {
  return (hacks || []).map(h =>
    `<li style="font-size:.86rem;color:var(--text-body);display:flex;gap:.5rem"><span style="color:var(--aqi-good);font-weight:700">✓</span> ${escHtml(h)}</li>`
  ).join('');
}

/**
 * Render room header and threat level chip.
 * @param {object} room - Room object
 * @param {string} threatClass - CSS class for threat level
 * @returns {string} HTML string
 */
function buildRoomHeaderHtml(room, threatClass) {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem">
      <div style="display:flex;align-items:center;gap:.8rem">
        <span style="font-size:2rem;line-height:1">${room.icon || '🏠'}</span>
        <div>
          <h3 style="font-size:1.25rem;font-weight:800;color:var(--text-main)">${escHtml(room.room)}</h3>
          <span style="font-size:.8rem;color:var(--text-muted)">Micro-Environment Space Inspection</span>
        </div>
      </div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <span class="chip ${threatClass}">Threat Level: ${room.threatLevel}</span>
        <span class="chip good">${room.pmReduction || '-50% PM2.5'}</span>
      </div>
    </div>
  `;
}

/**
 * Render active room microenvironment audit details.
 */
function renderRoomAudit() {
  const container = document.getElementById('roomAuditContent');
  if (!container || !roomAuditData.length) return;

  const room = roomAuditData[currentRoomIdx] || roomAuditData[0];
  const threatClass = room.threatLevel === 'Severe' ? 'severe' : room.threatLevel === 'High' ? 'unhealthy' : 'mod';

  container.innerHTML = `
    ${buildRoomHeaderHtml(room, threatClass)}
    <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:1.5rem">
      <div style="background:#fff;border:1px solid #fee2e2;border-radius:var(--r-md);padding:1.3rem">
        <h4 style="color:var(--aqi-severe);font-size:.9rem;font-weight:700;margin-bottom:.8rem">Identified Contaminant Sources</h4>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:.6rem">${renderThreatsListHtml(room.threats)}</ul>
      </div>

      <div style="background:#fff;border:1px solid #bbf7d0;border-radius:var(--r-md);padding:1.3rem">
        <h4 style="color:var(--aqi-good);font-size:.9rem;font-weight:700;margin-bottom:.8rem">Recommended Mitigations</h4>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:.65rem">${renderHacksListHtml(room.hacks)}</ul>
      </div>
    </div>

    <div style="margin-top:1.4rem;display:flex;justify-content:flex-end">
      <button class="btn btn-secondary btn-sm" onclick="chatAbout('How can I optimize the air quality in my ${room.room}?')">
        Consult on ${room.room} Mitigations →
      </button>
    </div>
  `;
}

// ============================================================
//  SUSTAINABLE ALTERNATIVES ENGINE
// ============================================================

/**
 * Returns baseline sustainable alternative swaps.
 * @returns {Array<object>} Default swap suggestions
 */
function getDefaultAlternatives() {
  return [
    {
      category: 'Food', difficulty: 'Easy', monthlySaving: '₹600 / mo',
      badOption: { name: 'Cooking Entire Meals on LPG Gas Stove', description: 'Releases nitrogen dioxide (NO2), carbon monoxide, and sub-micron combustion soot inside the living space.', emission: '3.4 kg CO2 / week', healthRisk: '40% higher asthma risk in children' },
      goodOption: { name: 'Single Induction Cooktop for Boiling & Curries', description: 'Zero direct indoor combustion emissions; converts 84% of electrical energy directly to cooking vessel heat.', saving: 'Saves 2.8 kg CO2/wk + 100% reduction in indoor NO2' }
    },
    {
      category: 'Transport', difficulty: 'Medium', monthlySaving: '₹3,200 / mo',
      badOption: { name: 'Solo Petrol Sedan Commute in Traffic Congestion', description: 'Directly follows tailpipe plumes in bumper-to-bumper city congestion; high idle emissions.', emission: '18.2 kg CO2 / week', healthRisk: 'High inhalation of polycyclic aromatic hydrocarbons' },
      goodOption: { name: 'Metro Rail + Walking with Fitted N95 Respirator', description: 'High-capacity electric rapid transit; avoids street-level exhaust exposure during peak smog hours.', saving: 'Prevents 15.4 kg CO2/wk + 85% reduced inhalation' }
    },
    {
      category: 'Lifestyle', difficulty: 'Easy', monthlySaving: '₹400 / mo',
      badOption: { name: 'Burning Incense Sticks (Agarbatti) & Scented Candles', description: 'Produces intense particulate spikes exceeding 500 μg/m³ PM2.5 in closed rooms along with benzene and toluene.', emission: '0.9 kg VOC aerosols / mo', healthRisk: 'Deep alveolar inflammation equivalent to secondhand smoke' },
      goodOption: { name: 'Water-Based Ultrasonic Diffuser / Cinnamon Simmer Pot', description: 'Natural citrus peels and cinnamon boiled in water on induction; zero carcinogenic soot.', saving: '100% elimination of indoor chemical soot' }
    },
    {
      category: 'Home', difficulty: 'Easy', monthlySaving: '₹1,500 / mo',
      badOption: { name: 'Unsealed Exterior Window Drafts in Winter', description: 'Infiltration of toxic outdoor smog into bedrooms overnight through window sill gaps.', emission: 'High thermal heat loss', healthRisk: 'Continuous 8-hour sleep exposure to winter smog' },
      goodOption: { name: 'Silicone Weatherstrip Tape on Window Frames (₹250)', description: 'Stops micro-draft infiltration by 90% while retaining indoor air purifier efficacy.', saving: 'Cuts overnight indoor PM2.5 by 50%' }
    }
  ];
}

/**
 * Fetch sustainable swaps from server or load defaults.
 */
async function loadAlternatives() {
  const container = document.getElementById('alternativesContent');
  if (!container) return;

  try {
    const res = await api.generate('alternatives');
    alternativesData = res.data || [];
  } catch (e) {
    alternativesData = getDefaultAlternatives();
  }
  renderAlternatives(alternativesData);
}

/**
 * Filter alternatives list by category.
 * @param {string} category - Category filter name
 * @param {HTMLElement|null} btn - Clicked filter button
 */
function filterAlternatives(category, btn) {
  document.querySelectorAll('.alt-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (category === 'All') {
    renderAlternatives(alternativesData);
  } else {
    const filtered = alternativesData.filter(a => (a.category || '').toLowerCase() === category.toLowerCase());
    renderAlternatives(filtered.length ? filtered : alternativesData);
  }
}

/**
 * Render current habit card side.
 * @param {object} bad - Bad option descriptor
 * @returns {string} HTML string
 */
function buildBadOptionHtml(bad) {
  return `
    <div class="alt-side current">
      <div class="alt-side-tag">Current Habit</div>
      <div style="font-weight:700;font-size:.95rem;color:var(--text-main);margin-bottom:.3rem">${escHtml(bad?.name || '')}</div>
      <p style="font-size:.83rem;color:var(--text-muted);line-height:1.4">${escHtml(bad?.description || '')}</p>
      <div style="margin-top:.8rem;font-size:.8rem;color:var(--aqi-unhealthy);font-weight:600">Carbon: ${escHtml(bad?.emission || '')}</div>
      <div style="font-size:.78rem;color:var(--aqi-severe);margin-top:.2rem">Risk: ${escHtml(bad?.healthRisk || '')}</div>
    </div>
  `;
}

/**
 * Render clean alternative card side.
 * @param {object} good - Good option descriptor
 * @returns {string} HTML string
 */
function buildGoodOptionHtml(good) {
  return `
    <div class="alt-side green">
      <div class="alt-side-tag">Clean Alternative</div>
      <div style="font-weight:700;font-size:.95rem;color:var(--aqi-good);margin-bottom:.3rem">${escHtml(good?.name || '')}</div>
      <p style="font-size:.83rem;color:var(--text-body);line-height:1.4">${escHtml(good?.description || '')}</p>
      <div style="margin-top:.8rem;font-size:.82rem;font-weight:700;color:var(--aqi-good)">Direct Gain: ${escHtml(good?.saving || '')}</div>
    </div>
  `;
}

/**
 * Build HTML string for a single sustainable swap comparison card.
 * @param {object} a - Swap item object
 * @returns {string} HTML string
 */
function buildAlternativeCardHtml(a) {
  return `
    <div class="alt-card-modern">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:.8rem">
        <div style="display:flex;align-items:center;gap:.6rem">
          <span style="font-weight:800;font-size:1.05rem;color:var(--text-main)">${escHtml(a.category || 'Habit')}</span>
          <span class="chip" style="font-size:.72rem">Difficulty: ${escHtml(a.difficulty || 'Easy')}</span>
        </div>
        <div style="font-size:.82rem;font-weight:700;color:var(--primary)">Estimated Savings: ${escHtml(a.monthlySaving || '₹500 / mo')}</div>
      </div>

      <div class="alt-compare-grid">
        ${buildBadOptionHtml(a.badOption)}
        <div style="text-align:center" class="alt-vs-badge">
          <span style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:50%;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;color:#475569;font-weight:700;font-size:.8rem">→</span>
        </div>
        ${buildGoodOptionHtml(a.goodOption)}
      </div>

      <div style="margin-top:1.2rem;display:flex;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" onclick="adoptSwap('${escHtml(a.goodOption?.name || '')}', '${escHtml(a.category || 'Green Swap')}')">
          Commit to This Swap (+2.5 kg CO₂)
        </button>
      </div>
    </div>
  `;
}

/**
 * Render list of sustainable alternative cards.
 * @param {Array<object>} list
 */
function renderAlternatives(list) {
  const container = document.getElementById('alternativesContent');
  if (!container) return;
  container.innerHTML = list.map(buildAlternativeCardHtml).join('');
}

async function adoptSwap(swapName, category) {
  try {
    await api.logImpact({
      action: 'Committed to Sustainable Swap: ' + swapName,
      category: category || 'Alternative',
      co2_saved: 2.5
    });
    toast(`Committed to: ${swapName}! +2.5 kg CO₂ recorded`, 'success');
    loadImpact();
  } catch (e) {
    toast('Error recording commitment: ' + e.message, 'error');
  }
}

// ============================================================
//  EXPOSURE & CARBON LEDGER
// ============================================================
async function loadImpact() {
  try {
    const { logs, totals } = await api.getImpact(30);
    renderImpactStats(totals);
    renderImpactLog(logs);
  } catch (e) {
    console.warn('Impact telemetry warning:', e);
  }
}

function renderImpactStats(t) {
  const container = document.getElementById('impactStats');
  if (!container) return;
  container.innerHTML = `
    <div class="pollutant-card">
      <div style="font-size:1.85rem;font-weight:800;color:var(--text-main)">${t?.total_actions || 0}</div>
      <div class="pol-unit">Verified Actions Logged</div>
    </div>
    <div class="pollutant-card">
      <div style="font-size:1.85rem;font-weight:800;color:var(--aqi-good)">${t?.total_co2_saved || 0} kg</div>
      <div class="pol-unit">Carbon Prevented</div>
    </div>
    <div class="pollutant-card">
      <div style="font-size:1.85rem;font-weight:800;color:var(--primary)">${t?.categories || 0}</div>
      <div class="pol-unit">Lifestyle Dimensions</div>
    </div>
  `;
}

function renderImpactLog(logs) {
  const container = document.getElementById('impactLog');
  if (!container) return;
  if (!logs.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;padding:1rem 0">No verified actions recorded yet. Check off items in your Daily Action Plan!</div>';
    return;
  }
  container.innerHTML = logs.map(l => `
    <div style="background:#ffffff;border:1px solid var(--border);border-radius:var(--r-sm);padding:.85rem 1.15rem;display:flex;align-items:center;gap:.9rem;box-shadow:var(--shadow-xs)">
      <span style="font-size:1rem;color:var(--aqi-good);font-weight:700">✓</span>
      <span style="flex:1;font-size:.86rem;font-weight:500;color:var(--text-main)">${escHtml(l.action)}</span>
      <span style="font-size:.84rem;font-weight:700;color:var(--aqi-good)">-${l.co2_saved || 0} kg CO₂</span>
      <span style="font-size:.74rem;color:var(--text-muted)">${new Date(l.logged_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
    </div>
  `).join('');
}

async function logImpact() {
  const action = document.getElementById('impactAction').value.trim();
  if (!action) {
    toast('Please enter the action details', 'warn');
    return;
  }
  try {
    await api.logImpact({
      action,
      category: document.getElementById('impactCat').value,
      co2_saved: parseFloat(document.getElementById('impactCO2').value) || 0,
    });
    document.getElementById('impactAction').value = '';
    document.getElementById('impactCO2').value = '';
    toast('Clean-air action recorded successfully', 'success');
    loadImpact();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ============================================================
//  TELEMETRY & PROFILE STATS
// ============================================================
async function loadProfileStats() {
  try {
    const stats = await api.getStats();
    const container = document.getElementById('profileStats');
    if (!container) return;
    container.innerHTML = [
      ['Consultations Initiated', stats.total_chats],
      ['Interactions Logged', stats.total_messages],
      ['Air Telemetry Polls', stats.total_aqi_readings],
      ['Cumulative Carbon Prevented', `${stats.co2_saved || 0} kg`],
      ['Historical Avg City AQI', stats.avg_aqi || '–'],
    ].map(([k, v]) => `
      <div style="display:flex;justify-content:space-between;font-size:.86rem;padding:.45rem 0;border-bottom:1px solid var(--border-subtle)">
        <span style="color:var(--text-muted)">${k}</span>
        <span style="font-weight:700;color:var(--text-main)">${v}</span>
      </div>
    `).join('');
  } catch (e) {
    console.warn('Profile stats warning:', e);
  }
}

// ============================================================
//  PRINTABLE FAMILY CLEAN AIR BLUEPRINT EXPORT
// ============================================================
/**
 * Generates the interior card grids for the printable Clean Air Plan.
 * @returns {string} HTML string
 */
function buildPrintableCardsHtml() {
  return `
    <div class="grid">
      <div class="card">
        <h3>Daily Smog Exposure Safeguards</h3>
        <ul>
          <li><strong>Morning (6 AM - 10 AM):</strong> Keep windows sealed; avoid early morning outdoor jogging.</li>
          <li><strong>Ventilation Window:</strong> Open windows strictly between 12:30 PM – 3:30 PM.</li>
          <li><strong>Commute:</strong> N95 respirator fitted closely; vehicle cabin AC set to internal recirculation.</li>
        </ul>
      </div>

      <div class="card">
        <h3>Indoor Air Quality Standards</h3>
        <ul>
          <li><strong>Kitchen:</strong> Door shut during cooking; high exhaust; favor induction over open gas.</li>
          <li><strong>Bedrooms:</strong> Air purifier operating on quiet mode near head of bed.</li>
          <li><strong>Cleaning:</strong> Wet microfiber cloth only — eliminate dry broom dust aerosolization.</li>
        </ul>
      </div>
    </div>

    <div class="card">
      <h3>Sustainable Daily Commitments</h3>
      <ul>
        <li>Switching high-heat boiling tasks to portable induction plate.</li>
        <li>Eliminating indoor incense sticks and chemical room aerosols.</li>
        <li>Silicone weatherstrip tape applied to exterior window drafts.</li>
      </ul>
    </div>
  `;
}

/**
 * Builds the complete standalone HTML blueprint document for printing.
 * @param {string} city - Target city
 * @param {number|string} aqi - Active AQI value
 * @param {string} cat - Severity category
 * @param {object} prof - Household profile
 * @returns {string} Complete HTML document string
 */
function buildPrintableBlueprintHtml(city, aqi, cat, prof) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <title>AirGuard - Household Clean Air Plan - ${city}</title>
      <style>
        body { font-family: 'Segoe UI', system-ui, sans-serif; line-height: 1.6; color: #1e293b; padding: 2.5rem; max-width: 800px; margin: 0 auto; }
        h1 { color: #0284c7; border-bottom: 2px solid #0284c7; padding-bottom: .4rem; margin-bottom: 1rem; font-size: 1.6rem; }
        .meta-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 1rem; margin-bottom: 1.5rem; font-size: .9rem; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; margin-bottom: 1.5rem; }
        .card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 1.1rem; }
        h3 { margin-top: 0; color: #0f172a; font-size: 1.05rem; }
        ul { padding-left: 1.2rem; }
        li { margin-bottom: .4rem; font-size: .9rem; }
        .footer { margin-top: 2rem; font-size: .8rem; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: .6rem; }
      </style>
    </head>
    <body>
      <h1>🌬️ AirGuard: Household Clean Air Action Plan</h1>
      <div class="meta-box">
        <strong>City:</strong> ${city} | <strong>Current Air Status:</strong> AQI ${aqi} (${cat}) | <strong>Date:</strong> ${new Date().toLocaleDateString()}
        <br/>
        <strong>Vulnerability Focus:</strong> ${prof?.health_concerns || 'General Protection'} | <strong>Household:</strong> ${prof?.family_size || '3-4'} members
      </div>
      ${buildPrintableCardsHtml()}
      <div class="footer">
        AirGuard Urban Air Quality & Respiratory Protection Platform. Keep this reference accessible in your home.
      </div>
    </body>
    </html>
  `;
}

/**
 * Open a formatted printable Clean Air Blueprint in a pop-up window.
 */
function exportSafetyPlan() {
  const printWindow = window.open('', '_blank');
  const city = profile?.city || 'Local Urban Area';
  const aqi = aqiData?.aqi || '–';
  const cat = aqiData?.category?.label || 'Elevated Smog';

  printWindow.document.write(buildPrintableBlueprintHtml(city, aqi, cat, profile));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); }, 500);
}

// ============================================================
//  UTILITY HELPERS
// ============================================================
function chatAbout(text) {
  showPage('chat');
  const input = document.getElementById('chatInput');
  if (input) {
    input.value = text;
    sendMessage();
  }
}

function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/###\s(.+)/g, '<h4>$1</h4>')
    .replace(/##\s(.+)/g,  '<h3>$1</h3>')
    .replace(/#\s(.+)/g,   '<h3>$1</h3>')
    .replace(/^-\s(.+)/gm, '<li style="margin:.3rem 0 .3rem 1.1rem;list-style:disc">$1</li>')
    .replace(/^\d+\.\s(.+)/gm, '<li style="margin:.3rem 0 .3rem 1.3rem;list-style:decimal">$1</li>')
    .split('\n\n')
    .map(block => block.trim() ? (block.startsWith('<') ? block : `<p>${block}</p>`) : '')
    .join('');
}

function escHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
