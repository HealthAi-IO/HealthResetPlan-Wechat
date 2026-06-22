const storage = require('../../utils/storage');
const sync = require('../../utils/sync');
const config = require('../../utils/config');

const CLOCK_TYPES = [
  { type: 'meal',     icon: '🍚', label: '饮食', hint: '例如"低盐便当 + 蒸鱼"', color: '#FB8C00' },
  { type: 'exercise', icon: '🏃', label: '运动', hint: '例如"快走 30 分钟"',     color: '#2BBE7A' },
  { type: 'medicine', icon: '💊', label: '用药', hint: '',                        color: '#E53935' },
  { type: 'weight',   icon: '⚖️', label: '称重', hint: '输入体重 kg',            color: '#1E88E5' },
  { type: 'water',    icon: '💧', label: '饮水', hint: '例如"200ml 温水"',        color: '#29B6F6' },
];
const CLOCK_LABELS = {
  meal: '饮食打卡',
  exercise: '运动打卡',
  medicine: '用药打卡',
  weight: '称重打卡',
  water: '饮水打卡',
};

Page({
  data: {
    clockTypes: CLOCK_TYPES,
    todayDone: 0, todayTotal: 0, todayPct: 0,
    records: [],
    reminders: [],
    remindersExpanded: false,
    reminderModeText: '优先使用小程序订阅消息提醒',
    // 记录备注弹窗
    modal: { show: false, type: '', icon: '', label: '', hint: '', note: '', isMedicine: false, medStatus: 'done' },
    // 称重弹窗
    weightModal: { show: false, value: '' },
    // 提醒弹窗
    reminderModal: { show: false, type: '', label: '', note: '', hour: 7, minute: 0, hourStr: '07', minStr: '00' },
  },

  onShow() { this._load(); },

  _load() {
    const todayRecs = storage.clock.today();
    const allRecs   = storage.clock.getAll();
    const reminders = storage.reminders.getAll();

    const done  = todayRecs.filter(r => r.status === 'done').length;
    const total = todayRecs.length;

    const displayRecs = (todayRecs.length ? todayRecs : allRecs).slice(0, 20).map(r => ({
      ...r,
      label: r.label || CLOCK_LABELS[r.type] || '打卡记录',
      timeLabel: _fmtTime(r.clockTime),
      isSkip: r.status === 'skip',
    }));

    const displayReminders = reminders.map(r => ({
      ...r,
      timeLabel: `${String(r.hour).padStart(2,'0')}:${String(r.minute).padStart(2,'0')}`,
      channelLabel: r.channel === 'wechat_subscribe' ? '订阅消息' : '本地提醒',
    }));

    this.setData({
      todayDone: done,
      todayTotal: total,
      todayPct: total > 0 ? Math.round(done / total * 100) : 0,
      records: displayRecs,
      reminders: displayReminders,
    });
  },

  // ── 快速打卡 ──────────────────────────────────────────────────
  onClockTap(e) {
    const { type, label, hint, icon } = e.currentTarget.dataset;
    if (type === 'weight') {
      this.setData({ 'weightModal.show': true, 'weightModal.value': '' });
      return;
    }
    if (type === 'medicine') {
      this.setData({
        modal: { show: true, type, icon, label, hint, note: '', isMedicine: true, medStatus: 'done' }
      });
      return;
    }
    this.setData({
      modal: { show: true, type, icon, label, hint, note: '', isMedicine: false, medStatus: 'done' }
    });
  },

  onModalNoteInput(e) { this.setData({ 'modal.note': e.detail.value }); },
  onMedStatusChange(e) { this.setData({ 'modal.medStatus': e.detail.value }); },
  onModalCancel()  { this.setData({ 'modal.show': false }); },
  onModalConfirm() {
    const { type, note, isMedicine, medStatus } = this.data.modal;
    const status = isMedicine ? medStatus : 'done';
    storage.clock.add({ type, status, note });
    this.setData({ 'modal.show': false });
    this._load();
    wx.showToast({ title: '已保存 ✓', icon: 'success', duration: 1200 });
  },

  // 称重弹窗
  onWeightInput(e)   { this.setData({ 'weightModal.value': e.detail.value }); },
  onWeightCancel()   { this.setData({ 'weightModal.show': false }); },
  onWeightConfirm() {
    const v = parseFloat(this.data.weightModal.value);
    if (!v || v < 20 || v > 300) {
      wx.showToast({ title: '请输入有效体重（20-300 kg）', icon: 'none' }); return;
    }
    storage.clock.add({ type: 'weight', status: 'done', note: `体重 ${v} kg` });
    const entry = storage.indicators.add({ type: 'weight', payload: { weightKg: v } });
    try { sync.enqueueIndicator(entry); } catch (e) {}
    this.setData({ 'weightModal.show': false });
    this._load();
    wx.showToast({ title: `称重 ${v} kg 已记录 ✓`, icon: 'success', duration: 1500 });
  },

  // ── 提醒弹窗 ──────────────────────────────────────────────────
  onAddReminder(e) {
    const { type, label } = e.currentTarget.dataset;
    this.setData({
      reminderModal: { show: true, type, label, note: '', hour: 7, minute: 0, hourStr: '07', minStr: '00' }
    });
  },

  onReminderNoteInput(e) { this.setData({ 'reminderModal.note': e.detail.value }); },

  onPickHour(e) {
    const h = parseInt(e.detail.value) || 7;
    this.setData({ 'reminderModal.hour': h, 'reminderModal.hourStr': String(h).padStart(2,'0') });
  },
  onPickMinute(e) {
    const m = parseInt(e.detail.value) || 0;
    this.setData({ 'reminderModal.minute': m, 'reminderModal.minStr': String(m).padStart(2,'0') });
  },

  onReminderCancel()  { this.setData({ 'reminderModal.show': false }); },
  async onReminderConfirm() {
    const { type, label, note, hour, minute } = this.data.reminderModal;
    const granted = await this._requestReminderSubscribe();
    if (!granted) {
      wx.showToast({ title: '你未同意订阅消息提醒', icon: 'none' });
      return;
    }
    storage.reminders.add({
      type,
      label: `${label}提醒`,
      note: note || `${label}提醒`,
      hour,
      minute,
      channel: 'wechat_subscribe',
      status: 'pending',
    });
    this.setData({ 'reminderModal.show': false });
    this._load();
    wx.showToast({ title: '订阅提醒已保存', icon: 'success' });
  },

  onDeleteReminder(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除提醒',
      content: '确定删除该提醒规则？',
      confirmText: '删除',
      confirmColor: '#E53935',
      success: r => {
        if (r.confirm) {
          storage.reminders.remove(id);
          this._load();
        }
      }
    });
  },

  onToggleReminders() {
    this.setData({ remindersExpanded: !this.data.remindersExpanded });
  },

  _requestReminderSubscribe() {
    const tmplIds = config.REMINDER_SUBSCRIBE_TEMPLATES || [];
    if (!tmplIds.length) return Promise.resolve(true);

    return new Promise(resolve => {
      wx.requestSubscribeMessage({
        tmplIds,
        success: res => {
          const granted = tmplIds.some(id => res[id] === 'accept');
          resolve(granted);
        },
        fail: () => resolve(false),
      });
    });
  },
});

function _fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
