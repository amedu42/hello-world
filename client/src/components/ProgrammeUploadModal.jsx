import { useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useStatus } from '../App.jsx';
import { ErrorNote, Modal, Spinner } from './ui.jsx';

export default function ProgrammeUploadModal({ project, hasActivities, onClose, onImported }) {
  const { ai } = useStatus();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [rows, setRows] = useState([]);
  const [mode, setMode] = useState(hasActivities ? 'replace' : 'append');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const read = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post(`/api/projects/${project.id}/programme/preview`, fd);
      setPreview(res);
      setRows(res.activities.map((a) => ({ ...a, include: true })));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const importRows = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/api/projects/${project.id}/activities/bulk`, { activities: rows.filter((r) => r.include), mode });
      onImported(res);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const update = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const count = rows.filter((r) => r.include).length;

  return (
    <Modal
      title="Upload work programme"
      wide
      onClose={onClose}
      footer={
        preview ? (
          <>
            <button className="btn ghost" onClick={() => setPreview(null)} disabled={busy}>Choose another file</button>
            <button className="btn primary" onClick={importRows} disabled={busy || !count}>
              {busy ? 'Importing…' : `Import ${count} activities`}
            </button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={read} disabled={!file || busy}>
              {busy ? <Spinner label="Reading programme…" /> : 'Read programme'}
            </button>
          </>
        )
      }
    >
      <ErrorNote error={error} />
      {!preview ? (
        <div className="stack">
          <label className="dropzone">
            <input type="file" accept=".xlsx,.xlsm,.csv,.xml,.pdf,.txt" onChange={(e) => setFile(e.target.files[0] || null)} />
            <strong>{file ? file.name : 'Choose a programme file'}</strong>
            <span className="muted">Excel (.xlsx), CSV, MS Project XML{ai ? ', or PDF' : ''}</span>
          </label>
          <ul className="muted small tips">
            <li>Export from MS Project, Primavera P6 or Excel with columns such as <b>ID</b>, <b>Activity / Task name</b>, <b>Duration</b>, <b>Start</b>, <b>Finish</b>.</li>
            <li>Rows without dates (summary rows) become section headings.</li>
            <li>Each activity is weighted by its duration when calculating overall progress. Add a <b>Weight</b> or <b>Value</b> column to weight by cost instead.</li>
            {ai ? (
              <li>AI reads PDF programmes and spreadsheets with unusual layouts.</li>
            ) : (
              <li>PDF programmes need AI, which is off on this server.</li>
            )}
          </ul>
        </div>
      ) : (
        <div className="stack">
          <div className="row wrap gap">
            <span className="badge">{preview.method}</span>
            <span className="muted">{preview.activities.length} activities found. Untick anything you don't want, and correct names or weights if needed.</span>
          </div>
          {preview.warnings.map((w) => <div key={w} className="note warn"><span>{w}</span></div>)}
          {hasActivities && (
            <div className="segmented" role="radiogroup">
              <label className={mode === 'replace' ? 'on' : ''}>
                <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Update existing programme
              </label>
              <label className={mode === 'append' ? 'on' : ''}>
                <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> Add to existing activities
              </label>
            </div>
          )}
          <div className="table-scroll tall">
            <table className="table compact">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={count === rows.length} onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, include: e.target.checked })))} aria-label="Select all" /></th>
                  <th>Code</th><th>Activity</th><th>Section</th><th>Start</th><th>Finish</th><th className="num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.include ? '' : 'dim'}>
                    <td><input type="checkbox" checked={r.include} onChange={(e) => update(i, 'include', e.target.checked)} /></td>
                    <td className="muted">{r.code}</td>
                    <td><input className="cell-input" value={r.name} onChange={(e) => update(i, 'name', e.target.value)} /></td>
                    <td className="muted">{r.section}</td>
                    <td className="nowrap">{fmtDate(r.start_date)}</td>
                    <td className="nowrap">{fmtDate(r.end_date)}</td>
                    <td className="num"><input className="cell-input num" type="number" min="0" step="any" value={r.weight} onChange={(e) => update(i, 'weight', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
