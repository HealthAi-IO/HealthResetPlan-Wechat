const K = {
  PROFILE: 'hrp_profile',
  INDICATORS: 'hrp_indicators',
  CLOCK: 'hrp_clock_records',
  PLANS: 'hrp_plans',
  REMINDERS: 'hrp_reminders',
  REPORTS: 'hrp_reports',
  AI_SESSIONS: 'hrp_ai_sessions',
  AI_MESSAGES: 'hrp_ai_messages',
};
const SERVER_TABLE = {
  [K.PROFILE]: 'user_profile',
  [K.INDICATORS]: 'health_indicator',
  [K.CLOCK]: 'clock_record',
  [K.PLANS]: 'plan',
  [K.REMINDERS]: 'reminder',
  [K.REPORTS]: 'health_report',
  [K.AI_SESSIONS]: 'ai_session',
  [K.AI_MESSAGES]: 'ai_message',
};
const memory = {};
let onlineVersion = 0;
let pendingWrite = Promise.resolve();
let lastWriteError = null;

const GUEST_SCOPE = 'guest';
let activeScope = GUEST_SCOPE;

const CLOCK_LABELS = {
  meal: '饮食打卡',
  exercise: '运动打卡',
  medicine: '用药打卡',
  weight: '称重打卡',
  water: '饮水打卡',
};

function _get(key) {
  const value = memory[key];
  return Array.isArray(value) ? value : [];
}

function _set(key, val) {
  memory[key] = val;
  _queueSave();
}

function _today(isoStr) {
  return new Date(isoStr).toDateString() === new Date().toDateString();
}

const profile = {
  get() {
    return memory[K.PROFILE] || null;
  },
  save(p) {
    memory[K.PROFILE] = p;
    _queueSave();
  },
};

const indicators = {
  getAll() {
    return _get(K.INDICATORS);
  },
  add(item) {
    item.id = item.id || Date.now() + Math.random();
    item.measuredAt = item.measuredAt || new Date().toISOString();
    const list = this.getAll();
    list.unshift(item);
    _set(K.INDICATORS, list.slice(0, 500));
    return item;
  },
  saveAll(list) {
    _set(K.INDICATORS, Array.isArray(list) ? list.slice(0, 500) : []);
  },
  latestByType(type) {
    return this.getAll().find(i => i.type === type) || null;
  },
  formatValue(i) {
    if (!i || !i.payload) return '--';
    const p = i.payload;
    const m = {
      weight: () => p.weightKg ? `${p.weightKg} kg` : '--',
      bp: () => (p.systolic && p.diastolic) ? `${p.systolic}/${p.diastolic} mmHg` : '--',
      glucose: () => p.mmol ? `${p.mmol} mmol/L` : '--',
      heart_rate: () => p.bpm ? `${p.bpm} bpm` : '--',
      spo2: () => p.pct ? `${p.pct}%` : '--',
      sleep: () => p.hours ? `${p.hours} h` : '--',
      steps: () => p.count ? `${p.count} 步` : '--',
      lipid: () => p.tc ? `TC ${p.tc} mmol/L` : '--',
      waist: () => p.cm ? `${p.cm} cm` : '--',
      body_fat: () => p.pct ? `${p.pct}%` : '--',
    };
    return (m[i.type] || (() => '--'))();
  },
};

const clock = {
  getAll() {
    return _get(K.CLOCK);
  },
  add(item) {
    item.id = item.id || Date.now() + Math.random();
    item.clockTime = item.clockTime || new Date().toISOString();
    item.label = item.label || CLOCK_LABELS[item.type] || item.type;
    const list = this.getAll();
    list.unshift(item);
    _set(K.CLOCK, list.slice(0, 300));
    return item;
  },
  today() {
    return this.getAll().filter(r => _today(r.clockTime));
  },
};

