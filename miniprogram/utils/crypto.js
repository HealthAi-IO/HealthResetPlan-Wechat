/**
 * End-to-end crypto for the WeChat mini program.
 *
 * Compatible with the Flutter app:
 * - UMK: 32 bytes restored from the app's 24-word BIP39 mnemonic.
 * - Payload crypto: AES-256-GCM, 12-byte IV, 16-byte auth tag, empty AAD.
 * - Public fingerprint: SHA-256("hrp-umk-public-fingerprint:v1:" + UMK).
 *
 * The old mini-program xor-hmac:v1-wxmp implementation is kept only for
 * decrypting records written by older mini-program builds.
 */

const sha256 = require('./sha256');
const vendor = require('./crypto_vendor');

function _strToBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if ((c & 0xfc00) === 0xd800 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      c = 0x10000 + ((c & 0x3ff) << 10) + (s.charCodeAt(++i) & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

function _bytesToStr(bytes) {
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0) {
      s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const o = cp - 0x10000;
      s += String.fromCharCode(0xd800 | (o >> 10)) + String.fromCharCode(0xdc00 | (o & 0x3ff));
    }
  }
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function _bytesToB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1];
    const b3 = bytes[i + 2];
    out += B64[b1 >> 2];
    out += B64[((b1 & 3) << 4) | ((b2 || 0) >> 4)];
    out += b2 === undefined ? '=' : B64[((b2 & 15) << 2) | ((b3 || 0) >> 6)];
    out += b3 === undefined ? '=' : B64[b3 & 63];
  }
  return out;
}

function _b64ToBytes(s) {
  s = String(s || '').replace(/=+$/, '');
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const c1 = B64.indexOf(s[i]);
    const c2 = B64.indexOf(s[i + 1]);
    const c3 = i + 2 < s.length ? B64.indexOf(s[i + 2]) : -1;
    const c4 = i + 3 < s.length ? B64.indexOf(s[i + 3]) : -1;
    out.push((c1 << 2) | (c2 >> 4));
    if (c3 >= 0) out.push(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 >= 0) out.push(((c3 & 3) << 6) | c4);
  }
  return out;
}

function _bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function _hexToBytes(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

async function _randomBytes(n) {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
    const out = new Uint8Array(n);
    globalThis.crypto.getRandomValues(out);
    return Array.from(out);
  }
  if (typeof wx !== 'undefined' && wx.getRandomValues) {
    try {
      const direct = wx.getRandomValues({ length: n });
      if (direct && direct.randomValues) {
        return Array.from(new Uint8Array(direct.randomValues));
      }
    } catch (e) {}
    return new Promise((resolve, reject) => {
      wx.getRandomValues({
        length: n,
        success: res => resolve(Array.from(new Uint8Array(res.randomValues))),
        fail: reject,
      });
    });
  }
  throw new Error('当前环境缺少安全随机数能力');
}

function _hmacSha256(keyBytes, msgBytes) {
  const blockSize = 64;
  let k = keyBytes;
  if (k.length > blockSize) k = _hexToBytes(sha256.hex(k));
  if (k.length < blockSize) k = k.concat(new Array(blockSize - k.length).fill(0));

  const opad = k.map(b => b ^ 0x5c);
  const ipad = k.map(b => b ^ 0x36);

  const innerHash = _hexToBytes(sha256.hex(ipad.concat(msgBytes)));
  return _hexToBytes(sha256.hex(opad.concat(innerHash)));
}

function pbkdf2(password, salt, iterations, dkLenBytes) {
  const pwd = _strToBytes(password);
  const slt = typeof salt === 'string' ? _strToBytes(salt) : salt;
  const hLen = 32;
  const blocks = Math.ceil(dkLenBytes / hLen);
  const result = [];

  for (let i = 1; i <= blocks; i++) {
    const blk = slt.concat([(i >> 24) & 0xff, (i >> 16) & 0xff, (i >> 8) & 0xff, i & 0xff]);
    let u = _hmacSha256(pwd, blk);
    const t = u.slice();
    for (let j = 1; j < iterations; j++) {
      u = _hmacSha256(pwd, u);
      for (let k = 0; k < t.length; k++) t[k] ^= u[k];
    }
    result.push(...t);
  }
  return result.slice(0, dkLenBytes);
}

