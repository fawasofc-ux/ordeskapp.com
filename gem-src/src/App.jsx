import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribe, getState, initStore } from './store.js';
import { isAuthed, logout, loadSeed } from './auth.js';
import * as E from './engine.js';
import { fmt, fmtFull } from './format.js';
import Login from './components/Login.jsx';
import KpiCard from './components/KpiCard.jsx';
import PartnerTable from './components/PartnerTable.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import Ledgers from './components/Ledgers.jsx';
import { PnlChart, ExpenseDonut, ReceivablesBar, CashFlowChart } from './components/Charts.jsx';

export default function App() {
  const [authed, setAuthed] = useState(isAuthed());
  const data = useSyncExternalStore(subscribe, getState);
  const [tripFilter, setTripFilter] = useState(''); // '' = combined

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
        <span className="subtle">LKR · live from ledgers</span>
        <button className="btn ghost icon" onClick={() => { logout(); setAuthed(false); }}>Lock</button>
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
        <KpiCard label="Inventory on Hand" value={liq.inventory} accent="cyan" caption="manual estimate — unsold stock" />
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
      </section>

      <Ledgers data={data} tripFilter={tripFilter} />

      <div className="footer-note">
        Data lives in this browser (localStorage) — export/backup before clearing browser data.
        Seeded from Gem_Business_Accounts.xlsx · all totals computed live.
      </div>
    </div>
  );
}
