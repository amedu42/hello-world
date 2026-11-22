import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, todayISO } from '../api.js';
import { Sparkle, useStatus } from '../App.jsx';
import { ErrorNote, Field, Spinner } from '../components/ui.jsx';
import { prepareImage } from '../images.js';

const WEATHER = ['Sunny', 'Partly cloudy', 'Overcast', 'Light rain', 'Heavy rain', 'Storm', 'Windy', 'Hot', 'Cold', 'Fog'];
const ISSUE_CATS = ['Safety', 'Quality', 'Design/RFI', 'Delay', 'Resources', 'Access', 'Utilities', 'Environmental', 'Other'];
const OTHER = '__other__';
let keySeq = 0;
const newItem = (o = {}) => ({ key: ++keySeq, activity_id: '', activity_name: '', progress: '', remarks: '', ...o });

const LISTS = {
  labour: { title: 'Labour on site', add: 'Add trade', cols: [{ k: 'trade', label: 'Trade', ph: 'e.g. Masons', w: 3 }, { k: 'count', label: 'No.', type: 'number', w: 1 }] },
  equipment: {
    title: 'Plant & equipment',
    add: 'Add equipment',
    cols: [{ k: 'name', label: 'Equipment', ph: 'e.g. Excavator 20t', w: 3 }, { k: 'count', label: 'No.', type: 'number', w: 1 }, { k: 'status', label: 'Status', options: ['Working', 'Idle', 'Broken down', 'Standby'], w: 2 }],
  },
  materials: {
    title: 'Material deliveries',
    add: 'Add delivery',
    cols: [{ k: 'material', label: 'Material', ph: 'e.g. Cement 42.5R', w: 3 }, { k: 'quantity', label: 'Quantity', ph: '200 bags', w: 2 }, { k: 'supplier', label: 'Supplier', w: 2 }, { k: 'notes', label: 'Notes / condition', w: 3 }],
  },
  visitors: {
    title: 'Visitors',
    add: 'Add visitor',
    cols: [{ k: 'name', label: 'Name', w: 2 }, { k: 'organisation', label: 'Organisation', w: 2 }, { k: 'purpose', label: 'Purpose', w: 3 }, { k: 'time', label: 'Time', type: 'time', w: 1 }],
  },
  issues: {
    title: 'Site issues',
    add: 'Add issue',
    cols: [
      { k: 'category', label: 'Category', options: ISSUE_CATS, w: 2 },
      { k: 'description', label: 'Description', ph: 'What happened?', w: 4 },
      { k: 'severity', label: 'Severity', options: ['Low', 'Medium', 'High'], w: 1.4 },
      { k: 'action', label: 'Action taken / required', w: 3 },
    ],
  },
};

const blankForm = (supervisor) => ({
  report_date: todayISO(),
  supervisor: supervisor || '',
  weather: { condition: '', temp_high: '', temp_low: '', rainfall: '', wind: '', impact: '', hours_lost: '' },
  items: [newItem()],
  labour: [],
  equipment: [],
  materials: [],
  visitors: [],
  issues: [],
  notes: '',
});

const draftKey = (pid) => `sitepulse:draft:${pid}`;
const loadDraft = (pid) => {
  try {
    return JSON.parse(localStorage.getItem(draftKey(pid)) || 'null');
  } catch {
    return null;
  }
};
const saveDraft = (pid, f) => {
  try {
    localStorage.setItem(draftKey(pid), JSON.stringify(f));
  } catch {
    /* storage unavailable */
  }
};
const clearDraft = (pid) => {
  try {
    localStorage.removeItem(draftKey(pid));
  } catch {
    /* storage unavailable */
  }
};

