import React, { useState } from 'react';
import { signIn } from '../db.js';

// Real accounts now, backed by Supabase Auth — no shared password baked into
// the bundle. The database enforces per-account access on top of this, so a
// stolen page is not a stolen ledger.
export default function Login({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user, error: err } = await signIn(email, password);
      if (user) onSuccess(user);
      else setError(err || 'ACCESS DENIED — invalid credentials');
    } catch (ex) {
      setError(String(ex.message || ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-box" onSubmit={submit}>
        <div className="logo">GEM<span>·DASH</span></div>
        <span className="subtle">Private dashboard — authorised access only</span>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
          {busy ? '…' : 'SIGN IN'}
        </button>
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  );
}
