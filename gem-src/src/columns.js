// Table column assembly for the ledgers. Kept free of React so it can be
// unit-tested: a computed column inserted mid-table shifts every cell after
// it, and a TOTAL row that slipped one column would print a number under the
// wrong heading — the kind of quiet error a books app must not ship.

// Fields, with computed columns spliced in after the field they belong to
// (`after: <key>`), or appended when they declare no position.
export function buildColumns(schema) {
  const out = [...schema.fields];
  for (const c of schema.computed || []) {
    const i = c.after ? out.findIndex((f) => f.key === c.after) : -1;
    if (i >= 0) out.splice(i + 1, 0, c);
    else out.push(c);
  }
  return out;
}

// Columns whose values sum meaningfully in the TOTAL row. Per-unit figures
// (unit price) and rates (commission %) opt out via noTotal — adding them up
// would produce a number that means nothing.
export function totalColumns(cols) {
  return cols.filter((c) => (c.type === 'number' || c.compute) && !c.noTotal);
}

// Index where the TOTAL row stops spanning the label and starts printing
// numbers. Everything from here on gets its own cell, so the totals line up
// under the headings they belong to.
export function firstTotalIndex(cols) {
  const totals = totalColumns(cols);
  const i = cols.findIndex((c) => totals.includes(c));
  return Math.max(1, i);
}
