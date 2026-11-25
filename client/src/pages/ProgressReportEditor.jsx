// Edit a weekly / monthly / status / milestone report before publishing: narrative, which tables to include,
// milestones and photos. Figures come from the project's data; "Refresh figures" recalculates them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { Sparkle, useAuth } from '../App.jsx';
import { prepareImage } from '../images.js';
import { ErrorNote, Spinner } from '../components/ui.jsx';
import { StatusTag } from './ProgressReportsPage.jsx';

const LAYOUT = {
  weekly: ['summary', 'curve', 'work_done', 'completed', 'progressed', 'schedule', 'sections', 'behind', 'look_ahead', 'upcoming', 'challenges', 'issues', 'resources', 'photos'],
  status: ['summary', 'curve', 'sections', 'schedule', 'behind', 'remaining', 'milestones', 'risks', 'issues', 'photos'],
  milestone: ['summary', 'milestones', 'commentary', 'outlook', 'photos'],
};
LAYOUT.monthly = LAYOUT.weekly;
const BLOCK_NAMES = {
  curve: 'Progress curve: planned vs actual',
  completed: 'Activities completed',
  progressed: 'Activities progressed',
  sections: 'Progress by phase',
  behind: 'Activities behind programme',
  upcoming: 'Look-ahead activities',
  issues: 'Site issues',
  resources: 'Resources and site conditions',
  milestones: 'Milestones: target vs actual',
  photos: 'Photos',
};
const pct = (n) => (n == null ? '–' : `${n}%`);
const signed = (n, u = '') => (n == null ? '–' : `${n > 0 ? '+' : ''}${n}${u}`);
const d = (iso) => (iso ? fmtDate(iso) : '–');

function kpis(r) {
  const o = r.data.overall;
  const sv = o.schedule_variance_days;
  const svBox = { label: 'Schedule', value: sv == null ? '–' : sv === 0 ? 'On time' : `${Math.abs(sv)}d ${sv > 0 ? 'behind' : 'ahead'}`, tone: sv > 0 ? 'bad' : sv < 0 ? 'good' : '' };
  if (r.type === 'milestone') {
    const ms = r.content.milestones || [];
    const late = ms.filter((m) => /late|overdue|risk/i.test(m.status || '')).length;
    return [{ label: 'Milestones', value: ms.length }, { label: 'Completed', value: ms.filter((m) => m.actual).length }, { label: 'Late / at risk', value: late, tone: late ? 'bad' : '' }, { label: 'Overall progress', value: pct(o.actual) }];
  }
  if (r.type === 'status') return [{ label: 'Actual progress', value: pct(o.actual) }, { label: 'Planned', value: pct(o.planned) }, svBox, { label: 'Forecast finish', value: d(o.forecast_finish) }];
  return [{ label: 'Overall progress', value: pct(o.actual) }, { label: `This ${r.type === 'weekly' ? 'week' : 'month'}`, value: signed(o.change, '%'), tone: o.change > 0 ? 'good' : '' }, { label: 'Planned', value: pct(o.planned) }, svBox];
}

