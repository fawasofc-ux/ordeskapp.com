// Export datasets — the ledgers flattened into plain tables for Excel, pandas
// or any other tool. Pure and free of React so the row shapes and the CSV text
// can be unit-tested: an export that silently drops a row, shifts a column or
// writes a number Excel reads as text is worse than no export at all.
//
// Scope rule: lot accounting began with Trip 2. Trip 1 was bought as a single
// untracked lot with no piece count, so no per-lot figure can exist for it and
// every dataset here starts at the first lot-tracked trip.

import {
  saleNet,
  saleCommission,
  saleAge,
  lotStock,
  purchaseUnitPrice,
} from './engine.js';

// Lot filter sentinels, mirroring the ledger toolbar's own filter.
export const ALL_LOTS = '';
export const NO_LOT = '__none';

// Money is rounded to cents on the way out. The dashboard already displays at
// most 2 decimals, so the file matches the screen, and a raw 20875.694444444
// in a spreadsheet only invites a fake-precision argument later.
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const qtyOf = (r) => Number(r?.qty) || 0;

// Trips that can be exported: the first trip holding a piece-tracked lot, and
// everything after it. Pinned to the data rather than to the id 'trip2', so
// Trip 3 and later follow automatically — including a new trip that has not
// bought its lot yet.
export function exportableTrips(data) {
  const trips = data?.trips || [];
  const lotTrips = new Set(lotStock(data).lots.map((l) => l.tripId));
  const first = trips.findIndex((t) => lotTrips.has(t.id));
  return first < 0 ? [] : trips.slice(first);
}

export function isExportableTrip(data, tripId) {
  return exportableTrips(data).some((t) => t.id === tripId);
}

// Resolves the scope once so every dataset filters identically.
function scope(data, { tripId = '', lotId = ALL_LOTS, now = new Date() } = {}) {
  const trips = exportableTrips(data);
  const tripIds = new Set(trips.map((t) => t.id));
  // A scope pointing at a non-exportable trip (Trip 1) yields nothing rather
  // than quietly widening to every trip.
  const wanted = tripId ? (tripIds.has(tripId) ? new Set([tripId]) : new Set()) : tripIds;
  const name = (id) => data.trips.find((t) => t.id === id)?.name || '';
  return { trips, tripIds: wanted, lotId, now, tripName: name };
}

function inScope(row, s) {
  if (!s.tripIds.has(row.tripId)) return false;
  if (s.lotId === NO_LOT) return !row.lotId;
  if (s.lotId) return row.lotId === s.lotId;
  return true;
}

// ---- datasets -------------------------------------------------------------
//
// Every dataset is { key, label, columns, rows }. Columns carry a `type` so
// the CSV writer knows which cells are numbers (written raw, for the analysis
// tool to parse) and which are text (escaped and formula-guarded).

