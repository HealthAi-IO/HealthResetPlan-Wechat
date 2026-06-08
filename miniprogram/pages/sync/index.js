const sync = require('../../utils/sync');

Page({
  data: {
    state: { loggedIn: false, hasKey: false, queueLen: 0, lastPushAt: 0, deviceId: '' },
    password: '',
    busy: false,
    logs: [],
    lastPushLabel: '从未'
  },

  onShow() { this._refresh(); },

  _refresh() {
    const s = sync.status();
    this.setData({
      state: s,
      lastPushLabel: s.lastPushAt ? this._fmt(s.lastPushAt) : '从未'
    });
  },

  onPwdInput(e) { this.setData({ password: e.detail.value }); },

  onSetKey() {
    const pwd = (this.data.password || '').trim();
    if (pwd.length < 8) {
      wx.showToast({ title: '密码至少 8 位', icon: 'none' });
      return;
    }
    try {
      sync.setMasterKeyByPassword(pwd);
      this._log('已派生并保存主密钥');
      this.setData({ password: '' });
      this._refresh();
      wx.showToast({ title: '已启用云同步', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '失败', icon: 'none' });
    }
  },

  onClearKey() {
    wx.showModal({
      title: '清除主密钥',
      content: '清除后将无法解密云端已上传的数据。确定吗？',
      confirmText: '清除',
      confirmColor: '#E53935',
      success: r => {
        if (r.confirm) {
          sync.clearMasterKey();
          this._log('主密钥已清除');
          this._refresh();
        }
      }
    });
  },

  async onPush() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const r = await sync.pushNow();
      if (r.skipped) {
        this._log('跳过推送：' + r.reason);
      } else if (r.ok) {
        this._log(`推送成功 · accepted ${r.accepted}`);
        wx.showToast({ title: `已上传 ${r.accepted} 条`, icon: 'success' });
      } else {
        const msg = (r.error && r.error.message) || '推送失败';
        this._log('❌ ' + msg);
        wx.showToast({ title: msg, icon: 'none' });
      }
    } finally {
      this.setData({ busy: false });
      this._refresh();
    }
  },

  async onPull() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const r = await sync.pullNow();
      if (r.skipped) {
        this._log('跳过拉取（未登录或未设置主密钥）');
      } else {
        this._log(`拉取完成 · 合并 ${r.merged}/${r.total} 条`);
        wx.showToast({ title: `合并 ${r.merged} 条`, icon: 'success' });
      }
    } catch (e) {
      this._log('❌ ' + (e.message || '拉取失败'));
      wx.showToast({ title: e.message || '拉取失败', icon: 'none' });
    } finally {
      this.setData({ busy: false });
      this._refresh();
    }
  },

  onGoMembership() { wx.navigateTo({ url: '/pages/membership/index' }); },

  _log(msg) {
    const logs = [{ t: this._fmtTime(), msg }, ...this.data.logs].slice(0, 30);
    this.setData({ logs });
  },

  _fmt(ms) {
    const d = new Date(ms);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },
  _fmtTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }
});
