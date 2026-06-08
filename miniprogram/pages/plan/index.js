const storage = require('../../utils/storage');
const planUtil = require('../../utils/plan');
const http = require('../../utils/request');

Page({
  data: {
    profile: null,
    plans: [],           // grouped by date: [{dateLabel, items:[...]}]
    filter: 'all',       // all | meal | exercise | measurement
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
      items: map[date],
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
    this.setData({ aiGenerating: true });
    http.post('/ai/plan', { profile: storage.profile.get() })
      .then(res => {
        wx.showToast({ title: 'AI 方案已生成', icon: 'success' });
        this._load();
      })
      .catch(err => {
        wx.showToast({ title: err.message || 'AI 生成失败', icon: 'none' });
      })
      .finally(() => { this.setData({ aiGenerating: false }); });
  },

  onRefresh() { this._load(); },
});

function _dateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const diff = Math.round((d - today) / 86400000);
  const WEEK = ['日','一','二','三','四','五','六'];
  const base = `${d.getMonth()+1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
  if (diff === 0)  return `今天  ${base}`;
  if (diff === 1)  return `明天  ${base}`;
  if (diff === -1) return `昨天  ${base}`;
  return base;
}
