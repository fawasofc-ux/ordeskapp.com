// Data layer: the single thing the UI talks to. Postgres (Supabase) is the
// source of truth; localStorage is kept purely as an offline read cache so the
// dashboard still renders without a connection.
//
// Writes are optimistic — the UI updates instantly, then the row goes to the
// database. If that write fails the local change is rolled back and the error
// surfaced, because a books app must never show a number it did not save.

import * as db from './db.js';
import { assignMissingLotIds, assignMissingSaleLots } from './engine.js';

// The offline cache is keyed per account. A single shared key meant a second
// business signing in on the same browser could be shown the first one's books
// whenever the database read failed — the cache had no idea whose data it held.
const CACHE_PREFIX = 'gem-dashboard-cache-v2';
const cacheKey = () => (ownerId ? `${CACHE_PREFIX}:${ownerId}` : null);

// Legacy (pre-database) books live under this key. Once an account has claimed
// them they are never offered again, so a second business is not invited to
// import the first one's ledger.
const LEGACY_OWNER_KEY = 'gem-legacy-owner';

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
  const key = cacheKey();
  if (key) {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* cache is best-effort */
    }
  }
  listeners.forEach((fn) => fn());
}

// Only ever returns the signed-in account's own cache.
function readCache() {
  const key = cacheKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---- boot ----

export async function initStore(userId) {
  ownerId = userId;
  setStatus('loading');
  // Drop the old un-keyed cache from before caches were per-account, so no
  // ownerless copy of anyone's books is left lying in the browser.
  try { localStorage.removeItem(CACHE_PREFIX); } catch { /* ignore */ }
  try {
    const loaded = await db.loadAll();
    state = { ...loaded, settings: loaded.settings || DEFAULT_SETTINGS };
    emit();
    setStatus('ready');
    startRealtime();
    await backfillLotIds();
    await backfillSaleLots();
    const empty = db.isEmpty(loaded);
    // An account that already holds books has clearly done its import, so it
    // claims the legacy copy — a later account will not be offered it.
    if (!empty) claimLegacyData();
    return { empty };
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

// Purchases recorded before lot ids existed get one assigned in date order and
// written back, so every lot is identifiable. Runs once — after the first pass
// nothing is missing, so it is a no-op on subsequent loads.
async function backfillLotIds() {
  const result = assignMissingLotIds(state.purchases || []);
  if (!result) return;
  const previous = state;
  state = { ...state, purchases: result.purchases };
  emit();
  try {
    for (const [rowId, lotId] of result.assigned) {
      const row = result.purchases.find((p) => p.id === rowId);
      await db.updateRowDb('purchases', rowId, row);
    }
  } catch (e) {
    state = previous; // leave them unassigned rather than half-written
    emit();
    setStatus('error', `Could not assign lot ids: ${e.message || e}`);
  }
}

// Sales recorded before lots were tracked get classified once: the legacy
// trip's gem sales take a lot (by description rule) and one piece of qty,
// while non-gem rows are pinned to qty 0 so they never move stock.
async function backfillSaleLots() {
  const result = assignMissingSaleLots(state.sales || []);
  if (!result) return;
  const previous = state;
  state = { ...state, sales: result.sales };
  emit();
  try {
    for (const rowId of result.assigned.keys()) {
      await db.updateRowDb('sales', rowId, result.sales.find((s) => s.id === rowId));
    }
  } catch (e) {
    state = previous;
    emit();
    setStatus('error', `Could not assign sale lots: ${e.message || e}`);
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
  // Signing out should leave no copy of that account's books behind, so the
  // next account on this browser cannot be shown them.
  const key = cacheKey();
  if (key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
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

// Records which account the legacy books belong to. The raw data is left in
// place as a backup; it simply stops being offered to anyone else.
function claimLegacyData() {
  if (!ownerId) return;
  try {
    if (!localStorage.getItem(LEGACY_OWNER_KEY)) {
      localStorage.setItem(LEGACY_OWNER_KEY, ownerId);
    }
  } catch {
    /* best effort */
  }
}

// The old app stored plaintext state under gem-dashboard-v1 on this same
// origin, so the first account can import the real books directly. Offered
// only to the account that already owns them — a second business signing in
// on this browser must never be invited to import the first one's ledger.
export function findLegacyData() {
  let claimedBy = null;
  try {
    claimedBy = localStorage.getItem(LEGACY_OWNER_KEY);
  } catch {
    /* ignore */
  }
  if (claimedBy && claimedBy !== ownerId) return null;

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
  // Assign lot ids before upload so they land with the initial insert rather
  // than needing a second pass of updates afterwards.
  const withLots = assignMissingLotIds(legacyState.purchases || []);
  const withSaleLots = assignMissingSaleLots(legacyState.sales || []);
  const prepared = {
    ...legacyState,
    ...(withLots ? { purchases: withLots.purchases } : {}),
    ...(withSaleLots ? { sales: withSaleLots.sales } : {}),
  };
  const counts = await db.migrateLocalState(prepared, ownerId, onProgress);
  claimLegacyData(); // imported once; never offered to another account
  await reloadFromDb();
  return counts;
}