function deriveMasterKey(password, userId) {
  const salt = 'hrp-wxmp-v1::' + userId;
  return pbkdf2(password, salt, 10000, 32);
}

function masterKeyFromMnemonic(mnemonic) {
  const key = vendor.mnemonicToEntropyBytes(mnemonic);
  if (key.length !== 32) throw new Error('助记词不匹配，请核对');
  return key;
}

function exportMnemonic(keyBytes) {
  if (!keyBytes || keyBytes.length !== 32) throw new Error('主密钥长度必须是 32 字节');
  return vendor.entropyBytesToMnemonic(keyBytes);
}

function validateMnemonic(mnemonic) {
  return vendor.validateEnglishMnemonic(mnemonic);
}

async function generateMasterKey() {
  return _randomBytes(32);
}

function publicFingerprint(keyBytes) {
  return sha256.hex(_strToBytes('hrp-umk-public-fingerprint:v1:').concat(keyBytes));
}

async function encryptJson(plainObj, keyBytes) {
  if (!keyBytes || keyBytes.length !== 32) throw new Error('主密钥无效');
  const iv = await _randomBytes(12);
  const plain = _strToBytes(JSON.stringify(plainObj));
  const encrypted = vendor.aesGcmEncrypt(keyBytes, iv, plain);
  return {
    cipher: _bytesToB64(encrypted.cipher),
    iv: _bytesToB64(iv),
    tag: _bytesToB64(encrypted.tag),
    alg: 'aes-256-gcm:v1',
  };
}

function decryptJson(payload, keyBytes) {
  const alg = payload && payload.alg ? payload.alg : 'aes-256-gcm:v1';
  if (alg === 'aes-256-gcm:v1') {
    const plain = vendor.aesGcmDecrypt(
      keyBytes,
      _b64ToBytes(payload.iv),
      _b64ToBytes(payload.cipher),
      _b64ToBytes(payload.tag),
    );
    return JSON.parse(_bytesToStr(plain));
  }
  if (alg === 'xor-hmac:v1-wxmp') {
    return _decryptLegacyJson(payload, keyBytes);
  }
  throw new Error('不支持的云同步加密算法：' + alg);
}

function _encryptRawLegacy(keyBytes, ivBytes, plainBytes) {
  const blocks = Math.ceil(plainBytes.length / 32);
  const stream = [];
  for (let i = 0; i < blocks; i++) {
    const ctr = ivBytes.concat([(i >> 24) & 0xff, (i >> 16) & 0xff, (i >> 8) & 0xff, i & 0xff]);
    stream.push(..._hmacSha256(keyBytes, ctr));
  }
  return plainBytes.map((b, i) => b ^ stream[i]);
}

function _decryptLegacyJson({ cipher, iv, tag }, keyBytes) {
  const cBytes = _b64ToBytes(cipher);
  const ivBytes = _b64ToBytes(iv);
  const tagB = _b64ToBytes(tag);

  const expectedTag = _hmacSha256(keyBytes, ivBytes.concat(cBytes)).slice(0, 16);
  for (let i = 0; i < 16; i++) {
    if (expectedTag[i] !== tagB[i]) throw new Error('完整性校验失败：密钥不匹配或数据被篡改');
  }
  const plain = _encryptRawLegacy(keyBytes, ivBytes, cBytes);
  return JSON.parse(_bytesToStr(plain));
}

module.exports = {
  deriveMasterKey,
  generateMasterKey,
  masterKeyFromMnemonic,
  exportMnemonic,
  validateMnemonic,
  publicFingerprint,
  encryptJson,
  decryptJson,
  _bytesToHex,
  _hexToBytes,
  _bytesToB64,
  _b64ToBytes,
};
