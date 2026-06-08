const storage = require('../../utils/storage');
const planUtil = require('../../utils/plan');

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const TYPE_LABELS = {
  weight: '体重', bp: '血压', glucose: '血糖', heart_rate: '心率',
  lipid: '血脂', spo2: '血氧', sleep: '睡眠', steps: '步数', waist: '腰围', body_fat: '体脂'
};

Page({
  data: {
    nickname: '', todayLabel: '',
    completionPct: 0, completionDash: '0 / 4', doneTypes: {},
    bmi: '--', bmiLevel: '--',
    latestBp: '--', latestWeight: '--', latestGlucose: '--',
    todayMealPlan: null, todayExercisePlan: null, hasPlan: false,
    recentIndicators: [], todayClocks: [],
    hasProfile: false, hasCloudSync: false,
    needsSetup: false,
  },

  onShow() { this._load(); },

  _load() {
    const app = getApp();
    const prof = storage.profile.get();
    const todayClocks = storage.clock.today();
    const todayPlans = storage.plans.today();
    const allInds = storage.indicators.getAll();

    // 打卡完成度
    const TARGET_TYPES = ['meal', 'exercise', 'medicine', 'weight'];
    const doneTypes = {};
    todayClocks.forEach(r => { if (r.status === 'done') doneTypes[r.type] = true; });
    const done = TARGET_TYPES.filter(t => doneTypes[t]).length;

    // BMI
    let bmi = '--', bmiLevel = '待完善';
    if (prof && prof.heightCm && prof.weightKg) {
      const h = prof.heightCm / 100;
      const v = prof.weightKg / (h * h);
      bmi = v.toFixed(1);
      bmiLevel = v < 18.5 ? '偏瘦' : v < 24 ? '正常' : v < 28 ? '超重' : '肥胖';
    }

    // 最新指标
    const bpR  = storage.indicators.latestByType('bp');
    const wtR  = storage.indicators.latestByType('weight');
    const glR  = storage.indicators.latestByType('glucose');
    const latestBp      = bpR ? `${bpR.payload.systolic}/${bpR.payload.diastolic}` : '--';
    const latestWeight  = wtR ? `${wtR.payload.weightKg} kg` : '--';
    const latestGlucose = glR ? `${glR.payload.mmol} mmol` : '--';

    // 今日计划
    const todayMealPlan     = todayPlans.find(p => p.type === 'meal')     || null;
    const todayExercisePlan = todayPlans.find(p => p.type === 'exercise') || null;

    // 最近6条指标（带格式化）
    const recentIndicators = allInds.slice(0, 6).map(i => ({
      ...i,
      typeLabel:    TYPE_LABELS[i.type] || i.type,
      displayValue: storage.indicators.formatValue(i),
      timeLabel:    _fmtTime(i.measuredAt),
    }));

    // 打卡记录格式化时间
    const todayClocksFmt = todayClocks.slice(0, 5).map(r => ({
      ...r,
      clockTime: _fmtTime(r.clockTime),
    }));

    const now = new Date();
    this.setData({
      nickname:    prof?.nickname || '朋友',
      todayLabel:  `${now.getMonth() + 1}月${now.getDate()}日 周${WEEKDAYS[now.getDay()]}`,
      completionPct: Math.round(done / TARGET_TYPES.length * 100),
      completionDash: `${done} / ${TARGET_TYPES.length}`,
      doneTypes,
      bmi, bmiLevel,
      latestBp, latestWeight, latestGlucose,
      todayMealPlan, todayExercisePlan,
      hasPlan: !!(todayMealPlan || todayExercisePlan),
      recentIndicators,
      todayClocks: todayClocksFmt,
      hasProfile:   !!prof,
      needsSetup: !prof || !allInds.length,
      hasCloudSync: !!app.globalData.hasCloudSync,
    });
  },

  onGeneratePlan() {
    planUtil.generateWeekly();
    this._load();
    wx.showToast({ title: '7 天计划已生成', icon: 'success' });
  },

  onGoPage(e) {
    const page = e.currentTarget.dataset.page;
    const tabPages = ['home', 'plan', 'clock', 'stats', 'settings'];
    if (tabPages.includes(page)) {
      wx.switchTab({ url: `/pages/${page}/index` });
    } else {
      wx.navigateTo({ url: `/pages/${page}/index` });
    }
  },

  onGoIndicators() { wx.navigateTo({ url: '/pages/indicators/index' }); },
  onGoPlan()       { wx.switchTab({ url: '/pages/plan/index' }); },
  onGoClock()      { wx.switchTab({ url: '/pages/clock/index' }); },
  onGoProfile()    { wx.navigateTo({ url: '/pages/profile/index' }); },
  onGoSettings()   { wx.switchTab({ url: '/pages/settings/index' }); },
  onGoChat()       { wx.navigateTo({ url: '/pages/chat/index' }); },
  onGoReport()     { wx.navigateTo({ url: '/pages/report/index' }); },
  onUseDemoData() {
    storage.resetDemoData();
    this._load();
    wx.showToast({ title: '已恢复测试数据', icon: 'success' });
  },
});

function _fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
