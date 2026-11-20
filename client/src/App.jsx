import { createContext, useContext, useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import Home from './pages/Home.jsx';
import ProjectDashboard from './pages/ProjectDashboard.jsx';
import ReportForm from './pages/ReportForm.jsx';
import ReportView from './pages/ReportView.jsx';

const StatusCtx = createContext({ ai: false });
export const useStatus = () => useContext(StatusCtx);

export default function App() {
  const [status, setStatus] = useState({ ai: false });
  useEffect(() => {
    api.get('/api/status').then(setStatus).catch(() => {});
  }, []);

  return (
    <StatusCtx.Provider value={status}>
      <header className="topbar">
        <Link to="/" className="brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--brand)" />
            <path d="M7 23h18M10 23V13l6-4 6 4v10" stroke="var(--accent)" strokeWidth="2.6" fill="none" strokeLinejoin="round" />
          </svg>
          <span>SitePulse</span>
        </Link>
        <span className={`ai-pill ${status.ai ? 'on' : ''}`} title={status.ai ? 'AI features are available' : 'Set ANTHROPIC_API_KEY on the server to enable AI features'}>
          <Sparkle /> AI {status.ai ? 'on' : 'off'}
        </span>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects/:id" element={<ProjectDashboard />} />
          <Route path="/projects/:id/reports/new" element={<ReportForm />} />
          <Route path="/reports/:rid" element={<ReportView />} />
          <Route path="/reports/:rid/edit" element={<ReportForm />} />
          <Route path="*" element={<p className="muted">Page not found. <Link to="/">Back to projects</Link></p>} />
        </Routes>
      </main>
    </StatusCtx.Provider>
  );
}

export function Sparkle({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2l1.8 5.6L19.5 9.5l-5.7 1.9L12 17l-1.8-5.6L4.5 9.5l5.7-1.9z" />
      <path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" />
    </svg>
  );
}
