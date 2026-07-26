import React, { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { addRow, updateRow, deleteRow, addCategory, addPartner } from '../store.js';
import { fmt } from '../format.js';
import { saleNet, nextGemCode } from '../engine.js';

// Schema-driven ledgers: one table + one form implementation for all five.
function schemas(data) {
  const tripOpts = data.trips.map((t) => ({ value: t.id, label: t.name }));
  return {
    sales: {
      label: 'Sales',
      fields: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'gemCode', label: 'Gem Code', type: 'gemcode', autoValue: nextGemCode(data), hint: 'issued automatically in order — untick for non-gem items (e.g. sarong)' },
        { key: 'description', label: 'Description', type: 'text', full: true },
        { key: 'customer', label: 'Customer', type: 'text' },
        { key: 'tripId', label: 'Trip', type: 'select', options: tripOpts },
        { key: 'status', label: 'Status', type: 'select', options: [{ value: 'Received', label: 'Received' }, { value: 'Pending', label: 'Pending' }] },
        { key: 'commissionPct', label: 'Commission %', type: 'number', noTotal: true, hint: '% deducted from the sale (0 for already-net entries)' },
        { key: 'qty', label: 'Qty', type: 'number', hint: 'pieces sold — draws down trip stock' },
        { key: 'amount', label: 'Amount (LKR)', type: 'number', hint: 'gross sale before commission' },
      ],
      // Net is always derived from amount and commission %, never stored.
      computed: [{ key: 'net', label: 'Net (LKR)', accent: 'pos', compute: saleNet }],
      defaults: { status: 'Pending', commissionPct: 0, qty: 1, gemCode: nextGemCode(data) },
    },
    purchases: {
      label: 'Purchases',
      fields: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'tripId', label: 'Trip', type: 'select', options: tripOpts },
        { key: 'pieces', label: 'Qty (pieces)', type: 'number', hint: 'pieces in the lot — adds to trip stock' },
        { key: 'fundingSource', label: 'Funding source', type: 'text' },
        { key: 'description', label: 'Description', type: 'text', full: true },
        { key: 'amount', label: 'Amount (LKR)', type: 'number', hint: 'total lot cost (no per-piece price)' },
      ],
    },
    expenses: {
      label: 'Expenses',
      fields: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'description', label: 'Description', type: 'text', full: true },
        { key: 'category', label: 'Category', type: 'select', options: data.settings.categories.map((c) => ({ value: c, label: c })), allowNew: addCategory },
        { key: 'tripId', label: 'Trip', type: 'select', options: tripOpts },
        { key: 'amount', label: 'Amount (LKR)', type: 'number' },
      ],
    },
    draws: {
      label: 'Partner Draws',
      fields: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'description', label: 'Description', type: 'text', full: true },
        { key: 'partner', label: 'Partner', type: 'select', options: data.settings.partners.map((p) => ({ value: p, label: p })), allowNew: addPartner },
        { key: 'tripId', label: 'Trip', type: 'select', options: tripOpts },
        { key: 'amount', label: 'Amount (LKR)', type: 'number' },
      ],
    },
    capital: {
      label: 'Capital',
      fields: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'description', label: 'Description', type: 'text', full: true },
        { key: 'amount', label: 'Amount (LKR)', type: 'number' },
      ],
    },
    trips: {
      label: 'Trips',
      fields: [
        { key: 'name', label: 'Trip name', type: 'text', full: true },
        { key: 'status', label: 'Status', type: 'select', options: [{ value: 'Open', label: 'Open' }, { value: 'Closed', label: 'Closed' }] },
      ],
      defaults: { status: 'Open' },
    },
  };
}

