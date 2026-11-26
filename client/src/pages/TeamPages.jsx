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
      {data?.billing && <SeatNote billing={data.billing} users={data.users} isAdmin={isAdmin} />}
      {!data ? <Spinner label="Loading…" /> : (
        <section className="card">
          <div className="table-scroll">
            <table className="table stack-mobile">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th>{isAdmin && <th />}</tr></thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td className="cell-title"><b>{u.name}</b>{u.id === data.me && <span className="badge sm">you</span>}{u.must_change_password && <span className="badge sm">temporary password</span>}{u.paused && <span className="badge sm warn-badge" title="Over the plan's member limit: can't log in until the plan is upgraded">paused</span>}</td>
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

/** Members used vs the plan's limit, and what happens to anyone over it. */
function SeatNote({ billing, users, isAdmin }) {
  const limit = billing.limits.members;
  if (limit == null) return null;
  const paused = users.filter((u) => u.paused).length;
  const full = users.length >= limit;
  if (!full) return <p className="muted small">{users.length} of {limit} members on the {billing.plan_name} plan.</p>;
  return (
    <div className="note warn">
      <span>
        {paused > 0
          ? `Your ${billing.plan_name} plan allows ${limit} members, so ${paused} ${paused === 1 ? 'person is' : 'people are'} paused and can't log in. `
          : `You're using all ${limit} member places on the ${billing.plan_name} plan. `}
        {isAdmin ? <Link to="/billing">Upgrade the plan</Link> : 'Ask your admin to upgrade the plan'} to add more people.
      </span>
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

  const setBilling = async (c, body, question) => {
    if (question && !confirm(question)) return;
    try {
      await api.put(`/api/billing/admin/companies/${c.id}`, body);
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
                <thead><tr><th>Company</th><th>Admin</th><th className="num">Users</th><th className="num">Projects</th><th className="num">Reports</th><th>Signed up</th><th>Last active</th><th>Status</th><th>Plan</th><th /></tr></thead>
                <tbody>
                  {data.companies.map((c) => (
                    <tr key={c.id}>
                      <td className="cell-title"><b>{c.name}</b></td>
                      <td className="muted break" data-label="Admin">{c.admin_email}{c.admin_email && !c.admin_verified && <span className="badge sm warn-badge" title="Hasn't confirmed their email yet">unconfirmed</span>}</td>
                      <td className="num" data-label="Users">{c.user_count}</td>
                      <td className="num" data-label="Projects">{c.project_count}</td>
                      <td className="num" data-label="Reports">{c.report_count}</td>
                      <td className="nowrap" data-label="Signed up">{fmtDateTime(c.created_at)}</td>
                      <td className="nowrap" data-label="Last active">{fmtDateTime(c.last_login)}</td>
                      <td data-label="Status"><span className={`status-tag ${c.status === 'active' ? 'ahead' : 'behind'}`}>{c.status === 'active' ? 'Active' : 'Suspended'}</span></td>
                      <td data-label="Plan" className="plan-cell">
                        <b>{c.billing.plan_name}</b>{' '}
                        <span className="muted small">
                          {c.billing.source === 'trial' ? `trial, ${c.billing.trial_days_left}d left` : c.billing.source === 'paid' ? `paid${c.billing.subscription?.status !== 'active' ? `, ${c.billing.subscription?.status}` : ''}` : c.billing.source === 'complimentary' ? 'free of charge' : ''}
                        </span>
                        <div className="row gap wrap plan-actions">
                          <select
                            className="inline-select"
                            value={c.billing.override || ''}
                            aria-label={`Complimentary plan for ${c.name}`}
                            title="Give this company a plan without payment"
                            onChange={(e) => setBilling(c, { plan_override: e.target.value || null }, `${e.target.value ? `Give ${c.name} the ${e.target.value} plan free of charge` : `Remove ${c.name}'s complimentary plan`}?`)}
                          >
                            <option value="">No free plan</option>
                            {data.plans.filter((p) => p.key !== 'free').map((p) => (
                              <option key={p.key} value={p.key}>Free {p.name}</option>
                            ))}
                          </select>
                          <button className="btn ghost sm" onClick={() => setBilling(c, { extend_trial_days: 7 }, `Add 7 trial days for ${c.name}?`)}>+7 trial days</button>
                        </div>
                      </td>
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
          <PriceEditor />
          <DemoRequests />
        </>
      )}
    </>
  );
}

const DEMO_STATUS = { new: 'New', contacted: 'Contacted', closed: 'Closed' };

/** "Book a demo" requests from the public homepage. */
function DemoRequests() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [show, setShow] = useState('open');
  const load = useCallback(() => api.get('/api/admin/demo-requests').then((d) => setRows(d.requests)).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  const setStatus = async (r, status) => {
    try {
      await api.put(`/api/admin/demo-requests/${r.id}`, { status });
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status } : x)));
    } catch (e) {
      setError(e.message);
    }
  };
  const shown = (rows || []).filter((r) => show === 'all' || r.status !== 'closed');
  const fresh = (rows || []).filter((r) => r.status === 'new').length;
  return (
    <section className="card">
      <div className="row between wrap gap">
        <h2 className="no-margin">Demo requests {fresh > 0 && <span className="status-tag behind">{fresh} new</span>}</h2>
        <select className="inline-select" value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show">
          <option value="open">Open requests</option>
          <option value="all">All requests</option>
        </select>
      </div>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {!rows ? <Spinner label="Loading…" /> : shown.length === 0 ? (
        <p className="muted">No {show === 'open' ? 'open ' : ''}demo requests yet. They arrive from the "Book a demo" form on the homepage.</p>
      ) : (
        <div className="table-scroll">
          <table className="table stack-mobile">
            <thead><tr><th>Received</th><th>Name</th><th>Company</th><th>Contact</th><th>Team</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="cell-title nowrap">{fmtDateTime(r.created_at)}</td>
                  <td data-label="Name"><b>{r.name}</b></td>
                  <td data-label="Company">{r.company}</td>
                  <td data-label="Contact" className="break">
                    <a href={`mailto:${r.email}`}>{r.email}</a>
                    {r.phone && <><br /><a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}>{r.phone}</a></>}
                  </td>
                  <td data-label="Team">{r.team_size || '–'}</td>
                  <td data-label="Message" className="muted">{r.message || '–'}</td>
                  <td data-label="Status">
                    <select className="inline-select" value={r.status} onChange={(e) => setStatus(r, e.target.value)} aria-label={`Status for ${r.name}`}>
                      {Object.entries(DEMO_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Plan prices (platform admin). Changing a price affects new subscriptions; existing ones keep their price. */
function PriceEditor() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api.get('/api/billing').then(setData).catch((e) => setError(e.message));
  }, []);
  if (!data) return error ? <ErrorNote error={error} /> : null;
  const key = (p, c, i) => `${p}|${c}|${i}`;
  const val = (p, c, i) => draft[key(p, c, i)] ?? data.prices[p]?.[c]?.[i] ?? '';
  const save = async () => {
    setError(null);
    try {
      const prices = Object.entries(draft).map(([k, amount]) => {
        const [plan, currency, interval] = k.split('|');
        return { plan, currency, interval, amount };
      });
      const res = await api.put('/api/billing/admin/prices', { prices });
      setData((d) => ({ ...d, prices: res.prices }));
      setDraft({});
      setSaved(true);
    } catch (e) {
      setError(e.message);
    }
  };
  const paid = data.plans.filter((p) => p.key !== 'free');
  return (
    <section className="card">
      <h2 className="no-margin">Plan prices</h2>
      <p className="muted small">New prices apply to new subscriptions. Existing subscribers keep the price they signed up at.{!data.payments_enabled && ' Online payments are off until PAYSTACK_SECRET_KEY is set.'}</p>
      <ErrorNote error={error} onClose={() => setError(null)} />
      <div className="table-scroll">
        <table className="table compact">
          <thead><tr><th>Plan</th><th className="num">₦ / month</th><th className="num">₦ / year</th><th className="num">$ / month</th><th className="num">$ / year</th></tr></thead>
          <tbody>
            {paid.map((p) => (
              <tr key={p.key}>
                <td><b>{p.name}</b></td>
                {['NGN', 'USD'].flatMap((c) => ['monthly', 'annually'].map((i) => (
                  <td key={c + i} className="num">
                    <input
                      className="price-input"
                      type="number"
                      min="1"
                      step={c === 'USD' ? '0.01' : '1'}
                      value={val(p.key, c, i)}
                      aria-label={`${p.name} ${c} ${i}`}
                      onChange={(e) => {
                        setSaved(false);
                        setDraft((d) => ({ ...d, [key(p.key, c, i)]: e.target.value }));
                      }}
                    />
                  </td>
                )))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row gap end">
        {saved && <span className="muted small">Prices saved.</span>}
        <button className="btn primary sm" disabled={!Object.keys(draft).length} onClick={save}>Save prices</button>
      </div>
    </section>
  );
}
