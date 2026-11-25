// Daily attendance register: a project's workforce list, and who was present / late / absent each day.
import express from 'express';
import { planOf } from './plans.js';
import path from 'node:path';
import { db, tx, UPLOAD_DIR } from './db.js';
import { companyProject } from './auth.js';
import { notifyRegisterSubmitted } from './notifications.js';
import { dayRegisterData, periodRegisterData, renderDayRegisterPdf, renderPeriodRegisterPdf } from './attendancePdf.js';

db.exec(`
CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trade TEXT,
  employer TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attendance_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  taken_by TEXT,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, date)
);
CREATE TABLE IF NOT EXISTS attendance_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL REFERENCES attendance_days(id) ON DELETE CASCADE,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  status TEXT NOT NULL,              -- present | late | absent
  time_in TEXT,                      -- HH:MM, for late arrivals
  absence_reason TEXT,               -- sick | leave | no_show | suspended | training | other
  note TEXT,
  UNIQUE(day_id, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_workers_project ON workers(project_id);
CREATE INDEX IF NOT EXISTS idx_att_days ON attendance_days(project_id, date);
CREATE INDEX IF NOT EXISTS idx_att_entries ON attendance_entries(day_id);
`);

export const STATUSES = ['present', 'late', 'absent'];
export const REASONS = { sick: 'Sick', leave: 'On leave', no_show: 'No-show (no reason given)', suspended: 'Suspended', training: 'Training / off site', other: 'Other' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
const clean = (v, max = 120) => (v == null ? null : String(v).trim().slice(0, max) || null);

function workerFor(req, wid) {
  const w = db
    .prepare('SELECT w.* FROM workers w JOIN projects p ON p.id = w.project_id WHERE w.id = ? AND p.company_id = ?')
    .get(wid, req.company.id);
  if (!w) throw new HttpError(404, 'Worker not found');
  return { ...w };
}

function listWorkers(projectId, includeInactive = true) {
  return db
    .prepare(
      `SELECT w.*, (SELECT COUNT(*) FROM attendance_entries e WHERE e.worker_id = w.id) AS entry_count
       FROM workers w WHERE w.project_id = ? ${includeInactive ? '' : 'AND w.active = 1'}
       ORDER BY w.active DESC, lower(COALESCE(w.trade, 'zzz')), lower(w.name)`
    )
    .all(projectId)
    .map((w) => ({ ...w, active: Boolean(w.active) }));
}

/** Counts for one day; trade_counts are people on site (present + late) per trade. */
export function daySummary(projectId, date) {
  const day = db.prepare('SELECT * FROM attendance_days WHERE project_id = ? AND date = ?').get(projectId, date);
  if (!day) return null;
  const entries = db
    .prepare(
      `SELECT e.*, w.name, w.trade, w.employer FROM attendance_entries e JOIN workers w ON w.id = e.worker_id
       WHERE e.day_id = ? ORDER BY lower(w.name)`
    )
    .all(day.id);
  const count = (s) => entries.filter((e) => e.status === s).length;
  const trades = new Map();
  for (const e of entries) {
    if (e.status === 'absent') continue;
    const t = e.trade || 'General';
    trades.set(t, (trades.get(t) || 0) + 1);
  }
  return {
    date,
    taken_by: day.taken_by,
    updated_at: day.updated_at,
    present: count('present'),
    late: count('late'),
    absent: count('absent'),
    on_site: count('present') + count('late'),
    absentees: entries
      .filter((e) => e.status === 'absent')
      .map((e) => ({ name: e.name, trade: e.trade, employer: e.employer, reason: e.absence_reason, reason_label: REASONS[e.absence_reason] || 'Not given', note: e.note })),
    trade_counts: [...trades.entries()].map(([trade, count]) => ({ trade, count })).sort((a, b) => b.count - a.count),
  };
}

/** Attendance panel data for the project dashboard. */
export function attendanceOverview(projectId, today, days = 14) {
  const activeWorkers = db.prepare('SELECT COUNT(*) n FROM workers WHERE project_id = ? AND active = 1').get(projectId).n;
  const since = new Date(Date.parse(today) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const history = db
    .prepare(
      `SELECT d.date,
         SUM(e.status = 'present') AS present, SUM(e.status = 'late') AS late, SUM(e.status = 'absent') AS absent
       FROM attendance_days d LEFT JOIN attendance_entries e ON e.day_id = d.id
       WHERE d.project_id = ? AND d.date BETWEEN ? AND ?
       GROUP BY d.id ORDER BY d.date`
    )
    .all(projectId, since, today)
    .map((r) => ({ date: r.date, present: r.present || 0, late: r.late || 0, absent: r.absent || 0 }));
  return { active_workers: activeWorkers, today: daySummary(projectId, today), history, since };
}

export const attendanceRouter = express.Router();

// ---------- workforce

attendanceRouter.get('/projects/:id/workers', (req, res) => {
  const p = companyProject(req, req.params.id);
  res.json({ workers: listWorkers(p.id) });
});

/** Add one worker ({name, trade, employer, phone}) or many ({lines: "Name, Trade, Employer, Phone\n..."}). */
attendanceRouter.post('/projects/:id/workers', (req, res) => {
  const p = companyProject(req, req.params.id);
  const b = req.body || {};
  let rows;
  if (typeof b.lines === 'string') {
    rows = b.lines
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = (l.includes('\t') ? l.split('\t') : l.split(',')).map((s) => s.trim());
        return { name: parts[0], trade: parts[1], employer: parts[2], phone: parts[3] };
      });
  } else {
    rows = [b];
  }
  rows = rows.filter((r) => clean(r.name));
  if (!rows.length) throw new HttpError(400, 'Enter at least one name.');
  if (rows.length > 1000) throw new HttpError(400, 'Add at most 1000 workers at a time.');
  const existing = new Set(db.prepare('SELECT lower(name) n FROM workers WHERE project_id = ? AND active = 1').all(p.id).map((r) => r.n));
  let added = 0;
  const skipped = [];
  tx(() => {
    const ins = db.prepare('INSERT INTO workers (project_id, name, trade, employer, phone) VALUES (?,?,?,?,?)');
    for (const r of rows) {
      const name = clean(r.name);
      if (existing.has(name.toLowerCase())) {
        skipped.push(name);
        continue;
      }
      existing.add(name.toLowerCase());
      ins.run(p.id, name, clean(r.trade), clean(r.employer), clean(r.phone, 40));
      added++;
    }
  });
  res.status(201).json({ added, skipped, workers: listWorkers(p.id) });
});

