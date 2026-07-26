import React, { useState } from 'react';
import { SUPABASE_URL, setAnonKey } from '../supabase.js';

// Shown only when no anon key was baked into the build. Lets the deploy be
// tested before the key is committed. The anon key is public by design —
// it grants nothing on its own; row level security is the real gate.
export default function SetupKey({ onDone }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('sb_secret') || trimmed.includes('service_role')) {
      setError('That looks like the SERVICE ROLE key — it bypasses all security. Use the anon / publishable key.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Prove the key actually talks to this project before storing it.
      const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: trimmed } });
      if (!res.ok) throw new Error(`Supabase rejected the key (HTTP ${res.status})`);
      setAnonKey(trimmed);
      onDone();
    } catch (ex) {
      setError(String(ex.message || ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-box" onSubmit={submit} style={{ maxWidth: 460 }}>
        <div className="logo">GEM<span>·DASH</span></div>
        <span className="subtle">Staging — one-time connection setup</span>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>Supabase anon / publishable key</label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="eyJhbGciOi… or sb_publishable_…"
            autoFocus
          />
          <div className="subtle" style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5 }}>
            Supabase dashboard → <b>Project Settings → API Keys</b> → copy the{' '}
            <b>anon / publishable</b> key. Never paste the <b>service_role</b> key
            into a web page — it bypasses every security rule.
          </div>
        </div>
        <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
          {busy ? 'checking…' : 'CONNECT'}
        </button>
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  );
}
