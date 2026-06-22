const http = require('../../utils/http');
const storage = require('../../utils/storage');
const sync = require('../../utils/sync');

Page({
  data: {
    mode: 'login',
    showPwd: false,
    loading: false,
    codeSending: false,
    form: { identifier: '', password: '', nickname: '', code: '' }
  },

  onSwitchLogin()    { this.setData({ mode: 'login' }); },
  onSwitchRegister() { this.setData({ mode: 'register' }); },
  onSwitchReset()    { this.setData({ mode: 'reset' }); },

  onOpenLegal(e) {
    wx.navigateTo({ url: `/pages/legal/index?type=${e.currentTarget.dataset.type}` });
  },

  onTogglePwd() { this.setData({ showPwd: !this.data.showPwd }); },

  onInput(e) {
    const f = e.currentTarget.dataset.field;
    this.setData({ [`form.${f}`]: e.detail.value });
  },

  _validate() {
    const { form, mode } = this.data;
    if (!form.identifier) {
      wx.showToast({ title: '请输入手机号或邮箱', icon: 'none' });
      return false;
    }
    if (!this._credType(form.identifier)) {
      wx.showToast({ title: '手机号或邮箱格式错误', icon: 'none' });
      return false;
    }
    if (!form.password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return false;
    }
    if (mode !== 'login' && (form.password.length < 8 || form.password.length > 64)) {
      wx.showToast({ title: '密码需 8-64 位', icon: 'none' });
      return false;
    }
    if (mode === 'reset' && !form.code.trim()) {
      wx.showToast({ title: '请输入验证码', icon: 'none' });
      return false;
    }
    return true;
  },

  async onSubmit() {
    if (!this._validate()) return;
    if (this.data.loading) return;
    this.setData({ loading: true });

    const { mode, form } = this.data;
    if (mode === 'reset') {
      await this._resetPassword();
      return;
    }
    const path = mode === 'login' ? '/auth/login' : '/auth/register';
    const localProfile = storage.profile.get() || {};
    const body = {
      credType: this._credType(form.identifier),
      identifier: form.identifier.trim(),
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

  _credType(identifier) {
    const value = (identifier || '').trim();
    if (/^1\d{10}$/.test(value)) return 'phone';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
    return '';
  },

  async onSendResetCode() {
    const identifier = this.data.form.identifier.trim();
    const credType = this._credType(identifier);
    if (!credType) {
      wx.showToast({ title: '请先填写正确的手机号或邮箱', icon: 'none' });
      return;
    }
    if (this.data.codeSending) return;
    this.setData({ codeSending: true });
    try {
      const data = await http.post('/auth/password-reset/send-code', { credType, identifier });
      if (data && data.debugCode) this.setData({ 'form.code': data.debugCode });
      wx.showToast({ title: '验证码已发送', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '发送失败', icon: 'none' });
    } finally {
      this.setData({ codeSending: false });
    }
  },

  async _resetPassword() {
    const { form } = this.data;
    try {
      await http.post('/auth/password-reset/reset', {
        credType: this._credType(form.identifier),
        identifier: form.identifier.trim(),
        code: form.code.trim(),
        newPassword: form.password
      });
      this.setData({ mode: 'login', 'form.code': '' });
      wx.showToast({ title: '密码已重置，请登录', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '重置失败', icon: 'none' });
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
      return '该账号已注册，请切换到登录';
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
