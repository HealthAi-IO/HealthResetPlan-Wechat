import { gcm } from '@noble/ciphers/aes.js';
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error('invalid hex');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeMnemonic(mnemonic) {
  return String(mnemonic || '').trim().replace(/\s+/g, ' ');
}

export function validateEnglishMnemonic(mnemonic) {
  return validateMnemonic(normalizeMnemonic(mnemonic), wordlist);
}

export function mnemonicToEntropyBytes(mnemonic) {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('助记词不匹配，请核对');
  }
  const entropy = mnemonicToEntropy(normalized, wordlist);
  return typeof entropy === 'string'
    ? Array.from(hexToBytes(entropy))
    : Array.from(entropy);
}

export function entropyBytesToMnemonic(bytes) {
  return entropyToMnemonic(Uint8Array.from(bytes), wordlist);
}

export function aesGcmEncrypt(key, nonce, plaintext) {
  const sealed = gcm(Uint8Array.from(key), Uint8Array.from(nonce)).encrypt(
    Uint8Array.from(plaintext),
  );
  const tagStart = sealed.length - 16;
  return {
    cipher: Array.from(sealed.slice(0, tagStart)),
    tag: Array.from(sealed.slice(tagStart)),
  };
}

export function aesGcmDecrypt(key, nonce, cipher, tag) {
  const sealed = new Uint8Array(cipher.length + tag.length);
  sealed.set(Uint8Array.from(cipher), 0);
  sealed.set(Uint8Array.from(tag), cipher.length);
  return Array.from(
    gcm(Uint8Array.from(key), Uint8Array.from(nonce)).decrypt(sealed),
  );
}

export { bytesToHex, hexToBytes };
