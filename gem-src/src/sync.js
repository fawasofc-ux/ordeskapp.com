// Cloud database: an encrypted document in the private fawasofc-ux/gem-data
// GitHub repo, read/written via the Contents API. Every mutation in the store
// is debounced and pushed as AES-256-GCM ciphertext (key = the session data
// key from auth.js), so GitHub only ever stores ciphertext — and every write
// is a git commit, giving free point-in-time history of the books.
//
// Concurrency model: single owner, last-write-wins. Documents carry a
// monotonically increasing `rev`; on boot the higher rev (local vs cloud)
// wins. A 409/422 on PUT (stale sha) refetches and retries once.
//
// The GitHub token is NEVER shipped in the public bundle. It is pasted once
// per device (a fine-grained PAT scoped to just the gem-data repo) and kept
// in this browser's localStorage. Without it the app still works fully,
// saving locally — the header pill shows "connect cloud".

import { getDataKey } from './auth.js';

const REPO = 'fawasofc-ux/gem-data';
const FILE = 'data.json';
const API = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
const TOKEN_LS = 'gem-synctoken-v1';

export function getSyncToken() {
  return localStorage.getItem(TOKEN_LS) || null;
}

export function clearSyncToken() {
  localStorage.removeItem(TOKEN_LS);
  setStatus('nokey');
}

const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
// Contents API base64 payloads are line-wrapped; atob chokes on newlines.
const cleanB64 = (s) => s.replace(/\s/g, '');
const utf8ToB64 = (s) => bytesToB64(new TextEncoder().encode(s));

let lastSha = null; // sha of the blob we last saw — required by the PUT API

// ---- status (subscribable, drives the header pill) ----
// 'boot' | 'nokey' | 'syncing' | 'synced' | 'offline' | 'error'
let status = 'boot';
let statusDetail = '';
const statusListeners = new Set();

function setStatus(next, detail = '') {
  status = next;
  statusDetail = detail;
  statusListeners.forEach((fn) => fn());
}

export function subscribeSync(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function getSyncStatus() {
  return status;
}

export function getSyncDetail() {
  return statusDetail;
}

function headers() {
  return {
    Authorization: `Bearer ${getSyncToken()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function encryptState(state) {
  const key = await getDataKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(state));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { iv: bytesToB64(iv), data: bytesToB64(cipher) };
}

async function decryptDoc(doc) {
  const key = await getDataKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(doc.iv) },
    key,
    b64ToBytes(doc.data),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

// Fetch the cloud document. Returns { rev, state } or null if missing/unreachable.
export async function pull() {
  const res = await fetch(`${API}?ref=main&t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
  if (res.status === 404) {
    lastSha = null;
    return null;
  }
  if (!res.ok) throw new Error(`GET ${res.status}`);
  const body = await res.json();
  lastSha = body.sha;
  const doc = JSON.parse(new TextDecoder().decode(b64ToBytes(cleanB64(body.content))));
  const state = await decryptDoc(doc);
  return { rev: doc.rev ?? 0, state };
}

async function putOnce(state) {
  const { iv, data } = await encryptState(state);
  const doc = { v: 1, rev: state.rev ?? 0, updatedAt: new Date().toISOString(), iv, data };
  const res = await fetch(API, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({
      message: `rev ${doc.rev}`,
      content: utf8ToB64(JSON.stringify(doc)),
      branch: 'main',
      ...(lastSha ? { sha: lastSha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`PUT ${res.status}`);
  const body = await res.json();
  lastSha = body.content.sha;
}

async function push(state) {
  try {
    await putOnce(state);
  } catch (e) {
    // Stale sha (parallel write) — refetch the sha and retry once, LWW.
    if (String(e.message).match(/409|422/)) {
      const res = await fetch(`${API}?ref=main&t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
      lastSha = res.ok ? (await res.json()).sha : null;
      await putOnce(state);
    } else {
      throw e;
    }
  }
}

// ---- debounced write-behind, wired to the store ----
let timer = null;
let pending = null;
let inflight = false;

export function schedulePush(state) {
  if (!getSyncToken()) {
    setStatus('nokey');
    return;
  }
  pending = state;
  setStatus('syncing');
  clearTimeout(timer);
  timer = setTimeout(flush, 1200);
}

export async function flush() {
  clearTimeout(timer);
  if (!pending || inflight) return;
  const state = pending;
  pending = null;
  inflight = true;
  try {
    await push(state);
    setStatus(pending ? 'syncing' : 'synced');
  } catch (e) {
    pending = pending || state; // keep it queued for retry
    setStatus(navigator.onLine === false ? 'offline' : 'error', String(e.message || e));
    setTimeout(flush, 15000); // retry
  } finally {
    inflight = false;
    if (pending) {
      clearTimeout(timer);
      timer = setTimeout(flush, 1200);
    }
  }
}

// Flush pending edits when the tab is hidden/closed (best effort).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('online', () => flush());
}

// One-time device setup: validate the pasted token against the data repo,
// store it, then reconcile. Returns { ok, state?, error? } — state is set
// when the cloud copy is newer and should replace local.
export async function connectCloud(token, localState) {
  const probe = await fetch(`https://api.github.com/repos/${REPO}?t=${Date.now()}`, {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  }).catch(() => null);
  if (!probe || !probe.ok) {
    return {
      ok: false,
      error: probe
        ? `Token rejected (HTTP ${probe.status}). It needs read/write Contents access to ${REPO}.`
        : 'Network error — could not reach GitHub.',
    };
  }
  localStorage.setItem(TOKEN_LS, token.trim());
  const state = await reconcile(localState);
  return { ok: true, state };
}

// Boot-time reconcile: compare local state (localStorage) with the cloud doc.
// Higher rev wins. Returns the state the app should use, or null to keep local.
export async function reconcile(localState) {
  if (!getSyncToken()) {
    setStatus('nokey');
    return null;
  }
  try {
    setStatus('syncing');
    const cloud = await pull();
    const localRev = localState?.rev ?? 0;
    if (!cloud) {
      // No cloud doc yet — first boot ever: publish local.
      schedulePush(localState);
      return null;
    }
    if (cloud.rev > localRev) {
      setStatus('synced');
      return { ...cloud.state, rev: cloud.rev };
    }
    if (localRev > cloud.rev) {
      schedulePush(localState); // local has unsynced edits — publish them
      return null;
    }
    setStatus('synced');
    return null; // in sync
  } catch (e) {
    setStatus(navigator.onLine === false ? 'offline' : 'error', String(e.message || e));
    return null; // work local-only; retries happen on next mutation
  }
}
