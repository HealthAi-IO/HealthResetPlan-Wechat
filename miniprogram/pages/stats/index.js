const http = require('../../utils/request');
const storage = require('../../utils/storage');

const TYPE_META = {
  weight:     { label: '体重',     unit: 'kg',      icon: '⚖️',  color: '#1E88E5' },
  bp:         { label: '血压',     unit: 'mmHg',    icon: '❤️',  color: '#E53935' },
  glucose:    { label: '血糖',     unit: 'mmol/L',  icon: '💧',  color: '#FB8C00' },
  heart_rate: { label: '心率',     unit: 'bpm',     icon: '💓',  color: '#EC407A' },
  spo2:       { label: '血氧',     unit: '%',       icon: '🌬️', color: '#29B6F6' },
  lipid:      { label: '血脂',     unit: 'mmol/L',  icon: '🔬',  color: '#7E57C2' },
  sleep:      { label: '睡眠',     unit: 'h',       icon: '🌙',  color: '#5C6BC0' },
  steps:      { label: '步数',     unit: '步',      icon: '👣',  color: '#2BBE7A' },
  waist:      { label: '腰围',     unit: 'cm',      icon: '📏',  color: '#8D6E63' },
  body_fat:   { label: '体脂率',   unit: '%',       icon: '🧬',  color: '#26A69A' },
};

Page({
  data: {
    groups: [],     // [{type, label, icon, color, latest, latestTime, history:[...], trend:'up'|'down'|'flat'}]
    nickname: '', avatarSrc: '', isLoggedIn: false,
    totalIndicators: 0,
    totalClocks: 0,
    accountDays: 0,
  },

  onShow() { this._load(); },

  _load() {
    const app = getApp();
    const prof = storage.profile.get();
    const allInds = storage.indicators.getAll();

    // 分组 + 取最近 7 条
    const map = {};
    allInds.forEach(i => {
      if (!map[i.type]) map[i.type] = [];
      if (map[i.type].length < 7) map[i.type].push(i);
    });

    // 近 30 天用于趋势图
    const cutoffMs = Date.now() - 30 * 86400000;

    const groups = Object.keys(TYPE_META)
      .filter(t => map[t] && map[t].length > 0)
      .map(type => {
        const meta = TYPE_META[type];
        const history = map[type];
        const latest = storage.indicators.formatValue(history[0]);
        const latestTime = _fmtDate(history[0].measuredAt);
        // 趋势：比较最新两条数值
        let trend = 'flat';
        if (history.length >= 2) {
          const v1 = _numVal(history[0]);
          const v2 = _numVal(history[1]);
          if (v1 !== null && v2 !== null) trend = v1 > v2 ? 'up' : v1 < v2 ? 'down' : 'flat';
        }

        // 30 天图表数据
        const series = allInds
          .filter(i => i.type === type && new Date(i.measuredAt).getTime() >= cutoffMs)
          .map(i => ({ time: i.measuredAt, value: _numVal(i), p: i.payload }))
          .filter(p => p.value !== null);

        const chartPoints  = series.map(p => ({ time: p.time, value: p.value }));
        // 血压：第二条曲线 = 舒张压
        const chartPoints2 = (type === 'bp')
          ? series
              .filter(p => p.p && typeof p.p.diastolic === 'number')
              .map(p => ({ time: p.time, value: p.p.diastolic }))
          : [];

        return {
          type, label: meta.label, icon: meta.icon, color: meta.color,
          latest, latestTime, trend,
          chartPoints, chartPoints2,
          chartCount: chartPoints.length,
          history: history.map(i => ({
            ...i,
            displayValue: storage.indicators.formatValue(i),
            timeLabel: _fmtDate(i.measuredAt),
          })),
          expanded: false,
        };
      });

    // 汇总数据
    const allClocks = storage.clock.getAll();
    const firstDate = allInds.length ? new Date(allInds[allInds.length - 1].measuredAt) : new Date();
    const days = Math.max(1, Math.round((Date.now() - firstDate) / 86400000));

    this.setData({
      groups,
      nickname:   prof?.nickname || (app.isLoggedIn() ? '已登录用户' : '本地用户'),
      avatarSrc:  this._avatarSrc(app),
      isLoggedIn: app.isLoggedIn(),
      totalIndicators: allInds.length,
      totalClocks:     allClocks.length,
      accountDays:     days,
    });
  },

  onToggleGroup(e) {
    const { index } = e.currentTarget.dataset;
    const key = `groups[${index}].expanded`;
    this.setData({ [key]: !this.data.groups[index].expanded });
  },

  onGoIndicators() { wx.navigateTo({ url: '/pages/indicators/index' }); },
  onChartArea() {}, // 阻止点击图表区折叠卡片（catchtap 用）

  _avatarSrc(app) {
    if (!app.globalData.userId || !app.globalData.avatarUrl) return '';
    return `${app.globalData.baseUrl}/files/avatar/${app.globalData.userId}?v=${encodeURIComponent(app.globalData.avatarUrl)}`;
  },

  onChooseAvatar() {
    const app = getApp();
    if (!app.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/index' });
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async res => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        wx.showLoading({ title: '上传中' });
        try {
          const uploaded = await http.upload('/files/avatar', file.tempFilePath);
          const avatarUrl = uploaded.avatarUrl || '';
          const info = await http.put('/users/me', { avatarUrl });
          app.setAccountInfo({
            avatarUrl: info.avatarUrl || avatarUrl,
            hasCloudSync: !!info.hasCloudSync
          });
          this._load();
          wx.showToast({ title: '头像已更新', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: (e && e.message) || '上传失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },
});

function _fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function _numVal(indicator) {
  if (!indicator?.payload) return null;
  const p = indicator.payload;
  if (p.weightKg   !== undefined) return p.weightKg;
  if (p.systolic   !== undefined) return p.systolic;
  if (p.mmol       !== undefined) return p.mmol;
  if (p.bpm        !== undefined) return p.bpm;
  if (p.pct        !== undefined) return p.pct;
  if (p.hours      !== undefined) return p.hours;
  if (p.count      !== undefined) return p.count;
  if (p.cm         !== undefined) return p.cm;
  if (p.tc         !== undefined) return p.tc;
  return null;
}
