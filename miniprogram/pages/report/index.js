const storage = require('../../utils/storage');
const http = require('../../utils/http');
const sync = require('../../utils/sync');

const AI_DOCTOR_DISCLAIMER = 'AI 不能代替医生诊断，只提供健康管理建议；如有异常或症状加重，请及时就医。';

const FIELD_MAP = {
  systolic: { type: 'bp', label: '收缩压', unit: 'mmHg', payloadKey: 'systolic' },
  diastolic: { type: 'bp', label: '舒张压', unit: 'mmHg', payloadKey: 'diastolic' },
  heartRate: { type: 'heart_rate', label: '心率', unit: 'bpm', payloadKey: 'bpm' },
  weightKg: { type: 'weight', label: '体重', unit: 'kg', payloadKey: 'weightKg' },
  glucoseMmol: { type: 'glucose', label: '空腹血糖', unit: 'mmol/L', payloadKey: 'mmol' },
  tc: { type: 'lipid', label: '总胆固醇', unit: 'mmol/L', payloadKey: 'tc' },
  ldl: { type: 'lipid', label: 'LDL', unit: 'mmol/L', payloadKey: 'ldl' },
  hdl: { type: 'lipid', label: 'HDL', unit: 'mmol/L', payloadKey: 'hdl' },
  tg: { type: 'lipid', label: '甘油三酯', unit: 'mmol/L', payloadKey: 'tg' },
  bodyFatPct: { type: 'body_fat', label: '体脂率', unit: '%', payloadKey: 'pct' },
  waistCm: { type: 'waist', label: '腰围', unit: 'cm', payloadKey: 'cm' },
  spo2Pct: { type: 'spo2', label: '血氧', unit: '%', payloadKey: 'pct' },
};

