import React, { useMemo, useState } from 'react';
import { fmt } from '../format.js';
import {
  DATASET_KEYS,
  NO_LOT,
  buildDataset,
  buildAllDatasets,
  datasetTotals,
  exportFilename,
  exportableTrips,
  toCsv,
  toJson,
} from '../exporters.js';

const PREVIEW_ROWS = 8;

// Downloads a string as a file. The object URL is revoked on the next tick —
// revoking it synchronously can cancel the download in Safari.
function downloadText(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Datasets that can carry a lot filter. The lot register is itself one row per
// lot, so "no lot" cannot apply to it.
const LOT_FILTERABLE = new Set(['sales', 'purchases', 'expenses']);

export default function ExportPanel({ data, tripFilter }) {
  const [key, setKey] = useState('lots');
  const [lotId, setLotId] = useState('');
  const [format, setFormat] = useState('csv');
  const [note, setNote] = useState('');

  const trips = useMemo(() => exportableTrips(data), [data]);
  const tripIds = useMemo(() => new Set(trips.map((t) => t.id)), [trips]);

  // Scope follows the trip chips at the top of the dashboard, so the export
  // never quietly covers a different period than the figures above it. A chip
  // on a trip that predates lot tracking falls back to every exportable trip
  // and says so rather than offering an empty file.
  const scopeTripId = tripFilter && tripIds.has(tripFilter) ? tripFilter : '';
  const outOfScopeTrip = tripFilter && !tripIds.has(tripFilter)
    ? data.trips.find((t) => t.id === tripFilter)
    : null;
  const firstTripName = trips[0]?.name || '';
  const scopeLabel = scopeTripId
    ? data.trips.find((t) => t.id === scopeTripId)?.name || ''
    : `All trips (${firstTripName} onwards)`;

  const lotOptions = useMemo(
    () =>
      [...new Set(
        (data.purchases || [])
          .filter((p) => tripIds.has(p.tripId) && p.lotId)
          .map((p) => p.lotId),
      )].sort(),
    [data.purchases, tripIds],
  );

  // Two ways a held filter stops making sense: "no gem lot" cannot apply to a
  // register of gem lots, and a lot id stops existing when the trip scope
  // changes under it. Both fall back to everything rather than leaving the
  // select blank over an empty table.
  const activeLot = lotId === NO_LOT
    ? (LOT_FILTERABLE.has(key) ? NO_LOT : '')
    : (lotId && lotOptions.includes(lotId) ? lotId : '');
  const opts = { tripId: scopeTripId, lotId: activeLot };

  const dataset = useMemo(
    () => (trips.length ? buildDataset(data, key, opts) : null),
    [data, key, scopeTripId, activeLot, trips.length],
  );
  // Every dataset for the current scope, built once: it supplies the tab
  // labels and the unfiltered row count behind each tab.
  const summaries = useMemo(
    () => (trips.length ? buildAllDatasets(data, { tripId: scopeTripId }) : []),
    [data, scopeTripId, trips.length],
  );

  if (!trips.length) {
    return (
      <div className="panel span12">
        <h3>Export &amp; Reports</h3>
        <div className="subtle">
          Nothing to export yet. Exports are built on gem lots, so they begin with the first trip
          that records a purchased lot with a piece count.
        </div>
      </div>
    );
  }

  const totals = datasetTotals(dataset);
  const preview = dataset.rows.slice(0, PREVIEW_ROWS);
  const meta = { scope: scopeLabel, lot: activeLot || 'all', generatedAt: new Date().toISOString() };

  function download(ds) {
    const isCsv = format === 'csv';
    downloadText(
      exportFilename(ds.key, scopeLabel, isCsv ? 'csv' : 'json'),
      isCsv ? toCsv(ds) : toJson(ds, meta),
      isCsv ? 'text/csv' : 'application/json',
    );
  }

  function downloadOne() {
    download(dataset);
    setNote(`${dataset.label} — ${dataset.rows.length} row${dataset.rows.length === 1 ? '' : 's'} downloaded.`);
  }

  // Four files, staggered: browsers treat a burst of downloads as a popup and
  // silently drop all but the first.
  function downloadAll() {
    const all = buildAllDatasets(data, { tripId: scopeTripId });
    all.forEach((ds, i) => setTimeout(() => download(ds), i * 400));
    setNote(`${all.length} files downloading — ${all.map((s) => s.label).join(', ')}. Your browser may ask to allow multiple downloads.`);
  }

  return (
    <div className="panel span12">
      <h3>Export &amp; Reports — {scopeLabel}</h3>

      {outOfScopeTrip && (
        <div className="badge warn" style={{ display: 'block', marginBottom: 12, lineHeight: 1.6 }}>
          {outOfScopeTrip.name} predates gem-lot tracking — it holds no piece-tracked lot, so no
          per-lot figures exist for it. Exporting <b>{scopeLabel}</b> instead.
        </div>
      )}

      <div className="tabs">
        {summaries.map((s) => (
          <button
            key={s.key}
            className={`tab${key === s.key ? ' active' : ''}`}
            onClick={() => { setKey(s.key); setNote(''); }}
          >
            {s.label}
            <span style={{ opacity: 0.5, marginLeft: 6 }}>{s.rows.length}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <select value={activeLot} onChange={(e) => setLotId(e.target.value)} title="Filter by gem lot">
          <option value="">All rows</option>
          {lotOptions.map((l) => (
            <option key={l} value={l}>{l} only</option>
          ))}
          {LOT_FILTERABLE.has(key) && <option value={NO_LOT}>No gem lot</option>}
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value)} title="File format">
          <option value="csv">CSV — Excel, Sheets, pandas</option>
          <option value="json">JSON — dataset with column types</option>
        </select>
        <span className="subtle">
          {dataset.rows.length} row{dataset.rows.length === 1 ? '' : 's'} · {dataset.columns.length} columns
        </span>
        <div className="spacer" />
        {note && <span className="pos" style={{ fontSize: 11 }}>{note}</span>}
        <button className="btn" onClick={downloadOne} disabled={!dataset.rows.length}>
          ↓ {dataset.label} ({format.toUpperCase()})
        </button>
        <button
          className="btn ghost"
          onClick={downloadAll}
          title={`All four datasets for ${scopeLabel}, one file each — unfiltered, whatever the lot filter shows`}
        >
          ↓ All {DATASET_KEYS.length} files
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              {dataset.columns.map((c) => (
                <th key={c.key} className={c.type === 'number' ? 'num' : ''}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((r, i) => (
              <tr key={i}>
                {dataset.columns.map((c) => {
                  const v = r[c.key];
                  const blank = v === '' || v == null;
                  return (
                    <td key={c.key} className={c.type === 'number' ? 'num' : ''}>
                      {blank ? <span className="subtle">—</span>
                        : c.type === 'number' ? fmt(v)
                        : c.key === 'lotId' ? <span className="gemcode">{v}</span>
                        : v}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!dataset.rows.length && (
              <tr><td colSpan={dataset.columns.length} className="subtle">No rows in this scope.</td></tr>
            )}
            {/* Totals are shown here and deliberately kept out of the file —
                a TOTAL line in a CSV reads back as another data row. */}
            {dataset.rows.length > 0 && (
              <tr className="total-row">
                {dataset.columns.map((c, i) => (
                  <td key={c.key} className={c.type === 'number' ? 'num' : ''}>
                    {i === 0 ? `TOTAL (${dataset.rows.length} rows)` : c.key in totals ? fmt(totals[c.key]) : ''}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dataset.rows.length > PREVIEW_ROWS && (
        <div className="subtle" style={{ marginTop: 8 }}>
          Preview shows the first {PREVIEW_ROWS} of {dataset.rows.length} rows — the file contains all of them.
        </div>
      )}

      <div className="subtle" style={{ marginTop: 10, lineHeight: 1.7 }}>
        Exports cover <b>{firstTripName} onwards</b>. Trip 1 was bought as one untracked lot with no
        piece count, so no per-lot cost, stock or margin can be derived for it and it is left out of
        every file rather than exported as zeroes. Scope follows the trip chips at the top of the page.
        Money is written to the cent with no thousands separators, dates as YYYY-MM-DD, and the TOTAL
        row above is <b>not</b> written into the file — so a spreadsheet or dataframe reads every line
        as data. <b>Gem Lots</b> is the lot register: one row per lot with its cost, unit cost, pieces
        sold and remaining, revenue, direct expenses and realised margin. Sales, Purchases and Expenses
        each carry their lot id, so any of them can be pivoted by lot.
      </div>
    </div>
  );
}
