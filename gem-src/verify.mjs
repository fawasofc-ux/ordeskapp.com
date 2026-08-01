// Correctness test: run the live engine over the seed ledgers and assert
// every total matches the Excel workbook. `npm run verify`.

import { seedData as d } from './src/seed.js';
import * as E from './src/engine.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Math.abs(actual - expected) < 0.001;
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

const t1 = E.pnl(d, 'trip1');
const t2 = E.pnl(d, 'trip2');
const all = E.pnl(d, null);

console.log('— P&L —');
check('Trip 1 Gross Sales', t1.grossSales, 1310950);
check('Trip 1 COGS', t1.cogs, 400000);
check('Trip 1 Expenses', t1.expenses, 255000);
check('Trip 1 Net Profit', t1.netProfit, 655950);
check('Trip 2 Gross Sales', t2.grossSales, 865025);
check('Trip 2 COGS', t2.cogs, 2451525);
check('Trip 2 Expenses', t2.expenses, 646450);
check('Trip 2 Net Profit', t2.netProfit, -2232950);
check('Combined Gross Sales', all.grossSales, 2175975);
check('Combined COGS', all.cogs, 2851525);
check('Combined Expenses', all.expenses, 901450);
check('Combined Net Profit', all.netProfit, -1577000);

console.log('— Cash & liquidity —');
const cash = E.cashReconciliation(d);
const liq = E.liquidity(d);
check('Sales Received', cash.salesReceived, 1494475);
check('Pending receivables', liq.receivables, 681500);
check('Capital owed to Fawas', E.capitalOwed(d), 2342500);
check('Cash In', cash.cashIn, 3836975);
check('Cash Out', cash.cashOut, 3896975);
check('Expected bank', cash.expectedBank, -60000);
// Inventory is now derived from the lots: 30 pcs left of GL002 + all 64 of GL003.
const AUTO_INVENTORY = 30 * (751525 / 36) + 64 * (1700000 / 64);
check('Inventory auto-valued from lots', liq.inventory, AUTO_INVENTORY);
check('Inventory mode defaults to auto', liq.inventoryMode === 'auto', true);
check('Total business value', liq.businessValue, 681500 + AUTO_INVENTORY);
// The manual override still works and takes precedence when selected.
const manualMode = { ...d, settings: { ...d.settings, inventoryMode: 'manual', inventoryEstimate: 2340000 } };
check('Manual override wins when set', E.liquidity(manualMode).inventory, 2340000);
check('Auto value still reported alongside manual', E.liquidity(manualMode).inventoryAuto, AUTO_INVENTORY);

console.log('— Partners —');
const dist = E.partnerDistribution(d);
check('Total draws', dist.totalDraws, 144000);
check('Distributable profit (closed trips)', dist.distributable, 655950);
const expect = {
  Fawas: { drawn: 8400, remaining: 319575, share: 327975 },
  Thambi: { drawn: 84300, remaining: 79687.5, share: 163987.5 },
  Wappa: { drawn: 51300, remaining: 112687.5, share: 163987.5 },
};
for (const p of dist.partners) {
  check(`${p.name} profit share`, p.profitShare, expect[p.name].share);
  check(`${p.name} drawn`, p.drawn, expect[p.name].drawn);
  check(`${p.name} remaining owed`, p.remaining, expect[p.name].remaining);
}

console.log('— Stock (quantity) & commission —');
const stock = E.stockByTrip(d);
const s2 = stock.rows.find((r) => r.trip.id === 'trip2');
check('Trip 2 pieces bought', s2.bought, 100);
check('Trip 2 pieces sold (6 gem sales x 1)', s2.sold, 6);
check('Trip 2 pieces remaining', s2.remaining, 94);
check('Combined pieces bought', stock.totals.bought, 100);
// Commission defaults to 0 on all seed sales → net === gross amount.
check('Seed sale net = amount when no commission', E.saleNet({ amount: 100000 }), 100000);
check('Sale net applies commission %', E.saleNet({ amount: 100000, commissionPct: 10 }), 90000);

console.log('— Gem codes (Trip 2 gemstone sales, date order) —');
function checkEq(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}
const coded = d.sales
  .filter((s) => s.gemCode)
  .sort((a, b) => String(a.gemCode).localeCompare(String(b.gemCode)));
