// Database layer — Postgres via Supabase, replacing the encrypted-document
// sync. The UI never imports this directly; store.js is still the only thing
// the components talk to, so the swap stayed a data-layer change.
//
// The app speaks camelCase and the database speaks snake_case, so each
// collection declares an explicit mapping both ways. Explicit beats clever
// here: a silent field-name mismatch would lose ledger data.

import { supabase } from './supabase.js';
import { COLLECTIONS } from './mappers.js';

export { COLLECTIONS };

// ---- auth ----

export async function currentUser() {
  const { data } = await supabase().auth.getUser();
  return data?.user || null;
}

export async function signIn(email, password) {
  const { data, error } = await supabase().auth.signInWithPassword({
    email: String(email).trim(),
    password,
  });
  return { user: data?.user || null, error: error?.message || null };
}

export async function signOut() {
  await supabase().auth.signOut();
}

// ---- reads ----

// Pull every ledger in parallel and assemble the same state shape the UI
// already expects, so nothing downstream had to change.
export async function loadAll() {
  const sb = supabase();
  const names = Object.keys(COLLECTIONS);
  const results = await Promise.all(
    names.map((n) => sb.from(COLLECTIONS[n].table).select('*')),
  );
  const settingsRes = await sb.from('gem_settings').select('data').maybeSingle();

  const state = {};
  names.forEach((n, i) => {
    const { data, error } = results[i];
    if (error) throw new Error(`${COLLECTIONS[n].table}: ${error.message}`);
    state[n] = (data || []).map(COLLECTIONS[n].fromDb);
  });
  if (settingsRes.error) throw new Error(`gem_settings: ${settingsRes.error.message}`);
  state.settings = settingsRes.data?.data || null;

  return state;
}

export function isEmpty(state) {
  return Object.keys(COLLECTIONS).every((n) => (state[n] || []).length === 0);
}

// ---- writes ----
// owner is filled by the column default (auth.uid()) so it can never be spoofed.

export async function insertRow(collection, row) {
  const { table, toDb } = COLLECTIONS[collection];
  const { error } = await supabase().from(table).insert(toDb(row));
  if (error) throw new Error(error.message);
}

export async function updateRowDb(collection, id, row) {
  const { table, toDb } = COLLECTIONS[collection];
  const payload = toDb(row);
  delete payload.id;
  const { error } = await supabase().from(table).update(payload).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteRowDb(collection, id) {
  const { table } = COLLECTIONS[collection];
  const { error } = await supabase().from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function saveSettings(settings, ownerId) {
  const { error } = await supabase()
    .from('gem_settings')
    .upsert({ owner: ownerId, data: settings }, { onConflict: 'owner' });
  if (error) throw new Error(error.message);
}

// ---- bulk migration ----

// Push a whole local state into an empty database. Chunked so a large ledger
// cannot exceed the request size, and it reports progress per collection.
export async function migrateLocalState(state, ownerId, onProgress = () => {}) {
  const sb = supabase();
  const counts = {};
  for (const name of Object.keys(COLLECTIONS)) {
    const { table, toDb } = COLLECTIONS[name];
    const rows = (state[name] || []).map(toDb);
    counts[name] = rows.length;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await sb.from(table).upsert(chunk, { onConflict: 'id' });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
    onProgress(name, rows.length);
  }
  if (state.settings) {
    await saveSettings(state.settings, ownerId);
    counts.settings = 1;
  }
  return counts;
}

// ---- realtime ----

// Any change written by another device/tab re-pulls the ledgers, so two
// browsers stay in step without a refresh.
export function subscribeRealtime(onChange) {
  const sb = supabase();
  const channel = sb.channel('gem-changes');
  for (const name of Object.keys(COLLECTIONS)) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: COLLECTIONS[name].table }, onChange);
  }
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'gem_settings' }, onChange);
  channel.subscribe();
  return () => sb.removeChannel(channel);
}
