const K = {
  PROFILE: 'hrp_profile',
  INDICATORS: 'hrp_indicators',
  CLOCK: 'hrp_clock_records',
  PLANS: 'hrp_plans',
  REMINDERS: 'hrp_reminders',
  REPORTS: 'hrp_reports',
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

module.exports = { profile, indicators, clock, plans, reminders, reports };

function _normalizeReportTime(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const n = Number(value);
  if (Number.isFinite(n) && n > 1000000000) return new Date(n).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