export default function ProgressReportEditor() {
  const { rid } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const timer = useRef(null);
  const latest = useRef(null);
  const base = `/api/progress-reports/${rid}`;

  const load = useCallback(async () => {
    try {
      const res = await api.get(base);
      setR(res);
      latest.current = res;
    } catch (e) {
      setError(e.message);
    }
  }, [base]);
  useEffect(() => {
    load();
  }, [load]);

  const generating = r?.status === 'generating';
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [generating, load]);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const cur = latest.current;
    if (!cur) return;
    setSaving(true);
    try {
      const res = await api.put(base, {
        title: cur.title,
        sections: cur.content.sections,
        prepared_for: cur.content.prepared_for,
        prepared_by: cur.content.prepared_by,
        notes: cur.content.notes,
        hidden: cur.content.hidden,
        milestones: cur.content.milestones,
        photos: cur.content.photos,
      });
      setR((now) => ({ ...res, title: now.title, content: { ...res.content, ...pick(now.content) } }));
      if (latest.current === cur) setDirty(false); // more typing during the save schedules another one
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }, [base]);
  // Keep what the user typed while a save was in flight.
  const pick = (c) => ({ sections: c.sections, prepared_for: c.prepared_for, prepared_by: c.prepared_by, notes: c.notes, hidden: c.hidden, milestones: c.milestones, photos: c.photos });

  const change = (fn) => {
    setR((cur) => {
      const next = fn(cur);
      latest.current = next;
      return next;
    });
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const setContent = (patch) => change((cur) => ({ ...cur, content: { ...cur.content, ...patch } }));

  const action = async (key, fn) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      if (dirty) await save();
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  const apply = (res) => {
    setR(res);
    latest.current = res;
  };

  if (error && !r) return <ErrorNote error={error} />;
  if (!r) return <Spinner label="Loading report…" />;

  const locked = r.status !== 'draft' || !r.access;
  const hidden = new Set(r.content.hidden || []);
  const toggleBlock = (k) => setContent({ hidden: hidden.has(k) ? [...hidden].filter((x) => x !== k) : [...hidden, k] });
  const sectionByKey = new Map(r.content.sections.map((s) => [s.key, s]));
  const D = r.data;

  const upload = (files) =>
    action('photos', async () => {
      const fd = new FormData();
      for (const f of files) fd.append('photos', await prepareImage(f, { maxDim: 1800, maxBytes: 2.5 * 1024 * 1024 }));
      apply(await api.post(`${base}/photos`, fd));
    });

  return (
    <div className="prog-editor">
      <nav className="crumbs">
        <Link to="/">Projects</Link> / <Link to={`/projects/${r.project.id}`}>{r.project.name}</Link> / <Link to={`/projects/${r.project.id}/progress-reports`}>Progress reports</Link> / <span>{r.code}</span>
      </nav>
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">{r.type_name} · {r.code}</div>
          <input className="title-input" value={r.title} disabled={locked} aria-label="Report title" onChange={(e) => change((cur) => ({ ...cur, title: e.target.value }))} />
          <p className="muted">
            {r.period_from ? `${d(r.period_from)} – ${d(r.period_to)}` : `As of ${d(r.period_to)}`} · <StatusTag status={r.status} />
            {r.status === 'draft' && <span className="save-state"> {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>}
          </p>
        </div>
        <div className="row gap wrap head-actions">
          <a className={`btn ghost ${dirty || generating ? 'disabled' : ''}`} href={`${base}/pdf?inline=1`} target="_blank" rel="noreferrer">Preview PDF</a>
          <a className={`btn ghost ${dirty || generating ? 'disabled' : ''}`} href={`${base}/pdf`}>Download PDF</a>
          {r.status === 'published' ? (
            r.access && <button className="btn ghost" disabled={!!busy} onClick={() => action('unpublish', async () => apply(await api.post(`${base}/unpublish`)))}>Unpublish to edit</button>
          ) : (
            <button className="btn primary" disabled={!!busy || generating || !r.access} onClick={() => confirm('Publish this report? It will be locked from further edits (you can unpublish later).') && action('publish', async () => { apply(await api.post(`${base}/publish`)); setNotice('Published. Download the PDF to share it.'); })}>
              Publish
            </button>
          )}
          <details className="menu">
            <summary className="btn ghost">More ▾</summary>
            <div className="menu-list">
              <button disabled={locked || !!busy} onClick={() => action('refresh', async () => { apply(await api.post(`${base}/refresh`)); setNotice('Figures recalculated from the latest project data. Your text was kept.'); })}>Refresh figures</button>
              <button disabled={locked || !!busy || !r.ai} onClick={() => confirm('Rewrite every section with AI? Your current text will be replaced.') && action('rewrite', async () => apply(await api.post(`${base}/rewrite`, { notes: r.content.notes })))}>Rewrite with AI</button>
              {(r.status !== 'published' || me.user.role === 'admin') && (
                <button className="danger" onClick={() => confirm(`Delete ${r.code}? This cannot be undone.`) && action('delete', async () => { await api.del(base); navigate(`/projects/${r.project.id}/progress-reports`); })}>Delete report</button>
              )}
            </div>
          </details>
        </div>
      </div>

      <ErrorNote error={error} onClose={() => setError(null)} />
      {notice && <div className="note success"><span>{notice}</span><button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button></div>}
      {r.error && r.status !== 'generating' && <div className="note warn">{r.error}</div>}
      {r.status === 'published' && <div className="note info">Published {d(r.published_at?.slice(0, 10))}{r.published_by ? ` by ${r.published_by}` : ''}. Unpublish to make changes.</div>}
      {!r.access && <div className="note info">Editing reports needs the Professional plan. You can still download this report.</div>}
      {generating && <div className="note info"><Spinner label="AI is writing the report from your project data. This usually takes under a minute…" /></div>}
      {!D.has_programme && <div className="note warn">This project has no programme activities yet, so progress figures are empty. Upload a programme for meaningful reports.</div>}

      <section className="card report-meta">
        <label className="field"><span className="field-label">Prepared for</span><input value={r.content.prepared_for || ''} disabled={locked} onChange={(e) => setContent({ prepared_for: e.target.value })} /></label>
        <label className="field"><span className="field-label">Prepared by</span><input value={r.content.prepared_by || ''} disabled={locked} onChange={(e) => setContent({ prepared_by: e.target.value })} /></label>
        <details className="notes-details">
          <summary>Notes for the AI {r.content.notes ? '(added)' : '(optional)'}</summary>
          <textarea rows={3} value={r.content.notes || ''} disabled={locked} onChange={(e) => setContent({ notes: e.target.value })} placeholder="Key events, reasons for delays, decisions needed… Then use More ▾ → Rewrite with AI." />
        </details>
      </section>

      <div className="kpi-row">
        {kpis(r).map((k) => (
          <div key={k.label} className="stat">
            <div className="stat-label">{k.label}</div>
            <div className={`stat-value ${k.tone}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {LAYOUT[r.type].map((block) => {
        const s = sectionByKey.get(block);
        if (s) {
          return (
            <section key={block} className="card report-block">
              <input className="block-title" value={s.title} disabled={locked} aria-label="Section title" onChange={(e) => setContent({ sections: r.content.sections.map((x) => (x.key === block ? { ...x, title: e.target.value } : x)) })} />
              {generating ? (
                <div className="skeleton-text"><Spinner label="Writing…" /></div>
              ) : (
                <AutoText
                  value={s.text}
                  disabled={locked}
                  placeholder="Leave empty to leave this section out of the PDF."
                  onChange={(text) => setContent({ sections: r.content.sections.map((x) => (x.key === block ? { ...x, text } : x)) })}
                />
              )}
            </section>
          );
        }
        const off = hidden.has(block);
        return (
          <section key={block} className={`card report-block figure ${off ? 'off' : ''}`}>
            <div className="row between wrap gap">
              <h3>{BLOCK_NAMES[block]}</h3>
              <label className="check-inline">
                <input type="checkbox" checked={!off} disabled={locked} onChange={() => toggleBlock(block)} /> Include in report
              </label>
            </div>
            {!off && (
              <Figure
                block={block}
                r={r}
                locked={locked}
                setContent={setContent}
                onUpload={upload}
                uploading={busy === 'photos'}
                photoUrl={(f) => `${base}/photo/${encodeURIComponent(f)}`}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

function AutoText({ value, onChange, disabled, placeholder }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} className="auto-text" rows={3} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Table({ cols, rows, empty }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <div className="table-scroll">
      <table className="table compact">
        <thead><tr>{cols.map((c) => <th key={c.label} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{cols.map((c, j) => <td key={c.label} className={`${c.num ? 'num' : ''} ${c.cls?.(row) || ''}`}>{c.get(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const statusCls = (s) => (/behind|late start|overdue|late|risk/i.test(s || '') ? 'bad-text' : /slipping/i.test(s || '') ? 'warn-text' : /complete|on time/i.test(s || '') ? 'good-text' : '');

function Figure({ block, r, locked, setContent, onUpload, uploading, photoUrl }) {
  const D = r.data;
  switch (block) {
    case 'curve':
      return <Curve c={D.curve} />;
    case 'completed':
      return <Table empty="No activities were completed in this period." cols={[{ label: 'Activity', get: (x) => x.name }, { label: 'Phase', get: (x) => x.section || '' }, { label: 'Completed', get: (x) => d(x.completed_on) }]} rows={D.completed} />;
    case 'progressed':
      return <Table empty="No activities progressed in this period." cols={[{ label: 'Activity', get: (x) => x.name }, { label: 'Before', num: 1, get: (x) => pct(x.before) }, { label: 'Now', num: 1, get: (x) => pct(x.actual) }, { label: 'Planned', num: 1, get: (x) => pct(x.planned) }, { label: 'Status', get: (x) => x.status, cls: (x) => statusCls(x.status) }]} rows={D.progressed} />;
    case 'sections':
      return <Table empty="No programme yet." cols={[{ label: 'Phase', get: (x) => x.name }, { label: 'Share', num: 1, get: (x) => pct(x.share) }, { label: 'Actual', num: 1, get: (x) => pct(x.actual) }, { label: 'Planned', num: 1, get: (x) => pct(x.planned) }, { label: 'Variance', num: 1, get: (x) => (x.planned == null ? '–' : signed(Math.round((x.actual - x.planned) * 10) / 10, ' pts')), cls: (x) => (x.planned != null && x.actual - x.planned < -5 ? 'bad-text' : '') }, { label: 'Planned finish', get: (x) => (x.actual_finish ? `Done ${d(x.actual_finish)}` : d(x.planned_finish)) }]} rows={D.sections} />;
    case 'behind':
      return <Table empty="No activities are more than 10 points behind programme." cols={[{ label: 'Activity', get: (x) => x.name }, { label: 'Actual', num: 1, get: (x) => pct(x.actual) }, { label: 'Planned', num: 1, get: (x) => pct(x.planned) }, { label: 'Variance', num: 1, get: (x) => signed(x.variance, ' pts'), cls: () => 'bad-text' }, { label: 'Planned finish', get: (x) => d(x.finish) }]} rows={D.behind} />;
    case 'upcoming':
      return (
        <>
          <p className="muted small">{d(D.look_ahead.from)} – {d(D.look_ahead.to)}</p>
          <Table empty="No programme activities are planned for this period." cols={[{ label: 'Activity', get: (x) => x.name }, { label: 'Phase', get: (x) => x.section || '' }, { label: 'Start', get: (x) => d(x.start) }, { label: 'Finish', get: (x) => d(x.finish) }, { label: 'Now', num: 1, get: (x) => pct(x.actual) }]} rows={D.upcoming} />
        </>
      );
    case 'issues':
      return <Table empty="No site issues were recorded." cols={[{ label: 'Date', get: (x) => d(x.date) }, { label: 'Category', get: (x) => x.category || '' }, { label: 'Issue', get: (x) => x.description || '' }, { label: 'Severity', get: (x) => x.severity || '', cls: (x) => (x.severity === 'High' ? 'bad-text' : '') }, { label: 'Action', get: (x) => x.action || '' }]} rows={D.site?.issues || D.recent_issues || []} />;
    case 'resources': {
      const s = D.site;
      const rows = [
        ['Daily reports filed', s.daily_reports],
        ['Labour on site', s.daily_reports ? `Average ${s.labour.average} a day, peak ${s.labour.peak} (${s.labour.man_days} man-days)` : '–'],
        s.labour.by_trade.length && ['Main trades', s.labour.by_trade.map((t) => `${t.trade} ${t.average}`).join(', ')],
        s.equipment.length && ['Equipment', s.equipment.join(', ')],
        ['Weather', s.weather.conditions.length ? s.weather.conditions.map((w) => `${w.condition} ${w.days}d`).join(', ') + (s.weather.hours_lost ? `; ${s.weather.hours_lost} hours lost` : '') : 'Not recorded'],
        s.attendance && ['Attendance register', `${s.attendance.days} days, average ${s.attendance.average_present} present, ${s.attendance.absences} absences`],
        s.visitors.length && ['Visitors', s.visitors.map((v) => v.name).join(', ')],
      ].filter(Boolean);
      return (
        <>
          <Table cols={[{ label: 'Item', get: (x) => <b>{x[0]}</b> }, { label: 'Details', get: (x) => x[1] }]} rows={rows} />
          {s.materials.length > 0 && (
            <Table cols={[{ label: 'Material', get: (x) => x.name }, { label: 'Received', num: 1, get: (x) => `${x.delivered} ${x.unit}` }, { label: 'Used', num: 1, get: (x) => x.used }, { label: 'In stock', num: 1, get: (x) => x.closing + (x.low ? ' (low)' : ''), cls: (x) => (x.low ? 'bad-text' : '') }]} rows={s.materials} />
          )}
        </>
      );
    }
    case 'milestones':
      return <MilestonesEditor list={r.content.milestones || []} locked={locked} onChange={(milestones) => setContent({ milestones })} />;
    case 'photos':
      return <PhotosEditor photos={r.content.photos || []} locked={locked} onChange={(photos) => setContent({ photos })} onUpload={onUpload} uploading={uploading} photoUrl={photoUrl} />;
    default:
      return null;
  }
}

function MilestonesEditor({ list, locked, onChange }) {
  const set = (i, patch) => onChange(list.map((m, j) => (j === i ? { ...m, ...patch, auto: patch.remarks !== undefined && Object.keys(patch).length === 1 ? m.auto : false } : m)));
  return (
    <>
      <div className="table-scroll">
        <table className="table compact ms-table">
          <thead><tr><th>Milestone</th><th>Target</th><th>Actual</th><th>Status</th><th>Remarks</th><th /></tr></thead>
          <tbody>
            {list.map((m, i) => (
              <tr key={m.key}>
                <td><input className="cell-input" value={m.name} disabled={locked} aria-label="Milestone" onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td><input className="cell-input" type="date" value={m.planned || ''} disabled={locked} aria-label="Target date" onChange={(e) => set(i, { planned: e.target.value || null })} /></td>
                <td>
                  <input className="cell-input" type="date" value={m.actual || ''} disabled={locked} aria-label="Actual date" onChange={(e) => set(i, { actual: e.target.value || null })} />
                  {!m.actual && m.forecast && <div className="muted small">Forecast {d(m.forecast)}</div>}
                  {!m.actual && !m.forecast && m.progress != null && <div className="muted small">{m.progress}% done</div>}
                </td>
                <td><input className={`cell-input ${statusCls(m.status)}`} value={m.status || ''} disabled={locked} aria-label="Status" onChange={(e) => set(i, { status: e.target.value })} /></td>
                <td><input className="cell-input" value={m.remarks || ''} disabled={locked} aria-label="Remarks" placeholder="—" onChange={(e) => set(i, { remarks: e.target.value })} /></td>
                <td>{!locked && <button className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!locked && (
        <button className="btn ghost sm" onClick={() => onChange([...list, { key: Math.random().toString(36).slice(2), auto: false, name: 'New milestone', planned: null, actual: null, status: '', remarks: '' }])}>
          + Add milestone
        </button>
      )}
      <p className="muted small">Phase milestones come from your programme; edited rows are kept when figures are refreshed.</p>
    </>
  );
}

function PhotosEditor({ photos, locked, onChange, onUpload, uploading, photoUrl }) {
  return (
    <div className="photo-picks large">
      {photos.map((p, i) => (
        <div key={p.filename} className="photo-pick">
          <img src={photoUrl(p.filename)} alt={p.caption || ''} loading="lazy" />
          <input value={p.caption || ''} placeholder="Caption" disabled={locked} aria-label={`Caption for photo ${i + 1}`} onChange={(e) => onChange(photos.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
          {!locked && <button className="icon-btn" aria-label="Remove photo" onClick={() => onChange(photos.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      {!locked && (
        <label className={`photo-add ${uploading ? 'disabled' : ''}`}>
          {uploading ? 'Uploading…' : '+ Add photos'}
          <input type="file" accept="image/*" multiple hidden onChange={(e) => onUpload([...e.target.files])} />
        </label>
      )}
      {!photos.length && locked && <p className="muted small">No photos.</p>}
    </div>
  );
}

/** Planned (dashed) vs actual progress curve. */
function Curve({ c }) {
  if (!c || (!c.actual.length && !c.planned.length)) return <p className="muted small">Not enough data for a curve yet.</p>;
  const W = 640, H = 220, P = { l: 36, r: 10, t: 10, b: 24 };
  const dates = [...c.planned, ...c.actual].map((p) => Date.parse(p.date)).concat(Date.parse(c.as_of));
  const t0 = Math.min(...dates), t1 = Math.max(...dates);
  const X = (iso) => P.l + ((Date.parse(iso) - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - P.t - P.b);
  const path = (pts) => pts.filter((p) => p.pct != null).map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)} ${Y(p.pct).toFixed(1)}`).join(' ');
  return (
    <figure className="curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Planned versus actual progress">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={P.l - 6} y={Y(v) + 4} textAnchor="end" className="axis">{v}%</text>
          </g>
        ))}
        <path d={path(c.planned)} className="planned" />
        <path d={path(c.actual)} className="actual" />
        {c.actual.length === 1 && <circle cx={X(c.actual[0].date)} cy={Y(c.actual[0].pct)} r="3" className="dot" />}
        <line x1={X(c.as_of)} x2={X(c.as_of)} y1={P.t} y2={H - P.b} className="asof" />
        <text x={P.l} y={H - 6} className="axis">{d(new Date(t0).toISOString().slice(0, 10))}</text>
        <text x={W - P.r} y={H - 6} textAnchor="end" className="axis">{d(new Date(t1).toISOString().slice(0, 10))}</text>
      </svg>
      <figcaption className="muted small"><span className="key planned" /> Planned <span className="key actual" /> Actual (from daily reports) <span className="key asof" /> Report date</figcaption>
    </figure>
  );
}
