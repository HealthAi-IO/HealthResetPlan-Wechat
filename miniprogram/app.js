const config = require('./utils/config');

App({
  globalData: {
    userInfo: null,
    userId: null,
    accessToken: null,
    refreshToken: null,
    hasCloudSync: false,
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
      this.globalData.hasCloudSync = !!wx.getStorageSync('hrp_has_cloud_sync');
      this.globalData.avatarUrl    = wx.getStorageSync('hrp_avatar_url')    || '';
    } catch (e) {}
  },

  setAuth({ userId, accessToken, refreshToken }) {
    this.globalData.userId       = userId;
    this.globalData.accessToken  = accessToken;
    this.globalData.refreshToken = refreshToken;
    try {
      wx.setStorageSync('hrp_user_id',       userId);
      wx.setStorageSync('hrp_access_token',  accessToken);
      wx.setStorageSync('hrp_refresh_token', refreshToken);
    } catch (e) {}
  },

  setAccountInfo({ nickname, avatarUrl, hasCloudSync }) {
    if (typeof hasCloudSync === 'boolean') this.globalData.hasCloudSync = hasCloudSync;
    if (avatarUrl !== undefined) this.globalData.avatarUrl = avatarUrl || '';
    try {
      if (typeof hasCloudSync === 'boolean') wx.setStorageSync('hrp_has_cloud_sync', hasCloudSync);
      if (avatarUrl !== undefined) wx.setStorageSync('hrp_avatar_url', avatarUrl || '');
      if (nickname) {
        const prof = wx.getStorageSync('hrp_profile') || {};
        wx.setStorageSync('hrp_profile', { ...prof, nickname });
      }
    } catch (e) {}
  },

  clearAuth() {
    this.globalData.userId       = null;
    this.globalData.accessToken  = null;
    this.globalData.refreshToken = null;
    this.globalData.hasCloudSync = false;
    try {
      wx.removeStorageSync('hrp_user_id');
      wx.removeStorageSync('hrp_access_token');
      wx.removeStorageSync('hrp_refresh_token');
      wx.removeStorageSync('hrp_has_cloud_sync');
      wx.removeStorageSync('hrp_avatar_url');
    } catch (e) {}
  },

  isLoggedIn() {
    return !!this.globalData.accessToken;
  }
});
