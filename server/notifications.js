// Push notifications: device subscriptions, per-user preferences, event alerts and timed reminders.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import * as webpush from 'web-push';
import { db, DATA_DIR } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  last_success TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_log (
  key TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
`);

// ------------------------------------------------------------------ keys (VAPID)
// From VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY if set; otherwise generated once and kept on the data disk,
// so subscriptions stay valid across deploys without anyone handling the secret.
function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = path.join(DATA_DIR, 'vapid.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    return keys;
  }
}
const KEYS = loadKeys();
const SUBJECT =
  process.env.VAPID_SUBJECT ||
  (process.env.PLATFORM_ADMIN_EMAIL ? `mailto:${process.env.PLATFORM_ADMIN_EMAIL}` : null) ||
  process.env.APP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'mailto:admin@example.com';
webpush.setVapidDetails(SUBJECT, KEYS.publicKey, KEYS.privateKey);

// ------------------------------------------------------------------ preferences

export const TYPES = {
  register_reminder: 'Attendance register reminder',
  report_reminder: 'Daily report reminder',
  register_submitted: 'Attendance register submitted',
  report_submitted: 'Daily report submitted',
  high_issue: 'High-severity site issue',
  low_stock: 'Low stock',
  behind: 'Behind schedule',
};

function defaultPrefs(role) {
  const admin = role === 'admin';
  return {
    types: {
      register_reminder: true,
      report_reminder: true,
      register_submitted: admin,
      report_submitted: admin,
      high_issue: true,
      low_stock: true,
      behind: admin,
    },
    register_time: '08:00',
    report_time: '17:00',
    behind_points: 10,
    workdays: [1, 2, 3, 4, 5, 6], // Mon–Sat (0 = Sunday)
    timezone: 'UTC',
  };
}

export function getPrefs(user) {
  const row = db.prepare('SELECT prefs FROM notification_prefs WHERE user_id = ?').get(user.id);
  const base = defaultPrefs(user.role);
  if (!row) return base;
  try {
    const p = JSON.parse(row.prefs);
    return { ...base, ...p, types: { ...base.types, ...(p.types || {}) } };
  } catch {
    return base;
  }
}

function savePrefs(userId, prefs) {
  db.prepare('INSERT INTO notification_prefs (user_id, prefs) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs').run(userId, JSON.stringify(prefs));
}

const validTz = (tz) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// ------------------------------------------------------------------ sending

function once(key) {
  try {
    db.prepare('INSERT INTO notification_log (key) VALUES (?)').run(key);
    return true; // first time
  } catch {
    return false; // already sent
  }
}

/** Sends a notification to every device of a user. Resolves to the number of devices reached. */
export async function sendToUser(userId, payload, { ttl = 6 * 3600 } = {}) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: ttl, urgency: payload.urgency || 'normal' });
        db.prepare("UPDATE push_subscriptions SET failures = 0, last_success = datetime('now') WHERE id = ?").run(s.id);
        sent++;
      } catch (e) {
        // 404/410: the device unsubscribed or the app was removed. Other errors: retry next time, give up after 10.
        if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        else {
          db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').run(s.id);
          db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND failures >= 10').run(s.id);
          console.warn(`Push to subscription ${s.id} failed: ${e.statusCode || ''} ${e.message}`);
        }
      }
    })
  );
  return sent;
}

/** Company users who have notifications on for `type` and at least one device (optionally excluding one user). */
function recipients(companyId, type, excludeUserId) {
  return db
    .prepare(
      `SELECT u.* FROM users u JOIN companies c ON c.id = u.company_id
       WHERE u.company_id = ? AND c.status = 'active' AND u.id != ?
         AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)`
    )
    .all(companyId, excludeUserId ?? -1)
    .map((u) => ({ ...u, prefs: getPrefs(u) }))
    .filter((u) => u.prefs.types[type]);
}

const fire = (promise) => promise.catch((e) => console.warn('Notification failed:', e.message));
const projectLabel = (p) => p.name;
const shortDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// ------------------------------------------------------------------ event alerts (called from the API)

export function notifyRegisterSubmitted({ project, date, summary, byUser }) {
  fire(
    (async () => {
      if (!once(`regsub:${project.id}:${date}`)) return;
      const names = summary.absentees.slice(0, 3).map((a) => a.name.split(' ')[0] + (a.name.includes(' ') ? ` ${a.name.split(' ').slice(-1)[0][0]}.` : ''));
      const body = `${summary.present} present · ${summary.late} late · ${summary.absent} absent${names.length ? ` (${names.join(', ')}${summary.absentees.length > 3 ? '…' : ''})` : ''} · ${shortDate(date)}, by ${byUser.name}`;
      for (const u of recipients(project.company_id, 'register_submitted', byUser.id)) {
        await sendToUser(u.id, { title: `Attendance taken – ${projectLabel(project)}`, body, url: `/projects/${project.id}/attendance?date=${date}`, tag: `regsub-${project.id}-${date}` });
      }
    })()
  );
}

export function notifyReportSaved({ project, report, byUser, isNew, previousIssues = [], overall, previousOverall, planned }) {
  fire(
    (async () => {
      const url = `/reports/${report.id}`;
      if (isNew) {
        const delta = previousOverall != null ? Math.round((overall - previousOverall) * 10) / 10 : null;
        const body = `${shortDate(report.report_date)} · by ${byUser.name} · overall progress ${overall}%${delta != null ? ` (${delta >= 0 ? '+' : ''}${delta}%)` : ''}`;
        for (const u of recipients(project.company_id, 'report_submitted', byUser.id)) {
          await sendToUser(u.id, { title: `Daily report filed – ${projectLabel(project)}`, body, url, tag: `report-${report.id}` });
        }
      }
      // New high-severity issues (on edits, only ones that weren't there before)
      const key = (i) => `${i.category}|${i.description}`.toLowerCase();
      const before = new Set(previousIssues.filter((i) => i.severity === 'High').map(key));
      const fresh = (report.issues || []).filter((i) => i.severity === 'High' && !before.has(key(i)));
      if (fresh.length) {
        const body = fresh.map((i) => `${i.category}: ${i.description}${i.action ? ` – ${i.action}` : ''}`).join('\n');
        for (const u of recipients(project.company_id, 'high_issue', byUser.id)) {
          await sendToUser(u.id, { title: `⚠ High-severity issue – ${projectLabel(project)}`, body, url, tag: `issue-${report.id}-${fresh.length}`, urgency: 'high' }, { ttl: 24 * 3600 });
        }
      }
      // Behind schedule (each person's own threshold; at most once a week per project)
      if (planned != null && overall != null) {
        const gap = Math.round((planned - overall) * 10) / 10;
        if (gap > 0) {
          const week = Math.floor(Date.now() / (7 * 86400000));
          for (const u of recipients(project.company_id, 'behind', null)) {
            if (gap < (Number(u.prefs.behind_points) || 10)) continue;
            if (!once(`behind:${u.id}:${project.id}:${week}`)) continue;
            await sendToUser(u.id, {
              title: `Behind schedule – ${projectLabel(project)}`,
              body: `${overall}% complete vs ${planned}% planned for today (${gap} points behind).`,
              url: `/projects/${project.id}`,
              tag: `behind-${project.id}`,
            });
          }
        }
      }
    })()
  );
}

export function notifyLowStock({ project, material, stock, byUser }) {
  fire(
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const body =
        stock < 0
          ? `${project.name}: recorded stock is ${stock} ${material.unit}. Check that all deliveries are recorded.`
          : `${project.name}: ${stock} ${material.unit} left${material.reorder_level != null ? ` (reorder at ${material.reorder_level})` : ''}.`;
      for (const u of recipients(project.company_id, 'low_stock', byUser?.id)) {
        if (!once(`low:${u.id}:${material.id}:${today}`)) continue;
        await sendToUser(u.id, { title: `Low stock – ${material.name}`, body, url: `/projects/${project.id}/materials`, tag: `low-${material.id}` });
      }
    })()
  );
}

// ------------------------------------------------------------------ timed reminders

/** Local date/time parts for a time zone. */
function localNow(tz, now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday };
}
const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const REMINDER_WINDOW = 4 * 60; // still send up to 4 hours late (e.g. after a server restart)

function activeProjects(companyId, date) {
  return db
    .prepare(
      `SELECT * FROM projects WHERE company_id = ?
         AND (start_date IS NULL OR start_date <= ?)
         AND (end_date IS NULL OR end_date >= date(?, '-14 days'))
       ORDER BY name`
    )
    .all(companyId, date, date);
}

/** Checks every user's reminder times; safe to call every minute. Returns the number of notifications sent. */
export async function runReminders(now = new Date()) {
  let sent = 0;
  const users = db
    .prepare(
      `SELECT u.* FROM users u JOIN companies c ON c.id = u.company_id
       WHERE c.status = 'active' AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)`
    )
    .all();
  for (const u of users) {
    const prefs = getPrefs(u);
    const tz = validTz(prefs.timezone) ? prefs.timezone : 'UTC';
    const t = localNow(tz, now);
    if (!(prefs.workdays || []).includes(t.weekday)) continue;
    const due = (time) => {
      const m = toMinutes(time);
      return m != null && t.minutes >= m && t.minutes < m + REMINDER_WINDOW;
    };

    if (prefs.types.register_reminder && due(prefs.register_time)) {
      const pending = activeProjects(u.company_id, t.date).filter(
        (p) =>
          db.prepare('SELECT 1 FROM workers WHERE project_id = ? AND active = 1 LIMIT 1').get(p.id) &&
          !db.prepare('SELECT 1 FROM attendance_days WHERE project_id = ? AND date = ?').get(p.id, t.date)
      );
      if (pending.length && once(`reg-rem:${u.id}:${t.date}`)) {
        const one = pending.length === 1;
        sent += await sendToUser(
          u.id,
          {
            title: one ? `Take today's register – ${pending[0].name}` : `Today's attendance registers`,
            body: one ? "Today's attendance register hasn't been taken yet." : `${pending.length} projects still need today's register: ${pending.map((p) => p.name).join(', ')}.`,
            url: one ? `/projects/${pending[0].id}/attendance` : '/',
            tag: `reg-rem-${t.date}`,
          },
          { ttl: 3 * 3600 }
        );
      }
    }

    if (prefs.types.report_reminder && due(prefs.report_time)) {
      const pending = activeProjects(u.company_id, t.date).filter(
        (p) =>
          (db.prepare('SELECT 1 FROM activities WHERE project_id = ? LIMIT 1').get(p.id) || db.prepare('SELECT 1 FROM reports WHERE project_id = ? LIMIT 1').get(p.id)) &&
          !db.prepare('SELECT 1 FROM reports WHERE project_id = ? AND report_date = ?').get(p.id, t.date)
      );
      if (pending.length && once(`rep-rem:${u.id}:${t.date}`)) {
        const one = pending.length === 1;
        sent += await sendToUser(
          u.id,
          {
            title: one ? `Daily report due – ${pending[0].name}` : 'Daily reports due',
            body: one ? "Today's daily report hasn't been filed yet." : `${pending.length} projects have no report for today: ${pending.map((p) => p.name).join(', ')}.`,
            url: one ? `/projects/${pending[0].id}/reports/new` : '/',
            tag: `rep-rem-${t.date}`,
          },
          { ttl: 5 * 3600 }
        );
      }
    }
  }
  db.prepare("DELETE FROM notification_log WHERE created_at < datetime('now', '-60 days')").run();
  return sent;
}

