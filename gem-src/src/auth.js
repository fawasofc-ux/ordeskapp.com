// Access gate + data encryption for a static page.
// The seed ledger data ships only as AES-256-GCM ciphertext (seed.enc.json);
// the decryption key is derived from the admin password with PBKDF2, so the
// public bundle never contains the plaintext financial figures. Credentials
// are additionally checked as a SHA-256 hash of "username:password".

import encSeed from './seed.enc.json';

const CRED_HASH = 'b535618fb474a44e08f0a958dbf2c5646a70e4144e652ef2e6b60473d763715e';
const SESSION_KEY = 'gem-auth-v1';
const DATA_KEY = 'gem-datakey-v1';

const enc = new TextEncoder();
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(password) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBytes(encSeed.salt), iterations: 210000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt'],
  );
}

async function decryptSeed(key) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(encSeed.iv) }, key, b64ToBytes(encSeed.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function login(username, password) {
  const hash = await sha256(`${username.trim()}:${password}`);
  if (hash !== CRED_HASH) return false;
  try {
    const key = await deriveKey(password);
    await decryptSeed(key); // proves the key is right before storing it
    sessionStorage.setItem(SESSION_KEY, hash);
    sessionStorage.setItem(DATA_KEY, bytesToB64(await crypto.subtle.exportKey('raw', key)));
    return true;
  } catch {
    return false;
  }
}

// Decrypt the seed using the session's stored key (after login / on reload).
export async function loadSeed() {
  const raw = sessionStorage.getItem(DATA_KEY);
  if (!raw) return null;
  try {
    const key = await crypto.subtle.importKey('raw', b64ToBytes(raw), 'AES-GCM', false, ['decrypt']);
    return await decryptSeed(key);
  } catch {
    return null;
  }
}

export function isAuthed() {
  return sessionStorage.getItem(SESSION_KEY) === CRED_HASH && !!sessionStorage.getItem(DATA_KEY);
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(DATA_KEY);
}
