// LKR money formatting helpers.

export function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-LK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function fmtFull(n) {
  return `LKR ${fmt(n)}`;
}

// Compact: 2.18M, 655.9K — used on KPI cards; full value shown on hover.
export function fmtCompact(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${fmt(abs)}`;
}