const plans = {
  getAll() {
    return _get(K.PLANS);
  },
  saveAll(list) {
    _set(K.PLANS, list);
  },
  add(item) {
    const now = new Date().toISOString();
    const clientId = String(item.clientId || item.id || _uuid());
    const next = {
      ...item,
      id: item.id || clientId,
      clientId,
      createdAt: item.createdAt || now,
      updatedAt: now,
    };
    this.saveAll(this.getAll().concat(next));
    return next;
  },
  update(id, patch) {
    const target = String(id);
    let updated = null;
    const list = this.getAll().map(item => {
      if (String(item.clientId || item.id) !== target) return item;
      updated = { ...item, ...patch, updatedAt: new Date().toISOString() };
      return updated;
    });
    this.saveAll(list);
    return updated;
  },
  remove(id) {
    const target = String(id);
    const list = this.getAll();
    const removed = list.find(item => String(item.clientId || item.id) === target) || null;
    this.saveAll(list.filter(item => String(item.clientId || item.id) !== target));
    return removed;
  },
  today() {
    return this.getAll().filter(p => _today(`${p.date}T00:00:00`));
  },
};

const reminders = {
  getAll() {
    return _get(K.REMINDERS);
  },
  add(item) {
    item.id = item.id || Date.now();
    item.channel = item.channel || 'local';
    item.status = item.status || 'pending';
    item.updatedAt = item.updatedAt || new Date().toISOString();
    item.createdAt = item.createdAt || item.updatedAt;
    const list = this.getAll();
    list.push(item);
    _set(K.REMINDERS, list);
  },
  replaceAiPlan(items) {
    const kept = this.getAll().filter(r => r.source !== 'ai-plan');
    _set(K.REMINDERS, kept.concat(items));
  },
  remove(id) {
    _set(K.REMINDERS, this.getAll().filter(r => r.id !== id));
  },
};

const reports = {
  getAll() {
    const list = _get(K.REPORTS);
    if (!Array.isArray(list) || !list.length) return [];
    if (list[0] && list[0].structured) {
      return list;
    }

    const migrated = list.map(item => {
      const fallbackId = String(item.id || Date.now() + Math.random());
      const reportTime = _normalizeReportTime(item.time);
      const summary = item.name || '检查报告';
      return {
        id: fallbackId,
        clientId: fallbackId,
        imagePath: item.thumb || '',
        reportTime,
        summary,
        rawText: '',
        provider: item.provider || '',
        structured: {
          reportDate: reportTime,
          indicators: [],
          summary,
          rawText: '',
          provider: item.provider || '',
        },
        createdAt: reportTime,
        updatedAt: reportTime,
      };
    });
    _set(K.REPORTS, migrated);
    return migrated;
  },
  saveAll(list) {
    const next = Array.isArray(list) ? list.slice(0, 100) : [];
    _set(K.REPORTS, next);
  },
  add(item) {
    const now = new Date().toISOString();
    const report = {
      id: String(item.id || item.clientId || Date.now() + Math.random()),
      clientId: String(item.clientId || item.id || Date.now() + Math.random()),
      imagePath: item.imagePath || '',
      reportTime: _normalizeReportTime(item.reportTime || now),
      summary: item.summary || '',
      rawText: item.rawText || '',
      provider: item.provider || '',
      structured: item.structured || {},
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now,
    };
    const list = this.getAll().filter(entry => String(entry.clientId || entry.id) !== report.clientId);
    list.unshift(report);
    this.saveAll(list);
    return report;
  },
  remove(id) {
    const clientId = String(id || '');
    this.saveAll(this.getAll().filter(item => String(item.clientId || item.id) !== clientId));
  },
};

