// Premium: generate a work programme with AI from drawings, BOQ, dates and notes; review and edit it;
// download it as a Gantt PDF or MS Project XML; or use it as the project's task list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Sparkle } from '../App.jsx';
import { prepareImage } from '../images.js';
import { ErrorNote, Field, Modal, Spinner } from '../components/ui.jsx';

const DAYS = [
  [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun'],
];
const KINDS = { drawing: 'Drawing', boq: 'BOQ', spec: 'Specification / other', other: 'Other' };
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.xlsx,.xlsm,.csv,.txt';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtD = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return `${WD[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
};
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const newUid = () => Math.random().toString(36).slice(2, 10);

/** "3, 5SS+2, 7FF-1d" → [{uid, type, lag}] using the row numbers currently shown (row n = tasks[n-2]). */
function parsePreds(text, tasks, selfUid) {
  const out = [];
  const bad = [];
  for (const raw of text.split(/[,;]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    const m = tok.match(/^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*(?:d|days?)?)?$/i);
    const t = m && tasks[Number(m[1]) - 2];
    if (!t || t.uid === selfUid) {
      bad.push(tok);
      continue;
    }
    out.push({ uid: t.uid, type: (m[2] || 'FS').toUpperCase(), lag: m[3] ? Number(m[3] + m[4]) : 0 });
  }
  return { preds: out, bad };
}

