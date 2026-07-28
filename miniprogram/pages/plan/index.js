const storage = require('../../utils/storage');
const planUtil = require('../../utils/plan');
const http = require('../../utils/http');

const EDITOR_TYPES = [
  { value: 'meal', label: '饮食' },
  { value: 'exercise', label: '运动' },
  { value: 'measurement', label: '测量' },
];

Page({
  data: {
    profile: null,
    plans: [],           // grouped by date: [{dateLabel, items:[...]}]
    filter: 'all',       // all | meal | exercise | measurement
    selectedProvider: 'doubao',
    aiGenerating: false,
    isEmpty: true,
    aiPreviewVisible: false,
    pendingAiPlan: null,
    expandedDates: [],
    aiRemaining: null,
    editorTypes: EDITOR_TYPES,
    editor: {
      show: false, editing: false, id: '', date: '', type: 'meal',
      typeIndex: 0, summary: '', breakfast: '', lunch: '', dinner: '',
      snack: '', exerciseType: '', duration: '', intensity: '',
      description: '', items: '',
    },
  },

  onShow() { this._load(); this._loadAiUsage(); },

  async _loadAiUsage() {
    if (!getApp().isLoggedIn()) return;
    try {
      const data = await http.get('/ai/chat/daily-usage');
      this.setData({ aiRemaining: data.plan && data.plan.remaining });
    } catch (_) {}
  },

  _load() {
    const prof = storage.profile.get();
    const all = storage.plans.getAll().filter(p => p.type !== 'risk');
    this._updateView(prof, all, this.data.filter);
  },

  _updateView(prof, all, filter) {
    const filtered = filter === 'all' ? all : all.filter(p => p.type === filter);

    // 按日期分组，按 date 升序排列
    const map = {};
    filtered.forEach(p => {
      const k = p.date;
      if (!map[k]) map[k] = [];
      map[k].push(p);
    });
    const groups = Object.keys(map).sort().map(date => ({
      date,
      dateLabel: _dateLabel(date),
      items: map[date].map(_decoratePlan),
      expanded: this.data.expandedDates.includes(date),
    }));

    this.setData({
      profile: prof,
      plans: groups,
      filter,
      isEmpty: groups.length === 0,
    });
  },

  onFilterTap(e) {
    const f = e.currentTarget.dataset.filter;
    const all = storage.plans.getAll().filter(p => p.type !== 'risk');
    this._updateView(storage.profile.get(), all, f);
  },

  onToggleDay(e) {
    const { date } = e.currentTarget.dataset;
    const current = this.data.expandedDates || [];
    const expandedDates = current.includes(date)
      ? current.filter(item => item !== date)
      : current.concat(date);
    this.setData({ expandedDates });
    const all = storage.plans.getAll().filter(p => p.type !== 'risk');
    this._updateView(storage.profile.get(), all, this.data.filter);
  },

  onGenerate() {
    planUtil.generateWeekly();
    this._load();
    wx.showToast({ title: '本地计划已更新', icon: 'success' });
  },

  onAddPlan(e) {
    this._openEditor(null, e.currentTarget.dataset.date);
  },

  onEditPlan(e) {
    const id = String(e.currentTarget.dataset.id);
    const plan = storage.plans.getAll()
      .find(item => String(item.clientId || item.id) === id);
    if (plan) this._openEditor(plan, plan.date);
  },

  onDeletePlan(e) {
    const id = String(e.currentTarget.dataset.id);
    wx.showModal({
      title: '删除计划项',
      content: '删除后账号中的该计划项将不可恢复，确定继续吗？',
      confirmText: '删除',
      confirmColor: '#E53935',
      success: result => {
        if (!result.confirm) return;
        storage.plans.remove(id);
        this._load();
      }
    });
  },

  onEditorInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`editor.${field}`]: e.detail.value });
  },

  onEditorTypeChange(e) {
    const index = Number(e.detail.value) || 0;
    this.setData({
      'editor.typeIndex': index,
      'editor.type': EDITOR_TYPES[index].value,
    });
  },

  onEditorCancel() {
    this.setData({ 'editor.show': false });
  },

  onEditorSave() {
    const editor = this.data.editor;
    const summary = editor.summary.trim();
    if (!summary) {
      wx.showToast({ title: '请填写计划概括', icon: 'none' });
      return;
    }
    const payload = { summary };
    if (editor.type === 'meal') {
      ['breakfast', 'lunch', 'dinner', 'snack'].forEach(key => {
        payload[key] = _lines(editor[key]);
      });
    } else if (editor.type === 'exercise') {
      const duration = Number(editor.duration);
      if (editor.exerciseType.trim()) payload.type = editor.exerciseType.trim();
      if (duration > 0) {
        payload.duration = duration;
        payload.durationMinutes = duration;
      }
      if (editor.intensity.trim()) payload.intensity = editor.intensity.trim();
      if (editor.description.trim()) {
        payload.desc = editor.description.trim();
        payload.items = [editor.description.trim()];
      }
    } else {
      payload.items = _lines(editor.items);
    }

    if (editor.editing) {
      storage.plans.update(editor.id, { summary, payload });
    } else {
      storage.plans.add({
        date: editor.date,
        type: editor.type,
        summary,
        payload,
        aiProvider: 'manual',
        aiModel: 'manual-edit',
      });
    }
    this.setData({ 'editor.show': false });
    this._load();
    wx.showToast({ title: '计划已保存', icon: 'success' });
  },

  _openEditor(plan, date) {
    const payload = (plan && plan.payload) || {};
    const type = (plan && plan.type) || 'meal';
    const typeIndex = Math.max(0, EDITOR_TYPES.findIndex(item => item.value === type));
    this.setData({
      editor: {
        show: true,
        editing: !!plan,
        id: plan ? String(plan.clientId || plan.id) : '',
        date,
        type,
        typeIndex,
        summary: (plan && (plan.summary || payload.summary)) || '',
        breakfast: _linesText(payload.breakfast),
        lunch: _linesText(payload.lunch),
        dinner: _linesText(payload.dinner),
        snack: _linesText(payload.snack),
        exerciseType: payload.type || '',
        duration: String(payload.durationMinutes || payload.duration || ''),
        intensity: payload.intensity || '',
        description: payload.desc || _lines(payload.items)[0] || '',
        items: _linesText(payload.items),
      },
    });
  },

  onAiGenerate() {
    const app = getApp();
    if (!app.isLoggedIn()) {
      wx.showModal({
        title: '需要登录',
        content: 'AI 生成方案需要手机号账号，请先登录。',
        confirmText: '去登录',
        success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/login/index' }); }
      });
      return;
    }
    const prof = storage.profile.get();
    if (!planUtil.hasUsableProfile()) {
      wx.showModal({
        title: '先完善档案',
        content: 'AI 方案需要年龄、身高、体重、目标等基础信息。',
        confirmText: '去完善',
        success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/profile/index' }); }
      });
      return;
    }

    wx.showActionSheet({
      itemList: ['豆包（推荐）', 'DeepSeek', '通义千问'],
      success: r => {
        const providers = ['doubao', 'deepseek', 'qwen'];
        this._generateWithProvider(providers[r.tapIndex] || 'doubao');
      }
    });
  },

  onRefresh() { this._load(); },

  async _generateWithProvider(provider) {
    this.setData({ aiGenerating: true, selectedProvider: provider });
    wx.showLoading({ title: 'AI 生成中…', mask: true });
    try {
      const body = planUtil.buildAiPlanRequest(provider);
      const res = await http.post('/ai/plan/generate', body);
      const parsed = planUtil.parseAiPlanResult(res);
      this.setData({
        pendingAiPlan: parsed,
        aiPreviewVisible: true,
      });
      this._loadAiUsage();
      wx.showToast({ title: parsed.executable ? 'AI 方案已生成' : '请查看生成结果', icon: parsed.executable ? 'success' : 'none' });
    } catch (err) {
      if (!storage.plans.getAll().length) {
        planUtil.generateWeekly();
        this._load();
      }
      wx.showToast({ title: _friendlyAiError(err), icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ aiGenerating: false });
    }
  },

  onCloseAiPreview() {
    this.setData({ aiPreviewVisible: false });
  },

  onRegenerateAiPlan() {
    this.setData({ aiPreviewVisible: false, pendingAiPlan: null });
    this.onAiGenerate();
  },

  onApplyAiPlan() {
    const pending = this.data.pendingAiPlan;
    if (!pending || !pending.executable) {
      wx.showToast({ title: '当前 AI 方案无法应用，请重新生成', icon: 'none' });
      return;
    }

    try {
      const applied = planUtil.applyAiPlanResult(pending);
      this.setData({ aiPreviewVisible: false, pendingAiPlan: null });
      this._load();
      wx.showModal({
        title: '方案已应用',
        content: `已写入 ${applied.count} 条计划，并生成 ${applied.reminderCount} 条提醒。`,
        confirmText: '去打卡',
        cancelText: '留在计划',
        success: r => {
          if (r.confirm) wx.switchTab({ url: '/pages/clock/index' });
        }
      });
    } catch (err) {
      wx.showToast({ title: err.message || '应用失败', icon: 'none' });
    }
  },
});

