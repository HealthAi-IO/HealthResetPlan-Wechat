const http = require('../../utils/request');
const storage = require('../../utils/storage');

const QUICK_QUESTIONS = [
  '我今天血压偏高，吃什么有帮助？',
  '糖前期适合做什么运动？',
  '减肥期间如何安排晚餐？',
  '怎么改善睡眠质量？'
];

Page({
  data: {
    messages: [],         // { id, role:'user'|'ai', content, streaming }
    input: '',
    sending: false,
    anchor: '',
    remaining: '--',
    limit: '--',
    quickQuestions: QUICK_QUESTIONS
  },

  onShow() {
    this._loadUsage();
  },

  async _loadUsage() {
    const app = getApp();
    if (!app.isLoggedIn()) {
      this.setData({ remaining: '请先登录', limit: '--' });
      return;
    }
    try {
      const r = await http.get('/ai/chat/daily-usage');
      this.setData({ remaining: r.remaining, limit: r.limit });
    } catch (e) { /* 静默 */ }
  },

  onInputChange(e) { this.setData({ input: e.detail.value }); },

  onQuickTap(e) {
    this.setData({ input: e.currentTarget.dataset.q }, () => this.onSend());
  },

  async onSend() {
    const text = (this.data.input || '').trim();
    if (!text || this.data.sending) return;

    const app = getApp();
    if (!app.isLoggedIn()) {
      wx.showModal({
        title: '请先登录',
        content: '使用 AI 助理需要登录账号',
        confirmText: '去登录',
        success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/login/index' }); }
      });
      return;
    }

    const userMsg = { id: Date.now() + '-u', role: 'user', content: text };
    const aiId = Date.now() + '-a';
    const aiMsg = { id: aiId, role: 'ai', content: '思考中…', streaming: true };

    this.setData({
      messages: [...this.data.messages, userMsg, aiMsg],
      input: '',
      sending: true,
      anchor: aiId
    });

    try {
      const profile = storage.profile.get() || {};
      const recent = storage.indicators.getAll().slice(0, 5);
      const r = await http.post('/ai/chat', {
        message: text,
        context: { profile, recent }
      });
      const reply = (r && r.reply) || (r && r.content) || '抱歉，未能获取回答';
      this._updateAiMsg(aiId, reply, false);
      this._loadUsage();
    } catch (err) {
      const msg = (err && err.message) || '网络异常，请稍后重试';
      this._updateAiMsg(aiId, '⚠️ ' + msg, false);
    } finally {
      this.setData({ sending: false });
    }
  },

  _updateAiMsg(id, content, streaming) {
    const messages = this.data.messages.map(m =>
      m.id === id ? { ...m, content, streaming } : m
    );
    this.setData({ messages, anchor: id });
  }
});
