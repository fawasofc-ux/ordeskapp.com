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
check('Trip 2 COGS', t2.cogs, 2391525);
check('Trip 2 Expenses', t2.expenses, 646450);
check('Trip 2 Net Profit', t2.netProfit, -2172950);
check('Combined Gross Sales', all.grossSales, 2175975);
check('Combined COGS', all.cogs, 2791525);
check('Combined Expenses', all.expenses, 901450);
check('Combined Net Profit', all.netProfit, -1517000);

console.log('— Cash & liquidity —');
const cash = E.cashReconciliation(d);
const liq = E.liquidity(d);
check('Sales Received', cash.salesReceived, 1494475);
check('Pending receivables', liq.receivables, 681500);
check('Capital owed to Fawas', E.capitalOwed(d), 2342500);
check('Cash In', cash.cashIn, 3836975);
check('Cash Out', cash.cashOut, 3836975);
check('Expected bank', cash.expectedBank, 0);
check('Inventory estimate', liq.inventory, 2340000);
check('Total business value', liq.businessValue, 3021500);

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
check('Trip 2 pieces bought', s2.bought, 94);
check('Trip 2 pieces sold (no qty on seed sales)', s2.sold, 0);
check('Trip 2 pieces remaining', s2.remaining, 94);
check('Combined pieces bought', stock.totals.bought, 94);
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
const pendingSale = d.sales.find((s) => s.gemCode === 'FS0006'); // 150,000 pending, Trip 2
const withQty = { ...d, sales: d.sales.map((s) => (s.id === pendingSale.id ? { ...s, qty: 1 } : s)) };
const afterReturn = {
  ...withQty,
  sales: withQty.sales.map((s) => (s.id === pendingSale.id ? { ...s, qty: 1, returned: true } : s)),
};
check('Returned sale nets zero', E.saleNet({ ...pendingSale, returned: true }), 0);
check('Pending return drops receivables by its value', E.liquidity(afterReturn).receivables, 681500 - 150000);
check('Pending return drops gross sales', E.pnl(afterReturn, 'trip2').grossSales, 865025 - 150000);
check('Pending return leaves cash in untouched', E.cashReconciliation(afterReturn).cashIn, 3836975);
const stockAfter = E.stockByTrip(afterReturn).rows.find((r) => r.trip.id === 'trip2');
check('Returned piece is back in stock', stockAfter.remaining, 94);
check('Returned piece is not counted as sold', stockAfter.sold, 0);
check('Returned pieces are reported', stockAfter.returned, 1);
check('Returns summary value', E.returnsSummary(afterReturn, 'trip2').value, 150000);

// Returning a RECEIVED sale (rare): the refund pulls the money back out.
const recvSale = d.sales.find((s) => s.status === 'Received' && s.tripId === 'trip1');
const afterRecvReturn = {
  ...d,
  sales: d.sales.map((s) => (s.id === recvSale.id ? { ...s, returned: true } : s)),
};
check('Received return reduces cash in (refund)', E.cashReconciliation(afterRecvReturn).cashIn, 3836975 - recvSale.amount);
check('Received return reduces sales received', E.cashReconciliation(afterRecvReturn).salesReceived, 1494475 - recvSale.amount);
check('Received return leaves receivables alone', E.liquidity(afterRecvReturn).receivables, 681500);

console.log('— Expense categories —');
const cats = Object.fromEntries(E.expensesByCategory(d).map((c) => [c.category, c.amount]));
const expectCats = { Processing: 90000, Export: 98000, Vehicle: 8500, Testing: 2500, Commission: 2000, Equipment: 24500, Travel: 521950, Inventory: 151000, Misc: 3000 };
for (const [cat, v] of Object.entries(expectCats)) check(`Category ${cat}`, cats[cat] || 0, v);

console.log(failures === 0 ? '\nALL CHECKS PASSED ✔' : `\n${failures} CHECK(S) FAILED ✘`);
process.exit(failures === 0 ? 0 : 1);
