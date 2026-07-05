import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribe, getState, initStore, connectCloudSync } from './store.js';
import { subscribeSync, getSyncStatus, getSyncDetail, flush } from './sync.js';
import { isAuthed, logout, loadSeed } from './auth.js';
import * as E from './engine.js';
import { fmt, fmtFull } from './format.js';
import Login from './components/Login.jsx';
import KpiCard from './components/KpiCard.jsx';
import PartnerTable from './components/PartnerTable.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import Ledgers from './components/Ledgers.jsx';
import { PnlChart, ExpenseDonut, ReceivablesBar, CashFlowChart } from './components/Charts.jsx';

// Poll the deployed version.json; when a newer build goes live, reload once
// automatically (guarded against loops) or surface a refresh badge.
function useUpdateCheck() {
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    let stop = false;
    async function check() {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = await res.json();
        if (stop || !build || build === __BUILD_ID__) return;
        const guard = `gem-reloaded-${build}`;
        if (!sessionStorage.getItem(guard)) {
          sessionStorage.setItem(guard, '1');
          window.location.reload();
        } else {
          setUpdateReady(true);
        }
      } catch {
        /* offline — ignore */
      }
    }
    check();
    const t = setInterval(check, 60000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return updateReady;
}

const SYNC_LABELS = {
  boot: ['amb', '● connecting…'],
  nokey: ['amb', '● local only — connect cloud'],
  syncing: ['amb', '● syncing…'],
  synced: ['pos', '● cloud synced'],
  offline: ['neg', '● offline — saved locally'],
  error: ['neg', '● sync error — saved locally'],
};

async function promptConnectCloud() {
  const token = window.prompt(
    'Connect cloud sync (one time on this device):\n\n' +
      'Paste a GitHub token with read/write Contents access to the private ' +
      'fawasofc-ux/gem-data repo (a fine-grained PAT scoped to only that repo is best).',
  );
  if (!token || !token.trim()) return;
  const res = await connectCloudSync(token);
  if (!res.ok) window.alert(`Could not connect: ${res.error}`);
}

