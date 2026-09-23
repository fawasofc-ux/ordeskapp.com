// Proves the exports are safe to hand to a spreadsheet or a dataframe:
// Trip 1 never leaks into a lot-based file, every lot ties back to its cost,
// and the CSV parses back into exactly the rows that went in.
//   node verify-export.mjs

import { seedData as d } from './src/seed.js';
import * as E from './src/engine.js';
import * as X from './src/exporters.js';

let failures = 0;
function checkEq(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}
function check(label, actual, expected, tol = 0.001) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

// A real RFC 4180 reader, so the round-trip test cannot be fooled by a naive
// split on commas — exactly the bug it exists to catch.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

console.log('— Scope: Trip 2 onwards —');
const trips = X.exportableTrips(d);
checkEq('Exportable trips start at Trip 2', trips.map((t) => t.name).join(','), 'Trip 2');
checkEq('Trip 1 is not exportable', X.isExportableTrip(d, 'trip1'), false);
checkEq('Trip 2 is exportable', X.isExportableTrip(d, 'trip2'), true);
// A trip opened after lot tracking began is exportable before it buys a lot.
const withTrip3 = { ...d, trips: [...d.trips, { id: 'trip3', name: 'Trip 3', status: 'Open' }] };
checkEq('A new empty Trip 3 is exportable', X.exportableTrips(withTrip3).map((t) => t.name).join(','), 'Trip 2,Trip 3');
// Books with no piece-tracked lot at all can export nothing.
checkEq('No lots means nothing to export', X.exportableTrips({ trips: d.trips, purchases: [], sales: [] }).length, 0);

console.log('— Trip 1 is excluded everywhere —');
for (const key of X.DATASET_KEYS) {
  const ds = X.buildDataset(d, key);
  checkEq(`${key}: no Trip 1 rows`, ds.rows.filter((r) => r.trip === 'Trip 1').length, 0);
  checkEq(`${key}: asking for Trip 1 returns nothing`, X.buildDataset(d, key, { tripId: 'trip1' }).rows.length, 0);
}

console.log('— Gem lots —');
const lots = X.lotsDataset(d);
checkEq('Both Trip 2 lots are listed', lots.rows.map((r) => r.lotId).join(','), 'GL002,GL003');
checkEq('GL001 (Trip 1, untracked) is absent', lots.rows.some((r) => r.lotId === 'GL001'), false);
const gl002 = lots.rows.find((r) => r.lotId === 'GL002');
const gl003 = lots.rows.find((r) => r.lotId === 'GL003');
checkEq('GL002 pieces', gl002.pieces, 36);
checkEq('GL002 pieces sold', gl002.piecesSold, 6);
checkEq('GL002 pieces remaining', gl002.piecesRemaining, 30);
check('GL002 unit cost', gl002.unitCost, 751525 / 36, 0.005);
check('GL002 sales net', gl002.salesNet, 554000);
check('GL002 pending (nothing received yet)', gl002.pending, 554000);
check('GL002 received', gl002.received, 0);
check('GL002 cost of pieces sold', gl002.costOfSold, 6 * (751525 / 36), 0.005);
check('GL002 remaining stock value', gl002.remainingValue, 30 * (751525 / 36), 0.005);
check('GL002 realised margin', gl002.realisedMargin, 554000 - 6 * (751525 / 36), 0.005);
checkEq('GL003 is untouched stock', gl003.piecesSold, 0);
check('GL003 remaining value is its whole cost', gl003.remainingValue, 1700000);
// The invariant that makes the lot register trustworthy: nothing is lost
// between what sold and what is left. Cents may round, so allow 0.02.
for (const r of lots.rows) {
  check(`${r.lotId}: cost of sold + remaining value = lot cost`, r.costOfSold + r.remainingValue, r.lotCost, 0.02);
}
check('Lot costs total to Trip 2 COGS', lots.rows.reduce((t, r) => t + r.lotCost, 0), E.pnl(d, 'trip2').cogs);
check(
  'Remaining stock value totals to the engine inventory',
  lots.rows.reduce((t, r) => t + r.remainingValue, 0),
  E.liquidity(d).inventoryAuto,
  0.02,
);

console.log('— Sales —');
const sales = X.salesDataset(d);
checkEq('Every Trip 2 sale is present', sales.rows.length, d.sales.filter((s) => s.tripId === 'trip2').length);
check('Sales net ties to the Trip 2 P&L', X.datasetTotals(sales).net, E.pnl(d, 'trip2').grossSales, 0.02);
const gemSales = X.salesDataset(d, { lotId: 'GL002' });
checkEq('Filtering to GL002 keeps only its sales', gemSales.rows.length, 6);
check('GL002 sales net matches the lot register', X.datasetTotals(gemSales).net, gl002.salesNet, 0.02);
const nonGem = X.salesDataset(d, { lotId: X.NO_LOT });
checkEq('The sarong sale is the only lot-less row', nonGem.rows.length, 1);
checkEq('A lot-less sale reports no cost', nonGem.rows[0].costOfSale, '');
checkEq('A lot-less sale reports no margin', nonGem.rows[0].margin, '');
const fs1 = sales.rows.find((r) => r.gemCode === 'FS0001');
check('A gem sale costs the lot unit price', fs1.costOfSale, 751525 / 36, 0.005);
check('Margin = net - cost of sale', fs1.margin, fs1.net - fs1.costOfSale, 0.005);
// Days outstanding is measured against a fixed date so the test never drifts.
const dated = X.salesDataset(d, { now: new Date(2026, 5, 13) }); // 13 Jun 2026
checkEq('Days outstanding counts from the sale date', dated.rows.find((r) => r.gemCode === 'FS0001').daysOutstanding, 31);
// A returned sale earns nothing and costs nothing — the piece came back.
const returned = X.salesDataset(
  { ...d, sales: d.sales.map((s) => (s.gemCode === 'FS0001' ? { ...s, returned: true } : s)) },
);
const retRow = returned.rows.find((r) => r.gemCode === 'FS0001');
checkEq('A returned sale is flagged', retRow.status, 'Returned');
checkEq('A returned sale nets zero', retRow.net, 0);
checkEq('A returned sale costs zero', retRow.costOfSale, 0);