const chat = {
  sessions() { return _get(K.AI_SESSIONS); },
  messages() { return _get(K.AI_MESSAGES); },
  saveSessions(items) { _set(K.AI_SESSIONS, Array.isArray(items) ? items : []); },
  saveMessages(items) { _set(K.AI_MESSAGES, Array.isArray(items) ? items : []); },
  ensureSession(provider) {
    const sessions = this.sessions();
    const existing = sessions.slice().sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))[0];
    if (existing) return existing;
    const now = Date.now();
    const session = { sessionUuid: _uuid(), title: 'New conversation', provider: provider || 'doubao', createdAt: now, updatedAt: now };
    this.saveSessions([session]);
    return session;
  },
  addMessage(item) {
    const now = Date.now();
    const message = { ...item, messageUuid: item.messageUuid || _uuid(), createdAt: item.createdAt || now, updatedAt: now };
    this.saveMessages(this.messages().concat(message));
    this.touchSession(message.sessionUuid, message.role === 'user' ? message.content : '');
    return message;
  },
  updateMessage(messageUuid, patch) {
    const now = Date.now();
    const messages = this.messages().map(item => item.messageUuid === messageUuid ? { ...item, ...patch, updatedAt: now } : item);
    const message = messages.find(item => item.messageUuid === messageUuid);
    this.saveMessages(messages);
    if (message) this.touchSession(message.sessionUuid, '');
    return message;
  },
  touchSession(sessionUuid, firstUserContent) {
    const now = Date.now();
    this.saveSessions(this.sessions().map(item => item.sessionUuid === sessionUuid ? {
      ...item, updatedAt: now,
      title: (item.title === 'New conversation' && firstUserContent) ? firstUserContent.slice(0, 24) : item.title
    } : item));
  },
};

function activateScope(userId) {
  activeScope = _normalizeScope(userId);
  return activeScope;
}

function useGuestScope() {
  return activateScope(GUEST_SCOPE);
}

function scopedKey(baseKey) {
  return `${baseKey}::${activeScope}`;
}

function currentScope() {
  return activeScope;
}

function clearCurrentData() {
  Object.values(K).forEach(key => {
    memory[key] = key === K.PROFILE ? null : [];
  });
  _queueSave();
}

function _normalizeScope(value) {
  const raw = String(value || '').trim();
  return raw && raw !== GUEST_SCOPE ? `account-${raw}` : GUEST_SCOPE;
}

async function bindOnline() {
  const snapshot = await require('./http').get('/data');
  onlineVersion = Number(snapshot.version || 0);
  const data = snapshot.data || {};
  Object.values(K).forEach(key => {
    const value = data[SERVER_TABLE[key]];
    memory[key] = key === K.PROFILE
      ? (Array.isArray(value) ? value[0] || null : null)
      : (Array.isArray(value) ? value : []);
  });
  lastWriteError = null;
}

function unbindOnline() {
  onlineVersion = 0;
  lastWriteError = null;
  Object.values(K).forEach(key => {
    memory[key] = key === K.PROFILE ? null : [];
  });
}

async function flush() {
  await pendingWrite;
  if (lastWriteError) throw lastWriteError;
}

function _queueSave() {
  if (!getApp().isLoggedIn()) return;
  pendingWrite = pendingWrite.then(async () => {
    const data = {};
    Object.values(K).forEach(key => {
      data[SERVER_TABLE[key]] = key === K.PROFILE
        ? (memory[key] ? [memory[key]] : [])
        : (memory[key] || []);
    });
    const saved = await require('./http').put('/data', { version: onlineVersion, data });
    onlineVersion = Number(saved.version || onlineVersion + 1);
    lastWriteError = null;
  }).catch(async err => {
    lastWriteError = err;
    try { await bindOnline(); } catch (e) {}
    wx.showToast({ title: '网络不可用，数据未保存', icon: 'none' });
  });
}

module.exports = {
  profile,
  indicators,
  clock,
  plans,
  reminders,
  reports,
  chat,
  activateScope,
  useGuestScope,
  scopedKey,
  currentScope,
  clearCurrentData,
  bindOnline,
  unbindOnline,
  flush,
};

function _normalizeReportTime(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const n = Number(value);
  if (Number.isFinite(n) && n > 1000000000) return new Date(n).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function _uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16);
    return (c === 'x' ? n : (n & 0x3) | 0x8).toString(16);
  });
}
