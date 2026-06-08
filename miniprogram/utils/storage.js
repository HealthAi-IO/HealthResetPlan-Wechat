const K = {
  PROFILE: 'hrp_profile',
  INDICATORS: 'hrp_indicators',
  CLOCK: 'hrp_clock_records',
  PLANS: 'hrp_plans',
  REMINDERS: 'hrp_reminders'
};

function _get(key) { try { return wx.getStorageSync(key) || []; } catch (e) { return []; } }
function _set(key, val) { try { wx.setStorageSync(key, val); } catch (e) {} }
function _today(isoStr) { return new Date(isoStr).toDateString() === new Date().toDateString(); }

const profile = {
  get() { try { return wx.getStorageSync(K.PROFILE) || null; } catch (e) { return null; } },
  save(p) { try { wx.setStorageSync(K.PROFILE, p); } catch (e) {} }
};

const indicators = {
  getAll() { return _get(K.INDICATORS); },
  add(item) {
    item.id = Date.now() + Math.random();
    item.measuredAt = item.measuredAt || new Date().toISOString();
    const list = this.getAll();
    list.unshift(item);
    _set(K.INDICATORS, list.slice(0, 500));
    return item;
  },
  latestByType(type) { return this.getAll().find(i => i.type === type) || null; },
  formatValue(i) {
    if (!i || !i.payload) return '--';
    const p = i.payload;
    const m = {
      weight:     () => p.weightKg ? `${p.weightKg} kg` : '--',
      bp:         () => (p.systolic && p.diastolic) ? `${p.systolic}/${p.diastolic} mmHg` : '--',
      glucose:    () => p.mmol ? `${p.mmol} mmol/L` : '--',
      heart_rate: () => p.bpm ? `${p.bpm} bpm` : '--',
      spo2:       () => p.pct ? `${p.pct}%` : '--',
      sleep:      () => p.hours ? `${p.hours} h` : '--',
      steps:      () => p.count ? `${p.count} 步` : '--',
      lipid:      () => p.tc ? `TC ${p.tc} mmol/L` : '--',
      waist:      () => p.cm ? `${p.cm} cm` : '--',
      body_fat:   () => p.pct ? `${p.pct}%` : '--',
    };
    return (m[i.type] || (() => '--'))();
  }
};

const CLOCK_LABELS = { meal: '饮食打卡', exercise: '运动打卡', medicine: '用药打卡', weight: '称重打卡', water: '饮水打卡' };

const clock = {
  getAll() { return _get(K.CLOCK); },
  add(item) {
    item.id = Date.now() + Math.random();
    item.clockTime = item.clockTime || new Date().toISOString();
    item.label = CLOCK_LABELS[item.type] || item.type;
    const list = this.getAll();
    list.unshift(item);
    _set(K.CLOCK, list.slice(0, 300));
    return item;
  },
  today() { return this.getAll().filter(r => _today(r.clockTime)); }
};

const plans = {
  getAll() { return _get(K.PLANS); },
  saveAll(list) { _set(K.PLANS, list); },
  today() { return this.getAll().filter(p => _today(p.date + 'T00:00:00')); }
};

const reminders = {
  getAll() { return _get(K.REMINDERS); },
  add(item) {
    item.id = Date.now();
    const list = this.getAll();
    list.push(item);
    _set(K.REMINDERS, list);
  },
  remove(id) { _set(K.REMINDERS, this.getAll().filter(r => r.id !== id)); }
};

function resetDemoData() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const prof = {
    nickname: '演示用户',
    gender: 1,
    age: 41,
    heightCm: 175,
    weightKg: 70,
    medicalHistory: '各项指标处于正常参考范围，定期监测维持健康状态',
    medications: '暂无长期用药'
  };
  profile.save(prof);

  const bp = [[116, 74], [114, 73], [117, 75], [115, 74], [118, 76], [115, 75], [116, 75]];
  const weights = [70.4, 70.2, 70.5, 70.1, 70.3, 70.0, 70.0];
  const list = [];
  for (let i = 0; i < 7; i++) {
    const measuredAt = new Date(today.getTime() - (6 - i) * 86400000).toISOString();
    list.unshift({
      id: `demo-bp-${i}-${Date.now()}`,
      type: 'bp',
      payload: { systolic: bp[i][0], diastolic: bp[i][1], heartRate: 68 + (i % 3) },
      measuredAt,
      source: 'demo'
    });
    list.unshift({
      id: `demo-weight-${i}-${Date.now()}`,
      type: 'weight',
      payload: { weightKg: weights[i] },
      measuredAt,
      source: 'demo'
    });
  }
  list.unshift(
    {
      id: `demo-glucose-${Date.now()}`,
      type: 'glucose',
      payload: { mmol: 5.0, mealType: 'fasting' },
      measuredAt: new Date(today.getTime() - 3 * 86400000).toISOString(),
      source: 'demo'
    },
    {
      id: `demo-lipid-${Date.now()}`,
      type: 'lipid',
      payload: { tc: 4.8, ldl: 2.8, hdl: 1.4, tg: 1.3 },
      measuredAt: new Date(today.getTime() - 5 * 86400000).toISOString(),
      source: 'demo'
    },
    {
      id: `demo-spo2-${Date.now()}`,
      type: 'spo2',
      payload: { pct: 98 },
      measuredAt: new Date(today.getTime() - 86400000).toISOString(),
      source: 'demo'
    },
    {
      id: `demo-steps-${Date.now()}`,
      type: 'steps',
      payload: { count: 8000 },
      measuredAt: new Date(today.getTime() - 86400000).toISOString(),
      source: 'demo'
    }
  );
  _set(K.INDICATORS, list);

  _set(K.CLOCK, ['meal', 'exercise', 'medicine'].map((type, idx) => ({
    id: `demo-clock-${type}-${Date.now()}`,
    type,
    status: 'done',
    note: type === 'meal' ? '午餐选择低盐高蛋白' : '',
    label: CLOCK_LABELS[type],
    clockTime: new Date(now.getTime() - (idx + 2) * 3600000).toISOString()
  })));
  _set(K.REMINDERS, [
    { id: 1, type: 'weight', time: '07:00', note: '晨起空腹称重' },
    { id: 2, type: 'meal', time: '11:00', note: '午餐前确认今日饮食' },
    { id: 3, type: 'exercise', time: '18:30', note: '晚间中等强度运动' },
    { id: 4, type: 'medicine', time: '21:00', note: '如有医嘱，按时用药' }
  ]);
}

module.exports = { profile, indicators, clock, plans, reminders, resetDemoData };
