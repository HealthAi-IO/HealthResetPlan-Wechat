const K = {
  PROFILE: 'hrp_profile',
  INDICATORS: 'hrp_indicators',
  CLOCK: 'hrp_clock_records',
  PLANS: 'hrp_plans',
  REMINDERS: 'hrp_reminders',
};

const CLOCK_LABELS = {
  meal: '饮食打卡',
  exercise: '运动打卡',
  medicine: '用药打卡',
  weight: '称重打卡',
  water: '饮水打卡',
};

function _get(key) {
  try {
    return wx.getStorageSync(key) || [];
  } catch (e) {
    return [];
  }
}

function _set(key, val) {
  try {
    wx.setStorageSync(key, val);
  } catch (e) {}
}

function _today(isoStr) {
  return new Date(isoStr).toDateString() === new Date().toDateString();
}

const profile = {
  get() {
    try {
      return wx.getStorageSync(K.PROFILE) || null;
    } catch (e) {
      return null;
    }
  },
  save(p) {
    try {
      wx.setStorageSync(K.PROFILE, p);
    } catch (e) {}
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

module.exports = { profile, indicators, clock, plans, reminders };