// One row per gem lot ever purchased — the lot register. Stock and money for
// each lot side by side, which is the view the ledgers can only show a piece
// of at a time.
export function lotsDataset(data, opts = {}) {
  const s = scope(data, opts);
  const byId = new Map((data.purchases || []).map((p) => [p.id, p]));
  const sales = data.sales || [];
  const expenses = data.expenses || [];

  const rows = lotStock(data)
    .lots.filter((l) => s.tripIds.has(l.tripId))
    // A lot row always carries a lot, so "no lot" can only select nothing.
    .filter((l) => (s.lotId === NO_LOT ? false : !s.lotId || l.lotId === s.lotId))
    .map((l) => {
      const live = sales.filter((x) => !x.returned && x.lotId === l.lotId);
      const returned = sales.filter((x) => x.returned && x.lotId === l.lotId);
      const gross = live.reduce((t, x) => t + (Number(x.amount) || 0), 0);
      const net = live.reduce((t, x) => t + saleNet(x), 0);
      const received = live.filter((x) => x.status === 'Received').reduce((t, x) => t + saleNet(x), 0);
      const direct = expenses.filter((e) => e.lotId === l.lotId).reduce((t, e) => t + (Number(e.amount) || 0), 0);
      const costOfSold = l.soldQty * l.unitPrice;
      return {
        lotId: l.lotId,
        trip: s.tripName(l.tripId),
        purchaseDate: l.date,
        description: l.description,
        fundingSource: byId.get(l.id)?.fundingSource || '',
        pieces: l.pieces,
        lotCost: money(l.amount),
        unitCost: money(l.unitPrice),
        piecesSold: l.soldQty,
        piecesReturned: returned.reduce((t, x) => t + qtyOf(x), 0),
        piecesRemaining: l.remaining,
        salesCount: live.length,
        salesGross: money(gross),
        commission: money(live.reduce((t, x) => t + saleCommission(x), 0)),
        salesNet: money(net),
        received: money(received),
        pending: money(net - received),
        costOfSold: money(costOfSold),
        directExpenses: money(direct),
        realisedMargin: money(net - costOfSold - direct),
        remainingValue: money(l.value),
        oversold: l.oversold ? 'YES' : '',
      };
    });

  return {
    key: 'lots',
    label: 'Gem Lots',
    columns: [
      { key: 'lotId', label: 'Lot ID' },
      { key: 'trip', label: 'Trip' },
      { key: 'purchaseDate', label: 'Purchase Date' },
      { key: 'description', label: 'Description' },
      { key: 'fundingSource', label: 'Funding Source' },
      { key: 'pieces', label: 'Pieces', type: 'number' },
      { key: 'lotCost', label: 'Lot Cost', type: 'number' },
      { key: 'unitCost', label: 'Unit Cost', type: 'number', noTotal: true },
      { key: 'piecesSold', label: 'Pieces Sold', type: 'number' },
      { key: 'piecesReturned', label: 'Pieces Returned', type: 'number' },
      { key: 'piecesRemaining', label: 'Pieces Remaining', type: 'number' },
      { key: 'salesCount', label: 'Sales Count', type: 'number' },
      { key: 'salesGross', label: 'Sales Gross', type: 'number' },
      { key: 'commission', label: 'Commission', type: 'number' },
      { key: 'salesNet', label: 'Sales Net', type: 'number' },
      { key: 'received', label: 'Received', type: 'number' },
      { key: 'pending', label: 'Pending', type: 'number' },
      { key: 'costOfSold', label: 'Cost of Pieces Sold', type: 'number' },
      { key: 'directExpenses', label: 'Direct Expenses', type: 'number' },
      { key: 'realisedMargin', label: 'Realised Margin', type: 'number' },
      { key: 'remainingValue', label: 'Remaining Stock Value', type: 'number' },
      { key: 'oversold', label: 'Oversold' },
    ],
    rows,
  };
}

// One row per sale, carrying the lot it came out of and what that piece cost,
// so margin can be read per sale and pivoted per lot.
export function salesDataset(data, opts = {}) {
  const s = scope(data, opts);
  const unitByLot = new Map(lotStock(data).lots.map((l) => [l.lotId, l.unitPrice]));

  const rows = (data.sales || [])
    .filter((r) => inScope(r, s))
    .map((r) => {
      const age = saleAge(r, s.now);
      const unit = r.lotId ? unitByLot.get(r.lotId) : undefined;
      // A sale off no lot has no derivable cost, so cost and margin are left
      // blank rather than reported as zero — a blank cannot be mistaken for
      // "this sold at no cost".
      const cost = unit == null ? '' : money(r.returned ? 0 : qtyOf(r) * unit);
      const net = money(saleNet(r));
      return {
        date: r.date || '',
        gemCode: r.gemCode || '',
        description: r.description || '',
        customer: r.customer || '',
        trip: s.tripName(r.tripId),
        lotId: r.lotId || '',
        status: r.returned ? 'Returned' : r.status || '',
        receivedDate: r.receivedDate || '',
        daysOutstanding: age.valid ? age.totalDays : '',
        qty: qtyOf(r),
        amount: money(r.amount),
        commissionPct: Number(r.commissionPct) || 0,
        commission: money(saleCommission(r)),
        net,
        unitCost: unit == null ? '' : money(unit),
        costOfSale: cost,
        margin: cost === '' ? '' : money(net - cost),
      };
    });

  return {
    key: 'sales',
    label: 'Sales',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'gemCode', label: 'Gem Code' },
      { key: 'description', label: 'Description' },
      { key: 'customer', label: 'Customer' },
      { key: 'trip', label: 'Trip' },
      { key: 'lotId', label: 'Lot ID' },
      { key: 'status', label: 'Status' },
      { key: 'receivedDate', label: 'Received Date' },
      { key: 'daysOutstanding', label: 'Days Outstanding', type: 'number', noTotal: true },
      { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'amount', label: 'Amount Gross', type: 'number' },
      { key: 'commissionPct', label: 'Commission %', type: 'number', noTotal: true },
      { key: 'commission', label: 'Commission', type: 'number' },
      { key: 'net', label: 'Net', type: 'number' },
      { key: 'unitCost', label: 'Lot Unit Cost', type: 'number', noTotal: true },
      { key: 'costOfSale', label: 'Cost of Sale', type: 'number' },
      { key: 'margin', label: 'Margin', type: 'number' },
    ],
    rows,
  };
}

