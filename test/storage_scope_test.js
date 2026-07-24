const assert = require('assert');

const values = new Map([
  ['hrp_profile', { nickname: 'legacy-account' }],
  ['hrp_master_key_hex', 'legacy-key'],
]);

global.wx = {
  getStorageSync(key) {
    return values.has(key) ? values.get(key) : '';
  },
  setStorageSync(key, value) {
    values.set(key, value);
  },
  removeStorageSync(key) {
    values.delete(key);
  },
  getStorageInfoSync() {
    return { keys: Array.from(values.keys()) };
  },
};

const storage = require('../miniprogram/utils/storage');

storage.activateScope('user-a');
assert.strictEqual(storage.profile.get().nickname, 'legacy-account');
assert.strictEqual(values.get('hrp_master_key_hex::account-user-a'), 'legacy-key');
assert.strictEqual(values.has('hrp_profile'), false);
storage.indicators.add({ id: 'a-indicator', type: 'weight', payload: { weightKg: 60 } });

storage.activateScope('user-b');
assert.strictEqual(storage.profile.get(), null);
assert.deepStrictEqual(storage.indicators.getAll(), []);
storage.profile.save({ nickname: 'account-b' });

storage.activateScope('user-a');
assert.strictEqual(storage.profile.get().nickname, 'legacy-account');
assert.strictEqual(storage.indicators.getAll()[0].id, 'a-indicator');
storage.clearCurrentData();
assert.strictEqual(storage.profile.get(), null);

storage.activateScope('user-b');
assert.strictEqual(storage.profile.get().nickname, 'account-b');

storage.useGuestScope();
assert.strictEqual(storage.profile.get(), null);
storage.profile.save({ nickname: 'guest' });
storage.activateScope('user-b');
assert.strictEqual(storage.profile.get().nickname, 'account-b');

console.log('storage scope isolation OK');
