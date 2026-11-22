import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate, todayISO } from '../api.js';
import { PeriodPdfModal } from '../components/AttendancePdfModal.jsx';
import { ErrorNote, Field, Modal, Spinner } from '../components/ui.jsx';

const shiftDate = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
export const fmtQty = (n) => (n == null ? '–' : (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }));
const UNITS = ['bags', 'tonnes', 'kg', 'm³', 'm²', 'm', 'litres', 'no.', 'rolls', 'sheets', 'lengths', 'loads', 'trips', 'pairs', 'drums', 'pallets'];

export default function MaterialsPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || todayISO();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [entry, setEntry] = useState(null); // {type, ...} being added/edited
  const [manageOpen, setManageOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [stockQ, setStockQ] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/api/projects/${id}/materials/day/${date}`));
    } catch (e) {
      setError(e.message);
    }
  }, [id, date]);
  useEffect(() => {
    setData(null);
    setWarning(null);
    load();
  }, [load]);

  const goDate = (d) => setParams(d === todayISO() ? {} : { date: d });
  const isToday = date === todayISO();
  const active = (data?.materials || []).filter((m) => m.active);
  const stockShown = useMemo(() => {
    const s = stockQ.trim().toLowerCase();
    return active.filter((m) => !s || m.name.toLowerCase().includes(s)).sort((a, b) => Number(b.low || b.negative) - Number(a.low || a.negative) || a.name.localeCompare(b.name));
  }, [active, stockQ]);

  const remove = async (mv) => {
    if (!confirm(`Delete this ${mv.type === 'delivered' ? 'delivery' : 'entry'} (${fmtQty(mv.quantity)} ${mv.unit} ${mv.material})?`)) return;
    try {
      const res = await api.del(`/api/material-movements/${mv.id}`);
      setWarning(res.warning);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading materials…" />;
  const day = data.day;

  return (
    <div className="register">
      <nav className="crumbs">
        <Link to="/">Projects</Link> / <Link to={`/projects/${id}`}>{data.project.name}</Link> / <span>Materials</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>Materials register</h1>
          <p className="muted">Record deliveries and what was used each day. Stock on hand updates automatically.</p>
        </div>
        <div className="row gap wrap head-actions">
          {data.materials.length > 0 && <button className="btn ghost" onClick={() => setPdfOpen(true)}>Download PDF</button>}
          <button className="btn ghost" onClick={() => setManageOpen(true)}>Manage materials</button>
        </div>
      </div>

      <div className="date-nav card">
        <button className="icon-btn big" onClick={() => goDate(shiftDate(date, -1))} aria-label="Previous day">‹</button>
        <div className="date-nav-main">
          <div className="date-nav-label">{isToday ? 'Today' : fmtDate(date, { weekday: 'long' })}</div>
          <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && goDate(e.target.value)} aria-label="Date" />
        </div>
        <button className="icon-btn big" onClick={() => goDate(shiftDate(date, 1))} disabled={date >= todayISO()} aria-label="Next day">›</button>
        {!isToday && <button className="btn ghost sm" onClick={() => goDate(todayISO())}>Today</button>}
      </div>

      <ErrorNote error={error} onClose={() => setError(null)} />
      {warning && <div className="note warn"><span>{warning}</span><button className="icon-btn" onClick={() => setWarning(null)} aria-label="Dismiss">✕</button></div>}

      {data.materials.length === 0 ? (
        <section className="card empty-inline">
          <h2>Add your materials first</h2>
          <p className="muted">List the materials you track on this project (with units and current stock). Then record deliveries and usage each day.</p>
          <button className="btn primary" onClick={() => setManageOpen(true)}>Add materials</button>
        </section>
      ) : (
        <>
          <div className="mat-actions">
            <button className="btn primary lg" onClick={() => setEntry({ type: 'delivered' })}>+ Record delivery</button>
            <button className="btn ghost lg" onClick={() => setEntry({ type: 'used' })}>+ Record usage</button>
          </div>

          <section className="card">
            <h2>{isToday ? "Today's" : fmtDate(date, { day: 'numeric', month: 'short' })} movements</h2>
            {!day || day.movement_count === 0 ? (
              <p className="muted">Nothing recorded for this day yet.</p>
            ) : (
              <>
                <div className="table-scroll">
                  <table className="table stack-mobile">
                    <thead><tr><th>Material</th><th className="num">Opening</th><th className="num">Received</th><th className="num">Used</th><th className="num">Wasted</th><th className="num">Closing</th></tr></thead>
                    <tbody>
                      {day.rows.map((r) => (
                        <tr key={r.material_id}>
                          <td className="cell-title">{r.name} <span className="muted small">({r.unit})</span></td>
                          <td className="num" data-label="Opening">{fmtQty(r.opening)}</td>
                          <td className="num pos" data-label="Received">{r.delivered ? `+${fmtQty(r.delivered)}` : '–'}</td>
                          <td className="num" data-label="Used">{r.used ? `−${fmtQty(r.used)}` : '–'}</td>
                          <td className="num" data-label="Wasted">{r.wasted ? `−${fmtQty(r.wasted)}` : '–'}</td>
                          <td className="num" data-label="Closing"><b className={r.negative || r.low ? 'neg' : ''}>{fmtQty(r.closing)}</b>{r.negative ? <span className="stock-tag bad">check</span> : r.low ? <span className="stock-tag low">low</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <MovementList title="Deliveries" items={day.deliveries} onEdit={setEntry} onDelete={remove} />
                <MovementList title="Used & wasted" items={day.usage} onEdit={setEntry} onDelete={remove} />
              </>
            )}
          </section>

          <section className="card">
            <div className="row between wrap gap">
              <h2>Stock on hand {isToday ? '' : `at end of ${fmtDate(date, { day: 'numeric', month: 'short' })}`}</h2>
              {active.length > 8 && <input className="search sm" placeholder="Search materials…" value={stockQ} onChange={(e) => setStockQ(e.target.value)} aria-label="Search materials" />}
            </div>
            <div className="table-scroll">
              <table className="table stack-mobile">
                <thead><tr><th>Material</th><th className="num">In stock</th><th className="num">Reorder at</th><th>Last delivery</th></tr></thead>
                <tbody>
                  {stockShown.map((m) => (
                    <tr key={m.id} className={m.negative ? 'row-bad' : m.low ? 'row-low' : ''}>
                      <td className="cell-title">{m.name}</td>
                      <td className="num" data-label="In stock">
                        <b>{fmtQty(m.stock)}</b> {m.unit}
                        {m.negative ? <span className="stock-tag bad">check records</span> : m.low ? <span className="stock-tag low">low</span> : null}
                      </td>
                      <td className="num muted" data-label="Reorder at">{m.reorder_level != null ? `${fmtQty(m.reorder_level)} ${m.unit}` : '–'}</td>
                      <td className="muted" data-label="Last delivery">{m.last_delivery ? fmtDate(m.last_delivery) : 'None yet'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {entry && (
        <EntryModal
          projectId={id}
          date={date}
          entry={entry}
          materials={active}
          activities={data.activities}
          types={data.types}
          onClose={() => setEntry(null)}
          onSaved={(res, again) => {
            setWarning(res.warning);
            load();
            if (!again) setEntry(null);
          }}
          onAddMaterial={() => setManageOpen(true)}
        />
      )}
      {pdfOpen && (
        <PeriodPdfModal
          title="Download materials register"
          description="Stock summary (stock at start, received, used, wasted, stock at end, low stock), every delivery with supplier and delivery note, every usage and wastage entry, and totals used per programme activity."
          hrefBase={`/api/projects/${id}/materials-pdf`}
          maxDays={92}
          day={date}
          defaultPreset="day"
          onClose={() => setPdfOpen(false)}
        />
      )}
      {manageOpen && <MaterialsModal projectId={id} onClose={() => setManageOpen(false)} onChanged={load} />}
    </div>
  );
}

function MovementList({ title, items, onEdit, onDelete }) {
  if (!items.length) return null;
  return (
    <div className="mv-list">
      <h4>{title}</h4>
      {items.map((m) => (
        <div key={m.id} className={`mv-row ${m.type}`}>
          <div className="mv-main">
            <div><b>{fmtQty(m.quantity)} {m.unit}</b> {m.material}{m.type === 'wasted' && <span className="stock-tag low">wasted</span>}</div>
            <div className="muted small">
              {[m.type === 'delivered' && m.supplier, m.type === 'delivered' && m.reference && `Note ${m.reference}`, m.activity_name, m.location, m.notes, m.recorded_by && `by ${m.recorded_by}`].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="mv-actions">
            <button className="btn ghost sm" onClick={() => onEdit(m)}>Edit</button>
            <button className="icon-btn danger" onClick={() => onDelete(m)} aria-label="Delete">✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function EntryModal({ projectId, date, entry, materials, activities, types, onClose, onSaved, onAddMaterial }) {
  const editing = Boolean(entry.id);
  const [f, setF] = useState({
    type: entry.type || 'delivered',
    material_id: entry.material_id ? String(entry.material_id) : '',
    quantity: entry.quantity ?? '',
    supplier: entry.supplier || '',
    reference: entry.reference || '',
    activity_id: entry.activity_id ? String(entry.activity_id) : '',
    location: entry.location || '',
    notes: entry.notes || '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const mat = materials.find((m) => String(m.id) === f.material_id);
  const isDelivery = f.type === 'delivered';

  const submit = async (again) => {
    setBusy(true);
    setError(null);
    try {
      const body = { ...f, date, material_id: Number(f.material_id), activity_id: f.activity_id ? Number(f.activity_id) : null };
      const res = editing ? await api.put(`/api/material-movements/${entry.id}`, body) : await api.post(`/api/projects/${projectId}/material-movements`, body);
      onSaved(res, again);
      if (again) {
        setSaved((n) => n + 1);
        // Keep the type and supplier (several items often come on one delivery); clear everything else.
        setF((x) => ({ ...x, material_id: '', quantity: '', reference: '', notes: '', activity_id: '', location: '' }));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit entry' : isDelivery ? 'Record delivery' : 'Record usage'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>{saved ? 'Done' : 'Cancel'}</button>
          {!editing && <button className="btn ghost" disabled={busy} onClick={() => submit(true)}>Save & add another</button>}
          <button className="btn primary" disabled={busy} onClick={() => submit(false)}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        <ErrorNote error={error} />
        {saved > 0 && <div className="note success small"><span>{saved} saved. Add the next one.</span></div>}
        <div className="segmented" role="radiogroup" aria-label="Type">
          {Object.entries(types).map(([k, v]) => (
            <label key={k} className={f.type === k ? 'on' : ''}><input type="radio" checked={f.type === k} onChange={() => setF((x) => ({ ...x, type: k }))} /> {v}</label>
          ))}
        </div>
        <Field label="Material *">
          <div className="row gap">
            <select value={f.material_id} onChange={set('material_id')} required autoFocus>
              <option value="">Choose material…</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({fmtQty(m.stock)} {m.unit} in stock)</option>)}
            </select>
            <button type="button" className="btn ghost sm" onClick={onAddMaterial} title="Add a material to the list">New</button>
          </div>
        </Field>
        <Field label={`Quantity *${mat ? ` (${mat.unit})` : ''}`}>
          <input type="number" min="0" step="any" inputMode="decimal" value={f.quantity} onChange={set('quantity')} required />
        </Field>
        {isDelivery ? (
          <div className="grid-2">
            <Field label="Supplier"><input value={f.supplier} onChange={set('supplier')} /></Field>
            <Field label="Delivery note / waybill no."><input value={f.reference} onChange={set('reference')} /></Field>
          </div>
        ) : (
          <div className="grid-2">
            <Field label="Used on (programme activity)">
              <select value={f.activity_id} onChange={set('activity_id')}>
                <option value="">—</option>
                {activities.map((a) => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ''}{a.name}</option>)}
              </select>
            </Field>
            <Field label="Location / area"><input value={f.location} onChange={set('location')} placeholder="e.g. Grid A1–A4" /></Field>
          </div>
        )}
        <Field label="Notes"><input value={f.notes} onChange={set('notes')} placeholder={isDelivery ? 'Condition on arrival, shortages…' : f.type === 'wasted' ? 'What happened?' : ''} /></Field>
      </form>
    </Modal>
  );
}

export function MaterialsModal({ projectId, onClose, onChanged }) {
  const [materials, setMaterials] = useState(null);
  const [tab, setTab] = useState('list');
  const [form, setForm] = useState({ name: '', unit: 'bags', opening_stock: '', reorder_level: '' });
  const [lines, setLines] = useState('');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    api.get(`/api/projects/${projectId}/materials`).then((d) => {
      setMaterials(d.materials);
      if (!d.materials.length) setTab('paste');
    }).catch((e) => setError(e.message));
  }, [projectId]);

  const run = async (fn, msg) => {
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      setMaterials(res.materials);
      if (msg) setNotice(typeof msg === 'function' ? msg(res) : msg);
      onChanged();
      return res;
    } catch (e) {
      setError(e.message);
      return null;
    }
  };
  const active = (materials || []).filter((m) => m.active);
  const archived = (materials || []).filter((m) => !m.active);

  return (
    <Modal title="Materials" wide onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {notice && <div className="note success"><span>{notice}</span></div>}
      <div className="segmented" role="tablist">
        <label className={tab === 'list' ? 'on' : ''}><input type="radio" checked={tab === 'list'} onChange={() => setTab('list')} /> Materials ({active.length})</label>
        <label className={tab === 'add' ? 'on' : ''}><input type="radio" checked={tab === 'add'} onChange={() => setTab('add')} /> Add one</label>
        <label className={tab === 'paste' ? 'on' : ''}><input type="radio" checked={tab === 'paste'} onChange={() => setTab('paste')} /> Paste a list</label>
      </div>
      <datalist id="mat-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>

      {!materials ? <Spinner label="Loading…" /> : tab === 'add' ? (
        <form
          className="grid-2 wf-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => api.post(`/api/projects/${projectId}/materials`, form), (res) => (res.added ? `${form.name} added.` : `${form.name} is already on the list.`));
            if (r) setForm({ name: '', unit: form.unit, opening_stock: '', reorder_level: '' });
          }}
        >
          <Field label="Material name *" className="span-2"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus placeholder="e.g. Cement 42.5R" /></Field>
          <Field label="Unit *"><input list="mat-units" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required /></Field>
          <Field label="Stock on site now" hint="Leave empty if none."><input type="number" min="0" step="any" value={form.opening_stock} onChange={(e) => setForm({ ...form, opening_stock: e.target.value })} /></Field>
          <Field label="Reorder level" hint="Warn when stock falls to this." className="span-2"><input type="number" min="0" step="any" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} /></Field>
          <div className="span-2"><button className="btn primary">Add material</button></div>
        </form>
      ) : tab === 'paste' ? (
        <div className="stack">
          <p className="muted small">One material per line: <b>Name, Unit, Stock on site now, Reorder level</b>. Only the name is required. You can also copy rows from Excel.</p>
          <textarea rows={8} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'Cement 42.5R, bags, 120, 50\nSharp sand, tonnes, 20, 5\nY16 rebar, tonnes, 2, 1\nHollow blocks 9", no., 0, 500'} />
          <div>
            <button
              className="btn primary"
              disabled={!lines.trim()}
              onClick={async () => {
                const r = await run(
                  () => api.post(`/api/projects/${projectId}/materials`, { lines }),
                  (res) => `${res.added} added${res.skipped.length ? `; ${res.skipped.length} already on the list (${res.skipped.slice(0, 5).join(', ')})` : ''}.`
                );
                if (r) {
                  setLines('');
                  setTab('list');
                }
              }}
            >
              Add these materials
            </button>
          </div>
        </div>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="muted">No materials yet. Use <b>Add one</b> or <b>Paste a list</b>.</p>
          ) : (
            <div className="table-scroll">
              <table className="table compact stack-mobile">
                <thead><tr><th>Material</th><th>Unit</th><th className="num">Opening stock</th><th className="num">Reorder at</th><th className="num">In stock</th><th /></tr></thead>
                <tbody>
                  {active.map((m) => <MaterialRow key={m.id} m={m} editing={editing === m.id} setEditing={setEditing} run={run} />)}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">Opening stock is what was on site before you started recording. Changing it recalculates all balances.</p>
          {archived.length > 0 && (
            <details className="wf-left">
              <summary className="small">Archived materials ({archived.length})</summary>
              <ul className="plain-list">
                {archived.map((m) => (
                  <li key={m.id}>{m.name} <button className="btn ghost sm" onClick={() => run(() => api.put(`/api/materials/${m.id}`, { active: true }), `${m.name} restored.`)}>Restore</button></li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Modal>
  );
}

function MaterialRow({ m, editing, setEditing, run }) {
  const [f, setF] = useState({ name: m.name, unit: m.unit, opening_stock: m.opening_stock, reorder_level: m.reorder_level ?? '' });
  if (editing) {
    return (
      <tr className="editing">
        <td data-label="Material"><input className="cell-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" /></td>
        <td data-label="Unit"><input className="cell-input" list="mat-units" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} aria-label="Unit" /></td>
        <td data-label="Opening stock"><input className="cell-input num" type="number" step="any" value={f.opening_stock} onChange={(e) => setF({ ...f, opening_stock: e.target.value })} aria-label="Opening stock" /></td>
        <td data-label="Reorder at"><input className="cell-input num" type="number" step="any" value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: e.target.value })} aria-label="Reorder level" /></td>
        <td />
        <td className="right nowrap">
          <button className="btn primary sm" onClick={async () => (await run(() => api.put(`/api/materials/${m.id}`, f), 'Saved.')) && setEditing(null)}>Save</button>{' '}
          <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="cell-title">{m.name}</td>
      <td data-label="Unit">{m.unit}</td>
      <td className="num" data-label="Opening stock">{fmtQty(m.opening_stock)}</td>
      <td className="num" data-label="Reorder at">{m.reorder_level != null ? fmtQty(m.reorder_level) : '–'}</td>
      <td className="num" data-label="In stock"><b className={m.low || m.negative ? 'neg' : ''}>{fmtQty(m.stock)}</b></td>
      <td className="right nowrap">
        <button className="btn ghost sm" onClick={() => setEditing(m.id)}>Edit</button>{' '}
        <button
          className="btn ghost sm danger-text"
          onClick={() =>
            confirm(m.movement_count ? `Archive ${m.name}? Its history is kept.` : `Remove ${m.name}?`) &&
            run(() => api.del(`/api/materials/${m.id}`), (res) => (res.archived ? `${m.name} archived; history kept.` : `${m.name} removed.`))
          }
        >
          {m.movement_count ? 'Archive' : 'Remove'}
        </button>
      </td>
    </tr>
  );
}