console.log('— Purchases & expenses —');
const purch = X.purchasesDataset(d);
checkEq('Only Trip 2 lots are purchased rows', purch.rows.map((r) => r.lotId).join(','), 'GL002,GL003');
check('Purchases total to Trip 2 COGS', X.datasetTotals(purch).amount, E.pnl(d, 'trip2').cogs);
check('Unit cost is amount / pieces', purch.rows[0].unitCost, 751525 / 36, 0.005);
const exp = X.expensesDataset(d);
check('Expenses total to the Trip 2 P&L', X.datasetTotals(exp).amount, E.pnl(d, 'trip2').expenses);
checkEq('Expense categories survive the export', exp.rows.some((r) => r.category === 'Travel'), true);

console.log('— CSV correctness —');
const csv = X.toCsv(lots);
const parsed = parseCsv(csv);
checkEq('Header names every column', parsed[0].join('|'), lots.columns.map((c) => c.label).join('|'));
checkEq('One line per row, no more', parsed.length, lots.rows.length + 1);
checkEq('Every line has the full column count', parsed.every((r) => r.length === lots.columns.length), true);
// Round-trip: what comes back out must be what went in, column for column.
let mismatches = 0;
lots.rows.forEach((row, i) => {
  lots.columns.forEach((c, j) => {
    const want = row[c.key] == null ? '' : String(row[c.key]);
    if (parsed[i + 1][j] !== want) mismatches++;
  });
});
checkEq('Every cell round-trips to its own column', mismatches, 0);
// Numbers must arrive as numbers, not locale-formatted text.
checkEq('Money is written raw for the parser', parsed[1][lots.columns.findIndex((c) => c.key === 'lotCost')], '751525');
checkEq('CSV uses CRLF line endings', csv.includes('\r\n'), true);
checkEq('No TOTAL row is written into the file', csv.toUpperCase().includes('TOTAL'), false);

console.log('— CSV escaping —');
const nasty = {
  ...d,
  expenses: [
    { id: 'x1', date: '2026-07-01', description: 'Cut, polish & "finish"', category: 'Processing', tripId: 'trip2', amount: 1000 },
    { id: 'x2', date: '2026-07-02', description: 'Line one\nline two', category: 'Misc', tripId: 'trip2', amount: 2000 },
    { id: 'x3', date: '2026-07-03', description: '=HYPERLINK("http://x","click")', category: 'Misc', tripId: 'trip2', amount: -500 },
  ],
};
const nastyDs = X.expensesDataset(nasty);
const nastyRows = parseCsv(X.toCsv(nastyDs));
checkEq('A comma in a description does not split the row', nastyRows.length, 4);
checkEq('Quotes survive intact', nastyRows[1][1], 'Cut, polish & "finish"');
checkEq('An embedded newline stays inside its cell', nastyRows[2][1], 'Line one\nline two');
checkEq('A formula in text is neutralised', nastyRows[3][1].startsWith("'="), true);
checkEq('A negative amount keeps its minus and stays numeric', nastyRows[3][5], '-500');

console.log('— JSON & filenames —');
const json = JSON.parse(X.toJson(lots, { scope: 'Trip 2' }));
checkEq('JSON names its dataset', json.dataset, 'lots');
checkEq('JSON carries the scope', json.scope, 'Trip 2');
checkEq('JSON row count matches the rows', json.rowCount, json.rows.length);
checkEq('JSON rows match the dataset', JSON.stringify(json.rows), JSON.stringify(lots.rows));
checkEq('JSON describes its columns', json.columns.length, lots.columns.length);
checkEq(
  'Filename carries dataset, scope and date',
  X.exportFilename('lots', 'Trip 2', 'csv', new Date(2026, 8, 23)),
  'gem-lots-trip-2-2026-09-23.csv',
);
checkEq(
  'Filename slugifies a combined scope',
  X.exportFilename('sales', 'All trips (Trip 2 onwards)', 'json', new Date(2026, 8, 23)),
  'gem-sales-all-trips-trip-2-onwards-2026-09-23.json',
);
checkEq('Every dataset key builds', X.buildAllDatasets(d).map((s) => s.key).join(','), 'lots,sales,purchases,expenses');

console.log(failures === 0 ? '\nALL EXPORT CHECKS PASSED ✔' : `\n${failures} CHECK(S) FAILED ✘`);
process.exit(failures === 0 ? 0 : 1);
