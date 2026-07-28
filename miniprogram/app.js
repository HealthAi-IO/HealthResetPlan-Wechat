const config = require('./utils/config');
const storage = require('./utils/storage');

App({
  globalData: {
    userInfo: null,
    userId: null,
    accessToken: null,
    refreshToken: null,
    avatarUrl: '',
    baseUrl: config.getApiBaseUrl(),
    envVersion: config.getEnvVersion(),
    appVersion: config.APP_VERSION
  },

  onLaunch() {
    try {
      this.globalData.baseUrl = config.getApiBaseUrl();
      this.globalData.envVersion = config.getEnvVersion();
      this.globalData.accessToken  = wx.getStorageSync('hrp_access_token')  || null;
      this.globalData.refreshToken = wx.getStorageSync('hrp_refresh_token') || null;
      this.globalData.userId       = wx.getStorageSync('hrp_user_id')       || null;
      storage.activateScope(this.globalData.userId);
      this.globalData.avatarUrl    = wx.getStorageSync('hrp_avatar_url')    || '';
      if (this.globalData.accessToken) {
        storage.bindOnline().catch(() => this.clearAuth());
      } else {
        setTimeout(() => wx.reLaunch({ url: '/pages/login/index' }), 0);
      }
    } catch (e) {}
  },

  setAuth({ userId, accessToken, refreshToken }) {
    storage.activateScope(userId);
    this.globalData.userId       = userId;
    this.globalData.accessToken  = accessToken;
    this.globalData.refreshToken = refreshToken;
    try {
      wx.setStorageSync('hrp_user_id',       userId);
      wx.setStorageSync('hrp_access_token',  accessToken);
      wx.setStorageSync('hrp_refresh_token', refreshToken);
    } catch (e) {}
  },

  setAccountInfo({ nickname, avatarUrl }) {
    if (avatarUrl !== undefined) this.globalData.avatarUrl = avatarUrl || '';
    try {
      if (avatarUrl !== undefined) wx.setStorageSync('hrp_avatar_url', avatarUrl || '');
      if (nickname) {
        const prof = storage.profile.get() || {};
        storage.profile.save({ ...prof, nickname });
      }
    } catch (e) {}
  },

  clearAuth() {
    this.globalData.userId       = null;
    this.globalData.accessToken  = null;
    this.globalData.refreshToken = null;
    try {
      wx.removeStorageSync('hrp_user_id');
      wx.removeStorageSync('hrp_access_token');
      wx.removeStorageSync('hrp_refresh_token');
      wx.removeStorageSync('hrp_avatar_url');
    } catch (e) {}
    storage.unbindOnline();
  },

  isLoggedIn() {
    return !!this.globalData.accessToken;
  }
});
