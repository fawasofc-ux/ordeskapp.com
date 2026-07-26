// Data layer: repository-style API over an in-memory state, persisted two
// ways — localStorage (instant, offline cache) and the encrypted cloud
// document in the private gem-data repo (via sync.js, write-behind). The UI
// only talks to this module. The seed arrives decrypted from auth.js at init
// time; it is never imported in plaintext, so it never lands in the bundle.
//
// state.rev increments on every user mutation; boot reconciles local vs
// cloud by rev (higher wins), so the same books follow you across browsers.

import { schedulePush, reconcile, connectCloud } from './sync.js';
import { nextGemCode } from './engine.js';

const STORAGE_KEY = 'gem-dashboard-v1';

// One-time backfill so books already saved in this browser / the cloud pick up
// gem codes too (the seed alone would only cover a fresh install). Trip 2
// gemstone sales are numbered in date order; the sarong sale is not a gemstone
// and is skipped. Runs once, guarded by a flag, so codes are never renumbered.
function backfillGemCodes(s) {
  if (!s || s.migrations?.gemCodes) return s;
  const targets = s.sales
    .filter((r) => r.tripId === 'trip2' && !r.gemCode && !/sarong/i.test(r.description || ''))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  const codes = new Map();
  let cursor = { ...s, sales: s.sales };
  for (const row of targets) {
    const code = nextGemCode(cursor);
    codes.set(row.id, code);
    // Feed each assignment back in so the next code increments off it.
    cursor = { ...cursor, sales: cursor.sales.map((r) => (r.id === row.id ? { ...r, gemCode: code } : r)) };
  }

  return {
    ...s,
    sales: s.sales.map((r) => (codes.has(r.id) ? { ...r, gemCode: codes.get(r.id) } : r)),
    migrations: { ...(s.migrations || {}), gemCodes: true },
  };
}

let state = null;
let seedCache = null;
const listeners = new Set();

// Called once after login/unlock with the decrypted workbook seed.
// Boots from the local cache instantly, then reconciles with the cloud
// in the background (swapping state in if the cloud copy is newer).
export function initStore(seed) {
  seedCache = seed;
  state = load();
  if (state.rev == null) {
    // Pre-cloud local data: rev 1 if it was ever edited away from the seed,
    // rev 0 if pristine — so existing edits win over the initial cloud doc.
    state = { ...state, rev: JSON.stringify(state) === JSON.stringify(seedCache) ? 0 : 1 };
  }
  applyMigrations();
  reconcile(state).then((cloudState) => {
    if (cloudState) {
      state = cloudState;
      applyMigrations();
    }
  });
}

// Run pending migrations over the current state; if anything changed, treat it
// as a mutation so the codes are persisted and synced like any other edit.
function applyMigrations() {
  const migrated = backfillGemCodes(state);
  if (migrated === state) {
    emit();
    return;
  }
  state = { ...migrated, rev: (state.rev || 0) + 1 };
  emit();
  schedulePush(state);
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load saved data, falling back to seed', e);
  }
  return structuredClone(seedCache);
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function emit() {
  persist();
  listeners.forEach((fn) => fn());
}

// Every user mutation funnels through here: bump rev, persist, sync.
function commit(next) {
  state = { ...next, rev: (state.rev || 0) + 1 };
  emit();
  schedulePush(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

const newId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// collection: 'sales' | 'purchases' | 'expenses' | 'draws' | 'capital' | 'trips'
export function addRow(collection, row) {
  commit({ ...state, [collection]: [...state[collection], { ...row, id: newId() }] });
}

export function updateRow(collection, id, patch) {
  commit({
    ...state,
    [collection]: state[collection].map((r) => (r.id === id ? { ...r, ...patch } : r)),
  });
}

export function deleteRow(collection, id) {
  commit({ ...state, [collection]: state[collection].filter((r) => r.id !== id) });
}

export function updateSettings(patch) {
  commit({ ...state, settings: { ...state.settings, ...patch } });
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

// One-time device setup: pasted token → validate, store, first sync.
// Swaps in the cloud state if it is newer than this browser's copy.
export async function connectCloudSync(token) {
  const res = await connectCloud(token, state);
  if (res.ok && res.state) {
    state = res.state;
    emit();
  }
  return res;
}

export function resetToSeed() {
  if (!seedCache) return;
  commit(structuredClone(seedCache));
}
