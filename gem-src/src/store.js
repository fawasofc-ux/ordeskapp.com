// Data layer: localStorage-backed store with a small repository-style API.
// The UI only talks to this module, so swapping localStorage for a real
// backend later means reimplementing load/persist — not rewriting the UI.
// The seed arrives decrypted from auth.js at init time; it is never
// imported in plaintext, so it never lands in the public bundle.

const STORAGE_KEY = 'gem-dashboard-v1';

let state = null;
let seedCache = null;
const listeners = new Set();

// Called once after login/unlock with the decrypted workbook seed.
export function initStore(seed) {
  seedCache = seed;
  state = load();
  emit();
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
  state = { ...state, [collection]: [...state[collection], { ...row, id: newId() }] };
  emit();
}

export function updateRow(collection, id, patch) {
  state = {
    ...state,
    [collection]: state[collection].map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
  emit();
}

export function deleteRow(collection, id) {
  state = { ...state, [collection]: state[collection].filter((r) => r.id !== id) };
  emit();
}

export function updateSettings(patch) {
  state = { ...state, settings: { ...state.settings, ...patch } };
  emit();
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

export function resetToSeed() {
  if (!seedCache) return;
  state = structuredClone(seedCache);
  emit();
}
