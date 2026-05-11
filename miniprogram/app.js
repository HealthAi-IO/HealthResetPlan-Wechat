App({
  globalData: {
    userInfo: null,
    hasCloudSync: false,
    baseUrl: 'https://api.healthresetplan.io/api/v1'
  },

  onLaunch() {
    wx.getStorage({
      key: 'hrp_has_cloud_sync',
      success: res => {
        this.globalData.hasCloudSync = !!res.data;
      },
      fail: () => {}
    });
  }
});
