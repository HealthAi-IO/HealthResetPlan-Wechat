/**
 * 绔埌绔姞瀵嗗悓姝ワ細瀹㈡埛绔姞瀵?鈫?POST /sync/push锛汫ET /sync/pull 鈫?瑙ｅ瘑銆? *
 * 鍚庣绾︽潫锛堜笌 BackendSyncService 瀵归綈锛夛細
 *   - 褰撳墠浠呮帴鍙?table = "health_indicator"
 *   - meta 闇€鍚?type / measured_at / source锛堟槑鏂囷級
 *   - 璋冪敤鏂归渶鏈変簯鍚屾浼氬憳鏉冪泭锛屽惁鍒?40301
 */

const http    = require('./request');
const crypto  = require('./crypto');
const storage = require('./storage');

const K = {
  MASTER_KEY:   'hrp_master_key_hex', // 涓诲瘑閽ワ紙hex 瀛楃涓诧紝浠呮湰鍦帮級
  SYNC_QUEUE:   'hrp_sync_queue',     // 寰呮帹閫侀槦鍒?  SYNC_CURSOR:  'hrp_sync_cursor',    // 涓婃 pull 鐨?serverTime
  DEVICE_ID:    'hrp_device_id',
  LAST_PUSH_AT: 'hrp_last_push_at'
};

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 涓诲瘑閽ョ鐞?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function setMasterKeyByPassword(password) {
  const app = getApp();
  const uid = app.globalData.userId;
  if (!uid) throw new Error('鏈櫥褰曪紝鏃犳硶娲剧敓涓诲瘑閽?);
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

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 璁惧 ID 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function _deviceId() {
  let id = wx.getStorageSync(K.DEVICE_ID);
  if (!id) {
    id = 'wxmp-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    wx.setStorageSync(K.DEVICE_ID, id);
  }
  return id;
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鍏ラ槦 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
/**
 * 鎶婁竴鏉?indicator 鎺ㄥ叆鍚屾闃熷垪銆? * @param {object} entry { id, type, payload, measuredAt }
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
  if (!_canSync()) return { skipped: true, queued, reason: '鏈櫥褰曟垨鏈缃富瀵嗛挜' };
  const pushed = await pushNow();
  return { queued, pushed };
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鎺ㄩ€?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function pushNow() {
  if (!_canSync()) return { skipped: true, reason: '鏈櫥褰曟垨鏈缃富瀵嗛挜' };
  const queue = wx.getStorageSync(K.SYNC_QUEUE) || [];
  if (!queue.length) return { skipped: true, reason: '闃熷垪涓虹┖' };

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
    // 鎺ㄩ€佹垚鍔熷悗娓呯┖宸插叆浜戠殑鏉＄洰
    wx.setStorageSync(K.SYNC_QUEUE, []);
    wx.setStorageSync(K.LAST_PUSH_AT, Date.now());
    return { ok: true, accepted: r.accepted, serverTime: r.serverTime };
  } catch (err) {
    // 40301: 娌″紑浼氬憳锛涘叾浠栭敊璇繚鐣欓槦鍒?    return { ok: false, error: err };
  }
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鎷夊彇 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
      console.warn('[sync.pull] decrypt 澶辫触:', it.clientId, e);
    }
  }

  if (r.serverTime) wx.setStorageSync(K.SYNC_CURSOR, r.serverTime);
  return { ok: true, merged, total: items.length };
}

function _canSync() {
  const app = getApp();
  return app.isLoggedIn() && hasMasterKey();
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鐘舵€佹憳瑕?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

