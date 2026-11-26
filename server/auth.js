// Companies, users, sessions and access control.
import express from 'express';
import crypto from 'node:crypto';
import { db, tx } from './db.js';
import { EventEmitter } from 'node:events';
import { appUrl, mailEnabled, resetEmail, sendMail, verifyEmail, welcomeEmail } from './mail.js';
import { PLANS, TRIAL_DAYS, allowedUserIds, billingSummary, migrateBilling, planOf } from './plans.js';

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
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

const companyCols = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
if (!companyCols.includes('logo_filename')) db.exec('ALTER TABLE companies ADD COLUMN logo_filename TEXT');
if (!companyCols.includes('primary_color')) db.exec('ALTER TABLE companies ADD COLUMN primary_color TEXT');
migrateBilling(); // subscription plan columns and tables

const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('terms_accepted_at')) db.exec('ALTER TABLE users ADD COLUMN terms_accepted_at TEXT');
if (!userCols.includes('email_verified_at')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
  // Everyone who signed up before verification existed counts as verified.
  db.exec("UPDATE users SET email_verified_at = COALESCE(created_at, datetime('now'))");
}
db.exec(`CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`);

/** Account events (new signups, verified emails) for alerts elsewhere in the app. */
export const authEvents = new EventEmitter();

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

export const isPlatformAdmin = (user) => Boolean(PLATFORM_ADMIN_EMAIL && user?.email?.toLowerCase() === PLATFORM_ADMIN_EMAIL);

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    must_change_password: Boolean(u.must_change_password),
    email_verified: Boolean(u.email_verified_at),
    created_at: u.created_at,
    last_login: u.last_login,
  };
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
  if (rec.n > max) throw new AuthError(429, `Too many attempts. Please wait ${Math.ceil((rec.reset - now) / 60000)} minutes and try again.`);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  db.prepare("DELETE FROM password_resets WHERE expires_at < ?").run(new Date().toISOString());
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
        `SELECT u.*, c.name AS company_name, c.status AS company_status, c.logo_filename, c.primary_color, s.token_hash
         FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(sha256(token), new Date().toISOString());
    if (row && row.company_status === 'active' && allowedUserIds(row.company_id).has(row.id)) {
      req.user = { ...row };
      req.company = { id: row.company_id, name: row.company_name, logo_filename: row.logo_filename, primary_color: row.primary_color };
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

/** Blocks the app's data until the signed-in user has confirmed their email address. */
export function requireVerified(req, _res, next) {
  if (req.user && !req.user.email_verified_at) {
    const e = new AuthError(403, 'Please confirm your email address first. We sent you a link.');
    e.code = 'email_unverified';
    return next(e);
  }
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
  const { id, name, logo_filename, primary_color } = req.company;
  res.json({
    user: publicUser(req.user),
    company: {
      id,
      name,
      has_logo: Boolean(logo_filename),
      logo_version: logo_filename || null,
      primary_color: primary_color || null,
      billing: billingSummary(id),
    },
    platform_admin: isPlatformAdmin(req.user),
  });
});

authRouter.post(
  '/signup',
  wrap(async (req, res) => {
    rateLimit(`signup:${req.ip}`, 5, 60 * 60000);
    const b = req.body || {};
    const company = String(b.company || '').trim();
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    if (!company) throw new AuthError(400, 'Enter your company name.');
    if (!name) throw new AuthError(400, 'Enter your name.');
    if (!isEmail(email)) throw new AuthError(400, 'Enter a valid email address.');
    checkPassword(b.password);
    if (b.accept_terms !== true) throw new AuthError(400, 'Please accept the Terms of Service and Privacy Policy.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new AuthError(409, 'An account with this email already exists. Log in instead.');

    const userId = tx(() => {
      // Every new company starts with a free trial of all paid features (no card needed).
      const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
      const cid = db.prepare('INSERT INTO companies (name, trial_ends_at) VALUES (?, ?)').run(company, trialEnds).lastInsertRowid;
      // Without email sending there's no way to confirm the address, so the account counts as verified.
      const verifiedNow = !mailEnabled() || (PLATFORM_ADMIN_EMAIL && email === PLATFORM_ADMIN_EMAIL);
      const uid = db
        .prepare("INSERT INTO users (company_id, name, email, password_hash, role, terms_accepted_at, email_verified_at) VALUES (?,?,?,?,?,datetime('now'),?)")
        .run(cid, name, email, hashPassword(b.password), 'admin', verifiedNow ? new Date().toISOString() : null).lastInsertRowid;
      // Projects from before company accounts existed go to the platform owner's company.
      if (PLATFORM_ADMIN_EMAIL && email === PLATFORM_ADMIN_EMAIL) {
        db.prepare("UPDATE companies SET plan_override = 'business' WHERE id = ?").run(cid); // the platform owner's company
        const n = db.prepare('UPDATE projects SET company_id = ? WHERE company_id IS NULL').run(cid).changes;
        if (n) console.log(`Assigned ${n} existing project(s) to company #${cid} (${company}).`);
      }
      return uid;
    });
    startSession(req, res, userId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    let verificationSent = false;
    if (!user.email_verified_at) verificationSent = await sendVerification(req, user).catch((e) => (console.error('Verification email failed:', e.message), false));
    authEvents.emit('signup', { user: { ...user }, company: { id: user.company_id, name: company }, verificationSent });
    res.status(201).json({ ok: true, verification_sent: verificationSent });
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
    if (!allowedUserIds(u.company_id).has(u.id)) {
      const plan = planOf(u.company_id);
      throw new AuthError(403, `Your company's ${plan.name} plan allows ${plan.members} members, so your account is paused. Ask your company admin to upgrade the plan.`);
    }
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

// ---------- email verification

const VERIFY_HOURS = 72;

/** Emails a fresh confirmation link (replacing earlier ones). Resolves to true if it was sent. */
async function sendVerification(req, user) {
  const base = appUrl(req) || `${req.protocol}://${req.get('host')}`;
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES (?,?,?)').run(
    sha256(token), user.id, new Date(Date.now() + VERIFY_HOURS * 3600000).toISOString()
  );
  return sendMail({ to: user.email, ...verifyEmail({ name: user.name, link: `${base}/verify-email?token=${token}`, hours: VERIFY_HOURS }) });
}

