// Pure calculation engine. Every number shown in the UI is derived here,
// at runtime, from raw ledger entries — nothing is hardcoded.

const sum = (rows) => rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);

const byTrip = (rows, tripId) => (tripId ? rows.filter((r) => r.tripId === tripId) : rows);

// Gross Sales, COGS, Expenses, Net Profit — per trip (tripId) or combined (null).
export function pnl(data, tripId = null) {
  const grossSales = sum(byTrip(data.sales, tripId));
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
  const salesReceived = sum(data.sales.filter((s) => s.status === 'Received'));
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
  const receivables = sum(data.sales.filter((s) => s.status === 'Pending'));
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
    received: sum(rows.filter((s) => s.status === 'Received')),
    pending: sum(rows.filter((s) => s.status === 'Pending')),
  };
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