// The purchase ledger as bought — one row per lot paid for, with the unit
// price the stock valuation runs on.
export function purchasesDataset(data, opts = {}) {
  const s = scope(data, opts);
  const rows = (data.purchases || [])
    .filter((r) => inScope(r, s))
    .map((r) => ({
      date: r.date || '',
      lotId: r.lotId || '',
      trip: s.tripName(r.tripId),
      description: r.description || '',
      fundingSource: r.fundingSource || '',
      pieces: Number(r.pieces) || 0,
      amount: money(r.amount),
      unitCost: money(purchaseUnitPrice(r)),
    }));

  return {
    key: 'purchases',
    label: 'Purchases',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'lotId', label: 'Lot ID' },
      { key: 'trip', label: 'Trip' },
      { key: 'description', label: 'Description' },
      { key: 'fundingSource', label: 'Funding Source' },
      { key: 'pieces', label: 'Pieces', type: 'number' },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'unitCost', label: 'Unit Cost', type: 'number', noTotal: true },
    ],
    rows,
  };
}

export function expensesDataset(data, opts = {}) {
  const s = scope(data, opts);
  const rows = (data.expenses || [])
    .filter((r) => inScope(r, s))
    .map((r) => ({
      date: r.date || '',
      description: r.description || '',
      category: r.category || '',
      trip: s.tripName(r.tripId),
      lotId: r.lotId || '',
      amount: money(r.amount),
    }));

  return {
    key: 'expenses',
    label: 'Expenses',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'description', label: 'Description' },
      { key: 'category', label: 'Category' },
      { key: 'trip', label: 'Trip' },
      { key: 'lotId', label: 'Lot ID' },
      { key: 'amount', label: 'Amount', type: 'number' },
    ],
    rows,
  };
}

export const BUILDERS = {
  lots: lotsDataset,
  sales: salesDataset,
  purchases: purchasesDataset,
  expenses: expensesDataset,
};

// Order the tabs and the "export everything" run follow.
export const DATASET_KEYS = ['lots', 'sales', 'purchases', 'expenses'];

export function buildDataset(data, key, opts = {}) {
  const build = BUILDERS[key];
  if (!build) throw new Error(`Unknown dataset: ${key}`);
  return build(data, opts);
}

export function buildAllDatasets(data, opts = {}) {
  return DATASET_KEYS.map((k) => buildDataset(data, k, opts));
}

// Column sums for the on-screen preview. Per-unit figures and rates opt out
// via noTotal — adding up unit costs or commission rates means nothing.
export function datasetTotals(dataset) {
  const out = {};
  for (const c of dataset.columns) {
    if (c.type !== 'number' || c.noTotal) continue;
    out[c.key] = dataset.rows.reduce((t, r) => t + (Number(r[c.key]) || 0), 0);
  }
  return out;
}

// ---- serialisation --------------------------------------------------------

// RFC 4180: quote a field containing a comma, quote or newline, doubling any
// quote inside it. Leading/trailing spaces are quoted too so they survive.
const NEEDS_QUOTE = /[",\r\n]|^\s|\s$/;

// Excel and Sheets execute a cell that opens with =, + or @ as a formula. Text
// cells starting with one are prefixed with an apostrophe so a description
// stays a description. Number cells are never touched, so a negative amount
// keeps its leading minus and still parses as a number.
const RISKY = /^[=+@\t\r]/;

export function csvCell(value, { text = true } = {}) {
  if (value == null) return '';
  let s = String(value);
  if (text && RISKY.test(s)) s = `'${s}`;
  if (NEEDS_QUOTE.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// No TOTAL row is written. A totals line in a CSV is read back as another data
// row and would double every figure in whatever analyses the file — the totals
// belong on screen, and are shown in the preview instead.
export function toCsv(dataset) {
  const { columns, rows } = dataset;
  const line = (cells) => cells.join(',');
  return [
    line(columns.map((c) => csvCell(c.label))),
    ...rows.map((r) => line(columns.map((c) => csvCell(r[c.key], { text: c.type !== 'number' })))),
  ].join('\r\n');
}

export function toJson(dataset, meta = {}) {
  return JSON.stringify(
    {
      dataset: dataset.key,
      label: dataset.label,
      ...meta,
      columns: dataset.columns.map((c) => ({ key: c.key, label: c.label, type: c.type || 'text' })),
      rowCount: dataset.rows.length,
      rows: dataset.rows,
    },
    null,
    2,
  );
}

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function exportFilename(key, scopeLabel, ext, now = new Date()) {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return ['gem', slug(key), slug(scopeLabel), day].filter(Boolean).join('-') + `.${ext}`;
}
