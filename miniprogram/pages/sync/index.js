const sync = require('../../utils/sync');

Page({
  data: {
    state: {
      loggedIn: false,
      hasKey: false,
      queueLen: 0,
      lastPushAt: 0,
      deviceId: '',
      keyFingerprint: '',
    },
    mnemonic: '',
    generatedMnemonic: '',
    generatedWords: [],
    backupConfirmed: false,
    busy: false,
    logs: [],
    lastPushLabel: '从未',
  },

  onShow() {
    this._refresh();
  },

  onMnemonicInput(e) {
    this.setData({ mnemonic: e.detail.value });
  },

  onBackupConfirmChange(e) {
    this.setData({ backupConfirmed: e.detail.value.length > 0 });
  },

  async onGenerateMasterKey() {
    if (this.data.busy) return;

    wx.showModal({
      title: '生成新的主密钥？',
      content: '如果 APP 已经上传过云端数据，请不要生成新密钥，请改用 APP 备份的助记词恢复。新密钥只能解密之后用这把密钥上传的数据。',
      confirmText: '继续生成',
      success: async res => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        try {
          const result = await sync.generateMasterKey();
          this.setData({
            generatedMnemonic: result.mnemonic,
            generatedWords: result.mnemonic.split(' '),
            backupConfirmed: false,
          });
          this._log('已生成新的 APP 兼容主密钥，请先离线备份助记词');
          this._refresh();
          wx.showToast({ title: '主密钥已生成', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: e.message || '生成失败', icon: 'none' });
        } finally {
          this.setData({ busy: false });
        }
      },
    });
  },

  onCopyGeneratedMnemonic() {
    if (!this.data.generatedMnemonic) return;
    wx.setClipboardData({
      data: this.data.generatedMnemonic,
      success: () => wx.showToast({ title: '助记词已复制', icon: 'none' }),
    });
  },

  async onRestoreMnemonic() {
    const mnemonic = _normalizeMnemonic(this.data.mnemonic);
    if (!mnemonic) {
      wx.showToast({ title: '请输入 APP 备份的主密钥助记词', icon: 'none' });
      return;
    }

    const words = mnemonic.split(' ');
    if (words.length !== 24) {
      wx.showToast({ title: `当前 ${words.length} 个词，应为 24 个词`, icon: 'none' });
      return;
    }

    try {
      this.setData({ busy: true });
      sync.setMasterKeyFromMnemonic(mnemonic);
      this._log('已从助记词恢复 APP 同款主密钥，开始全量拉取云端');
      this.setData({
        mnemonic: '',
        generatedMnemonic: '',
        generatedWords: [],
        backupConfirmed: true,
      });
      const result = await sync.pullNow({ resetCursor: true, replaceLocal: true });
      if (result.failed) {
        this._log(`云端拉取完成，但 ${result.failed} 条无法解密，请确认助记词来自 APP 上传数据时的同一把主密钥`);
        wx.showToast({ title: '部分数据无法解密', icon: 'none' });
      } else {
        this._log(`云端拉取完成：合并 ${result.merged}/${result.total} 条`);
        wx.showToast({
          title: result.total ? `已恢复 ${result.merged} 条` : '云端暂无可恢复数据',
          icon: result.total ? 'success' : 'none',
        });
      }
      this._refresh();
    } catch (e) {
      wx.showToast({ title: e.message || '助记词不正确', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  onClearKey() {
    wx.showModal({
      title: '清除主密钥',
      content: '清除后将无法解密云端已上传的数据。确定吗？',
      confirmText: '清除',
      confirmColor: '#E53935',
      success: r => {
        if (!r.confirm) return;
        sync.clearMasterKey();
        this.setData({ generatedMnemonic: '', generatedWords: [], backupConfirmed: false });
        this._log('主密钥已清除');
        this._refresh();
      },
    });
  },

  async onPush() {
    if (this.data.busy) return;
    if (this.data.generatedMnemonic && !this.data.backupConfirmed) {
      wx.showToast({ title: '请先确认已离线备份助记词', icon: 'none' });
      return;
    }

    this.setData({ busy: true });
    try {
      const r = await sync.pushNow();
      if (r.skipped) {
        this._log('跳过推送：' + r.reason);
      } else if (r.ok) {
        this._log(`推送成功：accepted ${r.accepted}`);
        wx.showToast({ title: `已上传 ${r.accepted} 条`, icon: 'success' });
      } else {
        const msg = (r.error && r.error.message) || '推送失败';
        this._log('失败：' + msg);
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
        this._log('跳过拉取：未登录或未恢复主密钥');
      } else {
        const parts = [`合并 ${r.merged}/${r.total} 条`];
        if (r.skipped) parts.push(`跳过 ${r.skipped} 条`);
        if (r.failed) parts.push(`失败 ${r.failed} 条`);
        this._log(`拉取完成：${parts.join('，')}`);
        const title = r.failed
          ? '密钥不匹配，部分数据无法解密'
          : (r.merged === 0 && r.total > 0 ? '没有可用这把密钥解密的新数据' : `合并 ${r.merged} 条`);
        wx.showToast({
          title,
          icon: (r.failed || (r.merged === 0 && r.total > 0)) ? 'none' : 'success',
        });
      }
    } catch (e) {
      const msg = e.message || '拉取失败';
      this._log('失败：' + msg);
      wx.showToast({ title: msg, icon: 'none' });
    } finally {
      this.setData({ busy: false });
      this._refresh();
    }
  },

  onGoMembership() {
    wx.navigateTo({ url: '/pages/membership/index' });
  },

  _refresh() {
    const s = sync.status();
    this.setData({
      state: s,
      lastPushLabel: s.lastPushAt ? this._fmt(s.lastPushAt) : '从未',
    });
  },

  _log(msg) {
    const logs = [{ t: this._fmtTime(), msg }, ...this.data.logs].slice(0, 30);
    this.setData({ logs });
  },

  _fmt(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  _fmtTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  },
});

function _normalizeMnemonic(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
