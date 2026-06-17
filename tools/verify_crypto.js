const store = new Map();

global.wx = {
  getStorageSync: key => store.get(key),
  setStorageSync: (key, value) => store.set(key, value),
  removeStorageSync: key => store.delete(key),
  getRandomValues: ({ length, success }) => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = (i * 19 + 5) & 255;
    if (success) success({ randomValues: bytes.buffer });
    return { randomValues: bytes.buffer };
  },
  request: options => {
    lastRequest = options;
    setTimeout(() => {
      options.success({
        statusCode: 200,
        data: { code: 0, data: global.__response },
      });
    }, 0);
  },
};

global.getApp = () => ({
  globalData: {
    userId: 'u1',
    accessToken: 'token',
    baseUrl: 'https://api.jkcqplan.com/api/v1',
    appVersion: '0.2.0',
  },
  isLoggedIn: () => true,
  clearAuth: () => {},
});

let lastRequest = null;

const crypto = require('../miniprogram/utils/crypto');
const sync = require('../miniprogram/utils/sync');

(async () => {
  const key = Array.from({ length: 32 }, (_, i) => i);
  const mnemonic = crypto.exportMnemonic(key);
  const restored = crypto.masterKeyFromMnemonic(mnemonic);
  if (crypto._bytesToHex(restored) !== crypto._bytesToHex(key)) {
    throw new Error('mnemonic restore mismatch');
  }

  const enc = await crypto.encryptJson({ hello: 'world', n: 7 }, key);
  if (enc.alg !== 'aes-256-gcm:v1') throw new Error('bad alg');
  const dec = crypto.decryptJson(enc, key);
  if (dec.hello !== 'world' || dec.n !== 7) {
    throw new Error('aes decrypt mismatch');
  }

  sync.setMasterKeyFromMnemonic(mnemonic);
  sync.enqueueIndicator({
    id: 'local1',
    type: 'weight',
    payload: { weightKg: 70 },
    measuredAt: new Date().toISOString(),
  });
  global.__response = { accepted: 1, serverTime: 100 };
  await sync.pushNow();
  const sent = lastRequest.data.items[0];
  if (sent.alg !== 'aes-256-gcm:v1') throw new Error('push did not use AES-GCM');
  if (lastRequest.data.keyFingerprint !== sync.keyFingerprint()) {
    throw new Error('push fingerprint mismatch');
  }

  const cloudEnc = await crypto.encryptJson({
    client_id: 'cloud1',
    type: 'weight',
    payload_json: JSON.stringify({ weightKg: 71 }),
    source: 'app',
    measured_at: Date.now(),
  }, key);
  global.__response = {
    serverTime: 200,
    items: [{
      table: 'health_indicator',
      clientId: 'cloud1',
      version: 1,
      clientUpdatedAt: Date.now(),
      ...cloudEnc,
      meta: { type: 'weight', measured_at: Date.now() },
    }],
  };
  const pull = await sync.pullNow();
  const indicators = store.get('hrp_indicators') || [];
  if (pull.merged !== 1 || indicators[0].payload.weightKg !== 71) {
    throw new Error('pull did not merge AES-GCM indicator');
  }

  console.log(JSON.stringify({
    ok: true,
    mnemonicWords: mnemonic.split(' ').length,
    alg: sent.alg,
    fingerprint: sync.keyFingerprint().slice(0, 12),
  }));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
