// Access gate + data encryption for a static page.
// The seed ledger data ships only as AES-256-GCM ciphertext (seed.enc.json);
// the key is derived from the admin password with PBKDF2, so the public
// bundle never contains the plaintext financial figures. Login is
// additionally checked as a SHA-256 hash of "username:password". The same
// derived key encrypts every document written to the cloud data repo
// (sync.js) — data at rest there is ciphertext too.

import encSeed from './seed.enc.json';

const CRED_HASH = 'b535618fb474a44e08f0a958dbf2c5646a70e4144e652ef2e6b60473d763715e';
const SESSION_KEY = 'gem-auth-v1';
const DATA_KEY = 'gem-datakey-v1';

// PBKDF2 work factor — must match encrypt-secrets.mjs.
const KDF_ITERATIONS = 600000;

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
    { name: 'PBKDF2', salt: b64ToBytes(encSeed.salt), iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function decryptJson(key, { iv, data }) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(iv) }, key, b64ToBytes(data));
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function login(username, password) {
  const hash = await sha256(`${username.trim()}:${password}`);
  if (hash !== CRED_HASH) return false;
  try {
    const key = await deriveKey(password);
    await decryptJson(key, encSeed); // proves the key is right before storing it
    sessionStorage.setItem(SESSION_KEY, hash);
    sessionStorage.setItem(DATA_KEY, bytesToB64(await crypto.subtle.exportKey('raw', key)));
    return true;
  } catch {
    return false;
  }
}

// The session's AES key (after login / on reload) — used for the seed and
// for encrypting/decrypting cloud documents.
export async function getDataKey() {
  const raw = sessionStorage.getItem(DATA_KEY);
  if (!raw) return null;
  try {
    return await crypto.subtle.importKey('raw', b64ToBytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

// Decrypt the seed using the session's stored key (after login / on reload).
export async function loadSeed() {
  const key = await getDataKey();
  if (!key) return null;
  try {
    return await decryptJson(key, encSeed);
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