attendanceRouter.put('/workers/:wid', (req, res) => {
  const w = workerFor(req, req.params.wid);
  const b = req.body || {};
  const next = {
    name: b.name !== undefined ? clean(b.name) || w.name : w.name,
    trade: b.trade !== undefined ? clean(b.trade) : w.trade,
    employer: b.employer !== undefined ? clean(b.employer) : w.employer,
    phone: b.phone !== undefined ? clean(b.phone, 40) : w.phone,
    active: b.active !== undefined ? (b.active ? 1 : 0) : w.active,
  };
  db.prepare('UPDATE workers SET name=?, trade=?, employer=?, phone=?, active=? WHERE id=?').run(next.name, next.trade, next.employer, next.phone, next.active, w.id);
  res.json({ workers: listWorkers(w.project_id) });
});

/** Deletes a worker who was never on a register; otherwise marks them as left so history is kept. */
attendanceRouter.delete('/workers/:wid', (req, res) => {
  const w = workerFor(req, req.params.wid);
  const used = db.prepare('SELECT 1 FROM attendance_entries WHERE worker_id = ? LIMIT 1').get(w.id);
  if (used) db.prepare('UPDATE workers SET active = 0 WHERE id = ?').run(w.id);
  else db.prepare('DELETE FROM workers WHERE id = ?').run(w.id);
  res.json({ removed: !used, deactivated: Boolean(used), workers: listWorkers(w.project_id) });
});

// ---------- register

attendanceRouter.get('/projects/:id/attendance/:date', (req, res) => {
  const p = companyProject(req, req.params.id);
  const { date } = req.params;
  if (!isDate(date)) throw new HttpError(400, 'Invalid date');
  const day = db.prepare('SELECT * FROM attendance_days WHERE project_id = ? AND date = ?').get(p.id, date);
  const entries = day ? db.prepare('SELECT * FROM attendance_entries WHERE day_id = ?').all(day.id) : [];
  const byWorker = new Map(entries.map((e) => [e.worker_id, e]));
  // Everyone active, plus anyone who has since left but was on this day's register.
  const workers = listWorkers(p.id).filter((w) => w.active || byWorker.has(w.id));
  const prev = db.prepare('SELECT date FROM attendance_days WHERE project_id = ? AND date < ? ORDER BY date DESC LIMIT 1').get(p.id, date);
  res.json({
    project: { id: p.id, name: p.name, code: p.code },
    date,
    taken: Boolean(day),
    taken_by: day?.taken_by || null,
    updated_at: day?.updated_at || null,
    notes: day?.notes || '',
    previous_date: prev?.date || null,
    reasons: REASONS,
    rows: workers.map((w) => {
      const e = byWorker.get(w.id);
      return {
        worker_id: w.id,
        name: w.name,
        trade: w.trade,
        employer: w.employer,
        active: w.active,
        status: e?.status || null,
        time_in: e?.time_in || '',
        absence_reason: e?.absence_reason || '',
        note: e?.note || '',
      };
    }),
  });
});

