import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, todayISO } from '../api.js';
import { Sparkle, useAuth, useStatus } from '../App.jsx';
import ProgrammeUploadModal from '../components/ProgrammeUploadModal.jsx';
import ProjectFormModal from '../components/ProjectFormModal.jsx';
import AttendancePanel from '../components/AttendancePanel.jsx';
import ProgressChart from '../components/ProgressChart.jsx';
import { activityStatus, ErrorNote, Modal, ProgressBar, Spinner } from '../components/ui.jsx';

export default function ProjectDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const { me } = useAuth();

  const load = useCallback(() => api.get(`/api/projects/${id}`).then(setP).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!p) return <Spinner label="Loading project…" />;

  const variance = p.planned_progress != null ? Math.round((p.overall_progress - p.planned_progress) * 10) / 10 : null;
  const openIssues = p.reports[0]?.issue_count ?? 0;
  const todaysReport = p.reports.find((r) => r.report_date === todayISO());

  const deleteProject = async () => {
    if (!confirm(`Delete "${p.name}" with all its activities, reports and photos? This cannot be undone.`)) return;
    await api.del(`/api/projects/${p.id}`);
    navigate('/');
  };

  return (
    <>
      <nav className="crumbs"><Link to="/">Projects</Link> / <span>{p.name}</span></nav>
      <div className="page-head">
        <div>
          {p.code && <div className="eyebrow">{p.code}</div>}
          <h1>{p.name}</h1>
          <p className="muted">
            {[p.client && `Client: ${p.client}`, p.location, p.start_date && `${fmtDate(p.start_date)} → ${fmtDate(p.end_date)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="row gap wrap">
          <details className="menu">
            <summary className="btn ghost">More ▾</summary>
            <div className="menu-list">
              <button onClick={() => setModal('edit')}>Edit project details</button>
              <button onClick={() => setModal('programme')}>Upload work programme</button>
              {me.user.role === 'admin' && <button className="danger" onClick={deleteProject}>Delete project</button>}
            </div>
          </details>
          <Link className="btn ghost" to={`/projects/${p.id}/attendance`}>Attendance</Link>
          {todaysReport ? (
            <Link className="btn primary" to={`/reports/${todaysReport.id}/edit`}>Edit today's report</Link>
          ) : (
            <Link className="btn primary" to={`/projects/${p.id}/reports/new`}>+ Daily report</Link>
          )}
        </div>
      </div>

      {p.activities.length === 0 && (
        <div className="note info row between wrap gap">
          <span><b>Start by uploading the work programme.</b> Its activities become the drop-down list in daily reports. You can also type tasks in manually.</span>
          <button className="btn primary sm" onClick={() => setModal('programme')}>Upload programme</button>
        </div>
      )}

      <section className="hero card">
        <div className="hero-main">
          <div className="hero-label">Overall project progress</div>
          <div className="hero-number">{p.overall_progress}<span>%</span></div>
          <ProgressBar value={p.overall_progress} planned={p.planned_progress} size="lg" />
          <div className="hero-sub">
            {variance == null ? (
              <span className="muted">Upload a programme with dates to compare against plan.</span>
            ) : (
              <>
                <span>Planned today: <b>{p.planned_progress}%</b></span>
                <span className={`variance ${variance >= 0 ? 'ahead' : variance > -5 ? 'risk' : 'behind'}`}>
                  {variance >= 0 ? '▲' : '▼'} {Math.abs(variance)}% {variance >= 0 ? 'ahead of' : 'behind'} plan
                </span>
              </>
            )}
          </div>
        </div>
        <div className="hero-stats">
          <Stat label="Activities" value={p.activities.length} sub={`${p.activities.filter((a) => a.progress >= 100).length} complete`} />
          <Stat label="Daily reports" value={p.reports.length} sub={p.reports[0] ? `Last ${fmtDate(p.reports[0].report_date, { day: 'numeric', month: 'short' })}` : 'None yet'} />
          <Stat label="Site issues" value={openIssues} sub="in latest report" />
        </div>
        <div className="hero-chart">
          <ProgressChart data={p.curve} />
        </div>
      </section>

      <AttendancePanel projectId={p.id} />

      <Insights projectId={p.id} hasReports={p.reports.length > 0} />

      <div className="dash-grid">
        <ActivitiesPanel project={p} onChange={(res) => setP((cur) => ({ ...cur, ...res }))} reload={load} onUpload={() => setModal('programme')} />
        <ReportsPanel project={p} />
      </div>

      {modal === 'edit' && (
        <ProjectFormModal project={p} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
      )}
      {modal === 'programme' && (
        <ProgrammeUploadModal project={p} hasActivities={p.activities.length > 0} onClose={() => setModal(null)} onImported={() => { setModal(null); load(); }} />
      )}
    </>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

function Insights({ projectId, hasReports }) {
  const { ai } = useStatus();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!ai || !hasReports) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await api.post(`/api/projects/${projectId}/ai/insights`));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card insights">
      <div className="row between wrap gap">
        <h2 className="h-icon"><Sparkle size={16} /> AI project insights</h2>
        <button className="btn ghost sm" onClick={run} disabled={busy}>
          {busy ? <Spinner label="Analysing reports…" /> : data ? 'Refresh' : 'Analyse progress & risks'}
        </button>
      </div>
      <ErrorNote error={error} />
      {!data && !busy && <p className="muted small">Reviews the programme and the last 14 daily reports for slippage, recurring issues and resourcing trends.</p>}
      {data && (
        <div className="insight-body">
          <p className="insight-headline">
            <span className={`status-tag ${data.status.toLowerCase().includes('behind') ? 'behind' : data.status.toLowerCase().includes('risk') ? 'risk' : 'ahead'}`}>{data.status}</span>
            {data.headline}
          </p>
          <div className="grid-2">
            <div>
              <h4>Risks</h4>
              <ul>{data.risks.map((r, i) => <li key={i}><b>{r.title}.</b> {r.detail}</li>)}</ul>
            </div>
            <div>
              <h4>Recommended actions</h4>
              <ul>{data.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ActivitiesPanel({ project, onChange, onUpload }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  const acts = project.activities;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return acts.filter((a) => {
      if (s && !`${a.code || ''} ${a.name} ${a.section || ''}`.toLowerCase().includes(s)) return false;
      const st = activityStatus(a).key;
      if (filter === 'active') return a.progress > 0 && a.progress < 100;
      if (filter === 'behind') return st === 'behind' || st === 'risk';
      if (filter === 'done') return a.progress >= 100;
      if (filter === 'todo') return a.progress === 0;
      return true;
    });
  }, [acts, q, filter]);

  const groups = useMemo(() => {
    const g = new Map();
    for (const a of shown) {
      const k = a.section || 'General';
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(a);
    }
    return [...g.entries()];
  }, [shown]);

  const totalW = acts.reduce((s, a) => s + a.weight, 0) || 1;

  const act = async (fn) => {
    setError(null);
    try {
      onChange(await fn());
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <section className="card panel">
      <div className="panel-head">
        <h2>Tasks & progress</h2>
        <div className="row gap">
          {acts.length > 0 && <button className={`btn sm ${manage ? 'primary' : 'ghost'}`} onClick={() => setManage((m) => !m)}>{manage ? 'Done' : 'Manage'}</button>}
        </div>
      </div>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {acts.length === 0 ? (
        <div className="empty-inline">
          <p className="muted">No activities yet.</p>
          <div className="row gap center">
            <button className="btn primary sm" onClick={onUpload}>Upload programme</button>
            <button className="btn ghost sm" onClick={() => setAdding(true)}>Add a task</button>
          </div>
        </div>
      ) : (
        <>
          <div className="row gap wrap filters">
            <input className="search sm" placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" />
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tasks">
              <option value="all">All tasks ({acts.length})</option>
              <option value="active">In progress</option>
              <option value="behind">Behind / slipping</option>
              <option value="todo">Not started</option>
              <option value="done">Complete</option>
            </select>
            {manage && <button className="btn ghost sm" onClick={() => setAdding(true)}>+ Add task</button>}
          </div>
          <div className="act-list">
            {groups.map(([section, list]) => (
              <div key={section} className="act-group">
                <div className="act-group-head">{section}</div>
                {list.map((a) => {
                  const st = activityStatus(a);
                  return (
                    <div key={a.id} className="act-row">
                      <div className="act-name">
                        <div>
                          {a.code && <span className="code">{a.code}</span>}
                          {a.name}
                          {a.source === 'manual' && <span className="badge sm">added on site</span>}
                        </div>
                        <div className="act-meta">
                          {a.start_date && <span>{fmtDate(a.start_date, { day: 'numeric', month: 'short' })} – {fmtDate(a.end_date, { day: 'numeric', month: 'short' })}</span>}
                          {a.planned != null && <span>Planned {a.planned}%</span>}
                          {manage && <span>Weight {a.weight} ({((a.weight / totalW) * 100).toFixed(1)}%)</span>}
                        </div>
                      </div>
                      <div className="act-progress">
                        <ProgressBar value={a.progress} planned={a.planned} />
                        <span className={`status-dot ${st.key}`} title={st.label}>{st.label}</span>
                      </div>
                      <div className="act-pct">{a.progress}%</div>
                      {manage && (
                        <div className="act-actions">
                          <button className="icon-btn" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}>✎</button>
                          <button
                            className="icon-btn danger"
                            aria-label={`Delete ${a.name}`}
                            onClick={() => confirm(`Delete "${a.name}"? Progress reported against it will no longer count toward overall progress.`) && act(() => api.del(`/api/activities/${a.id}`))}
                          >🗑</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {!groups.length && <p className="muted small pad">No tasks match.</p>}
          </div>
          <p className="muted small foot-note">
            Overall progress is the average of every task's progress, weighted by its programme duration{manage ? ' (or the weight you set)' : ''}. The marker on each bar shows planned progress for today.
          </p>
        </>
      )}
      {(editing || adding) && (
        <ActivityModal
          activity={editing}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSave={(body) =>
            act(async () => {
              const res = editing ? await api.put(`/api/activities/${editing.id}`, body) : await api.post(`/api/projects/${project.id}/activities`, body);
              setEditing(null);
              setAdding(false);
              return res;
            })
          }
        />
      )}
    </section>
  );
}

function ActivityModal({ activity, onClose, onSave }) {
  const [f, setF] = useState({ code: '', name: '', section: '', start_date: '', end_date: '', weight: '', ...Object.fromEntries(Object.entries(activity || {}).map(([k, v]) => [k, v ?? ''])) });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal
      title={activity ? 'Edit task' : 'Add task'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!f.name.trim()} onClick={() => onSave({ code: f.code, name: f.name, section: f.section, start_date: f.start_date, end_date: f.end_date, weight: f.weight })}>Save</button>
        </>
      }
    >
      <div className="grid-2">
        <label className="field span-2"><span className="field-label">Task name *</span><input value={f.name} onChange={set('name')} autoFocus /></label>
        <label className="field"><span className="field-label">Code</span><input value={f.code} onChange={set('code')} /></label>
        <label className="field"><span className="field-label">Section</span><input value={f.section} onChange={set('section')} placeholder="e.g. Substructure" /></label>
        <label className="field"><span className="field-label">Planned start</span><input type="date" value={f.start_date} onChange={set('start_date')} /></label>
        <label className="field"><span className="field-label">Planned finish</span><input type="date" value={f.end_date} onChange={set('end_date')} /></label>
        <label className="field span-2">
          <span className="field-label">Weight</span>
          <input type="number" min="0" step="any" value={f.weight} onChange={set('weight')} placeholder="Defaults to a typical task's weight" />
          <span className="field-hint">How much this task counts toward overall progress, usually its duration in days or its value.</span>
        </label>
      </div>
    </Modal>
  );
}

function ReportsPanel({ project }) {
  return (
    <section className="card panel">
      <div className="panel-head">
        <h2>Daily reports</h2>
        <Link className="btn ghost sm" to={`/projects/${project.id}/reports/new`}>+ New</Link>
      </div>
      {project.reports.length === 0 ? (
        <div className="empty-inline">
          <p className="muted">No reports yet. At the end of each day, record the activities worked on and their progress.</p>
        </div>
      ) : (
        <ul className="report-list">
          {project.reports.map((r) => (
            <li key={r.id}>
              <Link to={`/reports/${r.id}`} className="report-link">
                <div className="report-date">
                  <span className="d">{fmtDate(r.report_date, { day: 'numeric' })}</span>
                  <span className="m">{fmtDate(r.report_date, { month: 'short' })}</span>
                </div>
                <div className="report-info">
                  <div className="report-title">{fmtDate(r.report_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
                  <div className="muted small">
                    {r.item_count} {r.item_count === 1 ? 'activity' : 'activities'}{r.weather ? ` · ${r.weather}` : ''}{r.photo_count ? ` · ${r.photo_count} photos` : ''}{r.issue_count ? ` · ${r.issue_count} issue${r.issue_count > 1 ? 's' : ''}` : ''}
                  </div>
                </div>
                <div className="report-pct">{r.overall_progress ?? 0}%</div>
              </Link>
              <a className="icon-btn" href={`/api/reports/${r.id}/pdf`} title="Download PDF" aria-label={`Download PDF for ${r.report_date}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
