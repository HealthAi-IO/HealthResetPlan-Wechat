const http = require('../../utils/http');
const storage = require('../../utils/storage');
const sync = require('../../utils/sync');

const GOAL_LIST     = ['减脂降重', '控糖', '控压', '降脂', '综合调理'];
const ACTIVITY_LIST = ['久坐不动', '轻度活动', '中度活动', '高度活动'];
const DIET_LIST     = ['普通饮食', '低盐低脂', '素食', '定制饮食'];
const GENDER_LIST   = ['男', '女'];

Page({
  data: {
    form: {
      nickname: '', gender: 0, age: '', heightCm: '', weightKg: '',
      goal: 0, activityLevel: 0, dietPref: 0,
      hasHypertension: false, hasDiabetes: false, hasHyperlipidemia: false,
      hasCVD: false, hasObesity: false,
      medicalHistory: '', medicines: '',
    },
    goalList:     GOAL_LIST,
    activityList: ACTIVITY_LIST,
    dietList:     DIET_LIST,
    genderList:   GENDER_LIST,
    bmiText: '--',
    completionText: '0%',
    saved: false,
  },

  onLoad() {
    this._loadProfile();
  },

  onShow() {
    this._loadProfile();
  },

  _loadProfile() {
    const prof = storage.profile.get();
    if (prof) {
      const goalIdx     = GOAL_LIST.indexOf(prof.goal)          >= 0 ? GOAL_LIST.indexOf(prof.goal)          : 0;
      const actIdx      = ACTIVITY_LIST.indexOf(prof.activityLevel) >= 0 ? ACTIVITY_LIST.indexOf(prof.activityLevel) : 0;
      const dietIdx     = DIET_LIST.indexOf(prof.dietPref)      >= 0 ? DIET_LIST.indexOf(prof.dietPref)      : 0;
      const genderIdx   = GENDER_LIST.indexOf(prof.gender)      >= 0 ? GENDER_LIST.indexOf(prof.gender)      : 0;
      this.setData({
        form: {
          nickname:         prof.nickname         || '',
          gender:           genderIdx,
          age:              prof.age              ? String(prof.age)       : '',
          heightCm:         prof.heightCm         ? String(prof.heightCm) : '',
          weightKg:         prof.weightKg         ? String(prof.weightKg) : '',
          goal:             goalIdx,
          activityLevel:    actIdx,
          dietPref:         dietIdx,
          hasHypertension:  !!prof.hasHypertension,
          hasDiabetes:      !!prof.hasDiabetes,
          hasHyperlipidemia:!!prof.hasHyperlipidemia,
          hasCVD:           !!prof.hasCVD,
          hasObesity:       !!prof.hasObesity,
          medicalHistory:   prof.medicalHistory || '',
          medicines:        prof.medicines || '',
        }
      }, () => this._refreshSummary());
      return;
    }
    this.setData({
      form: {
        nickname: '', gender: 0, age: '', heightCm: '', weightKg: '',
        goal: 0, activityLevel: 0, dietPref: 0,
        hasHypertension: false, hasDiabetes: false, hasHyperlipidemia: false,
        hasCVD: false, hasObesity: false,
        medicalHistory: '', medicines: '',
      }
    }, () => this._refreshSummary());
  },

  onInput(e)  { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }, () => this._refreshSummary()); },
  onSwitch(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }, () => this._refreshSummary()); },

  onPickGender(e)   { this.setData({ 'form.gender':        parseInt(e.detail.value) }, () => this._refreshSummary()); },
  onPickGoal(e)     { this.setData({ 'form.goal':          parseInt(e.detail.value) }, () => this._refreshSummary()); },
  onPickActivity(e) { this.setData({ 'form.activityLevel': parseInt(e.detail.value) }, () => this._refreshSummary()); },
  onPickDiet(e)     { this.setData({ 'form.dietPref':      parseInt(e.detail.value) }, () => this._refreshSummary()); },

  onSave() {
    const f = this.data.form;
    if (!f.nickname.trim()) { wx.showToast({ title: '请填写昵称', icon: 'none' }); return; }
    if (!f.heightCm || !f.weightKg) { wx.showToast({ title: '请填写身高和体重', icon: 'none' }); return; }

    const prof = {
      nickname:          f.nickname.trim(),
      gender:            GENDER_LIST[f.gender],
      age:               parseInt(f.age)       || 0,
      birthYear:         parseInt(f.age)       ? new Date().getFullYear() - (parseInt(f.age) || 0) : 0,
      heightCm:          parseFloat(f.heightCm) || 0,
      weightKg:          parseFloat(f.weightKg) || 0,
      goal:              GOAL_LIST[f.goal],
      activityLevel:     ACTIVITY_LIST[f.activityLevel],
      dietPref:          DIET_LIST[f.dietPref],
      hasHypertension:   f.hasHypertension,
      hasDiabetes:       f.hasDiabetes,
      hasHyperlipidemia: f.hasHyperlipidemia,
      hasCVD:            f.hasCVD,
      hasObesity:        f.hasObesity,
      medicalHistory:    f.medicalHistory.trim(),
      medicines:         f.medicines,
      updatedAt:         new Date().toISOString(),
    };
    storage.profile.save(prof);

    // 同步写入体重指标
    if (prof.weightKg) {
      const entry = storage.indicators.add({ type: 'weight', payload: { weightKg: prof.weightKg } });
      try { sync.enqueueIndicator(entry); } catch (e) {}
    }
    this._syncAccountNickname(prof.nickname);

    this.setData({ saved: true });
    wx.showToast({ title: '档案已保存 ✓', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 1200);
  },

  async _syncAccountNickname(nickname) {
    const app = getApp();
    if (!app.isLoggedIn() || !nickname) return;
    try {
      const info = await http.put('/users/me', { nickname });
      app.setAccountInfo({
        nickname: info.nickname || nickname,
        avatarUrl: info.avatarUrl || app.globalData.avatarUrl,
        hasCloudSync: !!info.hasCloudSync
      });
    } catch (e) {}
  },

  _refreshSummary() {
    const f = this.data.form;
    const height = parseFloat(f.heightCm);
    const weight = parseFloat(f.weightKg);
    const bmi = height > 0 && weight > 0 ? weight / Math.pow(height / 100, 2) : 0;
    const required = ['nickname', 'age', 'heightCm', 'weightKg'];
    const filled = required.filter(key => String(f[key] || '').trim()).length;
    const completion = Math.round((filled / required.length) * 100);
    this.setData({
      bmiText: bmi ? bmi.toFixed(1) : '--',
      completionText: `${completion}%`
    });
  },
});
