// ============================================================
//  api.js — Thin client for all backend calls
// ============================================================

const API_BASE = '';  // Same origin

class AirGuardAPI {
  constructor() {
    this.token = localStorage.getItem('ag_token') || null;
  }

  setToken(t) { this.token = t; localStorage.setItem('ag_token', t); }
  clearToken() { this.token = null; localStorage.removeItem('ag_token'); }

  async request(method, path, body = null, json = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(API_BASE + path, opts);
    const data = json ? await resp.json() : await resp.text();

    if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
    return data;
  }

  get(p)       { return this.request('GET', p); }
  post(p, b)   { return this.request('POST', p, b); }
  put(p, b)    { return this.request('PUT', p, b); }
  patch(p, b)  { return this.request('PATCH', p, b); }
  del(p)       { return this.request('DELETE', p); }

  // ---- Auth ----
  login(email, password)                { return this.post('/api/auth/login', { email, password }); }
  register(name, email, password)       { return this.post('/api/auth/register', { name, email, password }); }
  me()                                  { return this.get('/api/auth/me'); }
  changePassword(currentPassword, newPassword) { return this.post('/api/auth/change-password', { currentPassword, newPassword }); }

  // ---- Profile ----
  getProfile()     { return this.get('/api/profile'); }
  saveProfile(d)   { return this.put('/api/profile', d); }
  getStats()       { return this.get('/api/profile/stats'); }

  // ---- AQI ----
  getAQI(city)     { return this.get(`/api/aqi/current${city ? '?city=' + encodeURIComponent(city) : ''}`); }
  getAQIHistory(d) { return this.get(`/api/aqi/history?days=${d || 7}`); }
  getAQIStats()    { return this.get('/api/aqi/stats'); }

  // ---- Chat / Sessions ----
  getSessions()           { return this.get('/api/chat/sessions'); }
  newSession(title)       { return this.post('/api/chat/sessions', { title }); }
  deleteSession(uuid)     { return this.del(`/api/chat/sessions/${uuid}`); }
  getMessages(uuid)       { return this.get(`/api/chat/sessions/${uuid}/messages`); }
  sendMessage(uuid, msg)  { return this.post(`/api/chat/sessions/${uuid}/message`, { message: msg }); }

  // ---- Generate ----
  generate(type)          { return this.post('/api/chat/generate', { type }); }

  // ---- Recommendations ----
  getRecommendations(type) { return this.get(`/api/chat/recommendations${type ? '?type=' + type : ''}`); }
  toggleBookmark(id)       { return this.patch(`/api/chat/recommendations/${id}/bookmark`); }

  // ---- Impact ----
  logImpact(d)    { return this.post('/api/impact', d); }
  getImpact(days) { return this.get(`/api/impact?days=${days || 30}`); }
}

window.api = new AirGuardAPI();
