// Supabase client. The anon (publishable) key is designed to be public — it
// carries no privileges of its own; row level security in the database is what
// actually protects the data. It can therefore be baked into the bundle.
// Until it is, the app accepts it at runtime so the deploy is testable.
// The service_role key must NEVER appear here: it bypasses RLS entirely.

import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://uylbbmpbfcosupvykats.supabase.co';

const BAKED_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const KEY_LS = 'gem-supabase-anon-key';

export function getAnonKey() {
  return BAKED_KEY || localStorage.getItem(KEY_LS) || '';
}

export function setAnonKey(key) {
  localStorage.setItem(KEY_LS, String(key || '').trim());
  client = null; // force rebuild with the new key
}

export function hasAnonKey() {
  return !!getAnonKey();
}

let client = null;

export function supabase() {
  if (!client) {
    const key = getAnonKey();
    if (!key) throw new Error('Supabase anon key not configured');
    client = createClient(SUPABASE_URL, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}
