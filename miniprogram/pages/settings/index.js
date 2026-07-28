const http = require('../../utils/http');
const storage = require('../../utils/storage');
const config = require('../../utils/config');

Page({
  data: {
    isLoggedIn: false,
    nickname: '', avatarSrc: '',
    version: `v${config.APP_VERSION}`,
    dataStatusText: '修改会自动保存到服务器',
  },

  onShow() { this._load(); },

  async _load() {
    const app = getApp();
    const prof = storage.profile.get() || {};
    this.setData({
      isLoggedIn: app.isLoggedIn(),
      nickname:   prof.nickname || (app.globalData.userId ? '已登录用户' : ''),
      avatarSrc: '',
      dataStatusText: '修改会自动保存到服务器',
    });
    const objectKey = this._avatarObjectKey(app.globalData.avatarUrl);
    if (objectKey) {
      try {
        const avatarSrc = await http.download('/files/content', {
          objectKey,
          contentType: 'image/jpeg',
        });
        this.setData({ avatarSrc });
      } catch (_) {}
    }
  },

  _avatarObjectKey(value) {
    const match = String(value || '').match(/[?&]objectKey=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  },

  onGoLogin()      { wx.navigateTo({ url: '/pages/login/index' }); },
  onGoProfile()    { wx.navigateTo({ url: '/pages/profile/index' }); },
  onGoReport()     { wx.navigateTo({ url: '/pages/report/index' }); },
  onGoIndicators() { wx.navigateTo({ url: '/pages/indicators/index' }); },
  onGoChat()       { wx.navigateTo({ url: '/pages/chat/index' }); },
  onGoPrivacy()    { wx.navigateTo({ url: '/pages/legal/index?type=privacy' }); },
  onGoTerms()      { wx.navigateTo({ url: '/pages/legal/index?type=terms' }); },

  onChooseAvatar() {
    const app = getApp();
    if (!app.isLoggedIn()) return;
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

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后本机不保留健康业务数据，再次登录会从服务器加载。',
      confirmText: '退出',
      confirmColor: '#E53935',
      success: async r => {
        if (r.confirm) {
          const app = getApp();
          const refreshToken = app.globalData.refreshToken;
          try {
            await http.post('/auth/logout', { refreshToken });
          } catch (e) {
            // 服务端不可用时仍允许退出本地账号。
          } finally {
            app.clearAuth();
            this._load();
            wx.showToast({ title: '已退出登录', icon: 'none' });
          }
        }
      }
    });
  },

  onFeedback() {
    wx.setClipboardData({ data: 'healthresetplan@outlook.com' });
    wx.showToast({ title: '邮箱已复制', icon: 'none' });
  },
});
