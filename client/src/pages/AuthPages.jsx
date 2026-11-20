import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorNote, Field } from '../components/ui.jsx';

function AuthShell({ title, sub, children, footer }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="auth-brand">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#16324f" />
            <path d="M7 23h18M10 23V13l6-4 6 4v10" stroke="#f2a900" strokeWidth="2.6" fill="none" strokeLinejoin="round" />
          </svg>
          <span>SitePulse</span>
        </div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
        {children}
      </div>
      {footer && <p className="auth-foot">{footer}</p>}
    </div>
  );
}

export function LoginPage({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Log in"
      sub="Construction progress tracking and daily site reports."
      footer={<>New to SitePulse? <Link to="/signup">Create a company account</Link></>}
    >
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <button className="btn primary lg" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <p className="muted small center-text">Forgot your password? Ask your company admin to reset it.</p>
      </form>
    </AuthShell>
  );
}

export function SignupPage({ onDone }) {
  const [f, setF] = useState({ company: '', name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/signup', f);
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your company account"
      sub="You'll be the admin and can add your team afterwards. Your projects are visible only to your company."
      footer={<>Already have an account? <Link to="/login">Log in</Link></>}
    >
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <Field label="Company name"><input value={f.company} onChange={set('company')} required autoFocus autoComplete="organization" /></Field>
        <Field label="Your name"><input value={f.name} onChange={set('name')} required autoComplete="name" /></Field>
        <Field label="Work email"><input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></Field>
        <Field label="Password" hint="At least 8 characters."><input type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" /></Field>
        <button className="btn primary lg" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthShell>
  );
}