checkEq('Codes issued', coded.length, 6);
checkEq('FS0001 is the earliest Trip 2 gem sale (2026-05-13)', coded[0].date, '2026-05-13');
// Codes must ascend with date — FS0001 oldest through FS0006 newest.
const dates = coded.map((s) => s.date);
checkEq('Codes run in date order', JSON.stringify(dates), JSON.stringify([...dates].sort()));
checkEq('Sarong sale carries no gem code', d.sales.find((s) => /sarong/i.test(s.description)).gemCode, undefined);
checkEq('Trip 1 sales carry no gem codes', d.sales.filter((s) => s.tripId === 'trip1' && s.gemCode).length, 0);
checkEq('Next code continues the run', E.nextGemCode(d), 'FS0007');

console.log('— Returns —');
// Returning a PENDING sale: no revenue, receivable gone, piece back in stock.
const pendingSale = d.sales.find((s) => s.gemCode === 'FS0006'); // 150,000 pending, Trip 2, GL002
const afterReturn = {
  ...d,
  sales: d.sales.map((s) => (s.id === pendingSale.id ? { ...s, returned: true } : s)),
};
check('Returned sale nets zero', E.saleNet({ ...pendingSale, returned: true }), 0);
check('Pending return drops receivables by its value', E.liquidity(afterReturn).receivables, 681500 - 150000);
check('Pending return drops gross sales', E.pnl(afterReturn, 'trip2').grossSales, 865025 - 150000);
check('Pending return leaves cash in untouched', E.cashReconciliation(afterReturn).cashIn, 3836975);
const stockAfter = E.stockByTrip(afterReturn).rows.find((r) => r.trip.id === 'trip2');
check('Returned piece is back in stock', stockAfter.remaining, 95);
check('Returned piece is not counted as sold', stockAfter.sold, 5);
check('Returned pieces are reported', stockAfter.returned, 1);
check('Returns summary value', E.returnsSummary(afterReturn, 'trip2').value, 150000);
// The piece returns to the lot it left, at that lot's unit price.
check('Returned piece rejoins its own lot', E.lotStock(afterReturn).lots.find((l) => l.lotId === 'GL002').remaining, 31);
check('Inventory rises by that lot unit price', E.liquidity(afterReturn).inventory, E.liquidity(d).inventory + 751525 / 36);

// Returning a RECEIVED sale (rare): the refund pulls the money back out.
const recvSale = d.sales.find((s) => s.status === 'Received' && s.tripId === 'trip1');
const afterRecvReturn = {
  ...d,
  sales: d.sales.map((s) => (s.id === recvSale.id ? { ...s, returned: true } : s)),
};
check('Received return reduces cash in (refund)', E.cashReconciliation(afterRecvReturn).cashIn, 3836975 - recvSale.amount);
check('Received return reduces sales received', E.cashReconciliation(afterRecvReturn).salesReceived, 1494475 - recvSale.amount);
check('Received return leaves receivables alone', E.liquidity(afterRecvReturn).receivables, 681500);

console.log('— Gem lot ids & unit price —');
const lots = d.purchases.filter((p) => p.lotId).sort((a, b) => a.lotId.localeCompare(b.lotId));
checkEq('Lot ids issued', lots.length, 3);
checkEq('GL001 is the earliest purchase', lots[0].date, '2025-01-01');
checkEq('Lot ids run in date order', JSON.stringify(lots.map((p) => p.date)), JSON.stringify(lots.map((p) => p.date).sort()));
checkEq('Next lot id continues the run', E.nextLotId(d), 'GL004');
// Unit price = amount / pieces, and must reconcile back to the lot total.
check('GL002 (36 pcs) unit price', E.purchaseUnitPrice(d.purchases[1]), 751525 / 36);
check('GL003 (64 pcs) unit price', E.purchaseUnitPrice(d.purchases[2]), 1700000 / 64);
check('Lot with no piece count has no unit price', E.purchaseUnitPrice(d.purchases[0]), 0);
check('Unit price x pieces rebuilds the lot cost', E.purchaseUnitPrice(d.purchases[2]) * 64, 1700000);
const st2 = E.stockByTrip(d).rows.find((r) => r.trip.id === 'trip2');
check('Trip 2 avg unit price', st2.avgCost, 2451525 / 100);
check('Lot detail exposed', st2.lots.length, 2);