export default function ProgrammeGeneratorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [inputs, setInputs] = useState(null);
  const [inputsDirty, setInputsDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadKind, setUploadKind] = useState('auto');
  const [holiday, setHoliday] = useState('');
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const fileRef = useRef(null);
  const base = `/api/projects/${id}/programme-generator`;

  const apply = useCallback((d, { keepInputs } = {}) => {
    setData(d);
    if (d.draft && !keepInputs) {
      setInputs(d.draft.inputs);
      setInputsDirty(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.get(base), { keepInputs: inputsDirty });
    } catch (e) {
      setError(e.message);
    }
  }, [base, apply, inputsDirty]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Poll while the AI is working.
  const generating = data?.draft?.status === 'generating';
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [generating, load]);

  const setIn = (k, v) => {
    setInputs((cur) => ({ ...cur, [k]: v }));
    setInputsDirty(true);
  };

  const saveInputs = async () => {
    const d = await api.put(`${base}/inputs`, inputs);
    apply(d);
    return d;
  };

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) {
        const isPhoto = f.type.startsWith('image/') || /\.(heic|heif|webp)$/i.test(f.name);
        // Photos of drawings are scaled to a size the AI reads well; PDFs and spreadsheets go as they are.
        fd.append('files', isPhoto ? await prepareImage(f, { maxDim: 2400, maxBytes: 3.5 * 1024 * 1024 }) : f);
      }
      if (uploadKind !== 'auto') fd.append('kind', uploadKind);
      apply(await api.post(`${base}/files`, fd), { keepInputs: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const generate = () =>
    run(async () => {
      if (data.draft.plan && !confirm('Generate a new programme? This replaces the current programme and any edits you made to it.')) return;
      if (inputsDirty) await saveInputs();
      apply(await api.post(`${base}/generate`));
    });

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading…" />;

  const crumbs = (
    <nav className="crumbs">
      <Link to="/">Projects</Link> / <Link to={`/projects/${id}`}>{data.project.name}</Link> / <span>AI programme</span>
    </nav>
  );

  if (!data.access) {
    return (
      <>
        {crumbs}
        <div className="page-head">
          <div>
            <h1>AI work programme generator <span className="premium-tag">Premium</span></h1>
            <p className="muted">Turn drawings and a bill of quantities into a linked, MS Project-ready work programme in minutes.</p>
          </div>
        </div>
        <section className="card premium-pitch">
          <ul className="ticks">
            <li>Upload working drawings (PDF or photos), the BOQ and any other documents.</li>
            <li>Give the proposed start and completion dates and your working days.</li>
            <li>AI plans the phases, tasks, durations and links, and the dates are calculated for you.</li>
            <li>Edit anything, then download a Gantt chart PDF or an MS Project XML file, or use it as this project's task list.</li>
          </ul>
          <p>Included in the Professional and Business plans.</p>
          <Link className="btn primary" to="/billing">See plans</Link>
        </section>
      </>
    );
  }

  const d = data.draft;
  const sched = d.schedule;
  const totalBytes = d.files.reduce((s, f) => s + f.size, 0);
  const locked = generating || busy;

  return (
    <div className="progen">
      {crumbs}
      <div className="page-head">
        <div>
          <h1>AI work programme generator <span className="premium-tag">Premium</span></h1>
          <p className="muted">Upload the drawings and BOQ, set the dates, and let AI draft a linked programme you can edit, download and use.</p>
        </div>
      </div>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {!data.ai && (
        <div className="note warn">AI is not switched on for this server yet, so programmes can't be generated. You can still prepare the details and documents.</div>
      )}

      <div className="progen-grid">
        <section className="card">
          <h2 className="step-title"><span className="step-no">1</span> Dates and working days</h2>
          <div className="form-row">
            <Field label="Proposed start date">
              <input type="date" value={inputs.start_date || ''} onChange={(e) => setIn('start_date', e.target.value || null)} disabled={locked} />
            </Field>
            <Field label="Target completion date">
              <input type="date" value={inputs.end_date || ''} min={inputs.start_date || undefined} onChange={(e) => setIn('end_date', e.target.value || null)} disabled={locked} />
            </Field>
          </div>
          <div className="field">
            <span className="field-label">Working days</span>
            <div className="day-chips" role="group" aria-label="Working days">
              {DAYS.map(([n, label]) => {
                const on = inputs.working_days.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    className={`day-chip ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    disabled={locked}
                    onClick={() => setIn('working_days', on ? inputs.working_days.filter((x) => x !== n) : [...inputs.working_days, n].sort())}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Public holidays and other non-working days</span>
            <div className="row gap wrap">
              <input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} className="auto-width" disabled={locked} aria-label="Holiday date" />
              <button
                type="button"
                className="btn ghost sm"
                disabled={!holiday || locked}
                onClick={() => {
                  if (!inputs.holidays.includes(holiday)) setIn('holidays', [...inputs.holidays, holiday].sort());
                  setHoliday('');
                }}
              >
                Add
              </button>
            </div>
            {inputs.holidays.length > 0 && (
              <div className="tag-list">
                {inputs.holidays.map((h) => (
                  <span className="tag" key={h}>
                    {fmtD(h)}
                    <button type="button" aria-label={`Remove ${h}`} disabled={locked} onClick={() => setIn('holidays', inputs.holidays.filter((x) => x !== h))}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <Field label="Notes for the planner" hint="Describe the job and anything the documents don't show: construction method, phasing, access, materials already on site, client milestones.">
            <textarea
              rows={5}
              value={inputs.notes}
              onChange={(e) => setIn('notes', e.target.value)}
              disabled={locked}
              placeholder="e.g. Renovation of a 2-storey office block with a new ground floor extension. Reinforced concrete frame, sandcrete blockwork, long-span aluminium roof. Client wants the ground floor handed over first."
            />
          </Field>
          {inputsDirty && (
            <div className="row end">
              <button className="btn ghost sm" disabled={locked} onClick={() => run(saveInputs)}>Save details</button>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="step-title"><span className="step-no">2</span> Drawings, BOQ and documents</h2>
          <p className="muted small">
            PDF, photos (JPEG, PNG, WebP, HEIC), Excel (.xlsx) or CSV. Up to {data.max_total_mb} MB in total. Save Word files as PDF first. Include the plans,
            sections and elevations, and the full BOQ.
          </p>
          <div className="row gap wrap">
            <select className="inline-select" value={uploadKind} onChange={(e) => setUploadKind(e.target.value)} aria-label="Document type" disabled={locked || uploading}>
              <option value="auto">Type: detect</option>
              {Object.entries(KINDS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <label className={`btn primary sm ${locked || uploading ? 'disabled' : ''}`}>
              {uploading ? 'Uploading…' : '+ Add files'}
              <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden disabled={locked || uploading} onChange={(e) => upload(e.target.files)} />
            </label>
          </div>
          {d.files.length === 0 ? (
            <p className="muted small empty-docs">No documents yet.</p>
          ) : (
            <ul className="doc-list">
              {d.files.map((f) => (
                <li key={f.id}>
                  <span className="doc-name" title={f.name}>{f.name}</span>
                  <span className="muted small nowrap">{fmtSize(f.size)}</span>
                  <select
                    className="inline-select"
                    value={f.kind}
                    disabled={locked}
                    aria-label={`Type of ${f.name}`}
                    onChange={(e) => run(async () => apply(await api.put(`${base}/files/${f.id}`, { kind: e.target.value }), { keepInputs: true }))}
                  >
                    {Object.entries(KINDS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <button
                    className="icon-btn"
                    disabled={locked}
                    aria-label={`Remove ${f.name}`}
                    onClick={() => run(async () => apply(await api.del(`${base}/files/${f.id}`), { keepInputs: true }))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {d.files.length > 0 && <p className="muted small">{fmtSize(totalBytes)} of {data.max_total_mb} MB used</p>}
        </section>
      </div>

      <section className="card generate-card">
        <div>
          <h2 className="step-title"><span className="step-no">3</span> Generate</h2>
          {generating ? (
            <p className="generating">
              <Spinner /> AI is reading your documents and planning the programme. This usually takes 2 to 6 minutes. You can leave this page and come back.
            </p>
          ) : d.status === 'failed' ? (
            <p className="bad-text">{d.error || 'Generation failed.'}</p>
          ) : d.generated_at ? (
            <p className="muted small">Last generated {new Date(d.generated_at).toLocaleString()}{d.generated_by ? ` by ${d.generated_by}` : ''}.</p>
          ) : (
            <p className="muted small">Check the dates and documents, then generate. You can edit the result before using it.</p>
          )}
        </div>
        <button className="btn primary" onClick={generate} disabled={locked || !data.ai || !inputs.start_date}>
          <Sparkle /> {generating ? 'Generating…' : d.plan ? 'Generate again' : 'Generate programme'}
        </button>
      </section>

      {sched && !generating && (
        <ProgrammeEditor
          key={d.generated_at || 'plan'}
          data={data}
          base={base}
          onSaved={(res) => apply(res, { keepInputs: true })}
          onError={setError}
          onImport={() => setImportOpen(true)}
        />
      )}

      {importOpen && (
        <ImportModal
          data={data}
          onClose={() => setImportOpen(false)}
          onDone={() => navigate(`/projects/${id}`)}
        />
      )}
    </div>
  );
}

function ProgrammeEditor({ data, base, onSaved, onError, onImport }) {
  const d = data.draft;
  const sched = d.schedule;
  const [title, setTitle] = useState(d.plan.title || data.project.name);
  const [tasks, setTasks] = useState(() => sched.rows.map(({ uid, name, outline, duration, preds, basis }) => ({ uid, name, outline, duration, preds, basis })));
  const [predDraft, setPredDraft] = useState({}); // uid -> text being typed
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);
  const latest = useRef({ title, tasks });
  latest.current = { title, tasks };

  // Rows from the last save, by uid, for dates and the critical flag.
  const scheduled = useMemo(() => new Map(sched.rows.map((r) => [r.uid, r])), [sched]);
  const idOf = useMemo(() => new Map(tasks.map((t, i) => [t.uid, i + 2])), [tasks]);
  const predText = (t) =>
    t.preds
      .filter((p) => idOf.has(p.uid))
      .map((p) => `${idOf.get(p.uid)}${p.type !== 'FS' || p.lag ? p.type : ''}${p.lag ? (p.lag > 0 ? '+' : '') + p.lag + 'd' : ''}`)
      .join(', ');

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    setSaving(true);
    try {
      const res = await api.put(`${base}/plan`, latest.current);
      onSaved(res);
      setDirty(false);
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  }, [base, onSaved, onError]);

  const change = (next) => {
    setTasks(next);
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const edit = (i, patch) => change(tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const isSummary = (i) => i + 1 < tasks.length && tasks[i + 1].outline > tasks[i].outline;
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= tasks.length) return;
    const next = [...tasks];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const remove = (i) => {
    const t = tasks[i];
    if (isSummary(i)) {
      if (!confirm(`Delete the phase "${t.name}" and all its tasks?`)) return;
      let end = i + 1;
      while (end < tasks.length && tasks[end].outline > t.outline) end++;
      const gone = new Set(tasks.slice(i, end).map((x) => x.uid));
      change(tasks.filter((_, j) => j < i || j >= end).map((x) => ({ ...x, preds: x.preds.filter((p) => !gone.has(p.uid)) })));
    } else {
      change(tasks.filter((_, j) => j !== i).map((x) => ({ ...x, preds: x.preds.filter((p) => p.uid !== t.uid) })));
    }
  };
  const insertAfter = (i) => {
    const ref = tasks[i];
    const outline = isSummary(i) ? ref.outline + 1 : ref.outline;
    const t = { uid: newUid(), name: 'New task', outline, duration: 1, preds: isSummary(i) ? [] : [{ uid: ref.uid, type: 'FS', lag: 0 }] };
    change([...tasks.slice(0, i + 1), t, ...tasks.slice(i + 1)]);
  };
  const addPhase = () => change([...tasks, { uid: newUid(), name: 'New phase', outline: 1, duration: 0, preds: [] }, { uid: newUid(), name: 'New task', outline: 2, duration: 1, preds: [] }]);
  const commitPreds = (i) => {
    const t = tasks[i];
    const text = predDraft[t.uid];
    if (text === undefined) return;
    const { preds, bad } = parsePreds(text, tasks, t.uid);
    setPredDraft(({ [t.uid]: _, ...rest }) => rest);
    if (bad.length) onError(`Row ${i + 2}: couldn't read "${bad.join(', ')}". Use row numbers, e.g. 5, 7SS+2, 9FF-1d.`);
    edit(i, { preds });
  };

  const P = sched.project;
  const late = data.draft.inputs.end_date && P.finish > data.draft.inputs.end_date;

  return (
    <section className="card progen-result">
      <div className="row between wrap gap">
        <div>
          <h2 className="no-margin">Programme</h2>
          <p className="muted small">
            {fmtD(P.start)} → <b className={late ? 'bad-text' : ''}>{fmtD(P.finish)}</b> · {P.duration} working days
            {P.available_days != null && ` (${P.available_days} available to the target date)`} · {sched.rows.filter((r) => !r.summary).length} tasks
          </p>
        </div>
        <div className="row gap wrap">
          <span className="muted small save-state">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <a className={`btn ghost sm ${dirty || saving ? 'disabled' : ''}`} href={`${base}/pdf`} onClick={(e) => (dirty || saving) && e.preventDefault()}>Download PDF</a>
          <a className={`btn ghost sm ${dirty || saving ? 'disabled' : ''}`} href={`${base}/xml`} onClick={(e) => (dirty || saving) && e.preventDefault()}>MS Project XML</a>
          <button className="btn primary sm" onClick={onImport} disabled={dirty || saving || !d.activities?.length}>Use as project tasks</button>
        </div>
      </div>

      {sched.warnings.map((w) => (
        <div className="note warn" key={w}>{w}</div>
      ))}

      {(d.plan.scope_summary || d.plan.assumptions.length > 0) && (
        <details className="assumptions">
          <summary>What the AI understood and assumed</summary>
          {d.plan.scope_summary && <p>{d.plan.scope_summary}</p>}
          {d.plan.assumptions.length > 0 && (
            <ul>
              {d.plan.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
          <p className="muted small">AI drafts can be wrong. Check the scope, durations and logic before you issue the programme.</p>
        </details>
      )}

      <p className="muted small">
        Edit names, durations (working days, 0 = milestone) and predecessors (row numbers, e.g. <code>5</code>, <code>7SS+2</code>, <code>9FF-1d</code>). Dates
        recalculate automatically. <span className="crit-key">Red</span> rows are on the critical path.
      </p>
      <div className="table-scroll progen-table-wrap">
        <table className="table compact progen-table">
          <thead>
            <tr>
              <th className="num">ID</th>
              <th>Task name</th>
              <th className="num">Days</th>
              <th>Predecessors</th>
              <th>Start</th>
              <th>Finish</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr className="pg-project">
              <td className="num muted">1</td>
              <td>
                <input
                  className="cell-input bold"
                  value={title}
                  aria-label="Programme title"
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDirty(true);
                    clearTimeout(timer.current);
                    timer.current = setTimeout(save, 900);
                  }}
                />
              </td>
              <td className="num">{P.duration}</td>
              <td />
              <td className="nowrap">{fmtD(P.start)}</td>
              <td className="nowrap">{fmtD(P.finish)}</td>
              <td />
            </tr>
            {tasks.map((t, i) => {
              const s = scheduled.get(t.uid);
              const summary = isSummary(i);
              return (
                <tr key={t.uid} className={`${summary ? 'pg-summary' : ''} ${s?.critical ? 'pg-critical' : ''}`}>
                  <td className="num muted">{i + 2}</td>
                  <td>
                    <div className="pg-name" style={{ paddingLeft: `${(t.outline - 1) * 16}px` }}>
                      <input className={`cell-input ${summary ? 'bold' : ''}`} value={t.name} aria-label={`Task ${i + 2} name`} onChange={(e) => edit(i, { name: e.target.value })} />
                    </div>
                  </td>
                  <td className="num">
                    {summary ? (
                      <span className="muted">{s?.duration ?? ''}</span>
                    ) : (
                      <input
                        className="cell-input num-input"
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={t.duration}
                        aria-label={`Task ${i + 2} duration in days`}
                        onChange={(e) => edit(i, { duration: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                      />
                    )}
                  </td>
                  <td>
                    {!summary && (
                      <input
                        className="cell-input pred-input"
                        value={predDraft[t.uid] ?? predText(t)}
                        aria-label={`Task ${i + 2} predecessors`}
                        placeholder="—"
                        onChange={(e) => setPredDraft((p) => ({ ...p, [t.uid]: e.target.value }))}
                        onBlur={() => commitPreds(i)}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      />
                    )}
                  </td>
                  <td className="nowrap">{s ? fmtD(s.start) : '…'}</td>
                  <td className="nowrap">{s ? (s.milestone ? '◆ ' : '') + fmtD(s.finish) : '…'}</td>
                  <td className="nowrap right">
                    <details className="menu row-menu">
                      <summary className="icon-btn" aria-label={`Actions for row ${i + 2}`}>⋯</summary>
                      <div className="menu-list">
                        <button onClick={() => insertAfter(i)}>{summary ? 'Add task to phase' : 'Insert task below'}</button>
                        <button onClick={() => edit(i, { outline: t.outline + 1 })} disabled={i === 0 || t.outline > tasks[i - 1].outline}>Indent →</button>
                        <button onClick={() => edit(i, { outline: Math.max(1, t.outline - 1) })} disabled={t.outline === 1}>← Outdent</button>
                        <button onClick={() => move(i, -1)} disabled={i === 0}>Move up</button>
                        <button onClick={() => move(i, 1)} disabled={i === tasks.length - 1}>Move down</button>
                        <button className="danger" onClick={() => remove(i)}>{summary ? 'Delete phase' : 'Delete task'}</button>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row gap">
        <button className="btn ghost sm" onClick={addPhase}>+ Add phase</button>
      </div>
    </section>
  );
}

function ImportModal({ data, onClose, onDone }) {
  const has = data.project.activity_count > 0;
  const [mode, setMode] = useState(has ? 'replace' : 'append');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const acts = data.draft.activities;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects/${data.project.id}/activities/bulk`, { activities: acts, mode });
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Use as project tasks"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={go} disabled={busy}>{busy ? 'Importing…' : `Import ${acts.length} tasks`}</button>
        </>
      }
    >
      <ErrorNote error={error} />
      <p>
        The {acts.length} tasks (phases become sections, milestones are left out) become this project's activity list for daily reports, with their planned dates
        and durations used for progress.
      </p>
      {has && (
        <div className="stack">
          <label className="check">
            <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
            <span><b>Replace the current programme</b> ({data.project.activity_count} activities). Activities with reported progress and manually added tasks are kept.</span>
          </label>
          <label className="check">
            <input type="radio" name="mode" checked={mode === 'append'} onChange={() => setMode('append')} />
            <span><b>Add to the current list</b></span>
          </label>
        </div>
      )}
    </Modal>
  );
}
