const app = getApp();

Page({
  data: {
    hasCloudSync: false,
    modules: [
      { key: 'profile', title: '健康档案', desc: '身高、体重、年龄、病史' },
      { key: 'report', title: '检查报告', desc: 'OCR + 大模型自动识别' },
      { key: 'plan', title: 'AI 个性化计划', desc: '饮食 + 运动 + 用药' },
      { key: 'clock', title: '打卡溯源', desc: '饮食 / 运动 / 用药 / 称重' },
      { key: 'stats', title: '数据趋势', desc: '体重、血压、血脂趋势' }
    ]
  },

  onShow() {
    this.setData({ hasCloudSync: !!app.globalData.hasCloudSync });
  },

  onModuleTap(e) {
    const key = e.currentTarget.dataset.key;
    wx.switchTab({ url: `/pages/${key}/index` }).catch(() => {
      wx.navigateTo({ url: `/pages/${key}/index` });
    });
  },

  onOpenSync() {
    wx.navigateTo({ url: '/pages/settings/index' });
  }
});
