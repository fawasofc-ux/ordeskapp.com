// Pure calculation engine. Every number shown in the UI is derived here,
// at runtime, from raw ledger entries — nothing is hardcoded.

const sum = (rows) => rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);

const byTrip = (rows, tripId) => (tripId ? rows.filter((r) => r.tripId === tripId) : rows);

// A sale's net revenue = amount (gross) less commission%. Existing entries carry
// no commissionPct, so it defaults to 0 → net === amount → no change to any total.
export const saleCommission = (s) => (Number(s.amount) || 0) * ((Number(s.commissionPct) || 0) / 100);
export const saleNet = (s) => (Number(s.amount) || 0) - saleCommission(s);

const sumNet = (rows) => rows.reduce((t, s) => t + saleNet(s), 0);

// Sales (net of commission), COGS, Expenses, Net Profit — per trip (tripId) or combined (null).
export function pnl(data, tripId = null) {
  const grossSales = sumNet(byTrip(data.sales, tripId));
  const cogs = sum(byTrip(data.purchases, tripId));
  const expenses = sum(byTrip(data.expenses, tripId));
  return { grossSales, cogs, expenses, netProfit: grossSales - cogs - expenses };
}

export function pnlByTrip(data) {
  const rows = data.trips.map((t) => ({ trip: t, ...pnl(data, t.id) }));
  return { rows, combined: pnl(data, null) };
}

// Cash In = capital + received sales; Cash Out = purchases + expenses + draws.
export function cashReconciliation(data) {
  const capitalIn = sum(data.capital);
  const salesReceived = sumNet(data.sales.filter((s) => s.status === 'Received'));
  const cashIn = capitalIn + salesReceived;
  const purchasesOut = sum(data.purchases);
  const expensesOut = sum(data.expenses);
  const drawsOut = sum(data.draws);
  const cashOut = purchasesOut + expensesOut + drawsOut;
  const expectedBank = cashIn - cashOut;
  const actualBank = Number(data.settings.actualBank) || 0;
  return {
    capitalIn, salesReceived, cashIn,
    purchasesOut, expensesOut, drawsOut, cashOut,
    expectedBank, actualBank,
    difference: actualBank - expectedBank,
  };
}

export function liquidity(data) {
  const receivables = sumNet(data.sales.filter((s) => s.status === 'Pending'));
  const inventory = Number(data.settings.inventoryEstimate) || 0;
  const actualBank = Number(data.settings.actualBank) || 0;
  return { receivables, inventory, actualBank, businessValue: actualBank + receivables + inventory };
}

export function capitalOwed(data) {
  return sum(data.capital);
}

// Distributable profit = net profit of CLOSED trips only (unsold inventory is never distributed).
export function partnerDistribution(data) {
  const closedTrips = data.trips.filter((t) => t.status === 'Closed');
  const distributable = closedTrips.reduce((t, trip) => t + pnl(data, trip.id).netProfit, 0);
  const partners = data.settings.partners.map((name) => {
    const sharePct = Number(data.settings.shares[name]) || 0;
    const profitShare = (sharePct / 100) * distributable;
    const drawn = sum(data.draws.filter((d) => d.partner === name));
    return { name, sharePct, profitShare, drawn, remaining: profitShare - drawn };
  });
  return { distributable, partners, totalDraws: sum(data.draws) };
}

export function expensesByCategory(data, tripId = null) {
  const map = new Map();
  for (const e of byTrip(data.expenses, tripId)) {
    map.set(e.category, (map.get(e.category) || 0) + (Number(e.amount) || 0));
  }
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function receivablesSplit(data, tripId = null) {
  const rows = byTrip(data.sales, tripId);
  return {
    received: sumNet(rows.filter((s) => s.status === 'Received')),
    pending: sumNet(rows.filter((s) => s.status === 'Pending')),
  };
}

// Quantity accounting for gem stock. Purchases arrive as a lot (a total cost for
// N pieces — no per-piece price), so we count pieces in vs pieces out and value
// the remainder at the lot's average cost. Money-side P&L stays lot-based and
// unchanged; this average cost is an informational estimate only.
export function stockByTrip(data) {
  const rows = data.trips.map((t) => {
    const purchases = data.purchases.filter((p) => p.tripId === t.id);
    const bought = purchases.reduce((s, p) => s + (Number(p.pieces) || 0), 0);
    const lotCost = purchases.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const sold = data.sales.filter((s) => s.tripId === t.id).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const remaining = bought - sold;
    const avgCost = bought > 0 ? lotCost / bought : 0;
    return { trip: t, bought, sold, remaining, avgCost, remainingValue: avgCost * remaining };
  });
  const totals = rows.reduce(
    (a, r) => ({
      bought: a.bought + r.bought,
      sold: a.sold + r.sold,
      remaining: a.remaining + r.remaining,
      remainingValue: a.remainingValue + r.remainingValue,
    }),
    { bought: 0, sold: 0, remaining: 0, remainingValue: 0 },
  );
  return { rows, totals };
}

// True when a trip's loss is likely just unsold inventory (open trip, COGS > sales).
export function isPaperLoss(data, tripId) {
  const trip = data.trips.find((t) => t.id === tripId);
  if (!trip || trip.status !== 'Open') return false;
  return pnl(data, tripId).netProfit < 0;
}

// Sum of negative net profits on open trips — the "paper loss" portion of combined P&L.
export function openTripPaperLoss(data) {
  return data.trips
    .filter((t) => t.status === 'Open')
    .reduce((t, trip) => {
      const np = pnl(data, trip.id).netProfit;
      return t + (np < 0 ? np : 0);
    }, 0);
}
