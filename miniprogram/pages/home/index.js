const storage = require('../../utils/storage');
const planUtil = require('../../utils/plan');
const sync = require('../../utils/sync');

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const TYPE_LABELS = {
  weight: '体重', bp: '血压', glucose: '血糖', heart_rate: '心率',
  lipid: '血脂', spo2: '血氧', sleep: '睡眠', steps: '步数', waist: '腰围', body_fat: '体脂'
};
const CLOCK_LABELS = {
  meal: '饮食打卡',
  exercise: '运动打卡',
  medicine: '用药打卡',
  weight: '称重打卡',
  water: '饮水打卡',
};

Page({
  data: {
    nickname: '', todayLabel: '',
    completionPct: 0, completionDash: '0 / 4', doneTypes: {},
    bmi: '--', bmiLevel: '--',
    latestBp: '--', latestWeight: '--', latestGlucose: '--',
    todayMealPlan: null, todayExercisePlan: null, hasPlan: false,
    mealSummaryExpanded: false, exerciseSummaryExpanded: false,
    hasLongMealSummary: false, hasLongExerciseSummary: false,
    recentIndicators: [], todayClocks: [],
    hasProfile: false, hasCloudSync: false,
    needsSetup: false,
    needsIndicators: false,
    syncStatusText: '去设置',
  },

  onShow() { this._load(); },

  onRefresh() { this._load(); },

  _load() {
    const app = getApp();
    const prof = storage.profile.get();
    const todayClocks = storage.clock.today();
    const todayPlans = storage.plans.today();
    const allInds = storage.indicators.getAll();
    const hasProfile = this._hasUsableProfile(prof);
    const needsIndicators = hasProfile && allInds.length === 0;

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
    const hasLongMealSummary = this._isLongText(todayMealPlan && todayMealPlan.summary);
    const hasLongExerciseSummary = this._isLongText(todayExercisePlan && todayExercisePlan.summary);

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
      label: r.label || CLOCK_LABELS[r.type] || '打卡记录',
      clockTime: _fmtTime(r.clockTime),
    }));

    const now = new Date();
    const syncStatus = sync.status();
    const syncStatusText = !syncStatus.loggedIn ? '先登录'
      : (!syncStatus.hasKey ? '待恢复密钥' : '可同步');
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
      hasLongMealSummary,
      hasLongExerciseSummary,
      recentIndicators,
      todayClocks: todayClocksFmt,
      hasProfile,
      needsSetup: !hasProfile || needsIndicators,
      needsIndicators,
      hasCloudSync: !!app.globalData.hasCloudSync,
      syncStatusText,
    });
  },

  onTogglePlanSummary(e) {
    const { type } = e.currentTarget.dataset;
    if (type === 'meal') {
      this.setData({ mealSummaryExpanded: !this.data.mealSummaryExpanded });
      return;
    }
    if (type === 'exercise') {
      this.setData({ exerciseSummaryExpanded: !this.data.exerciseSummaryExpanded });
    }
  },

  _hasUsableProfile(prof) {
    if (!prof) return false;
    const hasNickname = !!String(prof.nickname || '').trim();
    const hasHeight = Number(prof.heightCm) > 0;
    const hasWeight = Number(prof.weightKg) > 0;
    const hasAge = Number(prof.age || prof.birthYear) > 0;
    return hasNickname && hasHeight && hasWeight && hasAge;
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

  _isLongText(value) {
    return String(value || '').trim().length > 30;
  },
});

function _fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
