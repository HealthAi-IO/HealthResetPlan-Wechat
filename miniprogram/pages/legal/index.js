const CONTENT = {
  privacy: {
    title: '隐私政策与数据安全说明',
    lead: '登录后健康数据与账号绑定，并自动保存到服务器。',
    sections: [
      { title: '我们处理的数据', body: '健康档案、健康指标、计划与打卡数据，以及您主动上传的报告图片。' },
      { title: '加密与存储', body: '敏感业务数据由服务器使用 AES-256-GCM 加密后写入数据库，报告图片等文件加密后存入私有对象存储。' },
      { title: '您的控制权', body: '您可以申请注销账号；注销后账号业务数据及关联文件会被删除且不可恢复。' },
      { title: '使用限制', body: 'AI 内容仅作健康管理参考，不替代医生诊断、处方或急救建议。未成年人应在监护人陪同下使用。' }
    ]
  },
  terms: {
    title: '用户协议',
    lead: '本产品是健康管理辅助工具，不提供医学诊断，不替代医生治疗建议。',
    sections: [
      { title: '服务范围', body: '我们提供健康档案、AI 计划、提醒打卡、报告识别和数据统计等功能。' },
      { title: '用户责任', body: '请尽量准确录入健康信息；如有疾病诊断、特殊用药或运动禁忌，请优先遵循医生意见。' },
      { title: '账号安全', body: '请妥善保管账号、验证码和登录设备，不要向他人泄露登录凭据。' },
      { title: '责任限制', body: 'AI 内容受输入和模型能力影响，仅供日常健康管理参考，不应作为诊断、处方或急救依据。' }
    ]
  }
};

Page({
  data: { title: '', lead: '', sections: [] },

  onLoad(options) {
    const content = CONTENT[options.type] || CONTENT.privacy;
    this.setData(content);
    wx.setNavigationBarTitle({ title: content.title });
  }
});
