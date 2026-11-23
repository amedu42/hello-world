import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorNote, Field } from '../components/ui.jsx';
import { LegalFooter } from './LegalPages.jsx';

function AuthShell({ title, sub, children, footer }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <a className="auth-brand" href="/home" title="Proj4D home">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#16324f" />
            <path d="M7 23h18M10 23V13l6-4 6 4v10" stroke="#f2a900" strokeWidth="2.6" fill="none" strokeLinejoin="round" />
          </svg>
          <span>Proj4D</span>
        </a>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
        {children}
      </div>
      {footer && <p className="auth-foot">{footer}</p>}
      <LegalFooter />
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
      footer={<>New to Proj4D? <Link to="/signup">Create a company account</Link></>}
    >
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <button className="btn primary lg" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <p className="small center-text"><Link to="/forgot-password">Forgot your password?</Link></p>
      </form>
    </AuthShell>
  );
}

export function SignupPage({ onDone }) {
  const [f, setF] = useState({ company: '', name: '', email: '', password: '', accept_terms: false });
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
        <label className="check">
          <input type="checkbox" checked={f.accept_terms} onChange={(e) => setF((x) => ({ ...x, accept_terms: e.target.checked }))} required />
          <span>I agree to the <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link> on behalf of my company.</span>
        </label>
        <button className="btn primary lg" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Reset your password" sub={sent ? null : "Enter your email and we'll send you a link to choose a new password."} footer={<Link to="/login">Back to log in</Link>}>
      {sent ? (
        <div className="stack">
          <div className="note success"><span>If an account exists for <b>{email}</b>, a reset link is on its way. It works for 60 minutes.</span></div>
          <p className="muted small">No email after a few minutes? Check your spam folder, or ask your company admin to reset your password from the Team page.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="stack">
          <ErrorNote error={error} />
          <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <button className="btn primary lg" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage({ onDone }) {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [f, setF] = useState({ password: '', confirm: '' });
  const [error, setError] = useState(token ? null : 'This reset link is incomplete. Please request a new one.');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError('The passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/reset', { token, password: f.password });
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Choose a new password" footer={<Link to="/forgot-password">Request a new link</Link>}>
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <Field label="New password" hint="At least 8 characters."><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF((x) => ({ ...x, password: e.target.value }))} required minLength={8} autoFocus /></Field>
        <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF((x) => ({ ...x, confirm: e.target.value }))} required /></Field>
        <button className="btn primary lg" disabled={busy || !token}>{busy ? 'Saving…' : 'Save password and log in'}</button>
      </form>
    </AuthShell>
  );
}