Page({
  data: {
    image: '',
    loading: false,
    result: [],
    reportDate: '',
    reportSummary: '',
    reportAdvice: '',
    reportProvider: '',
    reportRawText: '',
    summaryExpanded: false,
    detailRawExpanded: false,
    history: [],
    activeReport: null,
    detailVisible: false,
  },

  onShow() {
    this._loadHistory();
  },

  onChooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
          wx.showToast({ title: '图片不超过 5MB', icon: 'none' });
          return;
        }
        this.setData({
          image: file.tempFilePath,
          result: [],
          reportDate: '',
          reportSummary: '',
          reportAdvice: '',
          reportProvider: '',
          reportRawText: '',
          summaryExpanded: false,
        });
      },
    });
  },

  onPreviewImage() {
    if (!this.data.image) return;
    wx.previewImage({ urls: [this.data.image], current: this.data.image });
  },

  async onUpload() {
    if (!this.data.image || this.data.loading) return;

    const app = getApp();
    if (!app.isLoggedIn()) {
      wx.showModal({
        title: '请先登录',
        content: 'OCR 识别需要登录账号才能调用云端 AI 服务。',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/login/index' });
          }
        },
      });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: 'AI 识别中...', mask: true });

    try {
      const data = _normalizeOcrData(await http.upload('/reports/analyze', this.data.image));
      const result = this._mapResult(data);
      const record = await this._buildReportRecord(this.data.image, data, result);

      storage.reports.add(record);
      this._enqueueReport(record);
      this._loadHistory();

      if (!result.length) {
        const count = Array.isArray(data && data.indicators) ? data.indicators.length : 0;
        wx.showToast({
          title: count ? '报告已保存，可在最近报告查看详情' : '未识别到指标，可手动录入',
          icon: 'none',
        });
      } else {
        wx.showToast({ title: '识别完成，已加入最近报告', icon: 'success' });
      }

      this.setData({
        result,
        reportDate: record.reportTime,
        reportSummary: record.summary,
        reportAdvice: record.analysisAdvice,
        reportProvider: record.provider,
        reportRawText: record.rawText,
        summaryExpanded: false,
      });
    } catch (err) {
      console.error('[report.ocr]', err);
      wx.showToast({ title: err.message || '在线识别失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  onToggleSelect(e) {
    const idx = e.currentTarget.dataset.idx;
    const result = this.data.result.slice();
    if (!result[idx]) return;
    result[idx].selected = e.detail.value;
    this.setData({ result });
  },

  onImport() {
    const selected = this.data.result.filter((item) => item.selected);
    if (!selected.length) {
      wx.showToast({ title: '请至少选择一项', icon: 'none' });
      return;
    }

    const grouped = {};
    selected.forEach((item) => {
      const field = FIELD_MAP[item.key];
      if (!field) return;
      if (!grouped[field.type]) grouped[field.type] = {};
      grouped[field.type][field.payloadKey] = Number(item.value);
    });

    const measuredAt = this._reportMeasuredAt();
    Object.keys(grouped).forEach((type) => {
      const payload = grouped[type];
      if (this.data.reportSummary) payload.summary = this.data.reportSummary;
      const entry = storage.indicators.add({ type, payload, measuredAt, source: 'report' });
      try {
        sync.enqueueIndicator(entry);
      } catch (e) {}
    });

    wx.showToast({ title: `已导入 ${selected.length} 项`, icon: 'success' });
    this.setData({
      image: '',
      result: [],
      reportDate: '',
      reportSummary: '',
      reportAdvice: '',
      reportProvider: '',
      reportRawText: '',
      summaryExpanded: false,
    });
  },

  onOpenHistory(e) {
    const id = String(e.currentTarget.dataset.id || '');
    const record = storage.reports.getAll().find((item) => String(item.clientId || item.id) === id);
    if (!record) return;

    const detail = this._formatReportRecord(record);
    this.setData({
      activeReport: detail,
      detailVisible: true,
      detailRawExpanded: false,
    });
  },

  onCloseDetail() {
    this.setData({
      activeReport: null,
      detailVisible: false,
      detailRawExpanded: false,
    });
  },

  onToggleSummary() {
    this.setData({ summaryExpanded: !this.data.summaryExpanded });
  },

  onToggleDetailRaw() {
    this.setData({ detailRawExpanded: !this.data.detailRawExpanded });
  },

  onPreviewHistoryImage() {
    const report = this.data.activeReport;
    if (!report || !report.imagePath) return;
    wx.previewImage({ urls: [report.imagePath], current: report.imagePath });
  },

  onDeleteHistory(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;

    wx.showModal({
      title: '删除报告',
      content: '删除后最近报告中将不再显示，已开启云同步时会同步删除。',
      confirmText: '删除',
      confirmColor: '#E53935',
      success: (res) => {
        if (!res.confirm) return;

        const record = storage.reports.getAll().find((item) => String(item.clientId || item.id) === id);
        storage.reports.remove(id);
        try {
          sync.enqueueItem({
            table: 'health_report',
            clientId: id,
            version: Date.now(),
            clientUpdatedAt: Date.now(),
            deleted: true,
            plain: { deleted: true },
            meta: { deleted: true },
          });
        } catch (e) {}
        if (record && record.imagePath) {
          this._removeSavedFile(record.imagePath);
        }
        if (this.data.activeReport && String(this.data.activeReport.clientId) === id) {
          this.onCloseDetail();
        }
        this._loadHistory();
        wx.showToast({ title: '已删除', icon: 'success' });
      },
    });
  },

  _loadHistory() {
    const history = storage.reports.getAll().map((item) => this._formatReportRecord(item));
    this.setData({ history });
  },

  _formatReportRecord(record) {
    const structured = record.structured && typeof record.structured === 'object' ? record.structured : {};
    const normalized = _normalizeOcrData({
      ...structured,
      rawText: structured.rawText || record.rawText || '',
    });
    const indicators = Array.isArray(normalized.indicators) ? normalized.indicators : [];
    return {
      ...record,
      clientId: String(record.clientId || record.id || ''),
      title: record.summary || normalized.summary || '检查报告',
      timeLabel: this._fmtTime(new Date(record.reportTime || record.createdAt || Date.now())),
      reportDateLabel: this._fmtDateOnly(record.reportTime),
      indicatorCount: indicators.length,
      indicators: indicators.map((item, index) => ({
        id: `${record.clientId || record.id}-${index}`,
        category: item.category || '其他',
        name: item.name || '',
        value: item.value || '',
        unit: item.unit || '',
        referenceRange: item.referenceRange || '',
        status: item.status || 'unknown',
        statusLabel: _statusLabel(item.status || 'unknown'),
        statusClass: _statusClass(item.status || 'unknown'),
      })),
      rawText: _displayRawText(record.rawText || normalized.rawText || ''),
      analysisAdvice: _withAiDoctorDisclaimer(record.analysisAdvice || normalized.analysisAdvice || ''),
      provider: record.provider || normalized.provider || '',
    };
  },

  _mapResult(data) {
    if (!data) return [];

    if (!Array.isArray(data.indicators) && data.indicators && typeof data.indicators === 'object') {
      return Object.entries(data.indicators)
        .filter(([key]) => FIELD_MAP[key])
        .map(([key, value]) => ({
          key,
          label: FIELD_MAP[key].label,
          value,
          unit: FIELD_MAP[key].unit,
          sourceName: FIELD_MAP[key].label,
          selected: true,
        }));
    }

    const found = {};
    (data.indicators || []).forEach((indicator) => {
      const key = _inferFieldKey(indicator.name || '');
      const value = _firstNumber(indicator.value || '');
      if (!key || value === null || found[key]) return;
      found[key] = {
        key,
        label: FIELD_MAP[key].label,
        value,
        unit: indicator.unit || FIELD_MAP[key].unit,
        sourceName: indicator.name || FIELD_MAP[key].label,
        referenceRange: indicator.referenceRange || '',
        status: indicator.status || 'unknown',
        selected: true,
      };
    });

    return Object.keys(FIELD_MAP)
      .filter((key) => found[key])
      .map((key) => found[key]);
  },

  async _buildReportRecord(imagePath, data, result) {
    data = _normalizeOcrData(data);
    const now = new Date().toISOString();
    const reportTime = _normalizeReportTime(data.reportDate || now);
    const clientId = `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const savedImagePath = await this._persistImage(imagePath);
    const structured = {
      reportDate: reportTime,
      indicators: Array.isArray(data.indicators) ? data.indicators : result.map((item) => ({
        category: '其他',
        name: item.sourceName || item.label,
        value: String(item.value),
        unit: item.unit || '',
        referenceRange: item.referenceRange || '',
        status: item.status || 'unknown',
      })),
      summary: data.summary || '',
      analysisAdvice: _withAiDoctorDisclaimer(data.analysisAdvice || ''),
      rawText: _displayRawText(data.rawText || ''),
      provider: data.provider || '',
    };

    return {
      id: clientId,
      clientId,
      imagePath: savedImagePath || imagePath,
      reportTime,
      summary: data.summary || '检查报告',
      analysisAdvice: structured.analysisAdvice,
      rawText: _displayRawText(data.rawText || ''),
      structured,
      provider: data.provider || '',
      createdAt: now,
      updatedAt: now,
    };
  },

  _enqueueReport(report) {
    try {
      sync.enqueueItem({
        table: 'health_report',
        clientId: report.clientId,
        version: _toMs(report.updatedAt) || Date.now(),
        clientUpdatedAt: _toMs(report.updatedAt) || Date.now(),
        deleted: false,
        plain: {
          user_id: 'local-user',
          client_id: report.clientId,
          image_path: report.imagePath || '',
          report_time: _toMs(report.reportTime) || Date.now(),
          summary: report.summary || '',
          raw_text: report.rawText || '',
          structured_json: JSON.stringify(report.structured || {}),
          provider: report.provider || '',
          created_at: _toMs(report.createdAt) || Date.now(),
          updated_at: _toMs(report.updatedAt) || Date.now(),
          version: _toMs(report.updatedAt) || Date.now(),
        },
        meta: {
          report_time: _toMs(report.reportTime) || Date.now(),
          provider: report.provider || '',
        },
      });
    } catch (e) {}
  },

  async _persistImage(filePath) {
    if (!filePath) return '';
    try {
      const saved = await wx.saveFile({ tempFilePath: filePath });
      return saved.savedFilePath || filePath;
    } catch (e) {
      return filePath;
    }
  },

  _removeSavedFile(filePath) {
    try {
      if (!filePath || filePath.indexOf('wxfile://') !== 0) return;
      wx.removeSavedFile({ filePath });
    } catch (e) {}
  },

  _fmtTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  },

  _fmtDateOnly(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },

  _reportMeasuredAt() {
    const value = this.data.reportDate;
    if (!value || value === 'null') return new Date().toISOString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  },
});

function _inferFieldKey(name) {
  const normalized = _normalizeName(name);
  if (_containsAny(normalized, ['收缩压', '高压', 'systolic', 'sbp'])) return 'systolic';
  if (_containsAny(normalized, ['舒张压', '低压', 'diastolic', 'dbp'])) return 'diastolic';
  if (_containsAny(normalized, ['心率', '脉搏', 'heartrate', 'pulse'])) return 'heartRate';
  if (_containsAny(normalized, ['体重', 'weight'])) return 'weightKg';
  if (_containsAny(normalized, ['腰围', 'waist'])) return 'waistCm';
  if (_containsAny(normalized, ['体脂', 'bodyfat'])) return 'bodyFatPct';
  if (_containsAny(normalized, ['血氧', 'spo2', '氧饱和'])) return 'spo2Pct';
  if (_containsAny(normalized, ['血糖', '葡萄糖', 'glucose', 'glu', 'fpg']) && normalized.indexOf('尿') < 0) return 'glucoseMmol';
  if (_containsAny(normalized, ['甘油三酯', 'triglyceride', 'tg'])) return 'tg';
  if (_containsAny(normalized, ['低密度脂蛋白', 'ldlc', 'ldl'])) return 'ldl';
  if (_containsAny(normalized, ['高密度脂蛋白', 'hdlc', 'hdl'])) return 'hdl';
  if (_containsAny(normalized, ['总胆固醇', 'totalcholesterol', 'cholesterol', 'tc'])) return 'tc';
  return '';
}

function _normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_\-()/（）:：]/g, '');
}

function _containsAny(value, keywords) {
  return keywords.some((keyword) => value.indexOf(_normalizeName(keyword)) >= 0);
}

function _firstNumber(value) {
  const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const result = Number(match[0]);
  return Number.isFinite(result) ? result : null;
}

function _normalizeReportTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function _normalizeOcrData(data) {
  if (!data || typeof data !== 'object') return {};
  if (Array.isArray(data.indicators) && data.indicators.length) return data;
  const parsed = _tryParseJsonObject(data.rawText);
  if (!parsed) return data;
  return {
    ...parsed,
    provider: data.provider || parsed.provider || '',
  };
}

function _tryParseJsonObject(value) {
  let text = String(value || '').trim();
  if (!text) return null;
  if (text.indexOf('```') === 0) {
    const start = text.indexOf('\n');
    const end = text.lastIndexOf('```');
    if (start > 0 && end > start) text = text.slice(start + 1, end).trim();
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(text.slice(first, last + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function _displayRawText(value) {
  const text = String(value || '');
  return _tryParseJsonObject(text) ? '' : text;
}

function _withAiDoctorDisclaimer(value) {
  const text = String(value || '').trim();
  if (!text) return `AI 已根据报告内容生成初步分析建议。${AI_DOCTOR_DISCLAIMER}`;
  if (text.indexOf('不能代替医生') >= 0 || text.indexOf('不代替医生') >= 0) return text;
  return `${text} ${AI_DOCTOR_DISCLAIMER}`;
}

function _statusClass(status) {
  if (status === 'high') return 'high';
  if (status === 'low') return 'low';
  if (status === 'normal') return 'normal';
  return 'unknown';
}

function _statusLabel(status) {
  if (status === 'high') return '偏高';
  if (status === 'low') return '偏低';
  if (status === 'normal') return '正常';
  return '待核对';
}

function _toMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 1000000000) return n;
  const date = new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : 0;
}
