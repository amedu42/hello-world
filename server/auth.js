// Companies, users, sessions and access control.
import express from 'express';
import crypto from 'node:crypto';
import { db, tx } from './db.js';

// ------------------------------------------------------------------ schema

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',      -- active | suspended
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',        -- admin | member
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// Projects created before multi-company support have no company yet.
const projectCols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
if (!projectCols.includes('company_id')) {
  db.exec('ALTER TABLE projects ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE');
  db.exec('CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id)');
}

// ------------------------------------------------------------------ helpers

const SESSION_DAYS = 30;
const COOKIE = 'sp_session';
const PLATFORM_ADMIN_EMAIL = (process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(got, expected);
}
// A real hash to compare against when the email doesn't exist, so timing doesn't reveal accounts.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new AuthError(400, 'Password must be at least 8 characters.');
  if (pw.length > 200) throw new AuthError(400, 'Password is too long.');
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha256(token), userId, expires);
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userId);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

const isPlatformAdmin = (user) => Boolean(PLATFORM_ADMIN_EMAIL && user?.email?.toLowerCase() === PLATFORM_ADMIN_EMAIL);

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, must_change_password: Boolean(u.must_change_password), created_at: u.created_at, last_login: u.last_login };
}

// Simple in-memory limiter for login/sign-up attempts.
const attempts = new Map();
function rateLimit(key, max = 10, windowMs = 15 * 60000) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  rec.n++;
  if (rec.n > max) throw new AuthError(429, 'Too many attempts. Please wait 15 minutes and try again.');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
}, 3600000).unref();

// If the platform owner already has an account, give them any projects left from before company accounts.
if (PLATFORM_ADMIN_EMAIL) {
  const owner = db.prepare('SELECT company_id FROM users WHERE email = ?').get(PLATFORM_ADMIN_EMAIL);
  if (owner) {
    const n = db.prepare('UPDATE projects SET company_id = ? WHERE company_id IS NULL').run(owner.company_id).changes;
    if (n) console.log(`Assigned ${n} existing project(s) to the platform owner's company.`);
  }
}

// ------------------------------------------------------------------ middleware

/** Attaches req.user / req.company when a valid session cookie is present. */
export function loadSession(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db
      .prepare(
        `SELECT u.*, c.name AS company_name, c.status AS company_status, s.token_hash
         FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(sha256(token), new Date().toISOString());
    if (row && row.company_status === 'active') {
      req.user = { ...row };
      req.company = { id: row.company_id, name: row.company_name };
      req.sessionHash = row.token_hash;
    }
  }
  next();
}

/** Blocks state-changing requests coming from other websites. */
export function sameOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.headers.host) return next(new AuthError(403, 'Cross-site request blocked.'));
  }
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new AuthError(401, 'Please log in.'));
  next();
}

const requireAdmin = (req, _res, next) => (req.user?.role === 'admin' ? next() : next(new AuthError(403, 'Only company admins can do this.')));
const requirePlatformAdmin = (req, _res, next) => (isPlatformAdmin(req.user) ? next() : next(new AuthError(403, 'Not allowed.')));

// ------------------------------------------------------------------ access checks used by the API

export function companyProject(req, projectId) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?').get(projectId, req.company.id);
  if (!p) throw new AuthError(404, 'Project not found');
  return { ...p };
}

export function assertActivityAccess(req, activityId) {
  const a = db
    .prepare('SELECT a.* FROM activities a JOIN projects p ON p.id = a.project_id WHERE a.id = ? AND p.company_id = ?')
    .get(activityId, req.company.id);
  if (!a) throw new AuthError(404, 'Activity not found');
  return { ...a };
}

export function assertReportAccess(req, reportId) {
  const r = db
    .prepare('SELECT r.id FROM reports r JOIN projects p ON p.id = r.project_id WHERE r.id = ? AND p.company_id = ?')
    .get(reportId, req.company.id);
  if (!r) throw new AuthError(404, 'Report not found');
}

export function photoForCompany(req, filename) {
  return db
    .prepare(
      `SELECT ph.* FROM photos ph JOIN reports r ON r.id = ph.report_id JOIN projects p ON p.id = r.project_id
       WHERE ph.filename = ? AND p.company_id = ?`
    )
    .get(filename, req.company.id);
}

// ------------------------------------------------------------------ routes

export const authRouter = express.Router();
const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out?.catch) out.catch(next);
  } catch (e) {
    next(e);
  }
};

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: publicUser(req.user), company: req.company, platform_admin: isPlatformAdmin(req.user) });
});

authRouter.post(
  '/signup',
  wrap((req, res) => {
    rateLimit(`signup:${req.ip}`, 5, 60 * 60000);
    const b = req.body || {};
    const company = String(b.company || '').trim();
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    if (!company) throw new AuthError(400, 'Enter your company name.');
    if (!name) throw new AuthError(400, 'Enter your name.');
    if (!isEmail(email)) throw new AuthError(400, 'Enter a valid email address.');
    checkPassword(b.password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new AuthError(409, 'An account with this email already exists. Log in instead.');

    const userId = tx(() => {
      const cid = db.prepare('INSERT INTO companies (name) VALUES (?)').run(company).lastInsertRowid;
      const uid = db
        .prepare('INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?,?,?,?,?)')
        .run(cid, name, email, hashPassword(b.password), 'admin').lastInsertRowid;
      // Projects from before company accounts existed go to the platform owner's company.
      if (PLATFORM_ADMIN_EMAIL && email === PLATFORM_ADMIN_EMAIL) {
        const n = db.prepare('UPDATE projects SET company_id = ? WHERE company_id IS NULL').run(cid).changes;
        if (n) console.log(`Assigned ${n} existing project(s) to company #${cid} (${company}).`);
      }
      return uid;
    });
    startSession(req, res, userId);
    res.status(201).json({ ok: true });
  })
);

