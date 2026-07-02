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

console.log('— Expense categories —');
const cats = Object.fromEntries(E.expensesByCategory(d).map((c) => [c.category, c.amount]));
const expectCats = { Processing: 90000, Export: 98000, Vehicle: 8500, Testing: 2500, Commission: 2000, Equipment: 24500, Travel: 521950, Inventory: 151000, Misc: 3000 };
for (const [cat, v] of Object.entries(expectCats)) check(`Category ${cat}`, cats[cat] || 0, v);

console.log(failures === 0 ? '\nALL CHECKS PASSED ✔' : `\n${failures} CHECK(S) FAILED ✘`);
process.exit(failures === 0 ? 0 : 1);
