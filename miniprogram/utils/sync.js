/**
 * 端到端加密同步：客户端加密 → POST /sync/push；GET /sync/pull → 解密。
 *
 * 后端约束（与 BackendSyncService 对齐）：
 *   - 当前仅接受 table = "health_indicator"
 *   - meta 需含 type / measured_at / source（明文）
 *   - 调用方需有云同步会员权益，否则 40301
 */

const http    = require('./request');
const crypto  = require('./crypto');
const storage = require('./storage');

const K = {
  MASTER_KEY:   'hrp_master_key_hex', // 主密钥（hex 字符串，仅本地）
  SYNC_QUEUE:   'hrp_sync_queue',     // 待推送队列
  SYNC_CURSOR:  'hrp_sync_cursor',    // 上次 pull 的 serverTime
  DEVICE_ID:    'hrp_device_id',
  LAST_PUSH_AT: 'hrp_last_push_at'
};

// ───────────────── 主密钥管理 ─────────────────
function setMasterKeyByPassword(password) {
  const app = getApp();
  const uid = app.globalData.userId;
  if (!uid) throw new Error('未登录，无法派生主密钥');
  const key = crypto.deriveMasterKey(password, uid);
  wx.setStorageSync(K.MASTER_KEY, crypto._bytesToHex(key));
}

function getMasterKey() {
  const hex = wx.getStorageSync(K.MASTER_KEY);
  return hex ? crypto._hexToBytes(hex) : null;
}

function hasMasterKey() {
  return !!wx.getStorageSync(K.MASTER_KEY);
}

function clearMasterKey() {
  wx.removeStorageSync(K.MASTER_KEY);
  wx.removeStorageSync(K.SYNC_QUEUE);
  wx.removeStorageSync(K.SYNC_CURSOR);
}

// ───────────────── 设备 ID ─────────────────
function _deviceId() {
  let id = wx.getStorageSync(K.DEVICE_ID);
  if (!id) {
    id = 'wxmp-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    wx.setStorageSync(K.DEVICE_ID, id);
  }
  return id;
}

// ───────────────── 入队 ─────────────────
/**
 * 把一条 indicator 推入同步队列。
 * @param {object} entry { id, type, payload, measuredAt }
 */
function enqueueIndicator(entry) {
  const queue = wx.getStorageSync(K.SYNC_QUEUE) || [];
  queue.push({
    table: 'health_indicator',
    clientId: String(entry.id),
    version: Date.now(),
    clientUpdatedAt: Date.now(),
    plain: entry.payload,
    meta: {
      type: entry.type,
      measured_at: new Date(entry.measuredAt).getTime(),
      source: 'wxmp'
    }
  });
  wx.setStorageSync(K.SYNC_QUEUE, queue);
}

function enqueueAllIndicators() {
  const existing = wx.getStorageSync(K.SYNC_QUEUE) || [];
  const queuedIds = new Set(existing.map(q => String(q.clientId)));
  const queue = existing.slice();
  storage.indicators.getAll().forEach(entry => {
    const id = String(entry.id);
    if (queuedIds.has(id)) return;
    queue.push({
      table: 'health_indicator',
      clientId: id,
      version: Date.now(),
      clientUpdatedAt: Date.now(),
      plain: entry.payload || {},
      meta: {
        type: entry.type,
        measured_at: new Date(entry.measuredAt).getTime(),
        source: entry.source || 'wxmp'
      }
    });
  });
  wx.setStorageSync(K.SYNC_QUEUE, queue);
  return queue.length - existing.length;
}

async function pushLocalIndicatorsIfReady() {
  const queued = enqueueAllIndicators();
  if (!_canSync()) return { skipped: true, queued, reason: '未登录或未设置主密钥' };
  const pushed = await pushNow();
  return { queued, pushed };
}

// ───────────────── 推送 ─────────────────
async function pushNow() {
  if (!_canSync()) return { skipped: true, reason: '未登录或未设置主密钥' };
  const queue = wx.getStorageSync(K.SYNC_QUEUE) || [];
  if (!queue.length) return { skipped: true, reason: '队列为空' };

  const key = getMasterKey();
  const items = queue.map(q => {
    const enc = crypto.encryptJson(q.plain, key);
    return {
      table: q.table,
      clientId: q.clientId,
      version: q.version,
      clientUpdatedAt: q.clientUpdatedAt,
      cipher: enc.cipher,
      iv: enc.iv,
      tag: enc.tag,
      alg: enc.alg,
      meta: q.meta
    };
  });

  try {
    const r = await http.post('/sync/push', { deviceId: _deviceId(), items });
    // 推送成功后清空已入云的条目
    wx.setStorageSync(K.SYNC_QUEUE, []);
    wx.setStorageSync(K.LAST_PUSH_AT, Date.now());
    return { ok: true, accepted: r.accepted, serverTime: r.serverTime };
  } catch (err) {
    // 40301: 没开会员；其他错误保留队列
    return { ok: false, error: err };
  }
}

// ───────────────── 拉取 ─────────────────
async function pullNow() {
  if (!_canSync()) return { skipped: true };
  const cursor = wx.getStorageSync(K.SYNC_CURSOR) || 0;
  const key = getMasterKey();

  const r = await http.get(`/sync/pull?since=${cursor}&limit=200`);
  const items = r.items || [];

  let merged = 0;
  for (const it of items) {
    try {
      const plain = crypto.decryptJson(it, key);
      const existing = storage.indicators.getAll();
      const idx = existing.findIndex(e => String(e.id) === String(it.clientId));
      const entry = {
        id: it.clientId,
        type: it.meta && it.meta.type,
        payload: plain,
        measuredAt: new Date(it.meta && it.meta.measured_at || it.clientUpdatedAt).toISOString()
      };
      if (idx >= 0) existing[idx] = { ...existing[idx], ...entry };
      else existing.unshift(entry);
      wx.setStorageSync('hrp_indicators', existing.slice(0, 500));
      merged++;
    } catch (e) {
      console.warn('[sync.pull] decrypt 失败:', it.clientId, e);
    }
  }

  if (r.serverTime) wx.setStorageSync(K.SYNC_CURSOR, r.serverTime);
  return { ok: true, merged, total: items.length };
}

function _canSync() {
  const app = getApp();
  return app.isLoggedIn() && hasMasterKey();
}

// ───────────────── 状态摘要 ─────────────────
function status() {
  return {
    loggedIn:     !!getApp().isLoggedIn(),
    hasKey:       hasMasterKey(),
    queueLen:     (wx.getStorageSync(K.SYNC_QUEUE) || []).length,
    cursor:       wx.getStorageSync(K.SYNC_CURSOR) || 0,
    lastPushAt:   wx.getStorageSync(K.LAST_PUSH_AT) || 0,
    deviceId:     _deviceId()
  };
}

module.exports = {
  setMasterKeyByPassword,
  hasMasterKey,
  clearMasterKey,
  enqueueIndicator,
  enqueueAllIndicators,
  pushLocalIndicatorsIfReady,
  pushNow,
  pullNow,
  status
};
