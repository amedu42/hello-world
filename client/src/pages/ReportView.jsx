import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { Sparkle, useStatus } from '../App.jsx';
import { ErrorNote, ProgressBar, Spinner } from '../components/ui.jsx';

export default function ReportView() {
  const { rid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { ai } = useStatus();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [regen, setRegen] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    api.get(`/api/reports/${rid}`).then(setData).catch((e) => setError(e.message));
  }, [rid]);

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading report…" />;
  const { report: r, items, photos, project, reportNo } = data;
  const w = r.weather || {};
  const labourTotal = r.labour.reduce((s, l) => s + (Number(l.count) || 0), 0);

  const regenerate = async () => {
    setRegen(true);
    setError(null);
    try {
      const { summary } = await api.post(`/api/reports/${rid}/summary`);
      setData((d) => ({ ...d, report: { ...d.report, summary, summary_source: 'ai' } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setRegen(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the report for ${fmtDate(r.report_date)}? Progress will be recalculated from the remaining reports.`)) return;
    await api.del(`/api/reports/${rid}`);
    navigate(`/projects/${project.id}`);
  };

  return (
    <>
      <nav className="crumbs">
        <Link to="/">Projects</Link> / <Link to={`/projects/${project.id}`}>{project.name}</Link> / <span>Report {fmtDate(r.report_date)}</span>
      </nav>
      {location.state?.justSaved && <div className="note success"><span>Report saved. Overall progress is now <b>{r.overall_progress}%</b>.</span></div>}
      {location.state?.aiError && <div className="note warn small"><span>AI summary unavailable ({location.state.aiError}); a standard summary was used.</span></div>}
      <ErrorNote error={error} onClose={() => setError(null)} />

      <div className="page-head">
        <div>
          <div className="eyebrow">Daily site report · No. {reportNo}</div>
          <h1>{fmtDate(r.report_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h1>
          <p className="muted">{project.name}{r.supervisor ? ` · Prepared by ${r.supervisor}` : ''}</p>
        </div>
        <div className="row gap wrap">
          <button className="btn ghost danger-text" onClick={remove}>Delete</button>
          <Link className="btn ghost" to={`/reports/${rid}/edit`}>Edit</Link>
          <a className="btn ghost" href={`/api/reports/${rid}/pdf?inline=1`} target="_blank" rel="noreferrer">View PDF</a>
          <a className="btn primary" href={`/api/reports/${rid}/pdf`}>Download PDF</a>
        </div>
      </div>

      <div className="report-top">
        <section className="card summary-card">
          <div className="row between wrap gap">
            <h2 className={r.summary_source === 'ai' ? 'h-icon' : ''}>{r.summary_source === 'ai' && <Sparkle size={15} />} Summary</h2>
            {ai && (
              <button className="btn ghost sm" onClick={regenerate} disabled={regen}>
                {regen ? <Spinner label="Writing…" /> : r.summary_source === 'ai' ? 'Rewrite' : 'Write with AI'}
              </button>
            )}
          </div>
          {(r.summary || '').split(/\n+/).map((para, i) => <p key={i}>{para}</p>)}
        </section>
        <section className="card overall-card">
          <div className="hero-label">Overall progress after this report</div>
          <div className="hero-number sm">{r.overall_progress ?? 0}<span>%</span></div>
          <ProgressBar value={r.overall_progress} size="lg" />
          <div className="mini-facts">
            {w.condition && <span>☀︎ {w.condition}{w.temp_high != null ? `, ${w.temp_high}°C` : ''}</span>}
            {labourTotal > 0 && <span>👷 {labourTotal} on site</span>}
            {r.issues.length > 0 && <span>⚠ {r.issues.length} issue{r.issues.length > 1 ? 's' : ''}</span>}
          </div>
        </section>
      </div>

      <section className="card">
        <h2>Activities & progress</h2>
        <div className="table-scroll">
          <table className="table stack-mobile">
            <thead><tr><th>Activity</th><th className="num">Previous</th><th className="num">Now</th><th className="num">Change</th><th style={{ width: '22%' }}>Progress</th><th>Remarks</th></tr></thead>
            <tbody>
              {items.map((i) => {
                const d = Math.round((i.progress - (i.progress_before || 0)) * 10) / 10;
                return (
                  <tr key={i.id}>
                    <td className="cell-title">{i.activity_name}</td>
                    <td className="num muted" data-label="Previous">{i.progress_before ?? 0}%</td>
                    <td className="num" data-label="Now"><b>{i.progress}%</b></td>
                    <td className={`num ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}`} data-label="Change">{d > 0 ? '+' : ''}{d}%</td>
                    <td data-label="Progress"><ProgressBar value={i.progress} /></td>
                    <td className="muted" data-label="Remarks">{i.remarks}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2 align-start">
        <section className="card">
          <h2>Weather</h2>
          {Object.values(w).some((v) => v !== '' && v != null) ? (
            <dl className="facts">
              {w.condition && <><dt>Condition</dt><dd>{w.condition}</dd></>}
              {(w.temp_high != null || w.temp_low != null) && <><dt>Temperature</dt><dd>{w.temp_low ?? '–'}°C to {w.temp_high ?? '–'}°C</dd></>}
              {w.rainfall && <><dt>Rainfall</dt><dd>{w.rainfall}</dd></>}
              {w.wind && <><dt>Wind</dt><dd>{w.wind}</dd></>}
              {w.impact && <><dt>Impact</dt><dd>{w.impact}</dd></>}
              {w.hours_lost ? <><dt>Hours lost</dt><dd>{w.hours_lost} h</dd></> : null}
            </dl>
          ) : <p className="muted">Not recorded.</p>}
        </section>
        <section className="card">
          <h2>Resources</h2>
          {r.labour.length === 0 && r.equipment.length === 0 && <p className="muted">Not recorded.</p>}
          {r.labour.length > 0 && (
            <table className="table compact">
              <thead><tr><th>Trade</th><th className="num">No.</th></tr></thead>
              <tbody>
                {r.labour.map((l, i) => <tr key={i}><td>{l.trade}</td><td className="num">{l.count}</td></tr>)}
                <tr className="total"><td>Total</td><td className="num">{labourTotal}</td></tr>
              </tbody>
            </table>
          )}
          {r.equipment.length > 0 && (
            <table className="table compact">
              <thead><tr><th>Equipment</th><th className="num">No.</th><th>Status</th></tr></thead>
              <tbody>{r.equipment.map((e, i) => <tr key={i}><td>{e.name}</td><td className="num">{e.count}</td><td>{e.status}</td></tr>)}</tbody>
            </table>
          )}
        </section>
      </div>

      <ListCard title="Site issues" rows={r.issues} empty="No issues reported." cols={[['category', 'Category'], ['description', 'Description'], ['severity', 'Severity'], ['action', 'Action']]} />
      <ListCard title="Material deliveries" rows={r.materials} empty="No deliveries recorded." cols={[['material', 'Material'], ['quantity', 'Quantity'], ['supplier', 'Supplier'], ['notes', 'Notes']]} />
      <ListCard title="Visitors" rows={r.visitors} empty="No visitors recorded." cols={[['name', 'Name'], ['organisation', 'Organisation'], ['purpose', 'Purpose'], ['time', 'Time']]} />

      {r.notes && (
        <section className="card">
          <h2>Additional notes</h2>
          <p className="prewrap">{r.notes}</p>
        </section>
      )}

      <section className="card">
        <h2>Site photos</h2>
        {photos.length === 0 ? <p className="muted">No photos.</p> : (
          <div className="photo-grid large">
            {photos.map((p) => (
              <figure key={p.id} className="photo clickable" onClick={() => setLightbox(p)}>
                <img src={p.url} alt={p.caption || ''} loading="lazy" />
                <figcaption>{p.caption || p.original_name}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Photo">
          <img src={lightbox.url} alt={lightbox.caption || ''} />
          {lightbox.caption && <p>{lightbox.caption}</p>}
        </div>
      )}
    </>
  );
}

function ListCard({ title, rows, cols, empty }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="muted">{empty}</p> : (
        <div className="table-scroll">
          <table className="table stack-mobile">
            <thead><tr>{cols.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map(([k, l], ci) => (
                    <td key={k} className={ci === 0 ? 'cell-title' : ''} data-label={ci === 0 ? undefined : l}>{k === 'severity' ? <span className={`sev ${String(row[k]).toLowerCase()}`}>{row[k]}</span> : row[k]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