authRouter.post(
  '/login',
  wrap((req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    rateLimit(`login:${req.ip}`, 30);
    rateLimit(`login:${email}`, 10);
    const u = db
      .prepare('SELECT u.*, c.status AS company_status FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = ?')
      .get(email);
    const ok = verifyPassword(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) throw new AuthError(401, 'Incorrect email or password.');
    if (u.company_status !== 'active') throw new AuthError(403, 'This company account is suspended. Please contact support.');
    startSession(req, res, u.id);
    res.json({ ok: true });
  })
);

authRouter.post('/logout', (req, res) => {
  if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
  setSessionCookie(req, res, '', 0);
  res.json({ ok: true });
});

authRouter.post(
  '/password',
  requireUser,
  wrap((req, res) => {
    const { current, password } = req.body || {};
    if (!verifyPassword(String(current || ''), req.user.password_hash)) throw new AuthError(400, 'Your current password is incorrect.');
    checkPassword(password);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(password), req.user.id);
    // Sign out other devices.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash);
    res.json({ ok: true });
  })
);

// ---------- team management (company admins)

authRouter.get('/team', requireUser, (req, res) => {
  const users = db.prepare('SELECT * FROM users WHERE company_id = ? ORDER BY created_at, id').all(req.company.id).map(publicUser);
  res.json({ users, me: req.user.id });
});

authRouter.post(
  '/team',
  requireUser,
  requireAdmin,
  wrap((req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const role = b.role === 'admin' ? 'admin' : 'member';
    if (!name) throw new AuthError(400, 'Enter a name.');
    if (!isEmail(email)) throw new AuthError(400, 'Enter a valid email address.');
    checkPassword(b.password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new AuthError(409, 'A user with this email already exists.');
    db.prepare('INSERT INTO users (company_id, name, email, password_hash, role, must_change_password) VALUES (?,?,?,?,?,1)').run(
      req.company.id, name, email, hashPassword(b.password), role
    );
    res.status(201).json({ ok: true });
  })
);

function teamMember(req, id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND company_id = ?').get(id, req.company.id);
  if (!u) throw new AuthError(404, 'User not found');
  return u;
}
const adminCount = (cid) => db.prepare("SELECT COUNT(*) n FROM users WHERE company_id = ? AND role = 'admin'").get(cid).n;

authRouter.put(
  '/team/:uid',
  requireUser,
  requireAdmin,
  wrap((req, res) => {
    const u = teamMember(req, req.params.uid);
    const b = req.body || {};
    if (b.role && b.role !== u.role) {
      const role = b.role === 'admin' ? 'admin' : 'member';
      if (u.role === 'admin' && role === 'member' && adminCount(req.company.id) <= 1) throw new AuthError(400, 'The company needs at least one admin.');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
    }
    if (b.password) {
      checkPassword(b.password);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(b.password), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    }
    res.json({ ok: true });
  })
);

authRouter.delete(
  '/team/:uid',
  requireUser,
  requireAdmin,
  wrap((req, res) => {
    const u = teamMember(req, req.params.uid);
    if (u.id === req.user.id) throw new AuthError(400, "You can't remove yourself.");
    if (u.role === 'admin' && adminCount(req.company.id) <= 1) throw new AuthError(400, 'The company needs at least one admin.');
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    res.json({ ok: true });
  })
);

// ---------- platform owner

authRouter.get('/admin/companies', requireUser, requirePlatformAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count,
        (SELECT COUNT(*) FROM projects p WHERE p.company_id = c.id) AS project_count,
        (SELECT COUNT(*) FROM reports r JOIN projects p ON p.id = r.project_id WHERE p.company_id = c.id) AS report_count,
        (SELECT MAX(u.last_login) FROM users u WHERE u.company_id = c.id) AS last_login,
        (SELECT u.email FROM users u WHERE u.company_id = c.id AND u.role = 'admin' ORDER BY u.id LIMIT 1) AS admin_email
       FROM companies c ORDER BY c.created_at DESC, c.id DESC`
    )
    .all();
  const unassigned = db.prepare('SELECT COUNT(*) n FROM projects WHERE company_id IS NULL').get().n;
  res.json({ companies: rows.map((r) => ({ ...r })), unassigned_projects: unassigned });
});

authRouter.put(
  '/admin/companies/:cid',
  requireUser,
  requirePlatformAdmin,
  wrap((req, res) => {
    const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.cid);
    if (!c) throw new AuthError(404, 'Company not found');
    const status = req.body?.status === 'suspended' ? 'suspended' : 'active';
    if (status === 'suspended' && c.id === req.company.id) throw new AuthError(400, "You can't suspend your own company.");
    db.prepare('UPDATE companies SET status = ? WHERE id = ?').run(status, c.id);
    if (status === 'suspended') db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)').run(c.id);
    res.json({ ok: true });
  })
);