console.log('— Per-lot stock depletion —');
const ls = E.lotStock(d);
const gl2 = ls.lots.find((l) => l.lotId === 'GL002');
const gl3 = ls.lots.find((l) => l.lotId === 'GL003');
check('GL002 pieces', gl2.pieces, 36);
check('GL002 sold (all 6 legacy gem sales)', gl2.soldQty, 6);
check('GL002 remaining', gl2.remaining, 30);
check('GL002 value = remaining x its own unit price', gl2.value, 30 * (751525 / 36));
check('GL003 untouched', gl3.soldQty, 0);
check('GL003 value', gl3.value, 1700000);
check('Total lot stock value', ls.totals.value, 30 * (751525 / 36) + 1700000);
check('Trip 1 lot excluded (no piece count)', ls.lots.filter((l) => l.tripId === 'trip1').length, 0);
check('Sarong moves no stock', d.sales.find((s) => /sarong/i.test(s.description)).qty, 0);
check('No unassigned-stock warnings on seed', ls.warnings.unassigned.count, 0);
check('No oversold lots on seed', ls.warnings.oversold, 0);

// Selling one more piece must take exactly that lot's unit price out of stock.
const oneMore = {
  ...d,
  sales: [...d.sales, { id: 'x1', date: '2026-07-31', tripId: 'trip2', status: 'Pending', amount: 40000, qty: 1, lotId: 'GL003' }],
};
check('Selling from GL003 deducts its unit price', E.lotStock(oneMore).totals.value, ls.totals.value - 1700000 / 64);
check('Inventory follows the sale automatically', E.liquidity(oneMore).inventory, E.liquidity(d).inventory - 1700000 / 64);

// Overselling a lot is surfaced rather than silently going negative.
const over = { ...d, sales: [...d.sales, { id: 'x2', tripId: 'trip2', status: 'Pending', amount: 1, qty: 999, lotId: 'GL003' }] };
check('Oversold lot is flagged', E.lotStock(over).warnings.oversold, 1);

console.log('— Legacy sale-lot classification —');
// Strip lots/qty to simulate the pre-lot ledger, then re-derive them.
const legacy = d.sales.map(({ lotId, qty, ...rest }) => rest);
const reassigned = E.assignMissingSaleLots(legacy);
const byCode = (c) => reassigned.sales.find((s) => s.gemCode === c);
checkEq('Legacy gem sales default to GL002', byCode('FS0001').lotId, 'GL002');
checkEq('Legacy gem sales get qty 1', byCode('FS0001').qty, 1);
checkEq('Sarong is pinned to qty 0', reassigned.sales.find((s) => /sarong/i.test(s.description)).qty, 0);
checkEq('Sarong gets no lot', reassigned.sales.find((s) => /sarong/i.test(s.description)).lotId, undefined);
checkEq('Trip 1 sales untouched', reassigned.sales.filter((s) => s.tripId === 'trip1' && s.lotId).length, 0);
// An (NL) description routes to GL003 instead.
const withNL = E.assignMissingSaleLots([
  { id: 'n1', tripId: 'trip2', description: 'Sale 1 pc (NL)', amount: 1 },
  { id: 'n2', tripId: 'trip2', description: 'plain sale', amount: 1 },
  { id: 'n3', tripId: 'trip2', description: 'Nlon fabric', amount: 1 },
]);
checkEq('(NL) routes to GL003', withNL.sales[0].lotId, 'GL003');
checkEq('Non-NL falls back to GL002', withNL.sales[1].lotId, 'GL002');
checkEq('"Nlon" is not treated as NL', withNL.sales[2].lotId, 'GL002');
checkEq('Classification is a no-op once assigned', E.assignMissingSaleLots(d.sales), null);
// Backfill assigns ids without renumbering the ones already issued.
const stripped = d.purchases.map(({ lotId, ...rest }) => rest);
checkEq('Backfill assigns all missing ids', E.assignMissingLotIds(stripped).purchases.map((p) => p.lotId).join(','), 'GL001,GL002,GL003');
checkEq('Backfill is a no-op when nothing is missing', E.assignMissingLotIds(d.purchases), null);
const partial = d.purchases.map((p, i) => (i === 1 ? { ...p, lotId: undefined } : p));
checkEq('Backfill continues past existing ids', E.assignMissingLotIds(partial).assigned.size, 1);

console.log('— Expense categories —');
const cats = Object.fromEntries(E.expensesByCategory(d).map((c) => [c.category, c.amount]));
const expectCats = { Processing: 90000, Export: 98000, Vehicle: 8500, Testing: 2500, Commission: 2000, Equipment: 24500, Travel: 521950, Inventory: 151000, Misc: 3000 };
for (const [cat, v] of Object.entries(expectCats)) check(`Category ${cat}`, cats[cat] || 0, v);

console.log(failures === 0 ? '\nALL CHECKS PASSED ✔' : `\n${failures} CHECK(S) FAILED ✘`);
process.exit(failures === 0 ? 0 : 1);
