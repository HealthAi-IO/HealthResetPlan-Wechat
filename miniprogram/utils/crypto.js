/**
 * 端到端加密层（小程序版）
 *
 * 设计目标：
 *   - 主密钥派生（PBKDF2-SHA256，10000 轮）— 已实现，纯 JS
 *   - HMAC-SHA256 完整性校验 — 已实现，调用 wx 自带或 SHA256 polyfill
 *   - 数据加密 / 解密 — 当前为 **占位实现（XOR + HMAC）**，未来需替换为 CryptoJS 的 AES-256-CBC
 *
 * 与 Flutter 端 / 后端的契约：
 *   - 返回结构 { cipher, iv, tag, alg }
 *     cipher: base64 字符串
 *     iv:     base64 字符串（16 字节）
 *     tag:    base64 字符串（HMAC-SHA256 截断到 16 字节）
 *     alg:    "xor-hmac:v1-wxmp"   ← 占位算法，标记为微信小程序版本
 *   - 服务端不解密，仅持久化；Flutter 端按 alg 路由解密
 *
 * 升级到 AES-256-CBC（推荐）：
 *   1. 在小程序根目录执行 `npm i crypto-js`，并在开发者工具构建 npm
 *   2. 把 _encryptRaw / _decryptRaw 改为 CryptoJS.AES.encrypt(..., key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 })
 *   3. 把 alg 改为 "aes-256-cbc-hmac:v1"
 *
 * ⚠️ 当前占位加密**不是工业级加密**，仅用于把同步流程跑通；正式上线前必须替换。
 */

const sha256 = require('./sha256');   // 纯 JS SHA-256（下方文件）

// ───────────────────────── 工具：字节 / Base64 ─────────────────────────
function _strToBytes(s) {
  // UTF-8 编码
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
  let s = '', i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0) s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const o  = cp - 0x10000;
      s += String.fromCharCode(0xd800 | (o >> 10)) + String.fromCharCode(0xdc00 | (o & 0x3ff));
    }
  }
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _bytesToB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i], b2 = bytes[i+1], b3 = bytes[i+2];
    out += B64[b1 >> 2];
    out += B64[((b1 & 3) << 4) | ((b2 || 0) >> 4)];
    out += (b2 === undefined) ? '=' : B64[((b2 & 15) << 2) | ((b3 || 0) >> 6)];
    out += (b3 === undefined) ? '=' : B64[b3 & 63];
  }
  return out;
}
function _b64ToBytes(s) {
  s = s.replace(/=+$/, '');
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const c1 = B64.indexOf(s[i]),     c2 = B64.indexOf(s[i+1]);
    const c3 = i+2 < s.length ? B64.indexOf(s[i+2]) : -1;
    const c4 = i+3 < s.length ? B64.indexOf(s[i+3]) : -1;
    out.push((c1 << 2) | (c2 >> 4));
    if (c3 >= 0) out.push(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 >= 0) out.push(((c3 & 3) << 6) | c4);
  }
  return out;
}

function _bytesToHex(bytes) {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}
function _hexToBytes(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function _randomBytes(n) {
  const out = new Array(n);
  if (typeof wx !== 'undefined' && wx.getRandomValues) {
    // 微信原生 API（异步），先用 Math.random 兜底；正式版改异步
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function _xorBytes(a, b) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i % b.length];
  return out;
}

// ───────────────────────── HMAC-SHA256 ─────────────────────────
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

// ───────────────────────── PBKDF2-SHA256 ─────────────────────────
function pbkdf2(password, salt, iterations, dkLenBytes) {
  const pwd  = _strToBytes(password);
  const slt  = typeof salt === 'string' ? _strToBytes(salt) : salt;
  const hLen = 32; // SHA-256
  const blocks = Math.ceil(dkLenBytes / hLen);
  const result = [];

  for (let i = 1; i <= blocks; i++) {
    const blk = slt.concat([(i >> 24) & 0xff, (i >> 16) & 0xff, (i >> 8) & 0xff, i & 0xff]);
    let u = _hmacSha256(pwd, blk);
    let t = u.slice();
    for (let j = 1; j < iterations; j++) {
      u = _hmacSha256(pwd, u);
      for (let k = 0; k < t.length; k++) t[k] ^= u[k];
    }
    result.push(...t);
  }
  return result.slice(0, dkLenBytes);
}

// ───────────────────────── 主密钥派生 ─────────────────────────
/**
 * 由"同步密码 + 用户 ID"派生 32 字节主密钥。
 * @param {string} password 用户设置的同步密码
 * @param {string} userId   登录后服务端返回的 userId（充当 salt）
 * @returns {number[]} 32 字节
 */
function deriveMasterKey(password, userId) {
  const salt = 'hrp-wxmp-v1::' + userId;
  return pbkdf2(password, salt, 10000, 32);
}

// ───────────────────────── 加密 / 解密（占位）─────────────────────────
function _encryptRaw(keyBytes, ivBytes, plainBytes) {
  // ⚠️ 占位实现：HKDF-like 流密码（HMAC(key, iv||counter) ⊕ plain）
  // 正式版替换为 AES-256-CBC（CryptoJS）
  const blocks = Math.ceil(plainBytes.length / 32);
  const stream = [];
  for (let i = 0; i < blocks; i++) {
    const ctr = ivBytes.concat([(i >> 24) & 0xff, (i >> 16) & 0xff, (i >> 8) & 0xff, i & 0xff]);
    stream.push(..._hmacSha256(keyBytes, ctr));
  }
  return _xorBytes(plainBytes, stream.slice(0, plainBytes.length));
}
function _decryptRaw(keyBytes, ivBytes, cipherBytes) {
  return _encryptRaw(keyBytes, ivBytes, cipherBytes); // 流密码可逆
}

/**
 * 加密 JSON 对象。
 * @param {object} plainObj
 * @param {number[]} keyBytes 32 字节主密钥
 * @returns {{cipher:string, iv:string, tag:string, alg:string}}
 */
function encryptJson(plainObj, keyBytes) {
  const iv = _randomBytes(16);
  const plain = _strToBytes(JSON.stringify(plainObj));
  const cipher = _encryptRaw(keyBytes, iv, plain);

  // HMAC-SHA256 完整性校验，截断到 16 字节做 tag
  const tag = _hmacSha256(keyBytes, iv.concat(cipher)).slice(0, 16);

  return {
    cipher: _bytesToB64(cipher),
    iv:     _bytesToB64(iv),
    tag:    _bytesToB64(tag),
    alg:    'xor-hmac:v1-wxmp'
  };
}

/**
 * 解密 JSON 对象（校验 tag）。
 */
function decryptJson({ cipher, iv, tag }, keyBytes) {
  const cBytes  = _b64ToBytes(cipher);
  const ivBytes = _b64ToBytes(iv);
  const tagB    = _b64ToBytes(tag);

  const expectedTag = _hmacSha256(keyBytes, ivBytes.concat(cBytes)).slice(0, 16);
  for (let i = 0; i < 16; i++) {
    if (expectedTag[i] !== tagB[i]) throw new Error('完整性校验失败：密钥不匹配或数据被篡改');
  }
  const plain = _decryptRaw(keyBytes, ivBytes, cBytes);
  return JSON.parse(_bytesToStr(plain));
}

module.exports = {
  deriveMasterKey,
  encryptJson,
  decryptJson,
  // 辅助导出
  _bytesToHex, _hexToBytes, _bytesToB64, _b64ToBytes
};
