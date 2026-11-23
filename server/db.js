import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// The file keeps its original name so existing installations keep their data after the rename to Proj4D.
export const db = new DatabaseSync(path.join(DATA_DIR, 'sitepulse.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  client TEXT,
  location TEXT,
  contractor TEXT,
  supervisor TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  programme_file TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT NOT NULL,
  section TEXT,
  start_date TEXT,
  end_date TEXT,
  weight REAL NOT NULL DEFAULT 1,
  progress REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'programme',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,
  supervisor TEXT,
  weather TEXT,        -- JSON {condition, temp_high, temp_low, rainfall, wind, impact, hours_lost}
  labour TEXT,         -- JSON [{trade, count}]
  equipment TEXT,      -- JSON [{name, count, status}]
  materials TEXT,      -- JSON [{material, quantity, supplier, notes}]
  visitors TEXT,       -- JSON [{name, organisation, purpose, time}]
  issues TEXT,         -- JSON [{category, description, severity, action}]
  notes TEXT,
  summary TEXT,
  summary_source TEXT,
  overall_progress REAL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, report_date)
);

CREATE TABLE IF NOT EXISTS report_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  activity_id INTEGER REFERENCES activities(id) ON DELETE SET NULL,
  activity_name TEXT NOT NULL,
  progress_before REAL,
  progress REAL NOT NULL,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT,
  caption TEXT
);

CREATE INDEX IF NOT EXISTS idx_act_project ON activities(project_id);
CREATE INDEX IF NOT EXISTS idx_rep_project ON reports(project_id, report_date);
CREATE INDEX IF NOT EXISTS idx_items_report ON report_items(report_id);
`);

export const JSON_FIELDS = ['weather', 'labour', 'equipment', 'materials', 'visitors', 'issues'];

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const plain = (row) => (row ? { ...row } : row);

export function decodeReport(row) {
  if (!row) return row;
  const r = plain(row);
  for (const f of JSON_FIELDS) {
    try {
      r[f] = r[f] ? JSON.parse(r[f]) : f === 'weather' ? {} : [];
    } catch {
      r[f] = f === 'weather' ? {} : [];
    }
  }
  return r;
}

/** Overall progress = duration/weight-weighted average of each activity's cumulative % complete. */
export function computeOverall(projectId) {
  const row = db
    .prepare('SELECT SUM(weight * progress) AS wp, SUM(weight) AS w FROM activities WHERE project_id = ?')
    .get(projectId);
  if (!row || !row.w) return 0;
  return Math.round((row.wp / row.w) * 10) / 10;
}

/**
 * Re-derive every activity's progress from the reports: an activity's progress is the value
 * entered in the most recent (by report date) daily report that mentions it.
 */
export function recomputeActivityProgress(projectId) {
  db.prepare('UPDATE activities SET progress = 0 WHERE project_id = ?').run(projectId);
  const latest = db
    .prepare(
      `SELECT ri.activity_id, ri.progress FROM report_items ri
       JOIN reports r ON r.id = ri.report_id
       WHERE r.project_id = ? AND ri.activity_id IS NOT NULL
       ORDER BY r.report_date ASC, ri.id ASC`
    )
    .all(projectId);
  const map = new Map();
  for (const l of latest) map.set(l.activity_id, l.progress);
  const upd = db.prepare('UPDATE activities SET progress = ? WHERE id = ?');
  for (const [id, p] of map) upd.run(p, id);
}

/** Overall progress as it stood at the end of each report date (for the progress curve). */
export function recomputeReportSnapshots(projectId) {
  const acts = db.prepare('SELECT id, weight FROM activities WHERE project_id = ?').all(projectId);
  const totalW = acts.reduce((s, a) => s + a.weight, 0);
  const weights = new Map(acts.map((a) => [a.id, a.weight]));
  const reports = db
    .prepare('SELECT id FROM reports WHERE project_id = ? ORDER BY report_date ASC')
    .all(projectId);
  const items = db.prepare('SELECT activity_id, progress FROM report_items WHERE report_id = ? AND activity_id IS NOT NULL');
  const upd = db.prepare('UPDATE reports SET overall_progress = ? WHERE id = ?');
  const state = new Map();
  for (const r of reports) {
    for (const it of items.all(r.id)) state.set(it.activity_id, it.progress);
    let wp = 0;
    for (const [id, p] of state) wp += (weights.get(id) || 0) * p;
    upd.run(totalW ? Math.round((wp / totalW) * 10) / 10 : 0, r.id);
  }
}

export function refreshProject(projectId) {
  recomputeActivityProgress(projectId);
  recomputeReportSnapshots(projectId);
}
