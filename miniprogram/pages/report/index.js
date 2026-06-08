const storage = require('../../utils/storage');
const http = require('../../utils/request');

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
      // 实际上传报告并识别（后端接口 /report/ocr，与现有 modules/report 模块对接）
      const uploadRes = await this._uploadFile(this.data.image, '/report/ocr');
      const data = (typeof uploadRes === 'string') ? JSON.parse(uploadRes) : uploadRes;
      const indicators = (data && data.data && data.data.indicators) || data.indicators || {};
      const result = this._mapResult(indicators);

      if (!result.length) {
        wx.showToast({ title: '未识别到指标，可改为手动录入', icon: 'none' });
      } else {
        this._saveHistory(this.data.image, result);
      }
      this.setData({ result });
    } catch (err) {
      console.error('[report.ocr]', err);
      // 失败时给出 mock 数据，便于无后端时也能完成流程演示
      const mock = this._mockResult();
      this.setData({ result: mock });
      wx.showToast({ title: '在线识别失败，展示示例数据', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  _uploadFile(filePath, path) {
    const app = getApp();
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: app.globalData.baseUrl + path,
        filePath, name: 'file',
        header: {
          Authorization: app.globalData.accessToken ? `Bearer ${app.globalData.accessToken}` : '',
          'X-Platform': 'wechat'
        },
        success: r => (r.statusCode === 200 ? resolve(r.data) : reject(r)),
        fail: reject
      });
    });
  },

  _mapResult(map) {
    return Object.entries(map)
      .filter(([k]) => FIELD_MAP[k])
      .map(([k, v]) => ({
        key: k,
        label: FIELD_MAP[k].label,
        value: v,
        unit: FIELD_MAP[k].unit,
        selected: true
      }));
  },

  _mockResult() {
    return [
      { key: 'systolic',    label: '收缩压',   value: 132, unit: 'mmHg',   selected: true },
      { key: 'diastolic',   label: '舒张压',   value: 84,  unit: 'mmHg',   selected: true },
      { key: 'glucoseMmol', label: '空腹血糖', value: 5.6, unit: 'mmol/L', selected: true },
      { key: 'tc',          label: '总胆固醇', value: 5.2, unit: 'mmol/L', selected: true },
      { key: 'ldl',         label: 'LDL',      value: 3.4, unit: 'mmol/L', selected: true }
    ];
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

    Object.entries(byType).forEach(([type, payload]) => {
      storage.indicators.add({ type, payload });
    });

    wx.showToast({ title: `已导入 ${sel.length} 项`, icon: 'success' });
    this.setData({ image: '', result: [] });
    this._loadHistory();
  },

  _saveHistory(thumb, indicators) {
    try {
      const list = wx.getStorageSync('hrp_reports') || [];
      list.unshift({
        id: Date.now(),
        thumb,
        name: '检查报告',
        time: this._fmtTime(new Date()),
        count: indicators.length
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
  }
});
