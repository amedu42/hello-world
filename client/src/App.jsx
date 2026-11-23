import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { Spinner } from './components/ui.jsx';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/AuthPages.jsx';
import { LegalFooter, PrivacyPage, TermsPage } from './pages/LegalPages.jsx';
import AttendancePage from './pages/AttendancePage.jsx';
import CompanySettings from './pages/CompanySettings.jsx';
import MaterialsPage from './pages/MaterialsPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import Home from './pages/Home.jsx';
import ProjectDashboard from './pages/ProjectDashboard.jsx';
import ReportForm from './pages/ReportForm.jsx';
import ReportView from './pages/ReportView.jsx';
import { AccountPage, AdminPage, TeamPage } from './pages/TeamPages.jsx';

const StatusCtx = createContext({ ai: false });
export const useStatus = () => useContext(StatusCtx);
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = loading, null = logged out
  const [status, setStatus] = useState({ ai: false });
  const navigate = useNavigate();
  const location = useLocation();

  const reload = useCallback(async () => {
    try {
      const m = await api.get('/api/auth/me');
      setMe(m);
      api.get('/api/status').then(setStatus).catch(() => {});
    } catch {
      setMe(null);
    }
  }, []);

  // Drop-down menus (<details class="menu">): keep them on screen, close on outside tap or after a choice.
  useEffect(() => {
    const place = (details) => {
      const list = details.querySelector('.menu-list');
      if (!list) return;
      list.classList.remove('open-right');
      const r = list.getBoundingClientRect();
      if (r.left < 8) list.classList.add('open-right');
    };
    const onToggle = (e) => {
      const d = e.target;
      if (d.matches?.('details.menu') && d.open) place(d);
    };
    const onClick = (e) => {
      document.querySelectorAll('details.menu[open]').forEach((d) => {
        const inside = d.contains(e.target);
        const chose = inside && e.target.closest('.menu-list a, .menu-list button');
        if (!inside || chose) d.removeAttribute('open');
      });
    };
    document.addEventListener('toggle', onToggle, true);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    reload();
    const onUnauthorized = () => setMe(null);
    window.addEventListener('sp:unauthorized', onUnauthorized);
    return () => window.removeEventListener('sp:unauthorized', onUnauthorized);
  }, [reload]);

  if (me === undefined) return <div className="container"><Spinner label="Loading…" /></div>;

  if (!me) {
    const afterLogin = async () => {
      await reload();
      const authPaths = ['/login', '/signup', '/forgot-password', '/reset-password'];
      navigate(authPaths.includes(location.pathname) ? '/' : location.pathname, { replace: true });
    };
    return (
      <Routes>
        <Route path="/signup" element={<SignupPage onDone={afterLogin} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage onDone={afterLogin} />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<LoginPage onDone={afterLogin} />} />
      </Routes>
    );
  }

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setMe(null);
    navigate('/login', { replace: true });
  };

  // A temporary password must be changed before anything else.
  const forcePassword = me.user.must_change_password;

  return (
    <AuthCtx.Provider value={{ me, reload }}>
      <StatusCtx.Provider value={status}>
        <header className="topbar">
          <Link to="/" className="brand">
            <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="var(--brand)" />
              <path d="M7 23h18M10 23V13l6-4 6 4v10" stroke="var(--accent)" strokeWidth="2.6" fill="none" strokeLinejoin="round" />
            </svg>
            <span>Proj4D</span>
          </Link>
          <div className="topbar-right">
            <span className={`ai-pill ${status.ai ? 'on' : ''}`} title={status.ai ? 'AI features are available' : 'AI features are off on this server'}>
              <Sparkle /> AI {status.ai ? 'on' : 'off'}
            </span>
            <details className="menu user-menu">
              <summary>
                <span className="avatar" aria-hidden="true">{me.user.name.slice(0, 1).toUpperCase()}</span>
                <span className="user-meta">
                  <span className="user-company">{me.company.name}</span>
                  <span className="user-name">{me.user.name}</span>
                </span>
                ▾
              </summary>
              <div className="menu-list" onClick={(e) => e.target.closest('a,button') && e.currentTarget.parentElement.removeAttribute('open')}>
                <Link to="/">Projects</Link>
                <Link to="/team">Team</Link>
                {me.user.role === 'admin' && <Link to="/settings">Company settings</Link>}
                <Link to="/notifications">Notifications</Link>
                <Link to="/account">Your account</Link>
                {me.platform_admin && <Link to="/admin">Platform admin</Link>}
                <button onClick={logout}>Log out</button>
              </div>
            </details>
          </div>
        </header>
        <main className="container">
          {location.pathname === '/terms' ? (
            <TermsPage />
          ) : location.pathname === '/privacy' ? (
            <PrivacyPage />
          ) : forcePassword ? (
            <AccountPage />
          ) : (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/signup" element={<Navigate to="/" replace />} />
              <Route path="/forgot-password" element={<Navigate to="/account" replace />} />
              <Route path="/reset-password" element={<ResetPasswordPage onDone={reload} />} />
              <Route path="/projects/:id" element={<ProjectDashboard />} />
              <Route path="/projects/:id/reports/new" element={<ReportForm />} />
              <Route path="/projects/:id/attendance" element={<AttendancePage />} />
              <Route path="/projects/:id/materials" element={<MaterialsPage />} />
              <Route path="/reports/:rid" element={<ReportView />} />
              <Route path="/reports/:rid/edit" element={<ReportForm />} />
              <Route path="/team" element={<TeamPage />} />
              <Route path="/settings" element={<CompanySettings />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              {me.platform_admin && <Route path="/admin" element={<AdminPage />} />}
              <Route path="*" element={<p className="muted">Page not found. <Link to="/">Back to projects</Link></p>} />
            </Routes>
          )}
          {!['/terms', '/privacy'].includes(location.pathname) && <LegalFooter />}
        </main>
      </StatusCtx.Provider>
    </AuthCtx.Provider>
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
