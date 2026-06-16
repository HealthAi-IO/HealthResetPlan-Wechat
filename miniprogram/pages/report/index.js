const storage = require('../../utils/storage');
const http = require('../../utils/http');
const sync = require('../../utils/sync');

// 指标 key → 录入类型 / 字段映射
const FIELD_MAP = {
  systolic:    { type: 'bp',         label: '收缩压',       unit: 'mmHg', payloadKey: 'systolic' },
  diastolic:   { type: 'bp',         label: '舒张压',       unit: 'mmHg', payloadKey: 'diastolic' },
  heartRate:   { type: 'heart_rate', label: '心率',         unit: 'bpm',  payloadKey: 'bpm' },
  weightKg:    { type: 'weight',     label: '体重',         unit: 'kg',   payloadKey: 'weightKg' },
  glucoseMmol: { type: 'glucose',    label: '空腹血糖',     unit: 'mmol/L', payloadKey: 'mmol' },
  tc:          { type: 'lipid',      label: '总胆固醇',     unit: 'mmol/L', payloadKey: 'tc' },
  ldl:         { type: 'lipid',      label: 'LDL',          unit: 'mmol/L', payloadKey: 'ldl' },
  hdl:         { type: 'lipid',      label: 'HDL',          unit: 'mmol/L', payloadKey: 'hdl' },
  tg:          { type: 'lipid',      label: '甘油三酯',     unit: 'mmol/L', payloadKey: 'tg' },
  bodyFatPct:  { type: 'body_fat',   label: '体脂率',       unit: '%',    payloadKey: 'pct' },
  waistCm:     { type: 'waist',      label: '腰围',         unit: 'cm',   payloadKey: 'cm' },
  spo2Pct:     { type: 'spo2',       label: '血氧',         unit: '%',    payloadKey: 'pct' }
};

