import React, { useMemo, useState } from 'react';
import { findLegacyData, runMigration } from '../store.js';
import { fmt } from '../format.js';

const LABELS = {
  trips: 'Trips',
  sales: 'Sales',
  purchases: 'Purchases',
  expenses: 'Expenses',
  draws: 'Partner draws',
  capital: 'Capital',
};

// First run against an empty database. Shows exactly what was found in this
// browser before importing anything — no silent writes to the books.
export default function Migrate({ onDone, onSkip }) {
  const legacy = useMemo(() => findLegacyData(), []);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({});
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const data = legacy?.data;
  const totalRows = data ? Object.keys(LABELS).reduce((t, k) => t + (data[k]?.length || 0), 0) : 0;
  const grossSales = data ? (data.sales || []).reduce((t, s) => t + (Number(s.amount) || 0), 0) : 0;

  async function importNow() {
    setBusy(true);
    setError('');
    try {
      const counts = await runMigration(data, (name, n) => setProgress((p) => ({ ...p, [name]: n })));
      setDone(counts);
    } catch (e) {
      setError(String(e.message || e));
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="login-wrap">
        <div className="login-box" style={{ maxWidth: 520 }}>
          <div className="logo">GEM<span>·DASH</span></div>
          <span className="subtle">Migration complete</span>
          <table style={{ margin: '18px 0' }}>
            <tbody>
              {Object.keys(LABELS).map((k) => (
                <tr key={k}>
                  <td style={{ textAlign: 'left' }}>{LABELS[k]}</td>
                  <td className="num pos">{fmt(done[k] || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn" style={{ width: '100%' }} onClick={onDone}>
            OPEN DASHBOARD
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-box" style={{ maxWidth: 520 }}>
        <div className="logo">GEM<span>·DASH</span></div>
        <span className="subtle">Your database is empty — first-time setup</span>

        {!legacy ? (
          <>
            <p className="subtle" style={{ textAlign: 'left', lineHeight: 1.6 }}>
              No existing books were found saved in this browser. If your data is in a
              different browser, open the staging page there and migrate from it —
              otherwise you can start with an empty ledger.
            </p>
            <button className="btn ghost" style={{ width: '100%' }} onClick={onSkip}>
              START EMPTY
            </button>
          </>
        ) : (
          <>
            <p className="subtle" style={{ textAlign: 'left', lineHeight: 1.6, marginBottom: 4 }}>
              Found your existing books in this browser. Nothing is written to the
              database until you confirm.
            </p>
            <table style={{ margin: '14px 0' }}>
              <tbody>
                {Object.keys(LABELS).map((k) => (
                  <tr key={k}>
                    <td style={{ textAlign: 'left' }}>{LABELS[k]}</td>
                    <td className="num">{fmt(data[k]?.length || 0)} rows</td>
                    <td className="num pos" style={{ width: 60 }}>
                      {progress[k] != null ? '✓' : ''}
                    </td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td style={{ textAlign: 'left' }}>Total</td>
                  <td className="num">{fmt(totalRows)} rows</td>
                  <td />
                </tr>
              </tbody>
            </table>
            <div className="subtle" style={{ textAlign: 'left', marginBottom: 14, fontSize: 11 }}>
              Gross sales in this copy: <span className="cy">LKR {fmt(grossSales)}</span> — check this
              matches your dashboard before importing.
            </div>
            <button className="btn" style={{ width: '100%' }} onClick={importNow} disabled={busy}>
              {busy ? 'importing…' : `IMPORT ${fmt(totalRows)} ROWS INTO DATABASE`}
            </button>
            <button
              className="btn ghost"
              style={{ width: '100%', marginTop: 8 }}
              onClick={onSkip}
              disabled={busy}
            >
              skip — start empty
            </button>
            <div className="subtle" style={{ marginTop: 10, fontSize: 11 }}>
              Your browser copy is left untouched, so this can be retried safely.
            </div>
          </>
        )}
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}
