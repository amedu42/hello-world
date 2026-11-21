import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../App.jsx';
import { ErrorNote, Field, Modal, Spinner } from '../components/ui.jsx';

const genPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(12);
  crypto.getRandomValues(a);
  return [...a].map((n) => chars[n % chars.length]).join('');
};
const fmtDateTime = (s) => (s ? fmtDate(s.slice(0, 10)) : 'Never');

// ------------------------------------------------------------------ Team

export function TeamPage() {
  const { me } = useAuth();
  const isAdmin = me.user.role === 'admin';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => api.get('/api/auth/team').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn, msg) => {
    setError(null);
    try {
      await fn();
      setNotice(msg);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <nav className="crumbs"><Link to="/">Projects</Link> / <span>Team</span></nav>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">People at {me.company.name} who can log in. Everyone sees all of your company's projects.</p>
        </div>
        {isAdmin && <button className="btn primary" onClick={() => setModal({ type: 'add' })}>+ Add person</button>}
      </div>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {notice && <div className="note success"><span>{notice}</span><button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button></div>}
      {!data ? <Spinner label="Loading…" /> : (
        <section className="card">
          <div className="table-scroll">
            <table className="table stack-mobile">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th>{isAdmin && <th />}</tr></thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td className="cell-title"><b>{u.name}</b>{u.id === data.me && <span className="badge sm">you</span>}{u.must_change_password && <span className="badge sm">temporary password</span>}</td>
                    <td data-label="Email" className="break">{u.email}</td>
                    <td data-label="Role">
                      {isAdmin && u.id !== data.me ? (
                        <select className="inline-select" value={u.role} onChange={(e) => act(() => api.put(`/api/auth/team/${u.id}`, { role: e.target.value }), `${u.name} is now ${e.target.value === 'admin' ? 'an admin' : 'a member'}.`)}>
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : u.role === 'admin' ? 'Admin' : 'Member'}
                    </td>
                    <td className="muted" data-label="Last login">{fmtDateTime(u.last_login)}</td>
                    {isAdmin && (
                      <td className="nowrap right">
                        {u.id !== data.me && (
                          <>
                            <button className="btn ghost sm" onClick={() => setModal({ type: 'reset', user: u })}>Reset password</button>{' '}
                            <button className="btn ghost sm danger-text" onClick={() => confirm(`Remove ${u.name}? They will no longer be able to log in.`) && act(() => api.del(`/api/auth/team/${u.id}`), `${u.name} was removed.`)}>Remove</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Admins can manage the team and delete projects. Members can create projects, upload programmes and file daily reports.</p>
        </section>
      )}
      {modal?.type === 'add' && <AddPersonModal onClose={() => setModal(null)} onDone={(msg) => { setModal(null); setNotice(msg); load(); }} />}
      {modal?.type === 'reset' && <ResetModal user={modal.user} onClose={() => setModal(null)} onDone={(msg) => { setModal(null); setNotice(msg); }} />}
    </>
  );
}

function AddPersonModal({ onClose, onDone }) {
  const [f, setF] = useState({ name: '', email: '', role: 'member', password: genPassword() });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/team', f);
      onDone(`${f.name} was added. Send them the login link, their email and the temporary password: ${f.password}. They'll be asked to change it.`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Add person" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" form="add-person" disabled={busy}>{busy ? 'Adding…' : 'Add person'}</button></>}>
      <form id="add-person" onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <Field label="Name"><input value={f.name} onChange={set('name')} required autoFocus /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} required /></Field>
        <Field label="Role">
          <select value={f.role} onChange={set('role')}>
            <option value="member">Member – projects and daily reports</option>
            <option value="admin">Admin – also manages the team</option>
          </select>
        </Field>
        <Field label="Temporary password" hint="Give this to them; they must change it when they first log in."><input value={f.password} onChange={set('password')} required minLength={8} /></Field>
      </form>
    </Modal>
  );
}

function ResetModal({ user, onClose, onDone }) {
  const [password, setPassword] = useState(genPassword());
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api.put(`/api/auth/team/${user.id}`, { password });
      onDone(`New temporary password for ${user.name}: ${password}. They have been logged out and must change it at next login.`);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <Modal title={`Reset password for ${user.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit}>Set temporary password</button></>}>
      <ErrorNote error={error} />
      <Field label="Temporary password"><input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} /></Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ Account (change password)

export function AccountPage() {
  const { me, reload } = useAuth();
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (f.password !== f.confirm) return setError('The new passwords do not match.');
    try {
      await api.post('/api/auth/password', { current: f.current, password: f.password });
      setDone(true);
      setF({ current: '', password: '', confirm: '' });
      reload();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="narrow">
      <h1>Your account</h1>
      <p className="muted">{me.user.name} · {me.user.email} · {me.company.name}</p>
      {me.user.must_change_password && <div className="note warn"><span>You're using a temporary password. Please choose your own to continue.</span></div>}
      {done && <div className="note success"><span>Password changed. You've been logged out on other devices.</span></div>}
      <section className="card">
        <h2>Change password</h2>
        <form onSubmit={submit} className="stack">
          <ErrorNote error={error} />
          <Field label="Current password"><input type="password" autoComplete="current-password" value={f.current} onChange={set('current')} required /></Field>
          <Field label="New password" hint="At least 8 characters."><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required minLength={8} /></Field>
          <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required /></Field>
          <div><button className="btn primary">Change password</button></div>
        </form>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Platform admin

export function AdminPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => api.get('/api/auth/admin/companies').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  const [resetInfo, setResetInfo] = useState(null);
  const resetLink = async (c) => {
    try {
      setResetInfo({ company: c.name, ...(await api.post(`/api/auth/admin/companies/${c.id}/reset-link`)) });
    } catch (e) {
      setError(e.message);
    }
  };

  const toggle = async (c) => {
    const next = c.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !confirm(`Suspend ${c.name}? Their users will be logged out and unable to log in. Their data is kept.`)) return;
    try {
      await api.put(`/api/auth/admin/companies/${c.id}`, { status: next });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <nav className="crumbs"><Link to="/">Projects</Link> / <span>Platform admin</span></nav>
      <div className="page-head">
        <div>
          <h1>Customer companies</h1>
          <p className="muted">Every company that has signed up. Only you can see this page.</p>
        </div>
      </div>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {!data ? <Spinner label="Loading…" /> : (
        <>
          <div className="hero-stats admin-stats">
            <div className="stat"><div className="stat-label">Companies</div><div className="stat-value">{data.companies.length}</div></div>
            <div className="stat"><div className="stat-label">Active</div><div className="stat-value">{data.companies.filter((c) => c.status === 'active').length}</div></div>
            <div className="stat"><div className="stat-label">Users</div><div className="stat-value">{data.companies.reduce((s, c) => s + c.user_count, 0)}</div></div>
            <div className="stat"><div className="stat-label">Daily reports</div><div className="stat-value">{data.companies.reduce((s, c) => s + c.report_count, 0)}</div></div>
          </div>
          <section className="card">
            <div className="table-scroll">
              <table className="table stack-mobile">
                <thead><tr><th>Company</th><th>Admin</th><th className="num">Users</th><th className="num">Projects</th><th className="num">Reports</th><th>Signed up</th><th>Last active</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {data.companies.map((c) => (
                    <tr key={c.id}>
                      <td className="cell-title"><b>{c.name}</b></td>
                      <td className="muted break" data-label="Admin">{c.admin_email}</td>
                      <td className="num" data-label="Users">{c.user_count}</td>
                      <td className="num" data-label="Projects">{c.project_count}</td>
                      <td className="num" data-label="Reports">{c.report_count}</td>
                      <td className="nowrap" data-label="Signed up">{fmtDateTime(c.created_at)}</td>
                      <td className="nowrap" data-label="Last active">{fmtDateTime(c.last_login)}</td>
                      <td data-label="Status"><span className={`status-tag ${c.status === 'active' ? 'ahead' : 'behind'}`}>{c.status === 'active' ? 'Active' : 'Suspended'}</span></td>
                      <td className="right nowrap">
                        <button className="btn ghost sm" onClick={() => resetLink(c)} title="Create a password reset link for this company's admin">Reset link</button>{' '}
                        <button className="btn ghost sm" onClick={() => toggle(c)}>{c.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {resetInfo && (
              <div className="note info stack-note">
                <span>
                  Password reset link for <b>{resetInfo.name}</b> ({resetInfo.email}) at {resetInfo.company}. Send it to them; it works once, for {resetInfo.minutes} minutes:
                  <input readOnly value={resetInfo.link} onFocus={(e) => e.target.select()} className="link-box" />
                </span>
                <button className="icon-btn" onClick={() => setResetInfo(null)} aria-label="Dismiss">✕</button>
              </div>
            )}
            {data.unassigned_projects > 0 && <p className="muted small">{data.unassigned_projects} project(s) from before company accounts are not assigned to any company yet.</p>}
          </section>
        </>
      )}
    </>
  );
}
