import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate, todayISO } from '../api.js';
import { ErrorNote, Field, Modal, Spinner } from '../components/ui.jsx';

const STATUS = [
  { key: 'present', label: 'Present', short: 'P' },
  { key: 'late', label: 'Late', short: 'L' },
  { key: 'absent', label: 'Absent', short: 'A' },
];
const shiftDate = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const nowHHMM = () => new Date().toTimeString().slice(0, 5);

export default function AttendancePage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || todayISO();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [workforceOpen, setWorkforceOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.get(`/api/projects/${id}/attendance/${date}`);
      setData(d);
      setRows(d.rows);
      setNotes(d.notes || '');
      setDirty(false);
    } catch (e) {
      setError(e.message);
    }
  }, [id, date]);

  useEffect(() => {
    setData(null);
    setSaved(null);
    load();
  }, [load]);

  // Warn before leaving with unsaved marks.
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, unmarked: 0 };
    for (const r of rows) c[r.status || 'unmarked']++;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && (r.status || 'unmarked') !== filter) return false;
      return !s || `${r.name} ${r.trade || ''} ${r.employer || ''}`.toLowerCase().includes(s);
    });
  }, [rows, filter, q]);

  const groups = useMemo(() => {
    const g = new Map();
    for (const r of shown) {
      const k = r.trade || 'General';
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r);
    }
    return [...g.entries()];
  }, [shown]);

  const update = (wid, patch) => {
    setRows((rs) => rs.map((r) => (r.worker_id === wid ? { ...r, ...patch } : r)));
    setDirty(true);
    setSaved(null);
  };
  const setStatus = (r, status) => {
    if (r.status === status) return update(r.worker_id, { status: null });
    update(r.worker_id, { status, time_in: status === 'late' ? r.time_in || nowHHMM() : '', absence_reason: status === 'absent' ? r.absence_reason || '' : '' });
  };
  const markRestPresent = () => {
    setRows((rs) => rs.map((r) => (r.status ? r : { ...r, status: 'present' })));
    setDirty(true);
    setSaved(null);
  };

  const goDate = (d) => {
    if (dirty && !confirm('You have unsaved changes on this register. Leave without saving?')) return;
    setParams(d === todayISO() ? {} : { date: d });
  };

  const save = async () => {
    const missing = rows.filter((r) => r.status === 'absent' && !r.absence_reason);
    if (missing.length && !confirm(`${missing.length} absentee${missing.length > 1 ? 's have' : ' has'} no reason selected. Save anyway?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.put(`/api/projects/${id}/attendance/${date}`, {
        notes,
        entries: rows.filter((r) => r.status).map(({ worker_id, status, time_in, absence_reason, note }) => ({ worker_id, status, time_in, absence_reason, note })),
      });
      setSaved(res.summary);
      setDirty(false);
      setData((d) => ({ ...d, taken: true, taken_by: res.summary.taken_by }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading register…" />;

  const isToday = date === todayISO();
  const absentees = rows.filter((r) => r.status === 'absent');
  const reasons = data.reasons;

  return (
    <div className="register">
      <nav className="crumbs">
        <Link to="/">Projects</Link> / <Link to={`/projects/${id}`}>{data.project.name}</Link> / <span>Attendance</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>Attendance register</h1>
          <p className="muted">
            {data.taken ? `Taken by ${data.taken_by}` : isToday ? "Today's register hasn't been taken yet." : 'No register was taken on this day.'}
          </p>
        </div>
        <button className="btn ghost" onClick={() => setWorkforceOpen(true)}>Manage workforce</button>
      </div>

      <div className="date-nav card">
        <button className="icon-btn big" onClick={() => goDate(shiftDate(date, -1))} aria-label="Previous day">‹</button>
        <div className="date-nav-main">
          <div className="date-nav-label">{isToday ? 'Today' : fmtDate(date, { weekday: 'long' })}</div>
          <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && goDate(e.target.value)} aria-label="Register date" />
        </div>
        <button className="icon-btn big" onClick={() => goDate(shiftDate(date, 1))} disabled={date >= todayISO()} aria-label="Next day">›</button>
        {!isToday && <button className="btn ghost sm" onClick={() => goDate(todayISO())}>Today</button>}
      </div>

      <ErrorNote error={error} onClose={() => setError(null)} />
      {saved && (
        <div className="note success">
          <span>Register saved: <b>{saved.on_site}</b> on site, <b>{saved.absent}</b> absent.</span>
          <button className="btn ghost sm" onClick={() => navigate(`/projects/${id}`)}>Back to dashboard</button>
        </div>
      )}

      {rows.length === 0 ? (
        <section className="card empty-inline">
          <h2>Add your workforce first</h2>
          <p className="muted">The register lists everyone working on this project. Add them once; each morning you just mark who is here.</p>
          <button className="btn primary" onClick={() => setWorkforceOpen(true)}>Add workers</button>
        </section>
      ) : (
        <>
          <div className="att-chips" role="tablist" aria-label="Filter by status">
            {[
              ['all', 'All', rows.length],
              ['present', 'Present', counts.present],
              ['late', 'Late', counts.late],
              ['absent', 'Absent', counts.absent],
              ['unmarked', 'Not marked', counts.unmarked],
            ].map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={`att-chip ${k} ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                {label} <b>{n}</b>
              </button>
            ))}
          </div>

          <div className="att-tools">
            <input className="search sm" placeholder="Search name, trade or employer…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search workers" />
            {counts.unmarked > 0 && (
              <button className="btn ghost sm" onClick={markRestPresent}>Mark {counts.unmarked === rows.length ? 'everyone' : `the other ${counts.unmarked}`} present</button>
            )}
          </div>

          <section className="card att-list">
            {groups.map(([trade, list]) => (
              <div key={trade}>
                <div className="act-group-head">{trade} <span className="muted">({list.length})</span></div>
                {list.map((r) => (
                  <div key={r.worker_id} className={`att-row ${r.status || 'unmarked'}`}>
                    <div className="att-person">
                      <div className="att-name">{r.name}{!r.active && <span className="badge sm">left</span>}</div>
                      {r.employer && <div className="muted small">{r.employer}</div>}
                    </div>
                    <div className="att-status" role="group" aria-label={`Attendance for ${r.name}`}>
                      {STATUS.map((s) => (
                        <button key={s.key} className={`att-btn ${s.key} ${r.status === s.key ? 'on' : ''}`} aria-pressed={r.status === s.key} onClick={() => setStatus(r, s.key)}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                    {r.status === 'late' && (
                      <div className="att-extra">
                        <label className="inline-field">Arrived <input type="time" value={r.time_in} onChange={(e) => update(r.worker_id, { time_in: e.target.value })} /></label>
                        <input className="att-note" placeholder="Note (optional)" value={r.note} onChange={(e) => update(r.worker_id, { note: e.target.value })} />
                      </div>
                    )}
                    {r.status === 'absent' && (
                      <div className="att-extra">
                        <select value={r.absence_reason} onChange={(e) => update(r.worker_id, { absence_reason: e.target.value })} aria-label="Reason for absence" className={r.absence_reason ? '' : 'needs'}>
                          <option value="">Reason…</option>
                          {Object.entries(reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <input className="att-note" placeholder="Note (optional)" value={r.note} onChange={(e) => update(r.worker_id, { note: e.target.value })} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {!groups.length && <p className="muted pad">No one matches.</p>}
          </section>

          <section className="card">
            <h2>Absentees ({absentees.length})</h2>
            {absentees.length === 0 ? (
              <p className="muted">No absentees{counts.unmarked ? ' marked yet' : ''}.</p>
            ) : (
              <ul className="absentee-list">
                {absentees.map((r) => (
                  <li key={r.worker_id}>
                    <b>{r.name}</b>
                    <span className="muted"> · {r.trade || 'General'}{r.employer ? ` · ${r.employer}` : ''}</span>
                    <span className={`reason ${r.absence_reason ? '' : 'missing'}`}>{reasons[r.absence_reason] || 'No reason selected'}</span>
                    {r.note && <span className="muted small"> – {r.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <Field label="Notes for this register (optional)">
              <textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="e.g. Toolbox talk at 07:30; subcontractor gang arrived at 09:00" />
            </Field>
          </section>

          <div className="form-actions">
            {dirty && <span className="muted small unsaved">Unsaved changes{counts.unmarked ? ` · ${counts.unmarked} not marked` : ''}</span>}
            <button className="btn primary lg" onClick={save} disabled={saving || (!dirty && data.taken) || rows.every((r) => !r.status)}>
              {saving ? 'Saving…' : data.taken ? 'Save changes' : 'Save register'}
            </button>
          </div>
        </>
      )}

      {workforceOpen && (
        <WorkforceModal
          projectId={id}
          onClose={() => setWorkforceOpen(false)}
          onChanged={() => {
            // Keep unsaved marks; add new people as unmarked.
            api.get(`/api/projects/${id}/attendance/${date}`).then((d) => {
              setRows((cur) => {
                const byId = new Map(cur.map((r) => [r.worker_id, r]));
                return d.rows.map((r) => (byId.has(r.worker_id) ? { ...r, ...pick(byId.get(r.worker_id)) } : r));
              });
            });
          }}
        />
      )}
    </div>
  );
}

const pick = (r) => ({ status: r.status, time_in: r.time_in, absence_reason: r.absence_reason, note: r.note });

// ------------------------------------------------------------------ Workforce

export function WorkforceModal({ projectId, onClose, onChanged }) {
  const [workers, setWorkers] = useState(null);
  const [tab, setTab] = useState('list');
  const [form, setForm] = useState({ name: '', trade: '', employer: '', phone: '' });
  const [lines, setLines] = useState('');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showLeft, setShowLeft] = useState(false);

  useEffect(() => {
    api.get(`/api/projects/${projectId}/workers`).then((d) => {
      setWorkers(d.workers);
      if (!d.workers.length) setTab('paste');
    }).catch((e) => setError(e.message));
  }, [projectId]);

  const run = async (fn, msg) => {
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      setWorkers(res.workers);
      if (msg) setNotice(typeof msg === 'function' ? msg(res) : msg);
      onChanged();
      return res;
    } catch (e) {
      setError(e.message);
      return null;
    }
  };

  const trades = useMemo(() => [...new Set((workers || []).map((w) => w.trade).filter(Boolean))].sort(), [workers]);
  const employers = useMemo(() => [...new Set((workers || []).map((w) => w.employer).filter(Boolean))].sort(), [workers]);
  const active = (workers || []).filter((w) => w.active);
  const left = (workers || []).filter((w) => !w.active);

  return (
    <Modal title="Workforce" wide onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {notice && <div className="note success"><span>{notice}</span></div>}
      <div className="segmented" role="tablist">
        <label className={tab === 'list' ? 'on' : ''}><input type="radio" checked={tab === 'list'} onChange={() => setTab('list')} /> Workers ({active.length})</label>
        <label className={tab === 'add' ? 'on' : ''}><input type="radio" checked={tab === 'add'} onChange={() => setTab('add')} /> Add one</label>
        <label className={tab === 'paste' ? 'on' : ''}><input type="radio" checked={tab === 'paste'} onChange={() => setTab('paste')} /> Paste a list</label>
      </div>

      {!workers ? <Spinner label="Loading…" /> : tab === 'add' ? (
        <form
          className="grid-2 wf-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => api.post(`/api/projects/${projectId}/workers`, form), (res) => (res.added ? `${form.name} added.` : `${form.name} is already on the list.`));
            if (r) setForm({ name: '', trade: form.trade, employer: form.employer, phone: '' });
          }}
        >
          <Field label="Full name *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></Field>
          <Field label="Trade"><input list="wf-trades" value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} placeholder="e.g. Mason" /></Field>
          <Field label="Employer / subcontractor"><input list="wf-employers" value={form.employer} onChange={(e) => setForm({ ...form, employer: e.target.value })} /></Field>
          <Field label="Phone"><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <div className="span-2"><button className="btn primary">Add worker</button></div>
          <datalist id="wf-trades">{trades.map((t) => <option key={t} value={t} />)}</datalist>
          <datalist id="wf-employers">{employers.map((t) => <option key={t} value={t} />)}</datalist>
        </form>
      ) : tab === 'paste' ? (
        <div className="stack">
          <p className="muted small">
            One person per line: <b>Name, Trade, Employer, Phone</b>. Only the name is required. You can also copy rows straight from Excel or Google Sheets.
          </p>
          <textarea rows={9} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'Musa Bello, Mason, ABC Subcontractors, 0803 000 0001\nAisha Yusuf, Carpenter\nEmeka Nwosu, Labourer'} />
          <div>
            <button
              className="btn primary"
              disabled={!lines.trim()}
              onClick={async () => {
                const r = await run(
                  () => api.post(`/api/projects/${projectId}/workers`, { lines }),
                  (res) => `${res.added} added${res.skipped.length ? `; ${res.skipped.length} already on the list (${res.skipped.slice(0, 5).join(', ')}${res.skipped.length > 5 ? '…' : ''})` : ''}.`
                );
                if (r) {
                  setLines('');
                  setTab('list');
                }
              }}
            >
              Add these people
            </button>
          </div>
        </div>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="muted">No one yet. Use <b>Add one</b> or <b>Paste a list</b>.</p>
          ) : (
            <div className="table-scroll">
              <table className="table compact stack-mobile">
                <thead><tr><th>Name</th><th>Trade</th><th>Employer</th><th>Phone</th><th /></tr></thead>
                <tbody>
                  {active.map((w) => (
                    <WorkerRow key={w.id} w={w} editing={editing === w.id} setEditing={setEditing} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {left.length > 0 && (
            <div className="wf-left">
              <button className="btn ghost sm" onClick={() => setShowLeft((s) => !s)}>{showLeft ? 'Hide' : 'Show'} people who have left ({left.length})</button>
              {showLeft && (
                <ul className="plain-list">
                  {left.map((w) => (
                    <li key={w.id}>
                      {w.name} <span className="muted">· {w.trade || 'General'}</span>{' '}
                      <button className="btn ghost sm" onClick={() => run(() => api.put(`/api/workers/${w.id}`, { active: true }), `${w.name} is back on the register.`)}>Back on site</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function WorkerRow({ w, editing, setEditing, run }) {
  const [f, setF] = useState({ name: w.name, trade: w.trade || '', employer: w.employer || '', phone: w.phone || '' });
  if (editing) {
    return (
      <tr className="editing">
        <td data-label="Name"><input className="cell-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" /></td>
        <td data-label="Trade"><input className="cell-input" value={f.trade} onChange={(e) => setF({ ...f, trade: e.target.value })} aria-label="Trade" /></td>
        <td data-label="Employer"><input className="cell-input" value={f.employer} onChange={(e) => setF({ ...f, employer: e.target.value })} aria-label="Employer" /></td>
        <td data-label="Phone"><input className="cell-input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} aria-label="Phone" /></td>
        <td className="right nowrap">
          <button className="btn primary sm" onClick={async () => (await run(() => api.put(`/api/workers/${w.id}`, f), 'Saved.')) && setEditing(null)}>Save</button>{' '}
          <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="cell-title">{w.name}</td>
      <td data-label="Trade">{w.trade}</td>
      <td data-label="Employer">{w.employer}</td>
      <td data-label="Phone">{w.phone}</td>
      <td className="right nowrap">
        <button className="btn ghost sm" onClick={() => setEditing(w.id)}>Edit</button>{' '}
        <button
          className="btn ghost sm danger-text"
          onClick={() =>
            confirm(w.entry_count ? `Mark ${w.name} as left? Their attendance history is kept.` : `Remove ${w.name}?`) &&
            run(() => api.del(`/api/workers/${w.id}`), (res) => (res.deactivated ? `${w.name} marked as left; history kept.` : `${w.name} removed.`))
          }
        >
          {w.entry_count ? 'Left site' : 'Remove'}
        </button>
      </td>
    </tr>
  );
}
