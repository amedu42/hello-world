import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../App.jsx';
import ProjectFormModal from '../components/ProjectFormModal.jsx';
import { NotificationPrompt } from './NotificationsPage.jsx';
import { ErrorNote, ProgressBar, Spinner } from '../components/ui.jsx';

export default function Home() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const { me } = useAuth();

  useEffect(() => {
    api.get('/api/projects').then(setProjects).catch((e) => setError(e.message));
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (projects || []).filter((p) => !s || [p.name, p.code, p.client, p.location].some((v) => v?.toLowerCase().includes(s)));
  }, [projects, q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="muted">{me.company.name} · select a project to open its dashboard and daily reports.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New project</button>
      </div>

      <ErrorNote error={error} />
      {projects && projects.length > 0 && <NotificationPrompt />}
      {!projects && !error && <Spinner label="Loading projects…" />}

      {projects && projects.length > 3 && (
        <input className="search" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
      )}

      {projects && projects.length === 0 && (
        <div className="empty-state">
          <h2>No projects yet</h2>
          <p className="muted">Create your first project, upload its work programme, then start filing daily site reports.</p>
          <button className="btn primary" onClick={() => setCreating(true)}>Create a project</button>
        </div>
      )}

      <div className="project-grid">
        {shown.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card project-card">
            <div className="project-card-top">
              <div>
                {p.code && <div className="eyebrow">{p.code}</div>}
                <h3>{p.name}</h3>
                <div className="muted small">{[p.client, p.location].filter(Boolean).join(' · ') || ' '}</div>
              </div>
              <div className="pct">{p.overall_progress}%</div>
            </div>
            <ProgressBar value={p.overall_progress} />
            <div className="project-card-meta">
              <span>{p.activity_count} activities</span>
              <span>{p.report_count} reports</span>
              <span>{p.last_report ? `Last: ${fmtDate(p.last_report, { day: 'numeric', month: 'short' })}` : 'No reports yet'}</span>
            </div>
          </Link>
        ))}
      </div>

      {creating && <ProjectFormModal onClose={() => setCreating(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />}
    </>
  );
}
