import React from 'react';
import { updateSettings, resetToSeed } from '../store.js';

// The two manual inputs (inventory estimate, actual bank) + profit shares.
export default function SettingsPanel({ settings }) {
  const shareTotal = Object.values(settings.shares).reduce((t, v) => t + (Number(v) || 0), 0);

  return (
    <div className="panel span4">
      <h3>Manual Inputs & Settings</h3>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>Inventory on hand (LKR) — manual estimate</label>
        <input
          type="number"
          value={settings.inventoryEstimate}
          onChange={(e) => updateSettings({ inventoryEstimate: Number(e.target.value) || 0 })}
        />
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
        <button
          className="btn ghost icon"
          style={{ marginTop: 10, display: 'block' }}
          onClick={() => {
            if (confirm('Reset ALL data back to the original workbook seed? All edits will be lost.')) resetToSeed();
          }}
        >
          Reset to workbook seed
        </button>
      </div>
    </div>
  );
}
