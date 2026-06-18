/**
 * App-compatible encrypted cloud sync for the mini program.
 *
 * The Flutter app and the mini program now share the same UMK model:
 * - restore the 32-byte UMK from the app's 24-word BIP39 mnemonic
 * - encrypt every sync payload as AES-256-GCM with empty AAD
 * - send the same public key fingerprint header/body field
 *
 * The server stores generic sync_record rows and cannot decrypt payloads.
 */

const http = require('./http');
const crypto = require('./crypto');
const storage = require('./storage');

const K = {
  MASTER_KEY: 'hrp_master_key_hex',
  SYNC_QUEUE: 'hrp_sync_queue',
  SYNC_CURSOR: 'hrp_sync_cursor',
  DEVICE_ID: 'hrp_device_id',
  LAST_PUSH_AT: 'hrp_last_push_at',
  LAST_PULL_AT: 'hrp_last_pull_at',
  LAST_KEY_FINGERPRINT: 'hrp_last_key_fingerprint'
};

const TABLES = [
  'user_profile',
  'health_indicator',
  'plan',
  'clock_record',
  'reminder',
  'health_report'
];

const STORAGE_KEYS = {
  profile: 'hrp_profile',
  indicators: 'hrp_indicators',
  plans: 'hrp_plans',
  clock: 'hrp_clock_records',
  reminders: 'hrp_reminders',
  reports: 'hrp_reports'
};

function setMasterKeyFromMnemonic(mnemonic) {
  const key = crypto.masterKeyFromMnemonic(normalizeMnemonic(mnemonic));
  _writeMasterKey(key);
}

async function generateMasterKey() {
  const key = await crypto.generateMasterKey();
  _writeMasterKey(key);
  return {
    mnemonic: crypto.exportMnemonic(key),
    fingerprint: crypto.publicFingerprint(key),
  };
}

function getMasterKey() {
  const hex = wx.getStorageSync(K.MASTER_KEY);
  return hex ? crypto._hexToBytes(hex) : null;
}

function keyFingerprint() {
  const key = getMasterKey();
  return key ? crypto.publicFingerprint(key) : '';
}

function hasMasterKey() {
  return !!wx.getStorageSync(K.MASTER_KEY);
}

function clearMasterKey() {
  wx.removeStorageSync(K.MASTER_KEY);
  wx.removeStorageSync(K.SYNC_QUEUE);
  wx.removeStorageSync(K.SYNC_CURSOR);
  wx.removeStorageSync(K.LAST_KEY_FINGERPRINT);
}

function _deviceId() {
  let id = wx.getStorageSync(K.DEVICE_ID);
  if (!id) {
    id = 'wxmp-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    wx.setStorageSync(K.DEVICE_ID, id);
  }
  return id;
}

function enqueueIndicator(entry) {
  enqueueItem(_indicatorToSyncItem(entry));
}

function enqueueIndicatorDelete(clientId) {
  if (clientId === undefined || clientId === null || clientId === '') return;
  enqueueItem({
    table: 'health_indicator',
    clientId: String(clientId),
    version: Date.now(),
    clientUpdatedAt: Date.now(),
    deleted: true,
    plain: { deleted: true },
    meta: { deleted: true }
  });
}

function enqueueItem(item) {
  if (!item || !item.table || !item.clientId) return;
  const queue = wx.getStorageSync(K.SYNC_QUEUE) || [];
  queue.push(item);
  wx.setStorageSync(K.SYNC_QUEUE, queue);
}

function enqueueAllIndicators() {
  const before = wx.getStorageSync(K.SYNC_QUEUE) || [];
  const next = before.slice();
  const seen = new Set(next.map(q => `${q.table}:${q.clientId}`));
  storage.indicators.getAll().forEach(entry => {
    const item = _indicatorToSyncItem(entry);
    const key = `${item.table}:${item.clientId}`;
    if (!seen.has(key)) {
      next.push(item);
      seen.add(key);
    }
  });
  wx.setStorageSync(K.SYNC_QUEUE, next);
  return next.length - before.length;
}

async function pushLocalIndicatorsIfReady() {
  return pushNow();
}

