const http = require('../../utils/http');
const storage = require('../../utils/storage');
const config = require('../../utils/config');
const sync = require('../../utils/sync');

Page({
  data: {
    isLoggedIn: false,
    nickname: '', avatarSrc: '',
    version: `v${config.APP_VERSION}`,
    syncStatusText: '先登录后可使用',
  },

  onShow() { this._load(); },

  _load() {
    const app = getApp();
    const prof = storage.profile.get() || {};
    this.setData({
      isLoggedIn: app.isLoggedIn(),
      nickname:   prof.nickname || (app.globalData.userId ? '已登录用户' : ''),
      avatarSrc:  this._avatarSrc(app),
      syncStatusText: this._syncStatusText(),
    });
  },

  _syncStatusText() {
    const s = sync.status();
    if (!s.loggedIn) return '先登录后可使用';
    if (!s.hasKey) return '待恢复手机端助记词';
    return `已就绪 · 待同步 ${s.queueLen} 条`;
  },

  _avatarSrc(app) {
    if (!app.globalData.userId || !app.globalData.avatarUrl) return '';
    return `${app.globalData.baseUrl}/files/avatar/${app.globalData.userId}?v=${encodeURIComponent(app.globalData.avatarUrl)}`;
  },

  onGoLogin()      { wx.navigateTo({ url: '/pages/login/index' }); },
  onGoProfile()    { wx.navigateTo({ url: '/pages/profile/index' }); },
  onGoReport()     { wx.navigateTo({ url: '/pages/report/index' }); },
  onGoIndicators() { wx.navigateTo({ url: '/pages/indicators/index' }); },
  onGoChat()       { wx.navigateTo({ url: '/pages/chat/index' }); },
  onGoSync()       { wx.navigateTo({ url: '/pages/sync/index' }); },
  onGoMembership() { wx.navigateTo({ url: '/pages/membership/index' }); },
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
      content: '确定退出账号？本地数据不会删除。',
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

  onClearData() {
    wx.showModal({
      title: '清除本地数据',
      content: '将清除所有本地指标、打卡记录和计划，不可恢复！',
      confirmText: '确认清除',
      confirmColor: '#E53935',
      success: r => {
        if (r.confirm) {
          storage.reports.getAll().forEach(report => {
            if (report.imagePath) wx.removeSavedFile({ filePath: report.imagePath });
          });
          const keys = [
            'hrp_indicators', 'hrp_clock_records', 'hrp_plans', 'hrp_reminders',
            'hrp_profile', 'hrp_reports', 'hrp_sync_queue', 'hrp_sync_cursor',
            'hrp_last_push_at', 'hrp_last_pull_at'
          ];
          keys.forEach(k => { try { wx.removeStorageSync(k); } catch (e) {} });
          wx.showToast({ title: '本地数据已清除', icon: 'success' });
        }
      }
    });
  },

  onFeedback() {
    wx.setClipboardData({ data: 'healthresetplan@outlook.com' });
    wx.showToast({ title: '邮箱已复制', icon: 'none' });
  },
});