attendanceRouter.put('/projects/:id/attendance/:date', (req, res) => {
  const p = companyProject(req, req.params.id);
  const { date } = req.params;
  if (!isDate(date)) throw new HttpError(400, 'Invalid date');
  const b = req.body || {};
  const entries = Array.isArray(b.entries) ? b.entries : [];
  const validWorkers = new Set(db.prepare('SELECT id FROM workers WHERE project_id = ?').all(p.id).map((r) => r.id));
  const marked = entries.filter((e) => e && STATUSES.includes(e.status) && validWorkers.has(Number(e.worker_id)));
  const firstSave = !db.prepare('SELECT 1 FROM attendance_days WHERE project_id = ? AND date = ?').get(p.id, date);
  if (!marked.length) throw new HttpError(400, 'Mark at least one worker before saving.');
  for (const e of marked) {
    if (e.status === 'absent' && e.absence_reason && !REASONS[e.absence_reason]) throw new HttpError(400, 'Unknown absence reason.');
    if (e.time_in && !/^\d{2}:\d{2}$/.test(e.time_in)) throw new HttpError(400, 'Times must be HH:MM.');
  }
  tx(() => {
    db.prepare(
      `INSERT INTO attendance_days (project_id, date, taken_by, notes) VALUES (?,?,?,?)
       ON CONFLICT(project_id, date) DO UPDATE SET taken_by = excluded.taken_by, notes = excluded.notes, updated_at = datetime('now')`
    ).run(p.id, date, req.user.name, clean(b.notes, 2000));
    const dayId = db.prepare('SELECT id FROM attendance_days WHERE project_id = ? AND date = ?').get(p.id, date).id;
    // Entries not sent (e.g. un-marked again) are removed.
    db.prepare('DELETE FROM attendance_entries WHERE day_id = ?').run(dayId);
    const ins = db.prepare('INSERT INTO attendance_entries (day_id, worker_id, status, time_in, absence_reason, note) VALUES (?,?,?,?,?,?)');
    for (const e of marked) {
      ins.run(
        dayId,
        Number(e.worker_id),
        e.status,
        e.status === 'late' ? clean(e.time_in, 5) : null,
        e.status === 'absent' ? e.absence_reason || null : null,
        clean(e.note, 500)
      );
    }
  });
  const summary = daySummary(p.id, date);
  if (firstSave) notifyRegisterSubmitted({ project: p, date, summary, byUser: req.user });
  res.json({ ok: true, summary });
});

attendanceRouter.delete('/projects/:id/attendance/:date', (req, res) => {
  const p = companyProject(req, req.params.id);
  db.prepare('DELETE FROM attendance_days WHERE project_id = ? AND date = ?').run(p.id, req.params.date);
  res.json({ ok: true });
});

/** Summary for a date (used to pre-fill a daily report's labour section). */
attendanceRouter.get('/projects/:id/attendance/:date/summary', (req, res) => {
  const p = companyProject(req, req.params.id);
  if (!isDate(req.params.date)) throw new HttpError(400, 'Invalid date');
  res.json({ summary: daySummary(p.id, req.params.date) });
});

/** Dashboard panel: today's summary, absentees and recent history. */
attendanceRouter.get('/projects/:id/attendance-overview', (req, res) => {
  const p = companyProject(req, req.params.id);
  const today = isDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
  res.json(attendanceOverview(p.id, today, Math.min(60, Math.max(7, Number(req.query.days) || 14))));
});

// ---------- PDF downloads

const brandingFor = (req) => ({
  name: req.company.name,
  color: req.company.primary_color,
  logoPath: req.company.logo_filename ? path.join(UPLOAD_DIR, req.company.logo_filename) : null,
  white_label: planOf(req.company.id).features.white_label, // no "Made with Proj4D" footer
});
const fileSafe = (p) => (p.code || p.name).replace(/[^\w-]+/g, '_').slice(0, 40);

attendanceRouter.get('/projects/:id/attendance/:date/pdf', (req, res) => {
  const p = companyProject(req, req.params.id);
  const { date } = req.params;
  if (!isDate(date)) throw new HttpError(400, 'Invalid date');
  const data = dayRegisterData(p.id, date);
  if (!data) throw new HttpError(404, 'No register was taken on this day.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${fileSafe(p)}_Attendance_${date}.pdf"`);
  renderDayRegisterPdf({ project: p, data, branding: brandingFor(req) }, res);
});

/** Landscape sheet: workers down the side, dates across (max 31 days). */
attendanceRouter.get('/projects/:id/attendance-pdf', (req, res) => {
  const p = companyProject(req, req.params.id);
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'Choose a start and end date.');
  if (from > to) throw new HttpError(400, 'The start date must be before the end date.');
  const span = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (span > 31) throw new HttpError(400, 'Choose a period of up to 31 days.');
  const data = periodRegisterData(p.id, from, to);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${fileSafe(p)}_Attendance_${from}_to_${to}.pdf"`);
  renderPeriodRegisterPdf({ project: p, from, to, data, branding: brandingFor(req) }, res);
});
