const sync = require('../../utils/sync');

Page({
  data: {
    state: {
      loggedIn: false,
      hasKey: false,
      queueLen: 0,
      lastPushAt: 0,
    },
    statusLabel: '未登录',
    statusTone: 'idle',
    mnemonic: '',
    generatedMnemonic: '',
    generatedWords: [],
    backupConfirmed: false,
    busy: false,
    lastPushLabel: '从未',
    resultMessage: '',
    resultType: '',
    guideExpanded: false,
    tipsExpanded: false,
    restoreFocus: false,
  },

  onShow() {
    this._refresh();
  },

  onMnemonicInput(e) {
    this.setData({ mnemonic: e.detail.value, restoreFocus: false });
  },

  onBackupConfirmChange(e) {
    this.setData({ backupConfirmed: e.detail.value.length > 0 });
  },

  onToggleGuide() {
    this.setData({ guideExpanded: !this.data.guideExpanded });
  },

  onToggleTips() {
    this.setData({ tipsExpanded: !this.data.tipsExpanded });
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
            resultMessage: '新的主密钥已经生成。请先离线备份助记词，再开始同步。',
            resultType: 'info',
          });
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
      this.setData({
        mnemonic: '',
        generatedMnemonic: '',
        generatedWords: [],
        backupConfirmed: true,
        restoreFocus: false,
      });
      const result = await sync.pullNow({ resetCursor: true, replaceLocal: true });
      if (result.failed) {
        this.setData({
          resultMessage: `已恢复主密钥，但有 ${result.failed} 条云端数据无法解密，请确认助记词来自手机端最初同步时备份的那一组。`,
          resultType: 'warn',
        });
        wx.showToast({ title: '部分数据无法解密', icon: 'none' });
      } else {
        this.setData({
          resultMessage: result.total
            ? `已恢复并合并 ${result.merged} 条云端数据，你现在看到的是和手机端同一份加密数据。`
            : '主密钥已恢复成功，但云端暂时没有可恢复的数据。',
          resultType: result.total ? 'success' : 'info',
        });
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
        this.setData({
          generatedMnemonic: '',
          generatedWords: [],
          backupConfirmed: false,
          mnemonic: '',
          restoreFocus: true,
          resultMessage: '当前主密钥已清除。现在可以在“恢复手机端助记词”里输入手机 APP 最新的 24 个助记词。',
          resultType: 'info',
        });
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
      if (r.ok) {
        this.setData({
          resultMessage: `本地数据已上传 ${r.accepted} 条。手机端登录同一账号并同步后即可看到这些更新。`,
          resultType: 'success',
        });
        wx.showToast({ title: `已上传 ${r.accepted} 条`, icon: 'success' });
      } else if (r.skipped) {
        this.setData({
          resultMessage: r.reason || '当前还不能上传，请先登录并恢复主密钥。',
          resultType: 'warn',
        });
        wx.showToast({ title: r.reason || '暂时无法同步', icon: 'none' });
      } else {
        const msg = (r.error && r.error.message) || '推送失败';
        this.setData({
          resultMessage: msg,
          resultType: 'warn',
        });
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
        this.setData({
          resultMessage: '请先登录同一账号，并恢复手机端备份过的助记词。',
          resultType: 'warn',
        });
        wx.showToast({ title: '请先登录并恢复主密钥', icon: 'none' });
      } else {
        const title = r.failed
          ? '密钥不匹配，部分数据无法解密'
          : (r.merged === 0 && r.total > 0 ? '没有可用这把密钥解密的新数据' : `合并 ${r.merged} 条`);
        this.setData({
          resultMessage: r.failed
            ? '主密钥已恢复，但云端存在不是这把密钥加密的数据，请回到手机端确认助记词是否一致。'
            : (r.merged === 0 && r.total > 0
              ? '云端有新记录，但当前这组助记词无法解密它们。'
              : (r.total === 0
                ? '云端暂无新的同步数据。'
                : `已从云端合并 ${r.merged} 条数据，小程序现在会和手机端更接近。`)),
          resultType: r.failed ? 'warn' : (r.total === 0 ? 'info' : 'success'),
        });
        wx.showToast({
          title,
          icon: (r.failed || (r.merged === 0 && r.total > 0)) ? 'none' : 'success',
        });
      }
    } catch (e) {
      const msg = e.message || '拉取失败';
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
    const statusLabel = !s.loggedIn ? '未登录' : (!s.hasKey ? '待恢复密钥' : '可同步');
    const statusTone = !s.loggedIn ? 'idle' : (!s.hasKey ? 'warn' : 'ok');
    this.setData({
      state: s,
      statusLabel,
      statusTone,
      lastPushLabel: s.lastPushAt ? this._fmt(s.lastPushAt) : '从未',
    });
  },

  _fmt(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
});

function _normalizeMnemonic(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
