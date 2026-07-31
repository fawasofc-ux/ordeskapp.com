// Row mapping between the app (camelCase) and the database (snake_case).
// Kept free of the Supabase client so it can be unit-tested in plain node —
// a silent field-name mismatch here would quietly lose ledger data, so it is
// the one part that must be provably correct.

const num = (v) => (v === '' || v == null ? null : Number(v));

// collection -> { table, toDb, fromDb }
export const COLLECTIONS = {
  trips: {
    table: 'gem_trips',
    toDb: (r) => ({ id: r.id, name: r.name, status: r.status || 'Open' }),
    fromDb: (r) => ({ id: r.id, name: r.name, status: r.status }),
  },
  sales: {
    table: 'gem_sales',
    toDb: (r) => ({
      id: r.id,
      date: r.date || '',
      gem_code: r.gemCode || null,
      description: r.description || '',
      customer: r.customer || '',
      trip_id: r.tripId || null,
      status: r.status || 'Pending',
      commission_pct: num(r.commissionPct) ?? 0,
      qty: num(r.qty),
      amount: num(r.amount) ?? 0,
      returned: !!r.returned,
      return_date: r.returnDate || null,
    }),
    fromDb: (r) => ({
      id: r.id,
      date: r.date || '',
      gemCode: r.gem_code || undefined,
      description: r.description || '',
      customer: r.customer || '',
      tripId: r.trip_id || '',
      status: r.status,
      commissionPct: r.commission_pct == null ? 0 : Number(r.commission_pct),
      qty: r.qty == null ? null : Number(r.qty),
      amount: Number(r.amount) || 0,
      ...(r.returned ? { returned: true } : {}),
      ...(r.return_date ? { returnDate: r.return_date } : {}),
    }),
  },
  purchases: {
    table: 'gem_purchases',
    // Unit price is absent by design — it is derived from amount / pieces.
    toDb: (r) => ({
      id: r.id,
      date: r.date || '',
      lot_id: r.lotId || null,
      trip_id: r.tripId || null,
      pieces: num(r.pieces),
      funding_source: r.fundingSource || '',
      description: r.description || '',
      amount: num(r.amount) ?? 0,
    }),
    fromDb: (r) => ({
      id: r.id,
      date: r.date || '',
      lotId: r.lot_id || undefined,
      tripId: r.trip_id || '',
      pieces: r.pieces == null ? null : Number(r.pieces),
      fundingSource: r.funding_source || '',
      description: r.description || '',
      amount: Number(r.amount) || 0,
    }),
  },
  expenses: {
    table: 'gem_expenses',
    toDb: (r) => ({
      id: r.id,
      date: r.date || '',
      description: r.description || '',
      category: r.category || '',
      trip_id: r.tripId || null,
      amount: num(r.amount) ?? 0,
    }),
    fromDb: (r) => ({
      id: r.id,
      date: r.date || '',
      description: r.description || '',
      category: r.category || '',
      tripId: r.trip_id || '',
      amount: Number(r.amount) || 0,
    }),
  },
  draws: {
    table: 'gem_draws',
    toDb: (r) => ({
      id: r.id,
      date: r.date || '',
      description: r.description || '',
      partner: r.partner || '',
      trip_id: r.tripId || null,
      amount: num(r.amount) ?? 0,
    }),
    fromDb: (r) => ({
      id: r.id,
      date: r.date || '',
      description: r.description || '',
      partner: r.partner || '',
      tripId: r.trip_id || '',
      amount: Number(r.amount) || 0,
    }),
  },
  capital: {
    table: 'gem_capital',
    toDb: (r) => ({
      id: r.id,
      date: r.date || '',
      description: r.description || '',
      amount: num(r.amount) ?? 0,
    }),
    fromDb: (r) => ({
      id: r.id,
      date: r.date || '',
      description: r.description || '',
      amount: Number(r.amount) || 0,
    }),
  },
};

