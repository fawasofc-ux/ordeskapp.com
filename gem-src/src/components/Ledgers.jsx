import React, { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { addRow, updateRow, deleteRow, addCategory, addPartner } from '../store.js';
import { fmt } from '../format.js';

// Schema-driven ledgers: one table + one form implementation for all five.
function schemas(data) {
  const tripOpts = data.trips.map((t) => ({ value: t.id, label: t.name }));
  return {
    sales: {
      label: 'Sales',
      fields: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'description', label: 'Description', type: 'text', full: true },
        { key: 'customer', label: 'Customer', type: 'text' },
        { key: 'tripId', label: 'Trip', type: 'select', options: tripOpts },
        { key: 'status', label: 'Status', type: 'select', options: [{ value: 'Received', label: 'Received' }, { value: 'Pending', label: 'Pending' }] },
        { key: 'amount', label: 'Amount (LKR)', type: 'number' },
      ],
      defaults: { status: 'Pending' },
    },
    purchases: {
      label: 'Purchases',
      fields: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'tripId', label: 'Trip', type: 'select', options: tripOpts },
        { key: 'pieces', label: 'Pieces', type: 'number' },
        { key: 'fundingSource', label: 'Funding source', type: 'text' },
        { key: 'description', label: 'Description', type: 'text', full: true },
        { key: 'amount', label: 'Amount (LKR)', type: 'number' },
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
            ) : (
              <input
                type={f.type}
                step={f.type === 'number' ? 'any' : undefined}
                value={form[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                required={f.key === 'amount' || f.key === 'name'}
              />
            )}
          </div>
        ))}
      </div>
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
    if (tab === 'sales' && statusFilter) out = out.filter((r) => r.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
    }
    out.sort((a, b) => {
      const va = a[sort.key] ?? '';
      const vb = b[sort.key] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb)) * sort.dir;
    });
    return out;
  }, [data, tab, tripFilter, statusFilter, search, sort]);

  const total = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);

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

  function headerCell(key, label, numeric = false) {
    const active = sort.key === key;
    return (
      <th className={numeric ? 'num' : ''} onClick={() => setSort({ key, dir: active ? -sort.dir : 1 })}>
        {label} {active ? (sort.dir === 1 ? '▲' : '▼') : ''}
      </th>
    );
  }

  const cols = schema.fields;
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
              {cols.map((f) => headerCell(f.key, f.label.replace(' (LKR)', ''), f.type === 'number'))}
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {cols.map((f) => (
                  <td key={f.key} className={f.type === 'number' ? 'num' : ''}>
                    {f.key === 'tripId' ? tripName(r.tripId)
                      : f.key === 'status' && tab === 'sales' ? (
                        <span className={`badge ${r.status === 'Received' ? 'ok' : 'warn'}`}>{r.status}</span>
                      ) : f.key === 'status' ? (
                        <span className={`badge ${r.status === 'Open' ? 'info' : 'ok'}`}>{r.status}</span>
                      ) : f.type === 'number' && r[f.key] != null && r[f.key] !== '' ? fmt(r[f.key])
                      : (r[f.key] ?? '') || <span className="subtle">—</span>}
                  </td>
                ))}
                <td>
                  <div className="row-actions">
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
                <td colSpan={cols.length - 1}>TOTAL ({rows.length} entries)</td>
                <td className="num">{fmt(total)}</td>
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
