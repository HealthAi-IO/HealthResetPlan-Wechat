const assert = require('assert');

global.getApp = () => ({ isLoggedIn: () => false });
global.wx = { showToast() {} };

const storage = require('../miniprogram/utils/storage');

storage.profile.save({ nickname: '测试用户' });
storage.indicators.add({ id: 'indicator-1', type: 'weight', payload: { weightKg: 60 } });

assert.strictEqual(storage.profile.get().nickname, '测试用户');
assert.strictEqual(storage.indicators.getAll()[0].id, 'indicator-1');

storage.clearCurrentData();
assert.strictEqual(storage.profile.get(), null);
assert.deepStrictEqual(storage.indicators.getAll(), []);

console.log('online memory storage OK');
