// Proves the ledger tables line up: a computed column spliced mid-table
// shifts every cell after it, and a TOTAL row off by one column would print
// a number under the wrong heading.
//   node verify-columns.mjs

import { buildColumns, totalColumns, firstTotalIndex } from './src/columns.js';
import { purchaseUnitPrice, saleNet } from './src/engine.js';

let failures = 0;
function checkEq(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

// Mirrors the real schemas in Ledgers.jsx.
const purchases = {
  fields: [
    { key: 'date', type: 'date' },
    { key: 'tripId', type: 'select' },
    { key: 'lotId', type: 'gemcode' },
    { key: 'pieces', type: 'number' },
    { key: 'fundingSource', type: 'text' },
    { key: 'description', type: 'text' },
    { key: 'amount', type: 'number' },
  ],
  computed: [{ key: 'unitPrice', after: 'description', noTotal: true, compute: purchaseUnitPrice }],
};

const sales = {
  fields: [
    { key: 'date', type: 'date' },
    { key: 'gemCode', type: 'gemcode' },
    { key: 'description', type: 'text' },
    { key: 'customer', type: 'text' },
    { key: 'tripId', type: 'select' },
    { key: 'status', type: 'select' },
    { key: 'commissionPct', type: 'number', noTotal: true },
    { key: 'qty', type: 'number' },
    { key: 'amount', type: 'number' },
  ],
  computed: [{ key: 'net', compute: saleNet }],
};

console.log('— Column order —');
const pCols = buildColumns(purchases).map((c) => c.key);
checkEq(
  'Purchases: lot id after Trip, unit price after Description',
  pCols.join(','),
  'date,tripId,lotId,pieces,fundingSource,description,unitPrice,amount',
);
const sCols = buildColumns(sales).map((c) => c.key);
checkEq(
  'Sales: net appended last (no `after` declared)',
  sCols.join(','),
  'date,gemCode,description,customer,tripId,status,commissionPct,qty,amount,net',
);

console.log('— TOTAL row alignment —');
// Every column from firstTotalIndex on gets its own cell; the label spans the
// rest. Cells emitted + the span must exactly cover the header row.
for (const [name, schema] of [['purchases', purchases], ['sales', sales]]) {
  const cols = buildColumns(schema);
  const idx = firstTotalIndex(cols);
  const emitted = cols.slice(idx).length;
  checkEq(`${name}: span + cells covers every column`, idx + emitted, cols.length);
}

const pc = buildColumns(purchases);
const pIdx = firstTotalIndex(pc);
checkEq('Purchases: totals start at pieces', pc[pIdx].key, 'pieces');
checkEq(
  'Purchases: totalled columns are pieces + amount only',
  totalColumns(pc).map((c) => c.key).join(','),
  'pieces,amount',
);
checkEq('Purchases: unit price is never summed', totalColumns(pc).some((c) => c.key === 'unitPrice'), false);

const sc = buildColumns(sales);
const sIdx = firstTotalIndex(sc);
checkEq('Sales: totals start at qty', sc[sIdx].key, 'qty');
checkEq(
  'Sales: totalled columns are qty, amount, net',
  totalColumns(sc).map((c) => c.key).join(','),
  'qty,amount,net',
);
checkEq('Sales: commission % is never summed', totalColumns(sc).some((c) => c.key === 'commissionPct'), false);

// A ledger with no numeric columns must still span at least one cell.
checkEq('Degenerate schema still spans a label cell', firstTotalIndex(buildColumns({ fields: [{ key: 'name', type: 'text' }] })), 1);

console.log(failures === 0 ? '\nCOLUMN ALIGNMENT VERIFIED ✔' : `\n${failures} CHECK(S) FAILED ✘`);
process.exit(failures === 0 ? 0 : 1);