export default function ReportForm() {
  const { id: projectIdParam, rid } = useParams();
  const editing = Boolean(rid);
  const navigate = useNavigate();
  const { ai } = useStatus();

  const [project, setProject] = useState(null);
  const [form, setForm] = useState(null);
  const [beforeMap, setBeforeMap] = useState({});
  const [existingPhotos, setExistingPhotos] = useState([]);
  const [removePhotoIds, setRemovePhotoIds] = useState([]);
  const [newPhotos, setNewPhotos] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(0);
  const [labourFrom, setLabourFrom] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // ---------- load
  useEffect(() => {
    (async () => {
      try {
        if (editing) {
          const r = await api.get(`/api/reports/${rid}`);
          const p = await api.get(`/api/projects/${r.report.project_id}`);
          setProject(p);
          const rep = r.report;
          setForm({
            report_date: rep.report_date,
            supervisor: rep.supervisor || '',
            weather: { ...blankForm().weather, ...rep.weather },
            items: r.items.map((i) => newItem({ activity_id: i.activity_id ? String(i.activity_id) : OTHER, activity_name: i.activity_name, progress: String(i.progress), remarks: i.remarks || '' })),
            labour: rep.labour,
            equipment: rep.equipment,
            materials: rep.materials,
            visitors: rep.visitors,
            issues: rep.issues,
            notes: rep.notes || '',
          });
          setBeforeMap(Object.fromEntries(r.items.filter((i) => i.activity_id).map((i) => [i.activity_id, i.progress_before ?? 0])));
          setExistingPhotos(r.photos);
        } else {
          const p = await api.get(`/api/projects/${projectIdParam}`);
          setProject(p);
          const draft = loadDraft(p.id);
          if (draft?.items) {
            draft.items = draft.items.map((i) => newItem(i));
            setForm(draft);
            setDraftRestored(true);
          } else {
            setForm(blankForm(p.supervisor || p.reports[0]?.supervisor));
          }
        }
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [editing, rid, projectIdParam]);

  // ---------- pre-fill labour from that morning's attendance register (new reports, empty labour only)
  const reportDate = form?.report_date;
  const labourEmpty = !form?.labour?.length;
  useEffect(() => {
    if (editing || !project || !reportDate || !labourEmpty) return;
    let cancelled = false;
    api
      .get(`/api/projects/${project.id}/attendance/${reportDate}/summary`)
      .then(({ summary }) => {
        if (cancelled || !summary || !summary.trade_counts.length) return;
        setForm((f) => (f.labour.length ? f : { ...f, labour: summary.trade_counts.map((t) => ({ trade: t.trade, count: t.count })) }));
        setLabourFrom(summary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [editing, project, reportDate, labourEmpty]);

  // ---------- autosave draft for new reports
  useEffect(() => {
    if (!editing && project && form) {
      const t = setTimeout(() => saveDraft(project.id, form), 400);
      return () => clearTimeout(t);
    }
  }, [form, editing, project]);

  const activities = project?.activities || [];
  const actById = useMemo(() => new Map(activities.map((a) => [String(a.id), a])), [activities]);
  const sections = useMemo(() => {
    const g = new Map();
    for (const a of activities) {
      const k = a.section || 'General';
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(a);
    }
    return [...g.entries()];
  }, [activities]);

  if (error && !form) return <ErrorNote error={error} />;
  if (!form || !project) return <Spinner label="Loading…" />;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setWeather = (k) => (e) => setForm((f) => ({ ...f, weather: { ...f.weather, [k]: e.target.value } }));
  const setItem = (key, patch) => setForm((f) => ({ ...f, items: f.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  const prevProgress = (aid) => {
    if (!aid || aid === OTHER) return 0;
    if (editing && beforeMap[aid] != null) return beforeMap[aid];
    return actById.get(String(aid))?.progress ?? 0;
  };
  const usedIds = new Set(form.items.map((i) => i.activity_id).filter((x) => x && x !== OTHER));

  // ---------- AI quick fill
  const applyAI = (out) => {
    setForm((f) => {
      const filled = f.items.filter((i) => i.activity_id || i.activity_name.trim());
      const ids = new Set(filled.map((i) => i.activity_id));
      const add = [];
      for (const a of out.activities) {
        const aid = a.activity_id ? String(a.activity_id) : OTHER;
        if (aid !== OTHER && ids.has(aid)) continue;
        ids.add(aid);
        add.push(newItem({ activity_id: aid, activity_name: aid === OTHER ? a.activity_name : '', progress: a.progress != null ? String(Math.min(100, Math.max(0, a.progress))) : '', remarks: a.remarks || '', ai: true }));
      }
      const w = { ...f.weather };
      for (const [k, v] of Object.entries(out.weather || {})) if (v != null && v !== '' && !w[k]) w[k] = String(v);
      return {
        ...f,
        items: [...filled, ...add].length ? [...filled, ...add] : [newItem()],
        weather: w,
        labour: [...f.labour, ...out.labour],
        equipment: [...f.equipment, ...out.equipment],
        materials: [...f.materials, ...out.materials],
        visitors: [...f.visitors, ...out.visitors],
        issues: [...f.issues, ...out.issues],
        notes: [f.notes, out.notes].filter((s) => s && s.trim()).join('\n'),
      };
    });
  };

  // ---------- photos
  const addPhotos = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    setPhotoBusy((n) => n + files.length);
    const problems = [];
    for (const f of files) {
      try {
        const file = await prepareImage(f);
        setNewPhotos((ps) => [...ps, { file, url: URL.createObjectURL(file), caption: '' }]);
      } catch (e) {
        problems.push(e.message);
      } finally {
        setPhotoBusy((n) => n - 1);
      }
    }
    if (problems.length) setError(problems.join(' '));
  };

  // ---------- submit
  const validate = () => {
    const items = form.items.filter((i) => i.activity_id || i.activity_name.trim());
    if (!items.length) return 'Add at least one activity worked on today.';
    for (const i of items) {
      if (i.activity_id === OTHER && !i.activity_name.trim()) return 'Type a name for each manually entered task.';
      if (i.progress === '' || isNaN(Number(i.progress))) return `Enter a progress % for "${i.activity_id === OTHER ? i.activity_name : actById.get(i.activity_id)?.name}".`;
      const n = Number(i.progress);
      if (n < 0 || n > 100) return 'Progress must be between 0 and 100%.';
    }
    if (!form.report_date) return 'Choose the report date.';
    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      items: form.items
        .filter((i) => i.activity_id || i.activity_name.trim())
        .map((i) => ({
          activity_id: i.activity_id && i.activity_id !== OTHER ? Number(i.activity_id) : null,
          activity_name: i.activity_id === OTHER ? i.activity_name.trim() : actById.get(i.activity_id)?.name,
          progress: Number(i.progress),
          remarks: i.remarks,
        })),
      weather: Object.fromEntries(Object.entries(form.weather).map(([k, v]) => [k, ['temp_high', 'temp_low', 'hours_lost'].includes(k) ? (v === '' ? null : Number(v)) : v])),
      remove_photo_ids: removePhotoIds,
    };
    const fd = new FormData();
    fd.append('data', JSON.stringify(payload));
    newPhotos.forEach((p) => fd.append('photos', p.file));
    fd.append('captions', JSON.stringify(newPhotos.map((p) => p.caption)));
    try {
      const res = editing ? await api.put(`/api/reports/${rid}`, fd) : await api.post(`/api/projects/${project.id}/reports`, fd);
      if (!editing) clearDraft(project.id);
      navigate(`/reports/${res.report.id}`, { state: { justSaved: true, aiError: res.ai_error } });
    } catch (err) {
      setError(err.message);
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const discardDraft = () => {
    clearDraft(project.id);
    setForm(blankForm(project.supervisor || project.reports[0]?.supervisor));
    setNewPhotos([]);
    setDraftRestored(false);
  };

  return (
    <form onSubmit={submit} className="report-form">
      <nav className="crumbs">
        <Link to="/">Projects</Link> / <Link to={`/projects/${project.id}`}>{project.name}</Link> / <span>{editing ? 'Edit report' : 'New daily report'}</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>{editing ? 'Edit daily report' : 'Daily site report'}</h1>
          <p className="muted">Record today's work, progress and site conditions. Overall progress updates when you submit.</p>
        </div>
      </div>

      {draftRestored && (
        <div className="note info row between wrap gap">
          <span>Restored your unsaved draft.</span>
          <button type="button" className="btn ghost sm" onClick={discardDraft}>Start fresh</button>
        </div>
      )}
      <ErrorNote error={error} onClose={() => setError(null)} />

      {ai && <QuickFill projectId={project.id} date={form.report_date} onResult={applyAI} />}

      {/* ---------------- General */}
      <section className="card form-section">
        <h2>General</h2>
        <div className="grid-3">
          <Field label="Report date *"><input type="date" value={form.report_date} max={todayISO()} onChange={(e) => set('report_date', e.target.value)} required /></Field>
          <Field label="Supervisor"><input value={form.supervisor} onChange={(e) => set('supervisor', e.target.value)} placeholder="Your name" /></Field>
        </div>
      </section>

      {/* ---------------- Activities */}
      <section className="card form-section">
        <div className="row between wrap gap">
          <h2>Activities & progress *</h2>
          <span className="muted small">Progress = total % complete for the activity, not today's increment.</span>
        </div>
        {activities.length === 0 && (
          <div className="note info small"><span>No programme uploaded for this project yet, so type each task in manually. Upload the programme from the dashboard to get a drop-down list.</span></div>
        )}
        <div className="items">
          {form.items.map((it, idx) => {
            const before = prevProgress(it.activity_id);
            const val = it.progress === '' ? null : Number(it.progress);
            const delta = val != null ? Math.round((val - before) * 10) / 10 : null;
            const selected = it.activity_id && it.activity_id !== OTHER ? actById.get(it.activity_id) : null;
            return (
              <div key={it.key} className={`item-row ${it.ai ? 'from-ai' : ''}`}>
                <div className="item-num">{idx + 1}</div>
                <div className="item-main">
                  <div className="item-top">
                    <Field label="Activity" className="grow">
                      <select
                        value={it.activity_id || (activities.length ? '' : OTHER)}
                        onChange={(e) => setItem(it.key, { activity_id: e.target.value, ai: false, progress: it.progress === '' && e.target.value !== OTHER ? '' : it.progress })}
                      >
                        {activities.length > 0 && <option value="">Select from programme…</option>}
                        {sections.map(([sec, list]) => (
                          <optgroup key={sec} label={sec}>
                            {list.map((a) => (
                              <option key={a.id} value={String(a.id)} disabled={usedIds.has(String(a.id)) && it.activity_id !== String(a.id)}>
                                {a.code ? `${a.code} · ` : ''}{a.name} ({a.progress}%)
                              </option>
                            ))}
                          </optgroup>
                        ))}
                        <option value={OTHER}>✎ Other – not on programme</option>
                      </select>
                    </Field>
                    <Field label="Progress %" className="progress-field">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        inputMode="decimal"
                        value={it.progress}
                        placeholder={String(before)}
                        onChange={(e) => setItem(it.key, { progress: e.target.value })}
                      />
                    </Field>
                    <button type="button" className="icon-btn danger remove" aria-label="Remove activity" onClick={() => set('items', form.items.length > 1 ? form.items.filter((x) => x.key !== it.key) : [newItem()])}>✕</button>
                  </div>
                  {(it.activity_id === OTHER || (!activities.length && !it.activity_id)) && (
                    <Field label="Task name (will be added to the project's task list)">
                      <input value={it.activity_name} onChange={(e) => setItem(it.key, { activity_id: OTHER, activity_name: e.target.value })} placeholder="e.g. Temporary drainage diversion" />
                    </Field>
                  )}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={val ?? before}
                    onChange={(e) => setItem(it.key, { progress: e.target.value })}
                    aria-label="Progress slider"
                    className="slider"
                    style={{ '--before': `${before}%`, '--val': `${val ?? before}%` }}
                  />
                  <div className="item-progress-meta">
                    <span>Previously {before}%</span>
                    {selected?.planned != null && <span>Planned today {selected.planned}%</span>}
                    {delta != null && <span className={delta < 0 ? 'neg' : delta > 0 ? 'pos' : ''}>{delta > 0 ? '+' : ''}{delta}% today</span>}
                    {delta != null && delta < 0 && <span className="neg">Lower than before – is that right?</span>}
                    {it.ai && <span className="ai-tag"><Sparkle size={11} /> from notes{it.progress === '' ? ' – enter progress' : ''}</span>}
                  </div>
                  <input className="remarks" value={it.remarks} onChange={(e) => setItem(it.key, { remarks: e.target.value })} placeholder="Remarks: work done today, location, quantities…" />
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" className="btn ghost" onClick={() => set('items', [...form.items, newItem()])}>+ Add activity</button>
      </section>

      {/* ---------------- Weather */}
      <section className="card form-section">
        <h2>Weather conditions</h2>
        <div className="grid-4">
          <Field label="Condition">
            <select value={form.weather.condition} onChange={setWeather('condition')}>
              <option value="">—</option>
              {WEATHER.map((w) => <option key={w}>{w}</option>)}
              {form.weather.condition && !WEATHER.includes(form.weather.condition) && <option>{form.weather.condition}</option>}
            </select>
          </Field>
          <Field label="High °C"><input type="number" value={form.weather.temp_high} onChange={setWeather('temp_high')} /></Field>
          <Field label="Low °C"><input type="number" value={form.weather.temp_low} onChange={setWeather('temp_low')} /></Field>
          <Field label="Hours lost"><input type="number" min="0" step="0.5" value={form.weather.hours_lost} onChange={setWeather('hours_lost')} /></Field>
          <Field label="Rainfall"><input value={form.weather.rainfall} onChange={setWeather('rainfall')} placeholder="e.g. 12 mm, AM showers" /></Field>
          <Field label="Wind"><input value={form.weather.wind} onChange={setWeather('wind')} placeholder="e.g. Light breeze" /></Field>
          <Field label="Impact on works" className="span-2"><input value={form.weather.impact} onChange={setWeather('impact')} placeholder="e.g. Concrete pour postponed to 2pm" /></Field>
        </div>
      </section>

      {/* ---------------- Lists */}
      <div className="grid-2 align-start">
        <RowsEditor
          spec={LISTS.labour}
          rows={form.labour}
          onChange={(v) => set('labour', v)}
          note={labourFrom && labourFrom.date === form.report_date && (
            <div className="note info small"><span>Filled from the attendance register: {labourFrom.on_site} on site, {labourFrom.absent} absent. Adjust if anyone left early.</span></div>
          )}
          footer={(rows) => rows.length > 0 && <span className="muted small">Total: {rows.reduce((s, r) => s + (Number(r.count) || 0), 0)} operatives</span>}
        />
        <RowsEditor spec={LISTS.equipment} rows={form.equipment} onChange={(v) => set('equipment', v)} />
      </div>
      <RowsEditor spec={LISTS.materials} rows={form.materials} onChange={(v) => set('materials', v)} />
      <RowsEditor spec={LISTS.issues} rows={form.issues} onChange={(v) => set('issues', v)} defaults={{ category: 'Other', severity: 'Low' }} />
      <RowsEditor spec={LISTS.visitors} rows={form.visitors} onChange={(v) => set('visitors', v)} />

      {/* ---------------- Photos */}
      <section className="card form-section">
        <h2>Site photos</h2>
        <div
          className={`photo-drop ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addPhotos(e.dataTransfer.files); }}
        >
          <div className="photo-buttons">
            <label className="btn primary">
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
              Choose from device
            </label>
            <label className="btn ghost camera-btn">
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
              Take photo
            </label>
          </div>
          <span className="muted small">
            Pick photos from your gallery, files or computer drive.<span className="desktop-only"> You can also drag them here.</span> Most image formats are converted automatically.
          </span>
          {photoBusy > 0 && <Spinner label={`Preparing ${photoBusy} photo${photoBusy > 1 ? 's' : ''}…`} />}
        </div>
        {(existingPhotos.length > 0 || newPhotos.length > 0) && (
          <div className="photo-grid">
            {existingPhotos.filter((p) => !removePhotoIds.includes(p.id)).map((p) => (
              <figure key={p.id} className="photo">
                <img src={p.url} alt={p.caption || ''} />
                <figcaption>{p.caption || p.original_name}</figcaption>
                <button type="button" className="photo-x" onClick={() => setRemovePhotoIds((ids) => [...ids, p.id])} aria-label="Remove photo">✕</button>
              </figure>
            ))}
            {newPhotos.map((p, i) => (
              <figure key={p.url} className="photo">
                <img src={p.url} alt="" />
                <input value={p.caption} placeholder="Caption" onChange={(e) => setNewPhotos((ps) => ps.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
                <button type="button" className="photo-x" onClick={() => setNewPhotos((ps) => ps.filter((_, j) => j !== i))} aria-label="Remove photo">✕</button>
              </figure>
            ))}
          </div>
        )}
        {!editing && newPhotos.length > 0 && <p className="muted small">Photos are not saved in the draft – submit the report to keep them.</p>}
      </section>

      <section className="card form-section">
        <h2>Additional notes</h2>
        <textarea rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Instructions received, inspections, delays, anything else to record…" />
      </section>

      <div className="form-actions">
        <Link to={editing ? `/reports/${rid}` : `/projects/${project.id}`} className="btn ghost">Cancel</Link>
        <button type="submit" className="btn primary lg" disabled={saving || photoBusy > 0}>
          {saving ? <Spinner label={ai ? 'Saving & writing summary…' : 'Saving…'} /> : editing ? 'Save report' : 'Submit daily report'}
        </button>
      </div>
    </form>
  );
}

function QuickFill({ projectId, date, onResult }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const ref = useRef(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.post(`/api/projects/${projectId}/ai/parse-notes`, { notes, date });
      onResult(out);
      setDone(true);
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card form-section quickfill">
      <div className="row between wrap gap">
        <div>
          <h2 className="h-icon"><Sparkle size={16} /> Quick fill from your notes</h2>
          <p className="muted small">Type or dictate the day in your own words. AI matches the work to programme activities and fills in the form for you to check.</p>
        </div>
        {!open && (
          <button type="button" className="btn ghost sm" onClick={() => { setOpen(true); setTimeout(() => ref.current?.focus(), 0); }}>
            {done ? 'Add more notes' : 'Write notes'}
          </button>
        )}
      </div>
      {done && !open && <div className="note success small"><span>Form filled from your notes. Check each entry below before submitting.</span></div>}
      {open && (
        <div className="stack">
          <textarea
            ref={ref}
            rows={5}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Hot and sunny, 34°C. 14 labourers, 4 steel fixers. Finished blinding to pad footings, rebar now about 60% done. 30t of Y16 rebar delivered by SteelCo. Client's QS visited at 11am. Near miss – unsecured ladder at grid C, toolbox talk held."
          />
          <ErrorNote error={error} />
          <div className="row gap end">
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn primary sm" onClick={run} disabled={busy || !notes.trim()}>
              {busy ? <Spinner label="Reading notes…" /> : 'Fill form'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function RowsEditor({ spec, rows, onChange, defaults = {}, footer, note }) {
  const blank = () => Object.fromEntries(spec.cols.map((c) => [c.k, defaults[c.k] ?? (c.options ? c.options[0] : '')]));
  const update = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const tpl = spec.cols.map((c) => `${c.w}fr`).join(' ') + ' 32px';
  return (
    <section className="card form-section">
      <h2>{spec.title}</h2>
      {note}
      {rows.length > 0 && (
        <div className="rows">
          <div className="rows-head" style={{ gridTemplateColumns: tpl }}>
            {spec.cols.map((c) => <span key={c.k}>{c.label}</span>)}
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="rows-row" style={{ gridTemplateColumns: tpl }}>
              {spec.cols.map((c) =>
                c.options ? (
                  <select key={c.k} value={r[c.k] ?? ''} onChange={(e) => update(i, c.k, e.target.value)} aria-label={c.label}>
                    {!c.options.includes(r[c.k]) && r[c.k] && <option>{r[c.k]}</option>}
                    {c.options.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input key={c.k} type={c.type || 'text'} min={c.type === 'number' ? 0 : undefined} value={r[c.k] ?? ''} placeholder={c.ph || c.label} aria-label={c.label} onChange={(e) => update(i, c.k, e.target.value)} />
                )
              )}
              <button type="button" className="icon-btn danger" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove row">✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="row between wrap gap">
        <button type="button" className="btn ghost sm" onClick={() => onChange([...rows, blank()])}>+ {spec.add}</button>
        {footer?.(rows)}
      </div>
    </section>
  );
}
