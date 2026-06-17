const storage = require('../../utils/storage');
const sync    = require('../../utils/sync');

const TYPE_LIST = [
  { value: 'weight',     label: '体重', icon: '⚖️' },
  { value: 'bp',         label: '血压', icon: '❤️' },
  { value: 'glucose',    label: '血糖', icon: '💧' },
  { value: 'heart_rate', label: '心率', icon: '💓' },
  { value: 'lipid',      label: '血脂', icon: '🧪' },
  { value: 'body_fat',   label: '体脂', icon: '🧍' },
  { value: 'waist',      label: '腰围', icon: '📏' },
  { value: 'spo2',       label: '血氧', icon: '🫁' },
  { value: 'sleep',      label: '睡眠', icon: '🌙' },
  { value: 'steps',      label: '步数', icon: '👟' }
];

// 时间多选 picker 范围
function _timeRange() {
  const now = new Date();
  const years = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--) years.push(`${y}年`);
  const months = []; for (let m = 1; m <= 12; m++) months.push(`${m}月`);
  const days   = []; for (let d = 1; d <= 31; d++) days.push(`${d}日`);
  const hours  = []; for (let h = 0; h < 24; h++) hours.push(`${String(h).padStart(2,'0')}时`);
  const mins   = []; for (let m = 0; m < 60; m += 5) mins.push(`${String(m).padStart(2,'0')}分`);
  return [years, months, days, hours, mins];
}

Page({
  data: {
    view: 'input',
    type: 'weight',
    typeList: TYPE_LIST,
    form: { mealType: 'fasting', quality: 'good' },

    measuredAt: new Date().toISOString(),
    measuredAtLabel: '',
    timeRange: [], timeIdx: [0, 0, 0, 0, 0],

    groups: []
  },

  onLoad(opt) {
    const range = _timeRange();
    const now = new Date();
    const idx = [
      0,
      now.getMonth(),
      now.getDate() - 1,
      now.getHours(),
      Math.floor(now.getMinutes() / 5)
    ];
    this.setData({
      timeRange: range,
      timeIdx: idx,
      measuredAtLabel: this._fmtNow(now),
      type: opt.type || 'weight'
    });
    this._loadGroups();
  },

  onShow() { this._loadGroups(); },

  onSwitchInput()   { this.setData({ view: 'input' }); },
  onSwitchHistory() { this.setData({ view: 'history' }); this._loadGroups(); },

  onPickType(e) {
    this.setData({ type: e.currentTarget.dataset.type, form: { mealType: 'fasting', quality: 'good' } });
  },

  onInput(e) {
    const f = e.currentTarget.dataset.field;
    this.setData({ [`form.${f}`]: e.detail.value });
  },

  onPickMeal(e)    { this.setData({ 'form.mealType': e.currentTarget.dataset.v }); },
  onPickQuality(e) { this.setData({ 'form.quality':  e.currentTarget.dataset.v }); },

  onTimeChange(e) {
    const idx = e.detail.value;
    const r = this.data.timeRange;
    const yr = parseInt(r[0][idx[0]]);
    const mo = idx[1];
    const day = idx[2] + 1;
    const hr = parseInt(r[3][idx[3]]);
    const mi = parseInt(r[4][idx[4]]);
    const dt = new Date(yr, mo, day, hr, mi);
    this.setData({
      timeIdx: idx,
      measuredAt: dt.toISOString(),
      measuredAtLabel: this._fmtNow(dt)
    });
  },

  _fmtNow(d) {
    return `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月${String(d.getDate()).padStart(2,'0')}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  _buildPayload() {
    const { type, form } = this.data;
    const num = (v) => v === undefined || v === '' ? null : Number(v);
    switch (type) {
      case 'weight':     return { weightKg: num(form.weightKg) };
      case 'bp':         return { systolic: num(form.systolic), diastolic: num(form.diastolic), heartRate: num(form.heartRate) || undefined };
      case 'glucose':    return { mmol: num(form.glucoseMmol), mealType: form.mealType };
      case 'heart_rate': return { bpm: num(form.bpm) };
      case 'lipid': {
        const p = {};
        if (form.tc)  p.tc  = num(form.tc);
        if (form.ldl) p.ldl = num(form.ldl);
        if (form.hdl) p.hdl = num(form.hdl);
        if (form.tg)  p.tg  = num(form.tg);
        return p;
      }
      case 'body_fat': return { pct: num(form.bodyFatPct) };
      case 'waist':    return { cm:  num(form.waistCm) };
      case 'spo2':     return { pct: num(form.spo2Pct) };
      case 'sleep':    return { hours: num(form.sleepHours), quality: form.quality };
      case 'steps':    return { count: num(form.steps) };
      default: return {};
    }
  },

  _validate(payload) {
    const empty = Object.values(payload).every(v => v === null || v === undefined || Number.isNaN(v));
    if (empty) {
      wx.showToast({ title: '请至少填写一项数值', icon: 'none' });
      return false;
    }
    const t = this.data.type;
    if (t === 'bp' && (!payload.systolic || !payload.diastolic)) {
      wx.showToast({ title: '请同时填写收缩压 / 舒张压', icon: 'none' });
      return false;
    }
    return true;
  },

  onSave() {
    const payload = this._buildPayload();
    if (!this._validate(payload)) return;

    const entry = storage.indicators.add({
      type: this.data.type,
      payload,
      measuredAt: this.data.measuredAt
    });
    // 端到端加密同步：入队（push 由用户在"我的→云同步"主动触发或后续做自动化）
    try { sync.enqueueIndicator(entry); } catch (e) {}
    wx.showToast({ title: '已保存', icon: 'success' });

    // 清空当前类型的数值，方便继续录入
    const cleared = { mealType: 'fasting', quality: 'good' };
    this.setData({ form: cleared });
  },

  _loadGroups() {
    const all = storage.indicators.getAll();
    const groups = TYPE_LIST.map(t => {
      const list = all.filter(i => i.type === t.value);
      if (!list.length) return null;
      const latest = list[0];
      return {
        type: t.value,
        icon: t.icon,
        label: t.label,
        latest: storage.indicators.formatValue(latest),
        latestTime: this._fmtTime(latest.measuredAt),
        expanded: false,
        history: list.slice(0, 30).map(h => ({
          id: h.id,
          displayValue: storage.indicators.formatValue(h),
          timeLabel: this._fmtTime(h.measuredAt)
        }))
      };
    }).filter(Boolean);
    this.setData({ groups });
  },

  _fmtTime(iso) {
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  onToggleGroup(e) {
    const type = e.currentTarget.dataset.type;
    const groups = this.data.groups.map(g => g.type === type ? { ...g, expanded: !g.expanded } : g);
    this.setData({ groups });
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录',
      content: '确认删除这条指标？',
      confirmText: '删除',
      confirmColor: '#E53935',
      success: r => {
        if (!r.confirm) return;
        const all = storage.indicators.getAll().filter(i => i.id !== id);
        try { wx.setStorageSync('hrp_indicators', all); } catch (e) {}
        try { sync.enqueueIndicatorDelete(id); } catch (e) {}
        this._loadGroups();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  }
});