Page({
  data: {
    image: '', loading: false,
    result: [],     // {key,label,value,unit,selected}
    reportDate: '',
    reportSummary: '',
    reportProvider: '',
    history: []
  },

  onShow() { this._loadHistory(); },

  onChooseImage() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album','camera'], sizeType: ['compressed'],
      success: r => {
        const f = r.tempFiles[0];
        if (f.size > 5 * 1024 * 1024) {
          wx.showToast({ title: '图片不超过 5MB', icon: 'none' });
          return;
        }
        this.setData({ image: f.tempFilePath, result: [] });
      }
    });
  },

  onPreviewImage() {
    if (!this.data.image) return;
    wx.previewImage({ urls: [this.data.image] });
  },

  async onUpload() {
    if (!this.data.image || this.data.loading) return;

    const app = getApp();
    if (!app.isLoggedIn()) {
      wx.showModal({
        title: '请先登录',
        content: 'OCR 识别需要登录账号才能调用云端 AI 服务。',
        confirmText: '去登录',
        success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/login/index' }); }
      });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: 'AI 识别中…', mask: true });

    try {
      const data = await http.upload('/reports/analyze', this.data.image);
      const result = this._mapResult(data);

      if (!result.length) {
        const count = data && Array.isArray(data.indicators) ? data.indicators.length : 0;
        wx.showToast({ title: count ? '已识别报告，暂无可自动导入项' : '未识别到指标，可改为手动录入', icon: 'none' });
      } else {
        this._saveHistory(this.data.image, data, result);
      }
      this.setData({
        result,
        reportDate: data.reportDate || '',
        reportSummary: data.summary || '',
        reportProvider: data.provider || ''
      });
    } catch (err) {
      console.error('[report.ocr]', err);
      wx.showToast({ title: err.message || '在线识别失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  _mapResult(data) {
    if (!data) return [];

    if (!Array.isArray(data.indicators) && data.indicators && typeof data.indicators === 'object') {
      return Object.entries(data.indicators)
        .filter(([k]) => FIELD_MAP[k])
        .map(([k, v]) => ({
          key: k,
          label: FIELD_MAP[k].label,
          value: v,
          unit: FIELD_MAP[k].unit,
          sourceName: FIELD_MAP[k].label,
          selected: true
        }));
    }

    const found = {};
    (data.indicators || []).forEach(ind => {
      const key = _inferFieldKey(ind.name || '');
      const value = _firstNumber(ind.value || '');
      if (!key || value === null || found[key]) return;
      found[key] = {
        key,
        label: FIELD_MAP[key].label,
        value,
        unit: ind.unit || FIELD_MAP[key].unit,
        sourceName: ind.name || FIELD_MAP[key].label,
        referenceRange: ind.referenceRange || '',
        status: ind.status || 'unknown',
        selected: true
      };
    });

    return Object.keys(FIELD_MAP).filter(k => found[k]).map(k => found[k]);
  },

  onToggleSelect(e) {
    const idx = e.currentTarget.dataset.idx;
    const result = [...this.data.result];
    result[idx].selected = e.detail.value;
    this.setData({ result });
  },

  onImport() {
    const sel = this.data.result.filter(r => r.selected);
    if (!sel.length) {
      wx.showToast({ title: '请至少选择一项', icon: 'none' });
      return;
    }
    // 按 type 聚合（同 type 多字段如 bp 的 systolic / diastolic 合并成一条）
    const byType = {};
    sel.forEach(r => {
      const m = FIELD_MAP[r.key];
      if (!byType[m.type]) byType[m.type] = {};
      byType[m.type][m.payloadKey] = Number(r.value);
    });

    const measuredAt = this._reportMeasuredAt();
    Object.entries(byType).forEach(([type, payload]) => {
      if (this.data.reportSummary) payload.summary = this.data.reportSummary;
      const entry = storage.indicators.add({ type, payload, measuredAt, source: 'report' });
      try { sync.enqueueIndicator(entry); } catch (e) {}
    });

    wx.showToast({ title: `已导入 ${sel.length} 项`, icon: 'success' });
    this.setData({ image: '', result: [], reportDate: '', reportSummary: '', reportProvider: '' });
    this._loadHistory();
  },

  _saveHistory(thumb, data, indicators) {
    try {
      const list = wx.getStorageSync('hrp_reports') || [];
      list.unshift({
        id: Date.now(),
        thumb,
        name: data.summary || '检查报告',
        time: data.reportDate || this._fmtTime(new Date()),
        count: indicators.length,
        provider: data.provider || ''
      });
      wx.setStorageSync('hrp_reports', list.slice(0, 20));
    } catch (e) {}
  },

  _loadHistory() {
    try { this.setData({ history: wx.getStorageSync('hrp_reports') || [] }); }
    catch (e) {}
  },

  _fmtTime(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  _reportMeasuredAt() {
    const s = this.data.reportDate;
    if (!s || s === 'null') return new Date().toISOString();
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
});

function _inferFieldKey(name) {
  const n = _normalizeName(name);
  if (_containsAny(n, ['收缩压', '高压', 'systolic', 'sbp'])) return 'systolic';
  if (_containsAny(n, ['舒张压', '低压', 'diastolic', 'dbp'])) return 'diastolic';
  if (_containsAny(n, ['心率', '脉搏', 'heartrate', 'pulse'])) return 'heartRate';
  if (_containsAny(n, ['体重', 'weight'])) return 'weightKg';
  if (_containsAny(n, ['腰围', 'waist'])) return 'waistCm';
  if (_containsAny(n, ['体脂', 'bodyfat'])) return 'bodyFatPct';
  if (_containsAny(n, ['血氧', 'spo2', '氧饱和'])) return 'spo2Pct';
  if (_containsAny(n, ['血糖', '葡萄糖', 'glucose', 'glu', 'fpg']) && n.indexOf('尿') < 0) return 'glucoseMmol';
  if (_containsAny(n, ['甘油三酯', 'triglyceride', 'tg'])) return 'tg';
  if (_containsAny(n, ['低密度脂蛋白', 'ldlc', 'ldl'])) return 'ldl';
  if (_containsAny(n, ['高密度脂蛋白', 'hdlc', 'hdl'])) return 'hdl';
  if (_containsAny(n, ['总胆固醇', 'totalcholesterol', 'cholesterol', 'tc'])) return 'tc';
  return '';
}

function _normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_\-()/（）:：]/g, '');
}

function _containsAny(value, keywords) {
  return keywords.some(keyword => value.indexOf(_normalizeName(keyword)) >= 0);
}

function _firstNumber(value) {
  const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}
