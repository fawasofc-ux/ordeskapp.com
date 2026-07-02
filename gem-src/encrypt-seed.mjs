// Build tool: encrypts src/seed.js → src/seed.enc.json with AES-256-GCM,
// key derived from the admin password via PBKDF2. The plaintext seed.js is
// gitignored; only the ciphertext ships in the public bundle.
// Usage: node encrypt-seed.mjs <password>

import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { seedData } from './src/seed.js';

const password = process.argv[2];
if (!password) {
  console.error('usage: node encrypt-seed.mjs <password>');
  process.exit(1);
}

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));

const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt'],
);
const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(seedData)));

const b64 = (buf) => Buffer.from(buf).toString('base64');
writeFileSync(
  new URL('./src/seed.enc.json', import.meta.url),
  JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256-210000', salt: b64(salt), iv: b64(iv), data: b64(ciphertext) }),
);
console.log('Encrypted seed written to src/seed.enc.json');
