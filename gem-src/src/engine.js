// Pure calculation engine. Every number shown in the UI is derived here,
// at runtime, from raw ledger entries — nothing is hardcoded.

const sum = (rows) => rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);

const byTrip = (rows, tripId) => (tripId ? rows.filter((r) => r.tripId === tripId) : rows);

// A sale's net revenue = amount (gross) less commission%. Existing entries carry
// no commissionPct, so it defaults to 0 → net === amount → no change to any total.
// A RETURNED sale nets zero: the goods came back, so it earns nothing, leaves no
// receivable, and (if it had been received) the refund cancels the cash in. Every
// money figure flows through saleNet, so returns unwind everywhere at once.
export const saleCommission = (s) => (Number(s.amount) || 0) * ((Number(s.commissionPct) || 0) / 100);
export const saleNet = (s) => (s.returned ? 0 : (Number(s.amount) || 0) - saleCommission(s));

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

// Inventory is normally derived from the lots (remaining pieces x unit price)
// and updates itself as gems sell. The manual figure remains available as an
// override for stock the lots do not describe.
export function liquidity(data) {
  const receivables = sumNet(data.sales.filter((s) => s.status === 'Pending'));
  const manual = Number(data.settings.inventoryEstimate) || 0;
  const auto = lotStock(data).totals.value;
  const mode = data.settings.inventoryMode === 'manual' ? 'manual' : 'auto';
  const inventory = mode === 'manual' ? manual : auto;
  const actualBank = Number(data.settings.actualBank) || 0;
  return {
    receivables,
    inventory,
    inventoryMode: mode,
    inventoryAuto: auto,
    inventoryManual: manual,
    actualBank,
    businessValue: actualBank + receivables + inventory,
  };
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

// A lot's unit price = total lot cost / pieces in the lot. Derived, never
// stored, so it can never drift from the amount and piece count it comes from.
// Returns 0 when the lot has no piece count (nothing to divide by).
export function purchaseUnitPrice(p) {
  const pieces = Number(p?.pieces) || 0;
  return pieces > 0 ? (Number(p?.amount) || 0) / pieces : 0;
}

// Per-lot stock. Each sale names the lot it came out of, so a sold piece is
// deducted from that specific lot at that lot's own unit price — no averaging.
//
// Two things are reported rather than quietly absorbed, because either would
// otherwise make stock silently wrong: sales that move pieces but name no lot,
// and sales that name a lot but carry no qty (so they deduct nothing).
export function lotStock(data) {
  const live = (data.sales || []).filter((s) => !s.returned);
  const qtyOf = (s) => Number(s.qty) || 0;

  const lots = (data.purchases || [])
    .filter((p) => (Number(p.pieces) || 0) > 0)
    .map((p) => {
      const pieces = Number(p.pieces) || 0;
      const unitPrice = purchaseUnitPrice(p);
      const mine = p.lotId ? live.filter((s) => s.lotId === p.lotId) : [];
      const soldQty = mine.reduce((t, s) => t + qtyOf(s), 0);
      const remaining = pieces - soldQty;
      return {
        id: p.id,
        lotId: p.lotId || '',
        tripId: p.tripId,
        date: p.date || '',
        description: p.description || '',
        pieces,
        amount: Number(p.amount) || 0,
        unitPrice,
        soldQty,
        remaining,
        // A lot cannot hold negative stock; flag it instead of hiding it.
        oversold: remaining < 0,
        value: remaining * unitPrice,
      };
    })
    .sort((a, b) => String(a.lotId).localeCompare(String(b.lotId)));

  const totals = lots.reduce(
    (a, l) => ({
      pieces: a.pieces + l.pieces,
      soldQty: a.soldQty + l.soldQty,
      remaining: a.remaining + l.remaining,
      cost: a.cost + l.amount,
      value: a.value + l.value,
    }),
    { pieces: 0, soldQty: 0, remaining: 0, cost: 0, value: 0 },
  );

  const knownLots = new Set(lots.map((l) => l.lotId).filter(Boolean));
  // Only trips that actually hold lots take part in stock accounting, so a
  // sale in a trip with no lots (Trip 1) is outside it rather than an error.
  const lotTrips = new Set(lots.map((l) => l.tripId));
  const unassigned = live.filter((s) => qtyOf(s) > 0 && !s.lotId && lotTrips.has(s.tripId));
  const unknownLot = live.filter((s) => s.lotId && !knownLots.has(s.lotId));
  const missingQty = live.filter((s) => s.lotId && qtyOf(s) === 0);

  return {
    lots,
    totals,
    warnings: {
      unassigned: { count: unassigned.length, qty: unassigned.reduce((t, s) => t + qtyOf(s), 0) },
      missingQty: missingQty.length,
      unknownLot: unknownLot.length,
      oversold: lots.filter((l) => l.oversold).length,
    },
  };
}

// Lots offered in the sale/expense pickers — only lots that actually hold
// pieces, which naturally excludes the Trip 1 record (it has no piece count).
export function lotOptions(data) {
  return lotStock(data).lots.map((l) => ({
    lotId: l.lotId,
    tripId: l.tripId,
    pieces: l.pieces,
    remaining: l.remaining,
    unitPrice: l.unitPrice,
  }));
}

// Quantity accounting rolled up per trip, now sourced from the lots so the
// trip figure and the lot figures can never disagree.
// Money-side P&L stays lot-based and unchanged; this valuation is an estimate.
export function stockByTrip(data) {
  const qty = (rows) => rows.reduce((s, x) => s + (Number(x.qty) || 0), 0);
  const allLots = lotStock(data).lots;
  // Stock is lot accounting, so a trip only appears once it holds a lot with
  // pieces. Trip 1 was bought as a single untracked lot, so counting its sales
  // here would report negative stock for gems that were never piece-tracked.
  const rows = data.trips
    .filter((t) => allLots.some((l) => l.tripId === t.id))
    .map((t) => {
      const lots = allLots.filter((l) => l.tripId === t.id);
      const lotIds = new Set(lots.map((l) => l.lotId));
      // Every figure below is summed from the lots, so the trip line and the
      // lot lines under it can never disagree.
      const bought = lots.reduce((s, l) => s + l.pieces, 0);
      const sold = lots.reduce((s, l) => s + l.soldQty, 0);
      const remaining = lots.reduce((s, l) => s + l.remaining, 0);
      const remainingValue = lots.reduce((s, l) => s + l.value, 0);
      const returned = qty(data.sales.filter((s) => s.returned && lotIds.has(s.lotId)));
      const avgCost = bought > 0
        ? lots.reduce((s, l) => s + l.unitPrice * l.pieces, 0) / bought
        : 0;
      return { trip: t, bought, sold, returned, remaining, avgCost, remainingValue, lots };
    });
  const totals = rows.reduce(
    (a, r) => ({
      bought: a.bought + r.bought,
      sold: a.sold + r.sold,
      returned: a.returned + r.returned,
      remaining: a.remaining + r.remaining,
      remainingValue: a.remainingValue + r.remainingValue,
    }),
    { bought: 0, sold: 0, returned: 0, remaining: 0, remainingValue: 0 },
  );
  return { rows, totals };
}

// Returned sales — surfaced so a return is visible, not silently absorbed.
export function returnsSummary(data, tripId = null) {
  const rows = byTrip(data.sales, tripId).filter((s) => s.returned);
  return {
    count: rows.length,
    pieces: rows.reduce((t, s) => t + (Number(s.qty) || 0), 0),
    value: rows.reduce((t, s) => t + (Number(s.amount) || 0), 0),
  };
}

// Sequential gem code (FS0001, FS0002 …) for gemstone sales. Derived from the
// highest code already issued — including returned rows, so codes are never
// reused. Purchases are deliberately not linked: lots have no per-piece identity.
export const GEM_CODE_PREFIX = 'FS';

export function nextGemCode(data, prefix = GEM_CODE_PREFIX) {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const highest = data.sales.reduce((max, s) => {
    const m = re.exec(String(s.gemCode || '').trim());
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

// Sequential gem lot id (GL001, GL002 …) identifying each purchased lot.
export const LOT_ID_PREFIX = 'GL';

export function nextLotId(data, prefix = LOT_ID_PREFIX) {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const highest = (data.purchases || []).reduce((max, p) => {
    const m = re.exec(String(p.lotId || '').trim());
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

// One-time classification of sales recorded before lots were tracked.
// Rules are matched in order and the first hit wins; anything unmatched falls
// back. Adding a future lot means adding a rule here — new sales pick their
// lot from the dropdown, so this only ever covers the legacy rows.
export const LEGACY_SALE_LOT_RULES = [
  { test: /\bNL\b/i, lotId: 'GL003' },
];
export const LEGACY_SALE_LOT_FALLBACK = 'GL002';
export const LEGACY_SALE_LOT_TRIP = 'trip2';
// Non-gem goods never come out of a gem lot.
const NON_GEM = /sarong/i;

// Backfills lotId (and qty, which defaults to one piece per gem sale) on the
// legacy trip's sales. Returns null when there is nothing to do.
export function assignMissingSaleLots(sales, {
  tripId = LEGACY_SALE_LOT_TRIP,
  rules = LEGACY_SALE_LOT_RULES,
  fallback = LEGACY_SALE_LOT_FALLBACK,
  defaultQty = 1,
} = {}) {
  const assigned = new Map();
  const next = sales.map((s) => {
    if (s.tripId !== tripId) return s;
    if (NON_GEM.test(s.description || '')) {
      // Sarong is not gem stock: pin qty to 0 so it can never move a lot.
      if (Number(s.qty) === 0 && !s.lotId) return s;
      assigned.set(s.id, { qty: 0 });
      return { ...s, qty: 0, lotId: undefined };
    }
    const patch = {};
    if (!s.lotId) {
      patch.lotId = (rules.find((r) => r.test.test(s.description || '')) || {}).lotId || fallback;
    }
    if (Number(s.qty) === 0 || s.qty == null) patch.qty = defaultQty;
    if (!Object.keys(patch).length) return s;
    assigned.set(s.id, patch);
    return { ...s, ...patch };
  });
  return assigned.size ? { sales: next, assigned } : null;
}

// Assigns lot ids to purchases missing one, oldest first, continuing from the
// highest id already issued so existing ids are never renumbered. Returns the
// new purchases array plus the ids assigned, or null when nothing was missing.
export function assignMissingLotIds(purchases) {
  const missing = purchases
    .filter((p) => !p.lotId)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (!missing.length) return null;

  const assigned = new Map();
  let cursor = { purchases };
  for (const row of missing) {
    const id = nextLotId(cursor);
    assigned.set(row.id, id);
    cursor = { purchases: cursor.purchases.map((p) => (p.id === row.id ? { ...p, lotId: id } : p)) };
  }
  return {
    purchases: purchases.map((p) => (assigned.has(p.id) ? { ...p, lotId: assigned.get(p.id) } : p)),
    assigned,
  };
}

// Which trip the dashboard opens on: the trip currently in progress, so the
// first thing seen is live work rather than combined history. Pinned to status
// rather than a hard-coded id, so opening Trip 3 later follows automatically.
// Falls back to the newest trip, then to combined ('').
export function defaultTripFilter(trips) {
  if (!trips || !trips.length) return '';
  const open = trips.filter((t) => t.status === 'Open');
  const pick = open.length ? open[open.length - 1] : trips[trips.length - 1];
  return pick?.id || '';
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
