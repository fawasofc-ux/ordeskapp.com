import React from 'react';
import { fmt } from '../format.js';

export default function PartnerTable({ dist }) {
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Partner</th>
            <th className="num">Share %</th>
            <th className="num">Profit Share</th>
            <th className="num">Drawn</th>
            <th className="num">Remaining Owed</th>
          </tr>
        </thead>
        <tbody>
          {dist.partners.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td className="num">{p.sharePct}%</td>
              <td className="num cy">{fmt(p.profitShare)}</td>
              <td className="num amb">{fmt(p.drawn)}</td>
              <td className={`num ${p.remaining >= 0 ? 'pos' : 'neg'}`}>{fmt(p.remaining)}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td>TOTAL</td>
            <td className="num">{dist.partners.reduce((t, p) => t + p.sharePct, 0)}%</td>
            <td className="num">{fmt(dist.distributable)}</td>
            <td className="num">{fmt(dist.totalDraws)}</td>
            <td className="num">{fmt(dist.distributable - dist.totalDraws)}</td>
          </tr>
        </tbody>
      </table>
      <div className="subtle" style={{ marginTop: 10 }}>
        Distributable profit = net profit of <b>closed trips only</b> (LKR {fmt(dist.distributable)}).
        Draws are advances against profit share, not expenses.
      </div>
    </>
  );
}
