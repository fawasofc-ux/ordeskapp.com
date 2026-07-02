import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, ReferenceLine,
} from 'recharts';
import { fmt, fmtCompact } from '../format.js';

const GREEN = '#39ff8e';
const RED = '#ff4d6d';
const CYAN = '#29e0ff';
const AMBER = '#ffc247';
const PIE_COLORS = ['#29e0ff', '#39ff8e', '#ffc247', '#ff4d6d', '#b388ff', '#4dd0e1', '#ffab91', '#a5d6a7', '#f48fb1', '#90caf9'];

const moneyTip = (value, name) => [`LKR ${fmt(value)}`, name];

export function PnlChart({ rows, combined }) {
  const data = [
    ...rows.map((r) => ({
      name: r.trip.name,
      Sales: r.grossSales,
      COGS: -r.cogs,
      Expenses: -r.expenses,
      'Net Profit': r.netProfit,
    })),
    { name: 'Combined', Sales: combined.grossSales, COGS: -combined.cogs, Expenses: -combined.expenses, 'Net Profit': combined.netProfit },
  ];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtCompact} axisLine={false} tickLine={false} width={60} />
        <Tooltip formatter={moneyTip} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono' }} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
        <Bar dataKey="Sales" fill={CYAN} radius={[3, 3, 0, 0]} isAnimationActive />
        <Bar dataKey="COGS" fill={RED} radius={[3, 3, 0, 0]} />
        <Bar dataKey="Expenses" fill={AMBER} radius={[3, 3, 0, 0]} />
        <Bar dataKey="Net Profit" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d['Net Profit'] >= 0 ? GREEN : RED} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ExpenseDonut({ categories }) {
  if (!categories.length) return <div className="subtle">No expenses recorded.</div>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={categories}
          dataKey="amount"
          nameKey="category"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
          stroke="none"
        >
          {categories.map((c, i) => (
            <Cell key={c.category} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={moneyTip} />
        <Legend
          layout="vertical" align="right" verticalAlign="middle"
          wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono', lineHeight: '20px' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ReceivablesBar({ received, pending }) {
  const data = [{ name: 'Sales', Received: received, Pending: pending }];
  return (
    <ResponsiveContainer width="100%" height={110}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
        <XAxis type="number" tickFormatter={fmtCompact} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" hide />
        <Tooltip formatter={moneyTip} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono' }} />
        <Bar dataKey="Received" stackId="a" fill={GREEN} radius={[4, 0, 0, 4]} />
        <Bar dataKey="Pending" stackId="a" fill={AMBER} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CashFlowChart({ cash }) {
  const data = [
    { name: 'Capital in', v: cash.capitalIn, c: GREEN },
    { name: 'Sales received', v: cash.salesReceived, c: GREEN },
    { name: 'Purchases', v: -cash.purchasesOut, c: RED },
    { name: 'Expenses', v: -cash.expensesOut, c: RED },
    { name: 'Draws', v: -cash.drawsOut, c: RED },
    { name: 'Expected bank', v: cash.expectedBank, c: CYAN },
  ];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" axisLine={false} tickLine={false} interval={0} tick={{ fontSize: 10 }} />
        <YAxis tickFormatter={fmtCompact} axisLine={false} tickLine={false} width={60} />
        <Tooltip formatter={(v) => [`LKR ${fmt(v)}`, 'Amount']} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
        <Bar dataKey="v" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.c} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
