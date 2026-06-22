const CONTENT = {
  privacy: {
    title: '隐私政策与端到端加密说明',
    lead: '健康数据优先保存在本地；选择云同步时，由客户端加密后上传。',
    sections: [
      { title: '我们处理的数据', body: '健康档案、健康指标、计划与打卡数据，以及您主动上传的报告图片。' },
      { title: '加密与同步', body: '开启云同步时，客户端使用 AES-256-GCM 加密敏感数据。服务端负责账号、同步和密文存储，不读取健康明文。' },
      { title: '您的控制权', body: '您可以仅在本地使用、清除本地数据或申请注销账号。主密钥丢失可能导致云端密文无法恢复，请妥善备份。' },
      { title: '使用限制', body: 'AI 内容仅作健康管理参考，不替代医生诊断、处方或急救建议。未成年人应在监护人陪同下使用。' }
    ]
  },
  terms: {
    title: '用户协议',
    lead: '本产品是健康管理辅助工具，不提供医学诊断，不替代医生治疗建议。',
    sections: [
      { title: '服务范围', body: '我们提供健康档案、AI 计划、提醒打卡、报告识别和数据统计等功能。' },
      { title: '用户责任', body: '请尽量准确录入健康信息；如有疾病诊断、特殊用药或运动禁忌，请优先遵循医生意见。' },
      { title: '账号与密钥', body: '请妥善保管账号、设备和加密密钥备份信息。' },
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