function RowForm({ schema, initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => {
    const base = {};
    for (const f of schema.fields) base[f.key] = initial?.[f.key] ?? schema.defaults?.[f.key] ?? '';
    return base;
  });
  const [newOption, setNewOption] = useState({});

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  function submit(e) {
    e.preventDefault();
    const out = { ...form };
    for (const f of schema.fields) {
      if (f.type === 'number') out[f.key] = out[f.key] === '' ? null : Number(out[f.key]);
      if (f.allowNew && out[f.key] === '__new__') {
        const name = (newOption[f.key] || '').trim();
        if (!name) return;
        f.allowNew(name);
        out[f.key] = name;
      }
    }
    onSave(out);
  }

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        {schema.fields.map((f) => (
          <div className={`field${f.full ? ' full' : ''}`} key={f.key}>
            <label>{f.label}</label>
            {f.type === 'select' ? (
              <>
                <select value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} required>
                  <option value="" disabled>Select…</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                  {f.allowNew && <option value="__new__">＋ Add new…</option>}
                </select>
                {f.allowNew && form[f.key] === '__new__' && (
                  <input
                    style={{ marginTop: 6 }}
                    placeholder="New name"
                    value={newOption[f.key] || ''}
                    onChange={(e) => setNewOption((s) => ({ ...s, [f.key]: e.target.value }))}
                    autoFocus
                  />
                )}
              </>
            ) : f.type === 'gemcode' ? (
              <>
                <input
                  value={form[f.key] || '— no code —'}
                  readOnly
                  tabIndex={-1}
                  style={{ fontFamily: 'var(--mono)', opacity: form[f.key] ? 1 : 0.45 }}
                />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!form[f.key]}
                    onChange={(e) => set(f.key, e.target.checked ? initial?.[f.key] || f.autoValue : '')}
                  />
                  Gemstone sale — auto code
                </label>
              </>
            ) : (
              <input
                type={f.type}
                step={f.type === 'number' ? 'any' : undefined}
                value={form[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                required={f.key === 'amount' || f.key === 'name'}
              />
            )}
            {f.hint && <div className="subtle" style={{ marginTop: 4, fontSize: 10 }}>{f.hint}</div>}
          </div>
        ))}
      </div>
      {schema.computed?.some((c) => c.key === 'net') && (
        <div className="subtle" style={{ marginTop: 12, fontFamily: 'var(--mono)' }}>
          Net after commission ={' '}
          <span className="pos">{fmt(saleNet({ amount: form.amount, commissionPct: form.commissionPct }))}</span>
          {Number(form.commissionPct) > 0 && ` (−${fmt((Number(form.amount) || 0) * (Number(form.commissionPct) || 0) / 100)} commission)`}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn">Save</button>
      </div>
    </form>
  );
}

export default function Ledgers({ data, tripFilter }) {
  const [tab, setTab] = useState('sales');
  const [editing, setEditing] = useState(null); // { row } or { row: null } for add
  const [sort, setSort] = useState({ key: 'date', dir: -1 });
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const allSchemas = schemas(data);
  const schema = allSchemas[tab];
  const tripName = (id) => data.trips.find((t) => t.id === id)?.name || '—';

  const rows = useMemo(() => {
    let out = [...data[tab]];
    if (tab !== 'capital' && tab !== 'trips' && tripFilter) out = out.filter((r) => r.tripId === tripFilter);
    if (tab === 'sales' && statusFilter) {
      if (statusFilter === '__returned') out = out.filter((r) => r.returned);
      else if (statusFilter === '__active') out = out.filter((r) => !r.returned);
      else out = out.filter((r) => r.status === statusFilter && !r.returned);
    }
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
    }
    const sortCol = (allSchemas[tab].computed || []).find((c) => c.key === sort.key);
    out.sort((a, b) => {
      const va = sortCol ? sortCol.compute(a) : (a[sort.key] ?? '');
      const vb = sortCol ? sortCol.compute(b) : (b[sort.key] ?? '');
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb)) * sort.dir;
    });
    return out;
  }, [data, tab, tripFilter, statusFilter, search, sort]);

  function onDelete(row) {
    if (tab === 'trips') {
      const used = ['sales', 'purchases', 'expenses', 'draws'].some((c) => data[c].some((r) => r.tripId === row.id));
      if (used) {
        alert('This trip still has ledger entries. Delete or reassign them first.');
        return;
      }
    }
    const label = row.description || row.name || 'this entry';
    if (confirm(`Delete "${label}"${row.amount ? ` (LKR ${fmt(row.amount)})` : ''}? This cannot be undone.`)) {
      deleteRow(tab, row.id);
    }
  }

  // Returning a sale unwinds it everywhere: no revenue, no receivable, and the
  // piece goes back into stock. A sale already Received also implies a refund,
  // so cash in drops — spelled out in the confirm rather than done silently.
  function onToggleReturn(row) {
    const label = [row.gemCode, row.description].filter(Boolean).join(' · ') || 'this sale';
    if (row.returned) {
      if (confirm(`Undo the return on ${label}?\n\nIt counts as a live sale again (LKR ${fmt(row.amount)}) and the piece leaves stock.`)) {
        updateRow('sales', row.id, { returned: false, returnDate: '' });
      }
      return;
    }
    const pieces = Number(row.qty) || 0;
    const stockLine = pieces ? `\n• ${fmt(pieces)} piece(s) go back into stock` : '';
    const moneyLine =
      row.status === 'Received'
        ? `\n• This sale was already RECEIVED — the return assumes you refunded LKR ${fmt(row.amount)}, so cash in drops by that amount.`
        : `\n• The pending receivable of LKR ${fmt(saleNet(row))} is removed.`;
    if (confirm(`Mark ${label} as RETURNED?${moneyLine}${stockLine}\n\nThe row stays in the ledger for history and can be undone.`)) {
      updateRow('sales', row.id, { returned: true, returnDate: new Date().toISOString().slice(0, 10) });
    }
  }

  function headerCell(key, label, numeric = false) {
    const active = sort.key === key;
    return (
      <th className={numeric ? 'num' : ''} onClick={() => setSort({ key, dir: active ? -sort.dir : 1 })}>
        {label} {active ? (sort.dir === 1 ? '▲' : '▼') : ''}
      </th>
    );
  }

  const computedCols = schema.computed || [];
  const cols = [...schema.fields, ...computedCols];
  // Columns whose values sum meaningfully in the TOTAL row.
  const totalCols = cols.filter((c) => (c.type === 'number' || c.compute) && !c.noTotal);
  const colTotal = (c) => rows.reduce((t, r) => t + (c.compute ? c.compute(r) : Number(r[c.key]) || 0), 0);
  const firstTotalIdx = cols.findIndex((c) => totalCols.includes(c));

  return (
    <div className="panel span12">
      <div className="tabs">
        {Object.entries(allSchemas).map(([key, s]) => (
          <button key={key} className={`tab${tab === key ? ' active' : ''}`} onClick={() => { setTab(key); setSort({ key: 'date', dir: -1 }); }}>
            {s.label}
            <span style={{ opacity: 0.5, marginLeft: 6 }}>{data[key].length}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        {tab === 'sales' && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="Received">Received</option>
            <option value="Pending">Pending</option>
            <option value="__returned">Returned only</option>
            <option value="__active">Hide returned</option>
          </select>
        )}
        <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 200 }} />
        <div className="spacer" />
        <button className="btn" onClick={() => setEditing({ row: null })}>＋ Add {schema.label.replace(/s$/, '')}</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              {cols.map((f) => headerCell(f.key, f.label.replace(' (LKR)', ''), f.type === 'number' || !!f.compute))}
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.returned ? 'returned' : ''}>
                {cols.map((f) => {
                  const numeric = f.type === 'number' || !!f.compute;
                  let content;
                  if (f.compute) {
                    content = <span className={f.accent || ''}>{fmt(f.compute(r))}</span>;
                  } else if (f.key === 'gemCode') {
                    content = r.gemCode ? <span className="gemcode">{r.gemCode}</span> : <span className="subtle">—</span>;
                  } else if (f.key === 'tripId') {
                    content = tripName(r.tripId);
                  } else if (f.key === 'status' && tab === 'sales') {
                    content = r.returned ? (
                      <span className="badge danger" title={r.returnDate ? `Returned ${r.returnDate}` : 'Returned'}>
                        returned
                      </span>
                    ) : (
                      <span className={`badge ${r.status === 'Received' ? 'ok' : 'warn'}`}>{r.status}</span>
                    );
                  } else if (f.key === 'status') {
                    content = <span className={`badge ${r.status === 'Open' ? 'info' : 'ok'}`}>{r.status}</span>;
                  } else if (f.key === 'commissionPct') {
                    content = r.commissionPct ? `${fmt(r.commissionPct)}%` : <span className="subtle">0%</span>;
                  } else if (f.type === 'number' && r[f.key] != null && r[f.key] !== '') {
                    content = fmt(r[f.key]);
                  } else {
                    content = (r[f.key] ?? '') || <span className="subtle">—</span>;
                  }
                  return <td key={f.key} className={numeric ? 'num' : ''}>{content}</td>;
                })}
                <td>
                  <div className="row-actions">
                    {tab === 'sales' && (
                      <button
                        className={`btn icon ${r.returned ? '' : 'ghost'}`}
                        onClick={() => onToggleReturn(r)}
                        title={r.returned ? 'Undo this return' : 'Gem returned — reverse the sale and put the piece back in stock'}
                      >
                        {r.returned ? 'Undo' : '↩ Return'}
                      </button>
                    )}
                    <button className="btn ghost icon" onClick={() => setEditing({ row: r })}>Edit</button>
                    <button className="btn danger icon" onClick={() => onDelete(r)}>Del</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="subtle">No entries.</td></tr>
            )}
            {tab !== 'trips' && rows.length > 0 && (
              <tr className="total-row">
                <td colSpan={Math.max(1, firstTotalIdx)}>TOTAL ({rows.length} entries)</td>
                {cols.slice(Math.max(1, firstTotalIdx)).map((c) => (
                  <td key={c.key} className={c.type === 'number' || c.compute ? 'num' : ''}>
                    {totalCols.includes(c) ? fmt(colTotal(c)) : ''}
                  </td>
                ))}
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal
          title={editing.row ? `Edit ${schema.label}` : `Add ${schema.label}`}
          onClose={() => setEditing(null)}
        >
          <RowForm
            schema={schema}
            initial={editing.row}
            onCancel={() => setEditing(null)}
            onSave={(values) => {
              if (editing.row) updateRow(tab, editing.row.id, values);
              else addRow(tab, values);
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
