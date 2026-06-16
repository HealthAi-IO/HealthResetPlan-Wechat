const http = require('../../utils/http');
const storage = require('../../utils/storage');
const sync = require('../../utils/sync');

Page({
  data: {
    mode: 'login',
    showPwd: false,
    loading: false,
    form: { identifier: '', password: '', nickname: '' }
  },

  onSwitchLogin()    { this.setData({ mode: 'login' }); },
  onSwitchRegister() { this.setData({ mode: 'register' }); },

  onTogglePwd() { this.setData({ showPwd: !this.data.showPwd }); },

  onInput(e) {
    const f = e.currentTarget.dataset.field;
    this.setData({ [`form.${f}`]: e.detail.value });
  },

  _validate() {
    const { form, mode } = this.data;
    if (!form.identifier) {
      wx.showToast({ title: '请输入手机号', icon: 'none' });
      return false;
    }
    if (!/^1\d{10}$/.test(form.identifier)) {
      wx.showToast({ title: '手机号格式错误', icon: 'none' });
      return false;
    }
    if (!form.password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return false;
    }
    if (mode === 'register' && (form.password.length < 8 || form.password.length > 64)) {
      wx.showToast({ title: '密码需 8-64 位', icon: 'none' });
      return false;
    }
    return true;
  },

  async onSubmit() {
    if (!this._validate()) return;
    if (this.data.loading) return;
    this.setData({ loading: true });

    const { mode, form } = this.data;
    const path = mode === 'login' ? '/auth/login' : '/auth/register';
    const localProfile = storage.profile.get() || {};
    const body = {
      credType: 'phone',
      identifier: form.identifier,
      password: form.password,
      ...(mode === 'register' ? { nickname: form.nickname || localProfile.nickname || '健康用户' } : {})
    };

    try {
      const data = await http.post(path, body);
      const app = getApp();
      app.setAuth({
        userId:       data.userId,
        accessToken:  data.accessToken,
        refreshToken: data.refreshToken
      });

      this._afterAuthSync(form.nickname);
      wx.showToast({ title: mode === 'login' ? '登录成功' : '注册成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (err) {
      const msg = this._errorMessage(err, mode);
      wx.showToast({ title: msg, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async _afterAuthSync(nickname) {
    try {
      await this._syncAccountInfo(nickname);
    } catch (e) {}
    try {
      await sync.pushLocalIndicatorsIfReady();
    } catch (e) {}
  },

  _errorMessage(err, mode) {
    const msg = (err && (err.message || err.msg)) || '';
    if (mode === 'register' && (err && err.code) === 40901) {
      return '手机号已注册，请切换到登录';
    }
    return msg || '网络异常，请稍后重试';
  },

  async _syncAccountInfo(inputNickname) {
    const app = getApp();
    const localProfile = storage.profile.get() || {};
    const nickname = (localProfile.nickname || inputNickname || '').trim();
    try {
      if (nickname) {
        await http.put('/users/me', { nickname });
      }
      const info = await http.get('/users/me');
      app.setAccountInfo({
        nickname: nickname || info.nickname,
        avatarUrl: info.avatarUrl || '',
        hasCloudSync: !!info.hasCloudSync
      });
    } catch (e) {
      if (nickname) storage.profile.save({ ...localProfile, nickname });
    }
  },

  onSkip() {
    wx.navigateBack();
  }
});
