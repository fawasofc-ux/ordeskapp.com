import React from 'react';
import { updateSettings, reloadFromDb } from '../store.js';
import { fmt } from '../format.js';

// Inventory (auto from lots, or manual override), actual bank, profit shares.
export default function SettingsPanel({ settings, liq }) {
  const shareTotal = Object.values(settings.shares).reduce((t, v) => t + (Number(v) || 0), 0);
  const auto = liq.inventoryMode === 'auto';

  return (
    <div className="panel span4">
      <h3>Manual Inputs & Settings</h3>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>
          Inventory on hand (LKR){' '}
          {auto ? <span className="pos">— auto from gem lots</span> : <span className="amb">— manual override</span>}
        </label>
        {auto ? (
          <input type="number" value={Math.round(liq.inventoryAuto * 100) / 100} readOnly tabIndex={-1} />
        ) : (
          <input
            type="number"
            value={settings.inventoryEstimate}
            onChange={(e) => updateSettings({ inventoryEstimate: Number(e.target.value) || 0 })}
          />
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => updateSettings({ inventoryMode: e.target.checked ? 'auto' : 'manual' })}
          />
          Calculate from remaining lot pieces × unit price
        </label>
        {!auto && (
          <div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>
            Lots currently value at <span className="cy">{fmt(liq.inventoryAuto)}</span>
          </div>
        )}
      </div>
      <div className="field" style={{ marginBottom: 16 }}>
        <label>Actual bank balance (LKR) — reconciled by hand</label>
        <input
          type="number"
          value={settings.actualBank}
          onChange={(e) => updateSettings({ actualBank: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="field">
        <label>Profit share % {shareTotal !== 100 && <span className="amb">(total {shareTotal}% — should be 100%)</span>}</label>
        {settings.partners.map((p) => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 70, fontSize: 13 }}>{p}</span>
            <input
              type="number"
              min="0"
              max="100"
              value={settings.shares[p] ?? 0}
              onChange={(e) => updateSettings({ shares: { ...settings.shares, [p]: Number(e.target.value) || 0 } })}
            />
          </div>
        ))}
      </div>
      <div className="subtle" style={{ marginTop: 14 }}>
        Everything else on this page is computed live from ledger entries.
        {/* Pulls a fresh copy from Postgres. Deliberately not a "wipe and
            reseed" button — against a real database that is a foot-gun. */}
        <button
          className="btn ghost icon"
          style={{ marginTop: 10, display: 'block' }}
          onClick={() => reloadFromDb().catch((e) => alert(`Reload failed: ${e.message || e}`))}
        >
          Reload from database
        </button>
      </div>
    </div>
  );
}
