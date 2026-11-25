// Weekly / monthly / status / milestone reports for a project (Professional plan): list and "New report".
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, todayISO } from '../api.js';
import { Sparkle } from '../App.jsx';
import { prepareImage } from '../images.js';
import { ErrorNote, Field, Modal, Spinner } from '../components/ui.jsx';

const DESCRIPTIONS = {
  weekly: 'Work completed, planned vs actual, two-week look-ahead and challenges for the week.',
  monthly: 'The same for a month: progress, programme position, look-ahead and site resources.',
  status: 'Work-in-progress status: completion by phase, schedule variance, remaining work and forecast finish.',
  milestone: 'Target vs actual completion dates for key phases and practical completion.',
};

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
/** Monday–Sunday week containing the date. */
function weekOf(dateIso) {
  const d = new Date(dateIso + 'T12:00:00');
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}
function monthOf(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: iso(new Date(y, m, 0, 12)) };
}

export default function ProgressReportsPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.get(`/api/projects/${id}/progress-reports`).then(setData).catch((e) => setError(e.message));
  }, [id]);

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading…" />;

  const crumbs = (
    <nav className="crumbs">
      <Link to="/">Projects</Link> / <Link to={`/projects/${id}`}>{data.project.name}</Link> / <span>Progress reports</span>
    </nav>
  );

  return (
    <div className="prog-reports">
      {crumbs}
      <div className="page-head">
        <div>
          <h1>Progress reports {!data.access && <span className="premium-tag">Professional</span>}</h1>
          <p className="muted">Weekly, monthly, status and milestone reports built from your programme and daily reports, written up with AI. Edit before you publish.</p>
        </div>
        {data.access && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Sparkle /> New report
          </button>
        )}
      </div>
      <ErrorNote error={error} onClose={() => setError(null)} />

      {!data.access ? (
        <section className="card premium-pitch">
          <ul className="ticks">
            {Object.entries(DESCRIPTIONS).map(([k, v]) => (
              <li key={k}><b>{data.types.find((t) => t.key === k)?.name}:</b> {v}</li>
            ))}
            <li>Numbers come straight from your programme and daily reports; AI writes the narrative. Edit everything, then publish and download the PDF.</li>
          </ul>
          <p>Included in the Professional plan and above. Daily progress reports stay available on every plan.</p>
          <Link className="btn primary" to="/billing">See plans</Link>
        </section>
      ) : (
        <>
          <div className="report-types">
            {data.types.map((t) => (
              <button key={t.key} className="card report-type" onClick={() => setCreating(t.key)}>
                <b>{t.name}</b>
                <span className="muted small">{DESCRIPTIONS[t.key]}</span>
              </button>
            ))}
            <Link className="card report-type" to={`/projects/${id}`}>
              <b>Daily Progress Report</b>
              <span className="muted small">Day-to-day work, crew counts, equipment, weather and site issues. Filed from the project page.</span>
            </Link>
          </div>

          <section className="card">
            <h2 className="no-margin">Reports</h2>
            {data.reports.length === 0 ? (
              <p className="muted">No reports yet. Choose a report type above to create the first one.</p>
            ) : (
              <div className="table-scroll">
                <table className="table stack-mobile">
                  <thead><tr><th>Report</th><th>Type</th><th>Period</th><th>Status</th><th>Updated</th></tr></thead>
                  <tbody>
                    {data.reports.map((r) => (
                      <tr key={r.id}>
                        <td className="cell-title"><Link to={`/progress-reports/${r.id}`}><b>{r.code}</b> {r.title}</Link></td>
                        <td data-label="Type">{r.type_name}</td>
                        <td data-label="Period" className="nowrap">{r.period_from ? `${fmtDate(r.period_from)} – ${fmtDate(r.period_to)}` : `As of ${fmtDate(r.period_to)}`}</td>
                        <td data-label="Status"><StatusTag status={r.status} /></td>
                        <td data-label="Updated" className="muted nowrap">{fmtDate(r.updated_at.slice(0, 10))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {creating && <NewReportModal data={data} initialType={typeof creating === 'string' ? creating : 'weekly'} onClose={() => setCreating(false)} />}
    </div>
  );
}

export function StatusTag({ status }) {
  const map = { published: ['ahead', 'Published'], draft: ['risk', 'Draft'], generating: ['active', 'Writing…'] };
  const [cls, label] = map[status] || ['', status];
  return <span className={`status-tag ${cls}`}>{label}</span>;
}

function NewReportModal({ data, initialType, onClose }) {
  const navigate = useNavigate();
  const today = todayISO();
  const [type, setType] = useState(initialType);
  const [weekDate, setWeekDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [asOf, setAsOf] = useState(today);
  const [preparedFor, setPreparedFor] = useState(data.project.client || '');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const period = type === 'weekly' ? weekOf(weekDate) : type === 'monthly' ? monthOf(month) : { from: null, to: asOf };

  const addPhotos = async (files) => {
    setError(null);
    try {
      const ready = [];
      for (const f of files) ready.push(await prepareImage(f, { maxDim: 1800, maxBytes: 2.5 * 1024 * 1024 }));
      setPhotos((p) => [...p, ...ready.map((file) => ({ file, caption: '', url: URL.createObjectURL(file) }))].slice(0, 12));
    } catch (e) {
      setError(e.message);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('type', type);
      if (period.from) fd.append('from', period.from);
      fd.append('to', period.to);
      fd.append('prepared_for', preparedFor);
      fd.append('notes', notes);
      photos.forEach((p) => fd.append('photos', p.file));
      fd.append('captions', JSON.stringify(photos.map((p) => p.caption)));
      const r = await api.post(`/api/projects/${data.project.id}/progress-reports`, fd);
      navigate(`/progress-reports/${r.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New progress report"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={create} disabled={busy}>
            {busy ? <Spinner label="Creating…" /> : <><Sparkle /> Create report</>}
          </button>
        </>
      }
    >
      <ErrorNote error={error} onClose={() => setError(null)} />
      <div className="type-choice" role="radiogroup" aria-label="Report type">
        {data.types.map((t) => (
          <label key={t.key} className={`type-option ${type === t.key ? 'on' : ''}`}>
            <input type="radio" name="type" checked={type === t.key} onChange={() => setType(t.key)} />
            <b>{t.name}</b>
            <span className="muted small">{DESCRIPTIONS[t.key]}</span>
          </label>
        ))}
      </div>
      <div className="form-grid-2">
        {type === 'weekly' && (
          <Field label="Week" hint={`${fmtDate(period.from)} – ${fmtDate(period.to)} (Monday to Sunday)`}>
            <input type="date" value={weekDate} onChange={(e) => e.target.value && setWeekDate(e.target.value)} />
          </Field>
        )}
        {type === 'monthly' && (
          <Field label="Month" hint={`${fmtDate(period.from)} – ${fmtDate(period.to)}`}>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </Field>
        )}
        {(type === 'status' || type === 'milestone') && (
          <Field label="Status as of">
            <input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
          </Field>
        )}
        <Field label="Prepared for">
          <input value={preparedFor} onChange={(e) => setPreparedFor(e.target.value)} placeholder="Client or stakeholder" />
        </Field>
      </div>
      <Field label="Anything to add? (optional)" hint="Key events, reasons for delays, instructions received, decisions needed, client requests. The AI uses this together with your daily reports.">
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Slab pour moved to Friday after the concrete supplier's plant broke down. Client approved the revised window schedule on Tuesday." />
      </Field>
      <div className="field">
        <span className="field-label">Extra photos (optional)</span>
        <span className="field-hint">Site photos from the period's daily reports are added automatically; add any others here.</span>
        <div className="photo-picks">
          {photos.map((p, i) => (
            <div key={p.url} className="photo-pick">
              <img src={p.url} alt="" />
              <input value={p.caption} placeholder="Caption" aria-label={`Caption for photo ${i + 1}`} onChange={(e) => setPhotos((ps) => ps.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
              <button className="icon-btn" aria-label="Remove photo" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {photos.length < 12 && (
            <label className="photo-add">
              + Add photos
              <input type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos([...e.target.files])} />
            </label>
          )}
        </div>
      </div>
      {!data.ai && <p className="muted small">AI isn't switched on for this server, so the narrative will be a plain summary of the figures that you can edit.</p>}
    </Modal>
  );
}
