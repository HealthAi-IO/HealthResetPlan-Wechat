const http = require('../../utils/http');
const sync = require('../../utils/sync');

const FEATURE_LABELS = {
  cloud_sync: '端到端加密云同步',
  ai_chat:    'AI 健康助理（不限次）',
  report_ocr: '检查报告 OCR 识别',
  family:     '家庭账户共享',
  priority:   '优先客服支持',
  export:     '数据导出'
};

const PLAN_DESC = {
  monthly: { period: '月', recommend: false },
  yearly:  { period: '年', recommend: true   }
};

Page({
  data: {
    plans: [],
    status: { active: false, features: [], expiresLabel: '' },
    selectedPlan: '',
    selectedPlanPrice: '',
    redeemCode: '',
    loading: true,
    busy: false
  },

  onShow() { this._load(); },

  async _load() {
    const app = getApp();
    if (!app.isLoggedIn()) {
      wx.showModal({
        title: '请先登录',
        content: '查看会员需要先登录账号',
        confirmText: '去登录',
        success: r => {
          if (r.confirm) wx.redirectTo({ url: '/pages/login/index' });
          else wx.navigateBack();
        }
      });
      return;
    }

    this.setData({ loading: true });
    try {
      const [plansRaw, statusRaw] = await Promise.all([
        http.get('/membership/plans').catch(() => []),
        http.get('/membership/status').catch(() => ({ active: false }))
      ]);

      const plans = (plansRaw || []).map(p => {
        const features = this._parseFeatures(p.features);
        const meta = PLAN_DESC[p.code] || { period: '次', recommend: false };
        return {
          code:         p.code,
          name:         p.name,
          priceYuan:    (p.priceFen / 100).toFixed(2).replace(/\.00$/, ''),
          priceFen:     p.priceFen,
          periodLabel:  meta.period,
          recommend:    meta.recommend,
          featureList:  features.map(f => FEATURE_LABELS[f] || f)
        };
      });

      // 默认选中"推荐"
      const def = plans.find(p => p.recommend) || plans[0];
      const status = {
        ...statusRaw,
        features: (statusRaw.features || []).map(f => FEATURE_LABELS[f] || f),
        expiresLabel: statusRaw.expiresAt ? this._fmtDate(statusRaw.expiresAt) : ''
      };
      getApp().setAccountInfo({ hasCloudSync: !!statusRaw.active });

      this.setData({
        plans,
        status,
        selectedPlan: def ? def.code : '',
        selectedPlanPrice: def ? '¥' + def.priceYuan : '',
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  _parseFeatures(featuresJson) {
    try { return JSON.parse(featuresJson || '[]'); } catch (e) { return []; }
  },

  _fmtDate(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  onPickPlan(e) {
    const code = e.currentTarget.dataset.code;
    const p = this.data.plans.find(x => x.code === code);
    if (p) this.setData({ selectedPlan: code, selectedPlanPrice: '¥' + p.priceYuan });
  },

  onRedeemInput(e) { this.setData({ redeemCode: e.detail.value }); },

  async onRedeem() {
    const code = (this.data.redeemCode || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入兑换码', icon: 'none' });
      return;
    }
    this.setData({ busy: true });
    try {
      await http.post('/membership/redeem', { code });
      await sync.pushLocalIndicatorsIfReady();
      wx.showToast({ title: '兑换成功 🎉', icon: 'success' });
      this.setData({ redeemCode: '' });
      this._load();
    } catch (err) {
      const msg = (err && err.message) || '兑换失败';
      wx.showToast({ title: msg, icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  async onPay() {
    if (!this.data.selectedPlan || this.data.busy) return;
    this.setData({ busy: true });

    try {
      // 1. 创建订单
      const order = await http.post('/membership/orders', {
        planCode: this.data.selectedPlan,
        channel:  'wechat'
      });

      // 2. 检查是否拿到 wx.requestPayment 所需的预支付参数
      const cred = order.payCredential;
      if (!cred || !cred.timeStamp || !cred.paySign) {
        wx.showModal({
          title: '订单已创建',
          content: `订单号：${order.orderNo}\n金额：¥${(order.amountFen/100).toFixed(2)}\n\n后端微信支付网关未接入，无法唤起支付。请在后台手动激活，或使用兑换码。`,
          showCancel: false
        });
        return;
      }

      // 3. 唤起微信支付
      await new Promise((resolve, reject) => {
        wx.requestPayment({
          timeStamp: String(cred.timeStamp),
          nonceStr:  cred.nonceStr,
          package:   cred.package,
          signType:  cred.signType || 'RSA',
          paySign:   cred.paySign,
          success: resolve,
          fail:    reject
        });
      });

      wx.showToast({ title: '支付成功 🎉', icon: 'success' });
      // 等回调入账（约 1-3s）后再刷新
      setTimeout(() => this._load(), 2000);

    } catch (err) {
      if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) {
        wx.showToast({ title: '已取消支付', icon: 'none' });
      } else {
        const msg = (err && (err.message || err.errMsg)) || '支付失败';
        wx.showToast({ title: msg, icon: 'none' });
      }
    } finally {
      this.setData({ busy: false });
    }
  }
});
