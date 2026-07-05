// Build tool: encrypts src/seed.js → src/seed.enc.json with AES-256-GCM,
// key derived from the admin password via PBKDF2 (must match KDF_ITERATIONS
// in src/auth.js). The plaintext seed.js is gitignored; only the ciphertext
// ships in the public bundle. NO credentials are ever written to the bundle.
//
// Usage: node encrypt-secrets.mjs <password> [--clouddoc]
//   --clouddoc also writes clouddoc.json — the encrypted initial cloud
//   document (rev 0) used to seed the private gem-data repo.

import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { seedData } from './src/seed.js';

const KDF_ITERATIONS = 600000; // keep in sync with src/auth.js

const password = process.argv[2];
if (!password) {
  console.error('usage: node encrypt-secrets.mjs <password> [--clouddoc]');
  process.exit(1);
}

const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString('base64');

// Reuse the existing salt when only rotating one artifact; else fresh.
const seedPath = new URL('./src/seed.enc.json', import.meta.url);
let salt;
const prev = existsSync(seedPath) ? JSON.parse(readFileSync(seedPath, 'utf8')) : null;
if (prev?.kdf === `PBKDF2-SHA256-${KDF_ITERATIONS}`) {
  salt = Buffer.from(prev.salt, 'base64');
  console.log('Reusing existing salt (same KDF params)');
} else {
  salt = crypto.getRandomValues(new Uint8Array(16));
  console.log('New salt generated');
}

const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt'],
);

async function encrypt(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), data: b64(cipher) };
}

// 1) Seed
const seedEnc = await encrypt(seedData);
writeFileSync(
  seedPath,
  JSON.stringify({ v: 2, kdf: `PBKDF2-SHA256-${KDF_ITERATIONS}`, salt: b64(salt), ...seedEnc }),
);
console.log('Wrote src/seed.enc.json');

// 2) Initial cloud document (rev 0 = pristine seed) for the gem-data repo
if (process.argv.includes('--clouddoc')) {
  const stateEnc = await encrypt({ ...seedData, rev: 0 });
  const doc = { v: 1, rev: 0, updatedAt: new Date().toISOString(), ...stateEnc };
  writeFileSync(new URL('./clouddoc.json', import.meta.url), JSON.stringify(doc));
  console.log('Wrote clouddoc.json (rev 0)');
}