/** The welcome email, sent once an address is confirmed (fire and forget). */
function sendWelcome(req, user) {
  const base = appUrl(req) || `${req.protocol}://${req.get('host')}`;
  const site = (process.env.HOMEPAGE_URL || base).replace(/\/+$/, '');
  const c = db.prepare('SELECT name, trial_ends_at FROM companies WHERE id = ?').get(user.company_id) || {};
  const trialEnds = c.trial_ends_at && Date.parse(c.trial_ends_at) > Date.now()
    ? new Date(c.trial_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;
  sendMail({
    to: user.email,
    ...welcomeEmail({
      name: user.name,
      company: c.name || 'Your company',
      appLink: `${base}/`,
      pricingLink: `${site}/pricing`,
      trialEnds,
      contactEmail: process.env.CONTACT_EMAIL || process.env.LEGAL_CONTACT_EMAIL || '',
      whatsapp: String(process.env.CONTACT_WHATSAPP || '').replace(/[^\d]/g, ''),
    }),
  }).catch((e) => console.error('Welcome email failed:', e.message));
}

// Confirm an address from the emailed link (works whether or not the person is logged in on this device).
authRouter.post(
  '/verify-email',
  wrap((req, res) => {
    rateLimit(`verify:${req.ip}`, 30);
    const token = String(req.body?.token || '');
    const row = db
      .prepare('SELECT v.user_id FROM email_verifications v WHERE v.token_hash = ? AND v.expires_at > ?')
      .get(sha256(token), new Date().toISOString());
    if (!row) {
      // Already used? Then the account may simply be verified already.
      if (req.user?.email_verified_at) return res.json({ ok: true, already: true });
      throw new AuthError(400, 'This link is invalid or has expired. Log in and ask for a new one.');
    }
    db.prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ? AND email_verified_at IS NULL").run(row.user_id);
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(row.user_id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    sendWelcome(req, user);
    authEvents.emit('verified', { user: { ...user } });
    res.json({ ok: true, email: user.email });
  })
);

authRouter.post(
  '/verify-email/resend',
  requireUser,
  wrap(async (req, res) => {
    if (req.user.email_verified_at) return res.json({ ok: true, already: true });
    rateLimit(`verify-resend:${req.user.id}`, 5, 60 * 60000);
    await sendVerification(req, req.user);
    res.json({ ok: true, email: req.user.email });
  })
);

// Fix a mistyped address before it's confirmed (then a new link goes to the corrected address).
authRouter.post(
  '/verify-email/change',
  requireUser,
  wrap(async (req, res) => {
    if (req.user.email_verified_at) throw new AuthError(400, 'Your email is already confirmed. Change it from Your account.');
    rateLimit(`verify-change:${req.user.id}`, 5, 60 * 60000);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!isEmail(email)) throw new AuthError(400, 'Enter a valid email address.');
    if (email !== req.user.email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new AuthError(409, 'An account with this email already exists.');
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.user.id);
    await sendVerification(req, { ...req.user, email });
    res.json({ ok: true, email });
  })
);

// ---------- forgotten password

const RESET_MINUTES = 60;

/** Creates a single-use reset link for a user (replacing any earlier one). */
function createResetLink(req, userId) {
  const base = appUrl(req);
  if (!base) throw new AuthError(500, 'APP_URL is not configured on the server.');
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)').run(
    sha256(token), userId, new Date(Date.now() + RESET_MINUTES * 60000).toISOString()
  );
  return `${base}/reset-password?token=${token}`;
}