export default function App() {
  const [authed, setAuthed] = useState(isAuthed());
  const data = useSyncExternalStore(subscribe, getState);
  const syncStatus = useSyncExternalStore(subscribeSync, getSyncStatus);
  const [tripFilter, setTripFilter] = useState(''); // '' = combined
  const updateReady = useUpdateCheck();

  // After unlock (or reload with a live session), decrypt the seed and boot the store.
  useEffect(() => {
    if (!authed || data) return;
    loadSeed().then((seed) => {
      if (seed) initStore(seed);
      else { logout(); setAuthed(false); }
    });
  }, [authed, data]);

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  if (!data) return <div className="login-wrap"><span className="subtle">Decrypting…</span></div>;

  // — derive everything live from the ledgers —
  const scope = tripFilter || null;
  const pnlScoped = E.pnl(data, scope);
  const { rows: pnlRows, combined } = E.pnlByTrip(data);
  const cash = E.cashReconciliation(data);
  const liq = E.liquidity(data);
  const owed = E.capitalOwed(data);
  const dist = E.partnerDistribution(data);
  const cats = E.expensesByCategory(data, scope);
  const recv = E.receivablesSplit(data, scope);
  const stock = E.stockByTrip(data);
  const paperLoss = E.openTripPaperLoss(data);
  const scopeLabel = scope ? data.trips.find((t) => t.id === scope)?.name : 'All trips';
  const scopedPaperLoss = scope ? (E.isPaperLoss(data, scope) ? pnlScoped.netProfit : 0) : paperLoss;

  const diffBadge =
    Math.abs(cash.difference) < 0.005 ? (
      <span className="badge ok">reconciled ✓</span>
    ) : (
      <span className="badge warn" title="Actual bank − expected bank. Non-zero = unrecorded cash movements to review.">
        Δ {fmt(cash.difference)} — to review
      </span>
    );

  return (
    <div className="app">
      <header className="header">
        <div className="logo">GEM<span>·DASH</span></div>
        <div className="chips">
          <button className={`chip${!tripFilter ? ' active' : ''}`} onClick={() => setTripFilter('')}>Combined</button>
          {data.trips.map((t) => (
            <button key={t.id} className={`chip${tripFilter === t.id ? ' active' : ''}`} onClick={() => setTripFilter(t.id)}>
              {t.name}
              <span className="tag">{t.status === 'Open' ? '● open' : '✓ closed'}</span>
            </button>
          ))}
        </div>
        <div className="spacer" />
        {updateReady && (
          <button className="btn icon" onClick={() => window.location.reload()} title="A newer version of the dashboard is deployed">
            ⟳ update ready
          </button>
        )}
        <span
          className={SYNC_LABELS[syncStatus]?.[0] || 'subtle'}
          style={{ fontFamily: 'var(--mono)', fontSize: 11, cursor: syncStatus === 'nokey' ? 'pointer' : 'default' }}
          onClick={syncStatus === 'nokey' ? promptConnectCloud : undefined}
          title={
            syncStatus === 'nokey'
              ? 'Click to connect this device to the cloud database (paste token once)'
              : getSyncDetail() || 'Every change is encrypted and saved to your private gem-data repo'
          }
        >
          {SYNC_LABELS[syncStatus]?.[1] || syncStatus}
        </span>
        <span className="subtle">LKR · live from ledgers</span>
        <button className="btn ghost icon" onClick={() => { flush(); logout(); setAuthed(false); }}>Lock</button>
      </header>

      <section className="kpis">
        <KpiCard
          hero
          label="Total Business Value"
          value={liq.businessValue}
          accent="cyan"
          caption={`bank ${fmt(liq.actualBank)} + receivables ${fmt(liq.receivables)} + inventory ${fmt(liq.inventory)}`}
        />
        <KpiCard
          label={`Net Profit — ${scopeLabel}`}
          value={pnlScoped.netProfit}
          accent={pnlScoped.netProfit >= 0 ? 'green' : 'red'}
          badge={scopedPaperLoss < 0 ? <span className="badge warn">paper loss — inventory unsold</span> : null}
          caption={!scope && paperLoss < 0 ? `incl. ${fmtFull(paperLoss)} paper loss on open trips` : null}
        />
        <KpiCard
          label="Cash Position (expected bank)"
          value={cash.expectedBank}
          accent={cash.expectedBank >= 0 ? 'cyan' : 'red'}
          badge={diffBadge}
        />
        <KpiCard label="Outstanding Receivables" value={liq.receivables} accent="amber" caption="pending collections" />
        <KpiCard label={`Capital Owed to ${data.settings.partners[0] || 'Owner'}`} value={owed} accent="violet" caption="payback obligation" />
        <KpiCard
          label="Inventory on Hand"
          value={liq.inventory}
          accent="cyan"
          caption={`manual estimate · ${fmt(stock.totals.remaining)} pcs in stock`}
        />
      </section>

      <section className="grid">
        <div className="panel span8">
          <h3>P&L by Trip — Sales → −COGS → −Expenses → Net</h3>
          <PnlChart rows={pnlRows} combined={combined} />
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Trip</th><th className="num">Gross Sales</th><th className="num">Gem COGS</th>
                <th className="num">Op. Expenses</th><th className="num">Net Profit</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pnlRows.map((r) => (
                <tr key={r.trip.id}>
                  <td>{r.trip.name}</td>
                  <td className="num">{fmt(r.grossSales)}</td>
                  <td className="num">{fmt(r.cogs)}</td>
                  <td className="num">{fmt(r.expenses)}</td>
                  <td className={`num ${r.netProfit >= 0 ? 'pos' : 'neg'}`}>{fmt(r.netProfit)}</td>
                  <td>
                    {E.isPaperLoss(data, r.trip.id) && (
                      <span className="badge warn" title="This trip's gem lot is bought but mostly unsold — the loss is on paper, not real.">
                        paper loss — inventory unsold
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Combined</td>
                <td className="num">{fmt(combined.grossSales)}</td>
                <td className="num">{fmt(combined.cogs)}</td>
                <td className="num">{fmt(combined.expenses)}</td>
                <td className={`num ${combined.netProfit >= 0 ? 'pos' : 'neg'}`}>{fmt(combined.netProfit)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        <SettingsPanel settings={data.settings} />

        <div className="panel span4">
          <h3>Expenses by Category — {scopeLabel}</h3>
          <ExpenseDonut categories={cats} />
        </div>

        <div className="panel span4">
          <h3>Receivables — {scopeLabel}</h3>
          <ReceivablesBar received={recv.received} pending={recv.pending} />
          <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
            <div><div className="subtle">Received</div><div className="pos" style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmt(recv.received)}</div></div>
            <div><div className="subtle">Pending</div><div className="amb" style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmt(recv.pending)}</div></div>
          </div>
        </div>

        <div className="panel span4">
          <h3>Cash In vs Cash Out</h3>
          <CashFlowChart cash={cash} />
          <div className="subtle" style={{ marginTop: 6 }}>
            In {fmt(cash.cashIn)} − Out {fmt(cash.cashOut)} = expected bank {fmt(cash.expectedBank)} {diffBadge}
          </div>
        </div>

        <div className="panel span12">
          <h3>Partner Profit Distribution — closed trips only</h3>
          <PartnerTable dist={dist} />
        </div>

        <div className="panel span12">
          <h3>Gem Stock — pieces bought vs sold (by quantity)</h3>
          <table>
            <thead>
              <tr>
                <th>Trip</th>
                <th className="num">Pieces Bought</th>
                <th className="num">Pieces Sold</th>
                <th className="num">Remaining</th>
                <th className="num">Avg Cost / Pc</th>
                <th className="num">Remaining Value (est.)</th>
              </tr>
            </thead>
            <tbody>
              {stock.rows.map((r) => (
                <tr key={r.trip.id}>
                  <td>{r.trip.name} <span className="subtle">{r.trip.status === 'Open' ? '● open' : '✓ closed'}</span></td>
                  <td className="num">{fmt(r.bought)}</td>
                  <td className="num amb">{fmt(r.sold)}</td>
                  <td className={`num ${r.remaining > 0 ? 'cy' : ''}`}>{fmt(r.remaining)}</td>
                  <td className="num">{r.avgCost ? fmt(r.avgCost) : <span className="subtle">—</span>}</td>
                  <td className="num">{r.avgCost ? fmt(r.remainingValue) : <span className="subtle">—</span>}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Combined</td>
                <td className="num">{fmt(stock.totals.bought)}</td>
                <td className="num">{fmt(stock.totals.sold)}</td>
                <td className="num">{fmt(stock.totals.remaining)}</td>
                <td className="num"></td>
                <td className="num">{fmt(stock.totals.remainingValue)}</td>
              </tr>
            </tbody>
          </table>
          <div className="subtle" style={{ marginTop: 10 }}>
            Lots are bought at a total price (no per-piece cost), so stock is tracked by <b>quantity</b>: pieces
            in from Purchases minus pieces out from Sales (the Qty column). Avg cost / remaining value are
            informational estimates (lot cost ÷ pieces) — the P&L above stays lot-based and is unaffected.
          </div>
        </div>
      </section>

      <Ledgers data={data} tripFilter={tripFilter} />

      <div className="footer-note">
        Cloud database: every change is encrypted in this browser and committed to the private
        gem-data repo (full history kept) · localStorage is the offline cache · all totals computed live.
      </div>
    </div>
  );
}