let timer = null;
export function startReminderScheduler() {
  if (timer || process.env.SITEPULSE_REMINDERS === 'off') return;
  const tick = () => runReminders().catch((e) => console.warn('Reminder run failed:', e.message));
  setTimeout(tick, 15000).unref();
  timer = setInterval(tick, 60000);
  timer.unref();
}

// ------------------------------------------------------------------ API (mounted under /api/push, login required)

export const pushRouter = express.Router();

pushRouter.get('/config', (req, res) => {
  const devices = db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id = ?').get(req.user.id).n;
  res.json({ publicKey: KEYS.publicKey, devices, types: TYPES, prefs: getPrefs(req.user) });
});

pushRouter.post('/subscribe', (req, res) => {
  const { subscription, timezone, device } = req.body || {};
  const endpoint = subscription?.endpoint;
  const keys = subscription?.keys || {};
  if (!/^https:\/\//.test(endpoint || '') || !keys.p256dh || !keys.auth) return res.status(400).json({ error: 'Invalid subscription.' });
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device) VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, failures = 0`
  ).run(req.user.id, endpoint, keys.p256dh, keys.auth, String(device || '').slice(0, 120) || null);
  // Remember the person's time zone for reminders (first device sets it; they can change it later).
  const prefs = getPrefs(req.user);
  if (timezone && validTz(timezone) && (!db.prepare('SELECT 1 FROM notification_prefs WHERE user_id = ?').get(req.user.id) || prefs.timezone === 'UTC')) {
    savePrefs(req.user.id, { ...prefs, timezone });
  }
  res.status(201).json({ ok: true });
});

pushRouter.post('/unsubscribe', (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
  res.json({ ok: true });
});

pushRouter.put('/prefs', (req, res) => {
  const cur = getPrefs(req.user);
  const b = req.body || {};
  const next = { ...cur };
  if (b.types && typeof b.types === 'object') {
    next.types = { ...cur.types };
    for (const k of Object.keys(TYPES)) if (k in b.types) next.types[k] = Boolean(b.types[k]);
  }
  for (const k of ['register_time', 'report_time']) {
    if (b[k] !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b[k])) return res.status(400).json({ error: 'Times must be HH:MM.' });
      next[k] = b[k];
    }
  }
  if (b.behind_points !== undefined) {
    const n = Number(b.behind_points);
    if (!(n >= 1 && n <= 100)) return res.status(400).json({ error: 'The behind-schedule threshold must be between 1 and 100.' });
    next.behind_points = n;
  }
  if (b.workdays !== undefined) {
    if (!Array.isArray(b.workdays) || b.workdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return res.status(400).json({ error: 'Invalid working days.' });
    next.workdays = [...new Set(b.workdays)].sort();
  }
  if (b.timezone !== undefined) {
    if (!validTz(b.timezone)) return res.status(400).json({ error: 'Unknown time zone.' });
    next.timezone = b.timezone;
  }
  savePrefs(req.user.id, next);
  res.json({ prefs: next });
});

pushRouter.post('/test', async (req, res) => {
  const n = await sendToUser(req.user.id, { title: 'SitePulse notifications are on', body: `This is a test for ${req.user.name}. You'll get your selected alerts on this device.`, url: '/notifications', tag: 'test' }, { ttl: 600 });
  res.json({ sent: n });
});