function _decoratePlan(plan) {
  const payload = plan.payload || {};
  if (plan.type === 'meal') {
    return {
      ...plan,
      mealRows: [
        { slot: '早餐', text: _listText(payload.breakfast) },
        { slot: '午餐', text: _listText(payload.lunch) },
        { slot: '晚餐', text: _listText(payload.dinner) },
        { slot: '加餐', text: _listText(payload.snack) },
      ].filter(row => row.text)
    };
  }
  if (plan.type === 'measurement') {
    return {
      ...plan,
      measureItems: Array.isArray(payload.items) ? payload.items : []
    };
  }
  return plan;
}

function _listText(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean).join(' / ');
  return raw || '';
}

function _lines(raw) {
  if (Array.isArray(raw)) {
    return raw.map(item => String(item).trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(/[\r\n]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function _linesText(raw) {
  return _lines(raw).join('\n');
}

function _friendlyAiError(err) {
  const code = err && err.code;
  const msg = err && (err.message || err.msg);
  if (code === 40301) return '请先登录手机号账号';
  if (code === 42901) return '今日 AI 使用次数已达上限';
  if (code === 50301) return 'AI 服务繁忙，已保留本地方案';
  return msg || 'AI 生成失败，已保留本地方案';
}

function _dateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target - today) / 86400000);
  const WEEK = ['日','一','二','三','四','五','六'];
  const base = `${d.getMonth()+1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
  if (diff === 0)  return `今天  ${base}`;
  if (diff === 1)  return `明天  ${base}`;
  if (diff === -1) return `昨天  ${base}`;
  return base;
}