async function pushNow() {
  if (!_canSync()) return { skipped: true, reason: '请先登录并恢复 APP 主密钥' };

  _prepareKeyChange();
  const key = getMasterKey();
  const localItems = buildLocalSyncItems();
  const queuedItems = wx.getStorageSync(K.SYNC_QUEUE) || [];
  const queuedUpserts = queuedItems.filter(item => !item.deleted);
  const queuedDeletes = queuedItems.filter(item => item.deleted);
  const itemsToEncrypt = _dedupeSyncItems(queuedUpserts.concat(localItems, queuedDeletes));

  if (!itemsToEncrypt.length) return { skipped: true, reason: '没有可推送的数据' };

  const items = [];
  for (const item of itemsToEncrypt) {
    const enc = await crypto.encryptJson(item.plain || {}, key);
    items.push({
      table: item.table,
      clientId: item.clientId,
      version: item.version || item.clientUpdatedAt || Date.now(),
      clientUpdatedAt: item.clientUpdatedAt || Date.now(),
      deleted: !!item.deleted,
      cipher: enc.cipher,
      iv: enc.iv,
      tag: enc.tag,
      alg: enc.alg,
      meta: item.meta || {}
    });
  }

  try {
    const r = await http.post('/sync/push', {
      deviceId: _deviceId(),
      keyFingerprint: keyFingerprint(),
      items
    });
    wx.setStorageSync(K.SYNC_QUEUE, []);
    wx.setStorageSync(K.LAST_PUSH_AT, Date.now());
    return { ok: true, accepted: r.accepted || items.length, serverTime: r.serverTime };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function pullNow(options = {}) {
  if (!_canSync()) return { skipped: true };

  _prepareKeyChange();
  if (options.resetCursor) wx.removeStorageSync(K.SYNC_CURSOR);

  const cursor = options.resetCursor ? 0 : (wx.getStorageSync(K.SYNC_CURSOR) || 0);
  const key = getMasterKey();
  const r = await http.get(`/sync/pull?since=${cursor}&limit=500`, null, {
    'X-Key-Fingerprint': keyFingerprint()
  });

  const items = Array.isArray(r.items) ? r.items : [];
  const byTable = _emptyPullStats();
  const decodedItems = [];

  let merged = 0;
  let skipped = 0;
  let failed = 0;

  for (const rawItem of items) {
    const item = _normalizeCloudItem(rawItem);
    if (!TABLES.includes(item.table)) {
      skipped++;
      continue;
    }
    _bumpPullStat(byTable, item.table, 'total');
    try {
      if (item.deleted) {
        decodedItems.push({ item, deleted: true });
        continue;
      }
      const plain = _normalizePlainRow(crypto.decryptJson(item, key));
      decodedItems.push({ item, plain, deleted: false });
    } catch (e) {
      failed++;
      _bumpPullStat(byTable, item.table, 'failed');
      console.warn('[sync.pull] decrypt/merge failed:', item.table, item.clientId, e);
    }
  }

  if (options.replaceLocal && decodedItems.length) _clearLocalSyncedData();

  decodedItems.forEach(entry => {
    const item = entry.item;
    try {
      if (entry.deleted) {
        const deleted = _deleteLocalItem(item.table, item.clientId);
        if (deleted) {
          merged++;
          _bumpPullStat(byTable, item.table, 'deleted');
        } else {
          skipped++;
          _bumpPullStat(byTable, item.table, 'skipped');
        }
        return;
      }
      const ok = _mergeLocalItem(item.table, item.clientId, entry.plain, item);
      if (ok) {
        merged++;
        _bumpPullStat(byTable, item.table, 'merged');
      } else {
        skipped++;
        _bumpPullStat(byTable, item.table, 'skipped');
      }
    } catch (e) {
      failed++;
      _bumpPullStat(byTable, item.table, 'failed');
      console.warn('[sync.pull] merge failed:', item.table, item.clientId, e);
    }
  });

  if (r.serverTime && failed === 0) {
    wx.setStorageSync(K.SYNC_CURSOR, r.serverTime);
    wx.setStorageSync(K.LAST_PULL_AT, Date.now());
    _saveCurrentKeyFingerprint();
  }
  return { ok: true, merged, skipped, failed, total: items.length, byTable };
}

function _writeMasterKey(key) {
  const nextFingerprint = crypto.publicFingerprint(key);
  const prevFingerprint = wx.getStorageSync(K.LAST_KEY_FINGERPRINT) || '';
  wx.setStorageSync(K.MASTER_KEY, crypto._bytesToHex(key));
  if (prevFingerprint && prevFingerprint !== nextFingerprint) {
    wx.removeStorageSync(K.SYNC_CURSOR);
  }
  wx.setStorageSync(K.LAST_KEY_FINGERPRINT, nextFingerprint);
}

function _prepareKeyChange() {
  const fingerprint = keyFingerprint();
  if (!fingerprint) return;
  const prevFingerprint = wx.getStorageSync(K.LAST_KEY_FINGERPRINT) || '';
  if (prevFingerprint && prevFingerprint !== fingerprint) {
    wx.removeStorageSync(K.SYNC_CURSOR);
  }
  wx.setStorageSync(K.LAST_KEY_FINGERPRINT, fingerprint);
}

function _saveCurrentKeyFingerprint() {
  const fingerprint = keyFingerprint();
  if (fingerprint) wx.setStorageSync(K.LAST_KEY_FINGERPRINT, fingerprint);
}

function _clearLocalSyncedData() {
  Object.keys(STORAGE_KEYS).forEach(key => {
    try {
      wx.removeStorageSync(STORAGE_KEYS[key]);
    } catch (e) {}
  });
}

function _emptyPullStats() {
  const stats = {};
  TABLES.forEach(table => {
    stats[table] = { total: 0, merged: 0, skipped: 0, failed: 0, deleted: 0 };
  });
  return stats;
}

function _bumpPullStat(stats, table, field) {
  if (!stats[table]) stats[table] = { total: 0, merged: 0, skipped: 0, failed: 0, deleted: 0 };
  stats[table][field] = (Number(stats[table][field]) || 0) + 1;
}

function _normalizeCloudItem(item) {
  const meta = item && item.meta && typeof item.meta === 'object' ? item.meta : {};
  const table = item.table || item.tableName || item.table_name || meta.table || meta.tableName || meta.table_name || '';
  const clientId = item.clientId || item.client_id || item.clientID || item.id || meta.clientId || meta.client_id || '';
  return {
    ...item,
    table: String(table || ''),
    clientId: clientId === undefined || clientId === null ? '' : String(clientId),
    deleted: !!(item.deleted || item.isDeleted || item.is_deleted)
  };
}

function buildLocalSyncItems() {
  const items = [];
  const profile = storage.profile.get();
  if (profile) items.push(_profileToSyncItem(profile));
  storage.indicators.getAll().forEach(entry => items.push(_indicatorToSyncItem(entry)));
  storage.plans.getAll().forEach(plan => items.push(_planToSyncItem(plan)));
  storage.clock.getAll().forEach(record => items.push(_clockToSyncItem(record)));
  storage.reminders.getAll().forEach(reminder => items.push(_reminderToSyncItem(reminder)));
  storage.reports.getAll().forEach(report => items.push(_reportToSyncItem(report)));
  return items.filter(Boolean);
}

function _profileToSyncItem(profile) {
  const now = _toMs(profile.updatedAt) || Date.now();
  const birthYear = Number(profile.birthYear) || (Number(profile.age) ? new Date().getFullYear() - Number(profile.age) : 0);
  const row = {
    user_id: 'local-user',
    client_id: 'profile-local-user',
    nickname: profile.nickname || '',
    gender: _toAppGender(profile.gender),
    birth_year: birthYear,
    height_cm: Number(profile.heightCm) || 0,
    weight_kg: Number(profile.weightKg) || 0,
    medical_history: _medicalHistory(profile),
    medications: profile.medications || profile.medicines || '',
    goal: _toAppGoal(profile.goal),
    exercise_base: _toAppExercise(profile.exerciseBase || profile.activityLevel),
    diet_preference: _toAppDiet(profile.dietPreference || profile.dietPref),
    created_at: _toMs(profile.createdAt) || now,
    updated_at: now,
    version: now
  };
  return {
    table: 'user_profile',
    clientId: row.client_id,
    version: now,
    clientUpdatedAt: now,
    plain: row,
    meta: { nickname: row.nickname, updated_at: now }
  };
}

function _indicatorToSyncItem(entry) {
  const measuredAt = _toMs(entry.measuredAt) || Date.now();
  const updatedAt = _toMs(entry.updatedAt) || measuredAt;
  const id = String(entry.clientId || entry.id || `indicator-${updatedAt}`);
  const type = entry.type || 'weight';
  const payload = _toAppIndicatorPayload(type, entry.payload || {});
  const row = {
    user_id: 'local-user',
    client_id: id,
    type,
    payload_json: JSON.stringify(payload),
    source: entry.source || 'wxmp',
    measured_at: measuredAt,
    created_at: _toMs(entry.createdAt) || measuredAt,
    updated_at: updatedAt,
    version: updatedAt
  };
  return {
    table: 'health_indicator',
    clientId: id,
    version: updatedAt,
    clientUpdatedAt: updatedAt,
    plain: row,
    meta: { type, measured_at: measuredAt, source: row.source }
  };
}

function _planToSyncItem(plan) {
  const planDate = _dateToMs(plan.planDate || plan.date) || Date.now();
  const updatedAt = _toMs(plan.updatedAt) || planDate;
  const id = String(plan.clientId || plan.id || `plan-${plan.type || 'meal'}-${planDate}`);
  const row = {
    user_id: 'local-user',
    client_id: id,
    type: plan.type || 'meal',
    plan_date: planDate,
    payload_json: JSON.stringify(plan.payload || {}),
    ai_provider: plan.aiProvider || plan.provider || 'local',
    ai_model: plan.aiModel || plan.model || 'wxmp',
    created_at: _toMs(plan.createdAt) || updatedAt,
    updated_at: updatedAt,
    version: updatedAt
  };
  return {
    table: 'plan',
    clientId: id,
    version: updatedAt,
    clientUpdatedAt: updatedAt,
    plain: row,
    meta: {
      type: row.type,
      plan_date: row.plan_date,
      ai_provider: row.ai_provider,
      ai_model: row.ai_model
    }
  };
}

function _clockToSyncItem(record) {
  const clockAt = _toMs(record.clockAt || record.clockTime) || Date.now();
  const updatedAt = _toMs(record.updatedAt) || clockAt;
  const id = String(record.clientId || record.id || `clock-${clockAt}`);
  const row = {
    user_id: 'local-user',
    client_id: id,
    type: record.type || 'meal',
    status: record.status || 'done',
    clock_at: clockAt,
    note: record.note || '',
    photo_path: record.photoPath || '',
    created_at: _toMs(record.createdAt) || clockAt,
    updated_at: updatedAt,
    version: updatedAt
  };
  return {
    table: 'clock_record',
    clientId: id,
    version: updatedAt,
    clientUpdatedAt: updatedAt,
    plain: row,
    meta: { type: row.type, clock_at: row.clock_at, status: row.status }
  };
}

function _reminderToSyncItem(reminder) {
  const remindAt = _reminderTimeToMs(reminder);
  const updatedAt = _toMs(reminder.updatedAt) || remindAt;
  const id = String(reminder.clientId || reminder.id || `reminder-${reminder.type || 'meal'}-${remindAt}`);
  const row = {
    user_id: 'local-user',
    client_id: id,
    type: reminder.type || 'meal',
    remind_at: remindAt,
    payload_json: JSON.stringify({
      label: reminder.label || '',
      note: reminder.note || '',
      hour: Number(reminder.hour) || new Date(remindAt).getHours(),
      minute: Number(reminder.minute) || new Date(remindAt).getMinutes()
    }),
    channel: reminder.channel || 'local',
    status: reminder.status || 'pending',
    created_at: _toMs(reminder.createdAt) || updatedAt,
    updated_at: updatedAt,
    version: updatedAt
  };
  return {
    table: 'reminder',
    clientId: id,
    version: updatedAt,
    clientUpdatedAt: updatedAt,
    plain: row,
    meta: { type: row.type, remind_at: row.remind_at, status: row.status }
  };
}

function _reportToSyncItem(report) {
  const reportTime = _toMs(report.reportTime) || Date.now();
  const updatedAt = _toMs(report.updatedAt) || reportTime;
  const id = String(report.clientId || report.id || `report-${reportTime}`);
  const structured = report.structured && typeof report.structured === 'object'
    ? report.structured
    : {};
  const imageBase64 = _readFileBase64(report.imagePath);
  const row = {
    user_id: 'local-user',
    client_id: id,
    image_path: report.imagePath || '',
    report_time: reportTime,
    summary: report.summary || '',
    raw_text: report.rawText || '',
    structured_json: JSON.stringify(structured),
    provider: report.provider || structured.provider || '',
    created_at: _toMs(report.createdAt) || updatedAt,
    updated_at: updatedAt,
    version: updatedAt,
    image_base64: imageBase64,
    image_ext: _fileExt(report.imagePath)
  };
  return {
    table: 'health_report',
    clientId: id,
    version: updatedAt,
    clientUpdatedAt: updatedAt,
    plain: row,
    meta: {
      report_time: row.report_time,
      provider: row.provider
    }
  };
}

function _mergeLocalItem(table, clientId, plain, cloudItem) {
  switch (table) {
    case 'user_profile':
      return _mergeProfile(plain);
    case 'health_indicator':
      return _upsert(STORAGE_KEYS.indicators, _indicatorFromRow(plain, clientId, cloudItem));
    case 'plan':
      return _upsert(STORAGE_KEYS.plans, _planFromRow(plain, clientId, cloudItem));
    case 'clock_record':
      return _upsert(STORAGE_KEYS.clock, _clockFromRow(plain, clientId, cloudItem));
    case 'reminder':
      return _upsert(STORAGE_KEYS.reminders, _reminderFromRow(plain, clientId, cloudItem));
    case 'health_report':
      return _upsert(STORAGE_KEYS.reports, _reportFromRow(plain, clientId, cloudItem));
    default:
      return false;
  }
}

function _deleteLocalItem(table, clientId) {
  const key = {
    health_indicator: STORAGE_KEYS.indicators,
    plan: STORAGE_KEYS.plans,
    clock_record: STORAGE_KEYS.clock,
    reminder: STORAGE_KEYS.reminders,
    health_report: STORAGE_KEYS.reports
  }[table];
  if (!key || !clientId) return false;
  const list = wx.getStorageSync(key) || [];
  const next = list.filter(item => String(item.clientId || item.id) !== String(clientId));
  wx.setStorageSync(key, next);
  return next.length !== list.length;
}

function _mergeProfile(plain) {
  const profile = _profileFromRow(plain);
  if (!_hasProfileContent(profile)) return false;
  const current = storage.profile.get() || {};
  wx.setStorageSync(STORAGE_KEYS.profile, {
    ...current,
    ...profile,
    updatedAt: profile.updatedAt || new Date().toISOString()
  });
  return true;
}

function _hasProfileContent(profile) {
  if (!profile) return false;
  return !!(
    profile.nickname ||
    profile.age ||
    profile.birthYear ||
    profile.heightCm ||
    profile.weightKg ||
    profile.medicines ||
    profile.hasHypertension ||
    profile.hasDiabetes ||
    profile.hasHyperlipidemia ||
    profile.hasCVD ||
    profile.hasObesity
  );
}

function _profileFromRow(row) {
  row = _normalizePlainRow(row);
  const conditions = String(row.medical_history || row.medicalHistory || '');
  const explicitAge = Number(row.age) || 0;
  const birthYear = Number(row.birth_year || row.birthYear) ||
    (explicitAge > 0 ? new Date().getFullYear() - explicitAge : 0);
  const age = explicitAge || (birthYear > 1900 ? new Date().getFullYear() - birthYear : 0);
  const gender = row.gender === 'male'
    ? '男'
    : row.gender === 'female'
      ? '女'
      : (row.gender === '男' || row.gender === '女' ? row.gender : '');
  return {
    nickname: row.nickname || '',
    gender,
    age,
    heightCm: Number(row.height_cm || row.heightCm) || 0,
    weightKg: Number(row.weight_kg || row.weightKg) || 0,
    goal: _fromProfileGoal(row.goal),
    activityLevel: row.activityLevel || _fromAppExercise(row.exercise_base || row.exerciseBase),
    dietPref: row.dietPref || _fromAppDiet(row.diet_preference || row.dietPreference),
    hasHypertension: conditions.includes('hypertension') || conditions.includes('高血压'),
    hasDiabetes: conditions.includes('diabetes') || conditions.includes('糖尿病'),
    hasHyperlipidemia: conditions.includes('hyperlipidemia') || conditions.includes('高血脂'),
    hasCVD: conditions.includes('cvd') || conditions.includes('心血管'),
    hasObesity: conditions.includes('obesity') || conditions.includes('肥胖'),
    medicines: row.medications || row.medicines || '',
    birthYear,
    updatedAt: new Date(Number(row.updated_at) || Date.now()).toISOString()
  };
}

function _indicatorFromRow(row, clientId, item) {
  const meta = item.meta || {};
  const type = meta.type || row.type || 'weight';
  return {
    id: clientId || row.client_id || row.id || `cloud-indicator-${Date.now()}`,
    clientId: clientId || row.client_id || '',
    type,
    payload: _toWxIndicatorPayload(type, _extractPayload(row)),
    measuredAt: new Date(Number(meta.measured_at || row.measured_at || item.clientUpdatedAt || Date.now())).toISOString(),
    source: meta.source || row.source || 'cloud',
    updatedAt: new Date(Number(row.updated_at || item.clientUpdatedAt || Date.now())).toISOString()
  };
}

function _planFromRow(row, clientId, item) {
  const planDate = Number(row.plan_date || item.clientUpdatedAt || Date.now());
  return {
    id: clientId || row.client_id || row.id || `cloud-plan-${planDate}`,
    clientId: clientId || row.client_id || '',
    type: row.type || 'meal',
    date: _dateString(planDate),
    payload: _parseJson(row.payload_json, {}),
    aiProvider: row.ai_provider || '',
    aiModel: row.ai_model || '',
    updatedAt: new Date(Number(row.updated_at || item.clientUpdatedAt || Date.now())).toISOString()
  };
}

function _clockFromRow(row, clientId, item) {
  const clockAt = Number(row.clock_at || item.clientUpdatedAt || Date.now());
  return {
    id: clientId || row.client_id || row.id || `cloud-clock-${clockAt}`,
    clientId: clientId || row.client_id || '',
    type: row.type || 'meal',
    status: row.status || 'done',
    note: row.note || '',
    photoPath: row.photo_path || '',
    clockTime: new Date(clockAt).toISOString(),
    updatedAt: new Date(Number(row.updated_at || item.clientUpdatedAt || Date.now())).toISOString()
  };
}

function _reminderFromRow(row, clientId, item) {
  const remindAt = Number(row.remind_at || item.clientUpdatedAt || Date.now());
  const payload = _parseJson(row.payload_json, {});
  const d = new Date(remindAt);
  return {
    id: clientId || row.client_id || row.id || `cloud-reminder-${remindAt}`,
    clientId: clientId || row.client_id || '',
    type: row.type || 'meal',
    label: payload.label || '',
    note: payload.note || '',
    hour: Number(payload.hour) || d.getHours(),
    minute: Number(payload.minute) || d.getMinutes(),
    channel: row.channel || 'local',
    status: row.status || 'pending',
    updatedAt: new Date(Number(row.updated_at || item.clientUpdatedAt || Date.now())).toISOString()
  };
}

function _reportFromRow(row, clientId, item) {
  const reportTime = Number(row.report_time || item.clientUpdatedAt || Date.now());
  const imagePath = _restoreReportImage(row, clientId || row.client_id || '');
  return {
    id: clientId || row.client_id || row.id || `cloud-report-${reportTime}`,
    clientId: clientId || row.client_id || '',
    imagePath,
    reportTime: new Date(reportTime).toISOString(),
    summary: row.summary || '',
    rawText: row.raw_text || '',
    structured: _parseJson(row.structured_json, {}),
    provider: row.provider || '',
    createdAt: new Date(Number(row.created_at || reportTime)).toISOString(),
    updatedAt: new Date(Number(row.updated_at || item.clientUpdatedAt || Date.now())).toISOString()
  };
}

function _upsert(key, entry) {
  const list = wx.getStorageSync(key) || [];
  const id = String(entry.clientId || entry.id);
  const idx = list.findIndex(item => String(item.clientId || item.id) === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.unshift(entry);
  wx.setStorageSync(key, list.slice(0, 500));
  return true;
}

function _readFileBase64(filePath) {
  if (!filePath) return '';
  try {
    const fs = wx.getFileSystemManager();
    return fs.readFileSync(filePath, 'base64') || '';
  } catch (e) {
    return '';
  }
}

function _restoreReportImage(row, clientId) {
  const imageBase64 = row.image_base64 || '';
  if (!imageBase64 || !clientId) return row.image_path || '';
  try {
    const fs = wx.getFileSystemManager();
    const ext = _fileExt(row.image_ext || row.image_path || '') || '.jpg';
    const dir = `${wx.env.USER_DATA_PATH}/reports`;
    try {
      fs.accessSync(dir);
    } catch (e) {
      fs.mkdirSync(dir, true);
    }
    const filePath = `${dir}/${clientId}${ext}`;
    fs.writeFileSync(filePath, imageBase64, 'base64');
    return filePath;
  } catch (e) {
    return row.image_path || '';
  }
}

function _fileExt(filePath) {
  const raw = String(filePath || '');
  const idx = raw.lastIndexOf('.');
  if (idx < 0) return '.jpg';
  const ext = raw.slice(idx).toLowerCase();
  return ext.length > 10 ? '.jpg' : ext;
}

function _dedupeSyncItems(items) {
  const map = new Map();
  items.forEach(item => {
    if (!item || !item.table || !item.clientId) return;
    map.set(`${item.table}:${item.clientId}`, item);
  });
  return Array.from(map.values());
}

function _extractPayload(row) {
  if (row.payload_json) return _parseJson(row.payload_json, {});
  if (row.payload && typeof row.payload === 'object') return row.payload;
  return row || {};
}

function _toAppIndicatorPayload(type, payload) {
  const p = { ...payload };
  if (type === 'glucose' && p.glucoseMmol === undefined && p.mmol !== undefined) p.glucoseMmol = p.mmol;
  if (type === 'spo2' && p.spo2Pct === undefined && p.pct !== undefined) p.spo2Pct = p.pct;
  if (type === 'waist' && p.waistCm === undefined && p.cm !== undefined) p.waistCm = p.cm;
  if (type === 'body_fat' && p.bodyFatPct === undefined && p.pct !== undefined) p.bodyFatPct = p.pct;
  if (type === 'sleep' && p.sleepHours === undefined && p.hours !== undefined) p.sleepHours = p.hours;
  if (type === 'steps' && p.steps === undefined && p.count !== undefined) p.steps = p.count;
  return p;
}

function _toWxIndicatorPayload(type, payload) {
  const p = { ...payload };
  if (type === 'glucose' && p.mmol === undefined && p.glucoseMmol !== undefined) p.mmol = p.glucoseMmol;
  if (type === 'spo2' && p.pct === undefined && p.spo2Pct !== undefined) p.pct = p.spo2Pct;
  if (type === 'waist' && p.cm === undefined && p.waistCm !== undefined) p.cm = p.waistCm;
  if (type === 'body_fat' && p.pct === undefined && p.bodyFatPct !== undefined) p.pct = p.bodyFatPct;
  if (type === 'sleep' && p.hours === undefined && p.sleepHours !== undefined) p.hours = p.sleepHours;
  if (type === 'steps' && p.count === undefined && p.steps !== undefined) p.count = p.steps;
  return p;
}

function _medicalHistory(profile) {
  const parts = [];
  if (profile.medicalHistory) parts.push(profile.medicalHistory);
  if (profile.hasHypertension) parts.push('hypertension');
  if (profile.hasDiabetes) parts.push('diabetes');
  if (profile.hasHyperlipidemia) parts.push('hyperlipidemia');
  if (profile.hasCVD) parts.push('cvd');
  if (profile.hasObesity) parts.push('obesity');
  return parts.join('；');
}

function _toAppGender(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'male' || s.includes('男')) return 'male';
  if (s === 'female' || s.includes('女')) return 'female';
  return 'unknown';
}

function _toAppGoal(v) {
  const s = String(v || '');
  if (s === 'fat_loss' || s.includes('减脂') || s.includes('降重')) return 'fat_loss';
  if (s === 'glucose_control' || s.includes('控糖')) return 'glucose_control';
  if (s === 'bp_control' || s.includes('控压')) return 'bp_control';
  if (s === 'lipid_control' || s.includes('降脂')) return 'lipid_control';
  return 'maintain';
}

function _fromAppGoal(v) {
  return {
    fat_loss: '减脂降重',
    glucose_control: '控糖',
    bp_control: '控压',
    lipid_control: '降脂',
    maintain: '综合调理'
  }[v] || '综合调理';
}

function _fromProfileGoal(v) {
  const s = String(v || '');
  if (s === 'fat_loss' || s === 'glucose_control' || s === 'bp_control' || s === 'lipid_control' || s === 'maintain') {
    return _fromAppGoal(s);
  }
  return s || '综合调理';
}

function _toAppExercise(v) {
  const s = String(v || '');
  if (s === 'moderate' || s.includes('中度')) return 'moderate';
  if (s === 'light' || s.includes('轻度')) return 'light';
  if (s.includes('高度')) return 'moderate';
  return 'none';
}

function _fromAppExercise(v) {
  return v === 'moderate' ? '中度活动' : v === 'light' ? '轻度活动' : '久坐不动';
}

function _toAppDiet(v) {
  const s = String(v || '');
  if (s === 'light' || s.includes('低盐') || s.includes('低脂')) return 'light';
  if (s === 'vegetarian' || s.includes('素食')) return 'vegetarian';
  if (s === 'custom' || s.includes('定制')) return 'custom';
  return 'normal';
}

function _fromAppDiet(v) {
  return v === 'light' ? '低盐低脂' : v === 'vegetarian' ? '素食' : v === 'custom' ? '定制饮食' : '普通饮食';
}

function _toMs(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 1000000000) return n;
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function _dateToMs(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const raw = String(value);
  const d = raw.includes('T') ? new Date(raw) : new Date(`${raw}T00:00:00`);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function _reminderTimeToMs(reminder) {
  if (reminder.remindAt) return _toMs(reminder.remindAt);
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(reminder.hour) || 7, Number(reminder.minute) || 0, 0, 0);
  return d.getTime();
}

function _dateString(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _parseJson(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function _normalizePlainRow(row) {
  if (!row) return {};
  if (typeof row === 'string') return _parseJson(row, {});
  if (typeof row !== 'object') return {};

  const nested =
    row.row ||
    row.data ||
    row.payload ||
    row.plain ||
    row.profile ||
    row.record ||
    null;
  if (nested && typeof nested === 'object') {
    return { ...row, ...nested };
  }
  if (typeof nested === 'string') {
    return { ...row, ..._parseJson(nested, {}) };
  }
  if (row.payload_json && typeof row.payload_json === 'string') {
    const parsedPayload = _parseJson(row.payload_json, null);
    if (parsedPayload && typeof parsedPayload === 'object') return { ...row, ...parsedPayload };
  }
  return row;
}

function normalizeMnemonic(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function _canSync() {
  const app = getApp();
  return app.isLoggedIn() && hasMasterKey();
}

function status() {
  return {
    loggedIn: !!getApp().isLoggedIn(),
    hasKey: hasMasterKey(),
    queueLen: buildLocalSyncItems().length + (wx.getStorageSync(K.SYNC_QUEUE) || []).filter(q => q.deleted).length,
    cursor: wx.getStorageSync(K.SYNC_CURSOR) || 0,
    lastPushAt: wx.getStorageSync(K.LAST_PUSH_AT) || 0,
    lastPullAt: wx.getStorageSync(K.LAST_PULL_AT) || 0,
    deviceId: _deviceId(),
    keyFingerprint: keyFingerprint()
  };
}

module.exports = {
  generateMasterKey,
  setMasterKeyFromMnemonic,
  hasMasterKey,
  clearMasterKey,
  enqueueItem,
  enqueueIndicator,
  enqueueIndicatorDelete,
  enqueueAllIndicators,
  pushLocalIndicatorsIfReady,
  pushNow,
  pullNow,
  status,
  keyFingerprint,
  buildLocalSyncItems
};
