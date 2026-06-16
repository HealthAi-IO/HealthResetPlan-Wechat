const storage = require('../../utils/storage');
const planUtil = require('../../utils/plan');
const http = require('../../utils/http');

Page({
  data: {
    profile: null,
    plans: [],           // grouped by date: [{dateLabel, items:[...]}]
    filter: 'all',       // all | meal | exercise | measurement
    selectedProvider: 'doubao',
    aiGenerating: false,
    isEmpty: true,
  },

  onShow() { this._load(); },

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

  onGenerate() {
    planUtil.generateWeekly();
    this._load();
    wx.showToast({ title: '本地计划已更新', icon: 'success' });
  },

  onAiGenerate() {
    const app = getApp();
    if (!app.isLoggedIn()) {
      wx.showModal({
        title: '需要登录',
        content: 'AI 生成方案需要账号 + 会员权益，请先登录。',
        confirmText: '去登录',
        success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/login/index' }); }
      });
      return;
    }
    const prof = storage.profile.get();
    if (!prof || !prof.heightCm || !prof.weightKg) {
      wx.showModal({
        title: '先完善档案',
        content: 'AI 方案需要身高、体重、目标等基础信息。',
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
      const applied = planUtil.applyAiPlanResult(res);
      this._load();
      wx.showToast({ title: `AI 已生成 ${applied.count} 条`, icon: 'success' });
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

function _friendlyAiError(err) {
  const code = err && err.code;
  const msg = err && (err.message || err.msg);
  if (code === 40301) return 'AI 方案生成需要会员权益';
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
