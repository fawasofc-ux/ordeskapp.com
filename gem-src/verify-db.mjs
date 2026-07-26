// Round-trips the real workbook ledgers through the database mapping
// (app -> snake_case row -> app) and re-runs the full financial engine on the
// result. If any field were dropped or renamed, a total would move.
// This is the migration's safety net, provable without a live database.
//   node verify-db.mjs

import { seedData } from './src/seed.js';
import { COLLECTIONS } from './src/mappers.js';
import * as E from './src/engine.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = typeof actual === 'number' ? Math.abs(actual - expected) < 0.001 : actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

// Simulate the full trip through Postgres.
const roundTripped = { settings: seedData.settings };
for (const [name, { toDb, fromDb }] of Object.entries(COLLECTIONS)) {
  roundTripped[name] = (seedData[name] || []).map((r) => fromDb(toDb(r)));
}

console.log('— Row counts survive the round trip —');
for (const name of Object.keys(COLLECTIONS)) {
  check(`${name} rows`, roundTripped[name].length, seedData[name].length);
}

console.log('— Financial totals identical after round trip —');
const before = { t1: E.pnl(seedData, 'trip1'), t2: E.pnl(seedData, 'trip2'), all: E.pnl(seedData, null) };
const after = { t1: E.pnl(roundTripped, 'trip1'), t2: E.pnl(roundTripped, 'trip2'), all: E.pnl(roundTripped, null) };
for (const scope of ['t1', 't2', 'all']) {
  for (const field of ['grossSales', 'cogs', 'expenses', 'netProfit']) {
    check(`${scope}.${field}`, after[scope][field], before[scope][field]);
  }
}
check('Cash in', E.cashReconciliation(roundTripped).cashIn, E.cashReconciliation(seedData).cashIn);
check('Cash out', E.cashReconciliation(roundTripped).cashOut, E.cashReconciliation(seedData).cashOut);
check('Receivables', E.liquidity(roundTripped).receivables, E.liquidity(seedData).receivables);
check('Capital owed', E.capitalOwed(roundTripped), E.capitalOwed(seedData));
check('Total draws', E.partnerDistribution(roundTripped).totalDraws, E.partnerDistribution(seedData).totalDraws);
check('Distributable profit', E.partnerDistribution(roundTripped).distributable, E.partnerDistribution(seedData).distributable);
check('Pieces bought', E.stockByTrip(roundTripped).totals.bought, E.stockByTrip(seedData).totals.bought);

console.log('— Field-level fidelity —');
const codesBefore = seedData.sales.filter((s) => s.gemCode).map((s) => s.gemCode).sort().join(',');
const codesAfter = roundTripped.sales.filter((s) => s.gemCode).map((s) => s.gemCode).sort().join(',');
check('Gem codes preserved', codesAfter, codesBefore);
check('Next gem code unchanged', E.nextGemCode(roundTripped), E.nextGemCode(seedData));
check('Sarong keeps no gem code', roundTripped.sales.find((s) => /sarong/i.test(s.description)).gemCode, undefined);
check('Empty dates stay empty (not null)', roundTripped.expenses.find((e) => e.description === 'Stone heat').date, '');
check('Trip links intact', roundTripped.sales.filter((s) => s.tripId === 'trip2').length, seedData.sales.filter((s) => s.tripId === 'trip2').length);
check('Funding source preserved', roundTripped.purchases[2].fundingSource, seedData.purchases[2].fundingSource);
check('Pieces preserved', roundTripped.purchases[2].pieces, seedData.purchases[2].pieces);
check('Partner names preserved', [...new Set(roundTripped.draws.map((d) => d.partner))].sort().join(','), 'Fawas,Thambi,Wappa');
check('Categories preserved', [...new Set(roundTripped.expenses.map((e) => e.category))].length, [...new Set(seedData.expenses.map((e) => e.category))].length);

// Returned + commission flags must survive, since they zero out revenue.
const withFlags = COLLECTIONS.sales.fromDb(
  COLLECTIONS.sales.toDb({ id: 'x', amount: 100000, commissionPct: 7.5, qty: 3, returned: true, returnDate: '2026-07-01', gemCode: 'FS0099' }),
);
check('commissionPct survives', withFlags.commissionPct, 7.5);
check('qty survives', withFlags.qty, 3);
check('returned survives', withFlags.returned, true);
check('returnDate survives', withFlags.returnDate, '2026-07-01');
check('returned sale still nets zero', E.saleNet(withFlags), 0);

console.log(failures === 0 ? '\nDB MAPPING VERIFIED — no data lost ✔' : `\n${failures} CHECK(S) FAILED ✘`);
process.exit(failures === 0 ? 0 : 1);
