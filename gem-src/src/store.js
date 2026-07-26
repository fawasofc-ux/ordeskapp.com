// Data layer: the single thing the UI talks to. Postgres (Supabase) is the
// source of truth; localStorage is kept purely as an offline read cache so the
// dashboard still renders without a connection.
//
// Writes are optimistic — the UI updates instantly, then the row goes to the
// database. If that write fails the local change is rolled back and the error
// surfaced, because a books app must never show a number it did not save.

import * as db from './db.js';

const CACHE_KEY = 'gem-dashboard-cache-v2';

// Fallback only, for a brand-new empty database. Deliberately carries no real
// partner names: this ships in a public bundle, and the actual partners and
// shares come from the account's own settings row once data is migrated.
export const DEFAULT_SETTINGS = {
  shares: {},
  partners: [],
  categories: ['Processing', 'Export', 'Vehicle', 'Testing', 'Commission', 'Equipment', 'Travel', 'Inventory', 'Misc'],
  inventoryEstimate: 0,
  actualBank: 0,
};

let state = null;
let ownerId = null;
let unsubscribeRealtime = null;
const listeners = new Set();

// ---- status pill ----
// 'loading' | 'ready' | 'saving' | 'error' | 'offline'
let status = 'loading';
let statusDetail = '';
const statusListeners = new Set();

function setStatus(next, detail = '') {
  status = next;
  statusDetail = detail;
  statusListeners.forEach((fn) => fn());
}

export function subscribeStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}
export const getStatus = () => status;
export const getStatusDetail = () => statusDetail;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

function emit() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    /* cache is best-effort */
  }
  listeners.forEach((fn) => fn());
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---- boot ----

export async function initStore(userId) {
  ownerId = userId;
  setStatus('loading');
  try {
    const loaded = await db.loadAll();
    state = { ...loaded, settings: loaded.settings || DEFAULT_SETTINGS };
    emit();
    setStatus('ready');
    startRealtime();
    return { empty: db.isEmpty(loaded) };
  } catch (e) {
    // No connection: fall back to the cached copy so the dashboard still works.
    const cached = readCache();
    if (cached) {
      state = cached;
      emit();
      setStatus('offline', String(e.message || e));
      return { empty: false, offline: true };
    }
    setStatus('error', String(e.message || e));
    throw e;
  }
}

function startRealtime() {
  if (unsubscribeRealtime) unsubscribeRealtime();
  unsubscribeRealtime = db.subscribeRealtime(() => {
    // Another device changed something — re-pull rather than guess.
    db.loadAll()
      .then((loaded) => {
        state = { ...loaded, settings: loaded.settings || DEFAULT_SETTINGS };
        emit();
      })
      .catch(() => {});
  });
}

export async function reloadFromDb() {
  setStatus('loading');
  const loaded = await db.loadAll();
  state = { ...loaded, settings: loaded.settings || DEFAULT_SETTINGS };
  emit();
  setStatus('ready');
}

export function teardown() {
  if (unsubscribeRealtime) unsubscribeRealtime();
  unsubscribeRealtime = null;
  state = null;
  ownerId = null;
}

// ---- writes (optimistic, with rollback) ----

const newId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

async function withRollback(nextState, writeFn) {
  const previous = state;
  state = nextState;
  emit();
  setStatus('saving');
  try {
    await writeFn();
    setStatus('ready');
  } catch (e) {
    state = previous; // never leave an unsaved number on screen
    emit();
    setStatus('error', String(e.message || e));
    alert(`Could not save to the database — the change was undone.\n\n${e.message || e}`);
  }
}

export async function addRow(collection, row) {
  const record = { ...row, id: newId() };
  await withRollback(
    { ...state, [collection]: [...state[collection], record] },
    () => db.insertRow(collection, record),
  );
}

export async function updateRow(collection, id, patch) {
  const merged = { ...state[collection].find((r) => r.id === id), ...patch };
  await withRollback(
    { ...state, [collection]: state[collection].map((r) => (r.id === id ? merged : r)) },
    () => db.updateRowDb(collection, id, merged),
  );
}

export async function deleteRow(collection, id) {
  await withRollback(
    { ...state, [collection]: state[collection].filter((r) => r.id !== id) },
    () => db.deleteRowDb(collection, id),
  );
}

export async function updateSettings(patch) {
  const next = { ...state.settings, ...patch };
  await withRollback({ ...state, settings: next }, () => db.saveSettings(next, ownerId));
}

export function addCategory(name) {
  const cats = state.settings.categories;
  if (!name || cats.includes(name)) return;
  updateSettings({ categories: [...cats, name] });
}

export function addPartner(name, sharePct = 0) {
  const { partners, shares } = state.settings;
  if (!name || partners.includes(name)) return;
  updateSettings({ partners: [...partners, name], shares: { ...shares, [name]: sharePct } });
}

// ---- migration from the pre-database browser copy ----

const LEGACY_KEYS = ['gem-dashboard-v1'];

// The old app stored plaintext state under gem-dashboard-v1 on this same
// origin, so the staging build can read the real books directly.
export function findLegacyData() {
  for (const key of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.sales)) return { key, data: parsed };
    } catch {
      /* ignore malformed */
    }
  }
  return null;
}

export async function runMigration(legacyState, onProgress) {
  setStatus('saving');
  const counts = await db.migrateLocalState(legacyState, ownerId, onProgress);
  await reloadFromDb();
  return counts;
}