authRouter.post(
  '/forgot',
  wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    rateLimit(`forgot:${req.ip}`, 10, 60 * 60000);
    rateLimit(`forgot:${email}`, 3, 60 * 60000);
    if (!isEmail(email)) throw new AuthError(400, 'Enter a valid email address.');
    const u = db
      .prepare('SELECT u.*, c.status AS company_status FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = ?')
      .get(email);
    // Same answer whether or not the account exists, so the form can't be used to discover accounts.
    if (u && u.company_status === 'active') {
      try {
        const link = createResetLink(req, u.id);
        await sendMail({ to: u.email, ...resetEmail({ name: u.name, link, minutes: RESET_MINUTES }) });
      } catch (e) {
        console.error('Password reset email failed:', e.message);
      }
    }
    res.json({ ok: true });
  })
);

authRouter.post(
  '/reset',
  wrap((req, res) => {
    rateLimit(`reset:${req.ip}`, 20);
    const token = String(req.body?.token || '');
    checkPassword(req.body?.password);
    const row = db
      .prepare(
        `SELECT pr.user_id, c.status FROM password_resets pr JOIN users u ON u.id = pr.user_id JOIN companies c ON c.id = u.company_id
         WHERE pr.token_hash = ? AND pr.expires_at > ?`
      )
      .get(sha256(token), new Date().toISOString());
    if (!row) throw new AuthError(400, 'This reset link is invalid or has expired. Please request a new one.');
    if (row.status !== 'active') throw new AuthError(403, 'This company account is suspended. Please contact support.');
    tx(() => {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(req.body.password), row.user_id);
      // The reset link came by email, so the address is confirmed too.
      db.prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ? AND email_verified_at IS NULL").run(row.user_id);
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    });
    startSession(req, res, row.user_id);
    res.json({ ok: true });
  })
);

// ---------- details shown on the Terms / Privacy pages (public)

authRouter.get('/legal', (_req, res) => {
  res.json({
    business_name: process.env.LEGAL_BUSINESS_NAME || '[Your business name]',
    contact_email: process.env.LEGAL_CONTACT_EMAIL || PLATFORM_ADMIN_EMAIL || '[contact email]',
    governing_law: process.env.LEGAL_GOVERNING_LAW || '[country / state]',
    effective_date: process.env.LEGAL_EFFECTIVE_DATE || '[date]',
    ai_enabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    mail_enabled: mailEnabled(),
  });
});

// ---------- team management (company admins)

authRouter.get('/team', requireUser, (req, res) => {
  const allowed = allowedUserIds(req.company.id);
  const users = db
    .prepare('SELECT * FROM users WHERE company_id = ? ORDER BY created_at, id')
    .all(req.company.id)
    .map((u) => ({ ...publicUser(u), paused: !allowed.has(u.id) }));
  res.json({ users, me: req.user.id, billing: billingSummary(req.company.id) });
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
    const plan = planOf(req.company.id);
    const count = db.prepare('SELECT COUNT(*) n FROM users WHERE company_id = ?').get(req.company.id).n;
    if (plan.members != null && count >= plan.members) {
      throw new AuthError(402, `Your ${plan.name} plan allows up to ${plan.members} members. Upgrade your plan to add more.`);
    }
    // People added by their company admin are vouched for, so they don't need to confirm their email.
    db.prepare("INSERT INTO users (company_id, name, email, password_hash, role, must_change_password, email_verified_at) VALUES (?,?,?,?,?,1,datetime('now'))").run(
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
        (SELECT u.email FROM users u WHERE u.company_id = c.id AND u.role = 'admin' ORDER BY u.id LIMIT 1) AS admin_email,
        (SELECT u.email_verified_at IS NOT NULL FROM users u WHERE u.company_id = c.id AND u.role = 'admin' ORDER BY u.id LIMIT 1) AS admin_verified
       FROM companies c ORDER BY c.created_at DESC, c.id DESC`
    )
    .all();
  const unassigned = db.prepare('SELECT COUNT(*) n FROM projects WHERE company_id IS NULL').get().n;
  res.json({ companies: rows.map((r) => ({ ...r, billing: billingSummary(r.id) })), unassigned_projects: unassigned, plans: Object.values(PLANS) });
});

// Lets the platform owner rescue a company admin who is locked out (works without email).
authRouter.post(
  '/admin/companies/:cid/reset-link',
  requireUser,
  requirePlatformAdmin,
  wrap((req, res) => {
    const u = db.prepare("SELECT * FROM users WHERE company_id = ? AND role = 'admin' ORDER BY id LIMIT 1").get(req.params.cid);
    if (!u) throw new AuthError(404, 'This company has no admin user.');
    res.json({ email: u.email, name: u.name, link: createResetLink(req, u.id), minutes: RESET_MINUTES });
  })
);

authRouter.put(
  '/admin/companies/:cid',
  requireUser,
  requirePlatformAdmin,
  wrap((req, res) => {
    const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.cid);
    if (!c) throw new AuthError(404, 'Company not found');
    if (req.body?.status !== undefined) {
      const status = req.body.status === 'suspended' ? 'suspended' : 'active';
      if (status === 'suspended' && c.id === req.company.id) throw new AuthError(400, "You can't suspend your own company.");
      db.prepare('UPDATE companies SET status = ? WHERE id = ?').run(status, c.id);
      if (status === 'suspended') db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)').run(c.id);
    }
    res.json({ ok: true });
  })
);
