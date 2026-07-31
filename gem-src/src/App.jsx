import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribe, getState, initStore, subscribeStatus, getStatus, getStatusDetail, teardown } from './store.js';
import { currentUser, signOut } from './db.js';
import { hasAnonKey } from './supabase.js';
import * as E from './engine.js';
import { fmt, fmtFull } from './format.js';
import Login from './components/Login.jsx';
import SetupKey from './components/SetupKey.jsx';
import Migrate from './components/Migrate.jsx';
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
  loading: ['amb', '● loading…'],
  saving: ['amb', '● saving…'],
  ready: ['pos', '● database live'],
  offline: ['neg', '● offline — cached copy'],
  error: ['neg', '● database error'],
};

export default function App() {
  const [keyReady, setKeyReady] = useState(hasAnonKey());
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [initError, setInitError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const data = useSyncExternalStore(subscribe, getState);
  const dbStatus = useSyncExternalStore(subscribeStatus, getStatus);
  const [tripFilter, setTripFilter] = useState(''); // '' = combined
  const updateReady = useUpdateCheck();

  // Restore an existing session on reload.
  useEffect(() => {
    if (!keyReady) { setBooting(false); return; }
    currentUser()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, [keyReady]);

  // Once signed in, load the ledgers out of Postgres. A failure here (missing
  // tables, RLS denial, network) must be shown, not swallowed — an infinite
  // "Loading…" on a books app hides the one thing the owner needs to see.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setInitError(null);
    initStore(user.id)
      .then(({ empty }) => { if (!cancelled) setNeedsMigration(empty); })
      .catch((e) => { if (!cancelled) setInitError(String(e.message || e)); });
    return () => { cancelled = true; };
  }, [user, retryTick]);

  async function handleSignOut() {
    await signOut();
    teardown();
    setUser(null);
    setNeedsMigration(false);
    setInitError(null);
  }

  if (!keyReady) return <SetupKey onDone={() => setKeyReady(true)} />;
  if (booting) return <div className="login-wrap"><span className="subtle">Connecting…</span></div>;
  if (!user) return <Login onSuccess={setUser} />;
  if (initError) {
    return (
      <div className="login-wrap">
        <div className="login-box" style={{ maxWidth: 480 }}>
          <div className="logo">GEM<span>·DASH</span></div>
          <span className="subtle">Could not load the ledgers</span>
          <div className="login-error" style={{ textAlign: 'left', margin: '14px 0', wordBreak: 'break-word' }}>
            {initError}
          </div>
          <div className="subtle" style={{ textAlign: 'left', fontSize: 11, lineHeight: 1.6, marginBottom: 14 }}>
            Common causes: the database tables haven't been created yet (run{' '}
            <code>schema.sql</code> in the Supabase SQL Editor), or the anon key belongs to a
            different Supabase project than the one the tables were created in.
          </div>
          <button className="btn" style={{ width: '100%' }} onClick={() => setRetryTick((t) => t + 1)}>
            RETRY
          </button>
          <button className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={handleSignOut}>
            sign out
          </button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="login-wrap"><span className="subtle">Loading ledgers…</span></div>;
  if (needsMigration) {
    return <Migrate onDone={() => setNeedsMigration(false)} onSkip={() => setNeedsMigration(false)} />;
  }

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
  const returns = E.returnsSummary(data, scope);
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
      {__IS_STAGING__ && (
        <div className="staging-banner">
          STAGING — /gem/test · this is the review copy, live at /gem is unchanged
        </div>
      )}
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
          className={SYNC_LABELS[dbStatus]?.[0] || 'subtle'}
          style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
          title={getStatusDetail() || 'Every change is saved straight to your Supabase database'}
        >
          {SYNC_LABELS[dbStatus]?.[1] || dbStatus}
        </span>
        <span className="subtle">LKR · live from ledgers</span>
        <button className="btn ghost icon" onClick={handleSignOut}>Sign out</button>
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
                <th className="num">Returned</th>
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
                  <td className={`num ${r.returned ? 'neg' : ''}`}>{r.returned ? fmt(r.returned) : <span className="subtle">—</span>}</td>
                  <td className={`num ${r.remaining > 0 ? 'cy' : ''}`}>{fmt(r.remaining)}</td>
                  <td className="num">{r.avgCost ? fmt(r.avgCost) : <span className="subtle">—</span>}</td>
                  <td className="num">{r.avgCost ? fmt(r.remainingValue) : <span className="subtle">—</span>}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Combined</td>
                <td className="num">{fmt(stock.totals.bought)}</td>
                <td className="num">{fmt(stock.totals.sold)}</td>
                <td className="num">{fmt(stock.totals.returned)}</td>
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
            {returns.count > 0 && (
              <>
                {' '}Returned pieces come back into stock and earn nothing —{' '}
                <span className="neg">
                  {returns.count} return{returns.count > 1 ? 's' : ''} ({fmt(returns.pieces)} pc,{' '}
                  {fmt(returns.value)} reversed)
                </span>.
              </>
            )}
          </div>
        </div>
      </section>

      <Ledgers data={data} tripFilter={tripFilter} />

      <div className="footer-note">
        Live Supabase database (Postgres) · signed in as {user.email} · changes save instantly and sync
        across devices · offline shows a cached copy · all totals computed live from the ledgers.
      </div>
    </div>
  );
}
