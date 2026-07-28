const http = require('../../utils/http');
const storage = require('../../utils/storage');

Page({
  data: {
    mode: 'login',
    loading: false,
    codeSending: false,
    form: { identifier: '', password: '', nickname: '', code: '' }
  },

  onSwitchLogin() { this.setData({ mode: 'login', 'form.code': '' }); },
  onSwitchRegister() { this.setData({ mode: 'register', 'form.code': '' }); },
  onSwitchReset() { this.setData({ mode: 'reset', 'form.code': '' }); },

  onOpenLegal(e) {
    wx.navigateTo({ url: `/pages/legal/index?type=${e.currentTarget.dataset.type}` });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  async onSubmit() {
    if (!this._validate()) return;
    if (this.data.loading) return;
    this.setData({ loading: true });

    try {
      if (this.data.mode === 'reset') {
        await this._resetPassword();
        return;
      }
      await this._smsLogin();
    } finally {
      this.setData({ loading: false });
    }
  },

  async onSendLoginCode() {
    await this._sendCode('/auth/sms/send-code', { phone: this._phone() });
  },

  async onSendResetCode() {
    await this._sendCode('/auth/password-reset/send-code', {
      credType: 'phone',
      identifier: this._phone()
    });
  },

  async _smsLogin() {
    const localProfile = storage.profile.get() || {};
    const { form } = this.data;
    const data = await http.post('/auth/sms/login', {
      phone: this._phone(),
      code: form.code.trim(),
      nickname: form.nickname || localProfile.nickname || '健康用户'
    });

    const app = getApp();
    app.setAuth({
      userId: data.userId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken
    });

    await this._afterAuthSync(form.nickname);
    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => wx.switchTab({ url: '/pages/home/index' }), 600);
  },

  async _resetPassword() {
    const { form } = this.data;
    await http.post('/auth/password-reset/reset', {
      credType: 'phone',
      identifier: this._phone(),
      code: form.code.trim(),
      newPassword: form.password
    });
    this.setData({ mode: 'login', 'form.code': '', 'form.password': '' });
    wx.showToast({ title: '密码已重置，请登录', icon: 'success' });
  },

  async _sendCode(path, body) {
    if (!this._phone()) {
      wx.showToast({ title: '请先填写正确的手机号', icon: 'none' });
      return;
    }
    if (this.data.codeSending) return;
    this.setData({ codeSending: true });
    try {
      const data = await http.post(path, body);
      if (data && data.debugCode) this.setData({ 'form.code': data.debugCode });
      wx.showToast({ title: '验证码已发送', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '发送失败', icon: 'none' });
    } finally {
      this.setData({ codeSending: false });
    }
  },

  _validate() {
    const { form, mode } = this.data;
    if (!this._phone()) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return false;
    }
    if (!form.code.trim()) {
      wx.showToast({ title: '请输入验证码', icon: 'none' });
      return false;
    }
    if (mode === 'reset') {
      if (!form.password) {
        wx.showToast({ title: '请输入新密码', icon: 'none' });
        return false;
      }
      if (form.password.length < 8 || form.password.length > 64) {
        wx.showToast({ title: '密码需 8-64 位', icon: 'none' });
        return false;
      }
    }
    return true;
  },

  async _afterAuthSync(nickname) {
    await storage.bindOnline();
    try {
      await this._syncAccountInfo(nickname);
    } catch (e) {}
  },

  async _syncAccountInfo(inputNickname) {
    const app = getApp();
    const localProfile = storage.profile.get() || {};
    const nickname = (localProfile.nickname || inputNickname || '').trim();
    try {
      if (nickname) await http.put('/users/me', { nickname });
      const info = await http.get('/users/me');
      app.setAccountInfo({
        nickname: nickname || info.nickname,
        avatarUrl: info.avatarUrl || '',
        hasCloudSync: true
      });
    } catch (e) {
      if (nickname) storage.profile.save({ ...localProfile, nickname });
    }
  },

  _phone() {
    const value = (this.data.form.identifier || '').replace(/\D/g, '');
    return /^1\d{10}$/.test(value) ? value : '';
  },

  onSkip() {
    wx.showToast({ title: '请先登录账号', icon: 'none' });
  }
});
