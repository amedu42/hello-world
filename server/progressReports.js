// Weekly, monthly, project status (WIP) and milestone tracking reports (Professional plan).
// Numbers come from the project's own data (programme, daily reports, registers); AI writes the narrative.
// Reports are drafts the user edits in the browser, then publishes and downloads as PDF.
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, decodeReport, UPLOAD_DIR } from './db.js';
import { companyProject, isPlatformAdmin, photoForCompany } from './auth.js';
import { aiEnabled, describeAIError, generateProgressNarrative } from './ai.js';
import { planOf, planWith } from './plans.js';
import { periodRegisterData } from './attendancePdf.js';
import { materialsPeriodData } from './materialsPdf.js';
import { renderProgressReportPdf } from './progressReportPdf.js';

db.exec(`
CREATE TABLE IF NOT EXISTS progress_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                 -- weekly | monthly | status | milestone
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  period_from TEXT,
  period_to TEXT NOT NULL,            -- end of period / "as of" date
  status TEXT NOT NULL DEFAULT 'draft', -- generating | draft | published
  data TEXT,                          -- JSON: figures and tables computed from project data
  content TEXT,                       -- JSON: editable narrative, settings, milestones, photos
  error TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  published_at TEXT,
  published_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_prog_reports ON progress_reports(project_id, type, period_to);
`);
db.prepare("UPDATE progress_reports SET status = 'draft', error = 'The narrative was interrupted (the server restarted). Use \"Rewrite with AI\" to try again.' WHERE status = 'generating'").run();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const TYPES = {
  weekly: { name: 'Weekly Progress Report', short: 'WPR', period: true },
  monthly: { name: 'Monthly Progress Report', short: 'MPR', period: true },
  status: { name: 'Project Status Report', short: 'PSR', period: false },
  milestone: { name: 'Milestone Tracking Report', short: 'MTR', period: false },
};

export const SECTIONS = {
  weekly: [
    ['summary', 'Executive summary'],
    ['work_done', 'Work completed'],
    ['schedule', 'Progress against programme'],
    ['look_ahead', 'Look-ahead'],
    ['challenges', 'Challenges and actions'],
  ],
  status: [
    ['summary', 'Executive summary'],
    ['schedule', 'Schedule analysis'],
    ['remaining', 'Remaining work'],
    ['risks', 'Risks and recovery actions'],
  ],
  milestone: [
    ['summary', 'Summary'],
    ['commentary', 'Milestone commentary'],
    ['outlook', 'Outlook'],
  ],
};
SECTIONS.monthly = SECTIONS.weekly;

// ------------------------------------------------------------------ dates

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
const ms = (iso) => Date.parse(iso + 'T00:00:00Z');
const addDays = (iso, n) => new Date(ms(iso) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / 86400000);
const r1 = (n) => Math.round(n * 10) / 10;
const todayISO = () => new Date().toISOString().slice(0, 10);

function plannedPct(a, on) {
  if (!a.start_date || !a.end_date) return null;
  const s = ms(a.start_date), e = ms(a.end_date), t = ms(on);
  if (t < s) return 0;
  if (t >= e) return 100;
  return r1((((t - s) / 86400000 + 1) / ((e - s) / 86400000 + 1)) * 100);
}
function plannedOverall(acts, on) {
  const tw = acts.reduce((s, a) => s + a.weight, 0);
  if (!tw || !acts.some((a) => a.start_date && a.end_date)) return null;
  return r1(acts.reduce((s, a) => s + a.weight * (plannedPct(a, on) ?? 0), 0) / tw);
}
const weighted = (acts, prog) => {
  const tw = acts.reduce((s, a) => s + a.weight, 0);
  return tw ? r1(acts.reduce((s, a) => s + a.weight * (prog.get(a.id) || 0), 0) / tw) : 0;
};

// ------------------------------------------------------------------ figures from project data

/**
 * Progress history: per date, the cumulative % of each activity (from daily reports), plus when each
 * activity and each section first started and reached 100%.
 */
function history(projectId, acts) {
  const items = db
    .prepare(
      `SELECT r.report_date AS date, ri.activity_id, ri.progress FROM report_items ri JOIN reports r ON r.id = ri.report_id
       WHERE r.project_id = ? AND ri.activity_id IS NOT NULL ORDER BY r.report_date, ri.id`
    )
    .all(projectId);
  const dates = [...new Set(items.map((i) => i.date))];
  const prog = new Map();
  const snaps = []; // [{date, map}]
  const actStart = new Map(), actDone = new Map();
  let k = 0;
  for (const d of dates) {
    while (k < items.length && items[k].date === d) {
      const it = items[k++];
      prog.set(it.activity_id, it.progress);
      if (it.progress > 0 && !actStart.has(it.activity_id)) actStart.set(it.activity_id, d);
      if (it.progress >= 100 && !actDone.has(it.activity_id)) actDone.set(it.activity_id, d);
      if (it.progress < 100) actDone.delete(it.activity_id); // reopened
    }
    snaps.push({ date: d, map: new Map(prog) });
  }
  const at = (date) => {
    let m = new Map();
    for (const s of snaps) {
      if (s.date > date) break;
      m = s.map;
    }
    return m;
  };
  return { at, snaps, actStart, actDone, ids: new Set(acts.map((a) => a.id)) };
}

const statusOf = (actual, planned) => {
  if (actual >= 100) return 'Complete';
  if (planned == null) return actual > 0 ? 'In progress' : 'Not started';
  const gap = planned - actual;
  if (gap > 15) return 'Behind';
  if (gap > 5) return 'Slipping';
  if (actual > 0) return 'On track';
  return planned > 0 ? 'Late start' : 'Not started';
};

function sectionStats(acts, H, asOf) {
  const prog = H.at(asOf);
  const groups = new Map();
  for (const a of acts) {
    const k = a.section || 'General';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const total = acts.reduce((s, a) => s + a.weight, 0) || 1;
  return [...groups.entries()].map(([name, list]) => {
    const starts = list.map((a) => a.start_date).filter(Boolean).sort();
    const ends = list.map((a) => a.end_date).filter(Boolean).sort();
    const actualStarts = list.map((a) => H.actStart.get(a.id)).filter((d) => d && d <= asOf).sort();
    const allDone = list.every((a) => (prog.get(a.id) || 0) >= 100);
    const doneDates = list.map((a) => H.actDone.get(a.id)).filter(Boolean).sort();
    return {
      name,
      activities: list.length,
      completed: list.filter((a) => (prog.get(a.id) || 0) >= 100).length,
      share: r1((list.reduce((s, a) => s + a.weight, 0) / total) * 100),
      actual: weighted(list, prog),
      planned: plannedOverall(list, asOf),
      planned_start: starts[0] || null,
      planned_finish: ends[ends.length - 1] || null,
      actual_start: actualStarts[0] || null,
      actual_finish: allDone && doneDates.length ? doneDates[doneDates.length - 1] : null,
    };
  });
}

function projectFrame(project, acts) {
  const starts = acts.map((a) => a.start_date).filter(Boolean).sort();
  const ends = acts.map((a) => a.end_date).filter(Boolean).sort();
  return { start: project.start_date || starts[0] || null, finish: project.end_date || ends[ends.length - 1] || null };
}

/** Days behind (+) or ahead (−) of the programme: how long ago the plan expected today's actual progress. */
function scheduleVarianceDays(acts, actual, asOf, frame) {
  if (!frame.start || !frame.finish || plannedOverall(acts, asOf) == null) return null;
  const last = frame.finish > asOf ? frame.finish : asOf;
  for (let d = frame.start; d <= last; d = addDays(d, 1)) {
    if ((plannedOverall(acts, d) ?? 0) >= actual) return daysBetween(d, asOf);
  }
  return null;
}

/** Forecast finish from the progress rate over the last 4 weeks (null if there's no recent progress). */
function forecastFinish(acts, H, asOf) {
  const now = weighted(acts, H.at(asOf));
  if (now >= 100) {
    const done = [...H.actDone.values()].sort();
    return { date: done[done.length - 1] || asOf, rate: null };
  }
  const before = weighted(acts, H.at(addDays(asOf, -28)));
  const rate = (now - before) / 28;
  if (rate <= 0.01) return { date: null, rate: 0 };
  return { date: addDays(asOf, Math.ceil((100 - now) / rate)), rate: r1(rate * 7) };
}

function curve(projectId, acts, frame, asOf) {
  const actual = db
    .prepare('SELECT report_date AS date, overall_progress AS pct FROM reports WHERE project_id = ? AND report_date <= ? ORDER BY report_date')
    .all(projectId, asOf)
    .map((r) => ({ date: r.date, pct: r.pct ?? 0 }));
  const planned = [];
  if (frame.start && frame.finish && plannedOverall(acts, frame.start) != null) {
    const span = Math.max(1, daysBetween(frame.start, frame.finish));
    const step = Math.max(1, Math.round(span / 40));
    for (let d = addDays(frame.start, -1); d <= addDays(frame.finish, step); d = addDays(d, step)) planned.push({ date: d, pct: plannedOverall(acts, d) });
  }
  return { actual, planned, as_of: asOf };
}

function milestonesFrom(sections, frame, forecast, asOf) {
  const rows = sections
    .filter((s) => s.planned_finish || s.actual_finish)
    .map((s) => {
      const late = s.actual_finish && s.planned_finish ? daysBetween(s.planned_finish, s.actual_finish) : null;
      let status;
      if (s.actual_finish) status = late > 0 ? `Completed ${late} day${late === 1 ? '' : 's'} late` : 'Completed on time';
      else if (s.planned_finish && s.planned_finish < asOf) status = `Overdue by ${daysBetween(s.planned_finish, asOf)} days`;
      else if (s.planned != null && s.planned - s.actual > 10) status = 'At risk';
      else status = s.actual > 0 ? 'On track' : 'Not started';
      return { key: `sec:${s.name}`, auto: true, name: `${s.name} complete`, planned: s.planned_finish, actual: s.actual_finish, progress: s.actual, status, remarks: '' };
    })
    .sort((a, b) => String(a.planned).localeCompare(String(b.planned)));
  if (frame.finish) {
    const done = sections.every((s) => s.actual_finish);
    const actual = done ? sections.map((s) => s.actual_finish).sort().pop() : null;
    const late = forecast.date && !actual ? daysBetween(frame.finish, forecast.date) : null;
    rows.push({
      key: 'project',
      auto: true,
      name: 'Practical completion',
      planned: frame.finish,
      actual,
      forecast: actual ? null : forecast.date,
      progress: null,
      status: actual
        ? daysBetween(frame.finish, actual) > 0 ? `Completed ${daysBetween(frame.finish, actual)} days late` : 'Completed on time'
        : late == null ? 'No forecast yet' : late > 0 ? `Forecast ${late} days late` : 'Forecast on time',
      remarks: '',
    });
  }
  return rows;
}

/** Everything a report shows, computed from the project's data. */
export function computeReportData(project, type, from, to) {
  const acts = db.prepare('SELECT * FROM activities WHERE project_id = ? ORDER BY sort_order, id').all(project.id).map((a) => ({ ...a }));
  const H = history(project.id, acts);
  const asOf = to;
  const frame = projectFrame(project, acts);
  const progNow = H.at(asOf);
  const actual = weighted(acts, progNow);
  const planned = plannedOverall(acts, asOf);
  const fc = forecastFinish(acts, H, asOf);
  const sections = sectionStats(acts, H, asOf);
  const svDays = scheduleVarianceDays(acts, actual, asOf, frame);
  const counts = {
    total: acts.length,
    complete: acts.filter((a) => (progNow.get(a.id) || 0) >= 100).length,
    in_progress: acts.filter((a) => (progNow.get(a.id) || 0) > 0 && (progNow.get(a.id) || 0) < 100).length,
  };
  counts.not_started = counts.total - counts.complete - counts.in_progress;

  const actRow = (a, prevMap) => {
    const now = progNow.get(a.id) || 0;
    const pl = plannedPct(a, asOf);
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      section: a.section,
      start: a.start_date,
      finish: a.end_date,
      before: prevMap ? prevMap.get(a.id) || 0 : null,
      actual: now,
      planned: pl,
      variance: pl == null ? null : r1(now - pl),
      status: statusOf(now, pl),
    };
  };

  const behind = acts
    .map((a) => actRow(a))
    .filter((r) => r.planned != null && r.actual < 100 && r.planned - r.actual > 10)
    .sort((a, b) => a.variance - b.variance)
    .slice(0, 15);

  const data = {
    type,
    as_of: asOf,
    from: from || null,
    to,
    project: { name: project.name, code: project.code, client: project.client, location: project.location, contractor: project.contractor, start: frame.start, finish: frame.finish },
    overall: { actual, planned, variance: planned == null ? null : r1(actual - planned), schedule_variance_days: svDays, forecast_finish: fc.date, progress_per_week: fc.rate, remaining: r1(100 - actual) },
    counts,
    sections,
    behind,
    curve: curve(project.id, acts, frame, asOf),
    has_programme: acts.length > 0,
  };

  if (TYPES[type].period) {
    const prev = H.at(addDays(from, -1));
    const startOverall = weighted(acts, prev);
    data.overall.start = startOverall;
    data.overall.change = r1(actual - startOverall);
    data.overall.planned_start = plannedOverall(acts, addDays(from, -1));
    data.completed = acts.filter((a) => {
      const d = H.actDone.get(a.id);
      return d && d >= from && d <= to;
    }).map((a) => ({ ...actRow(a, prev), completed_on: H.actDone.get(a.id) }));
    data.progressed = acts
      .map((a) => actRow(a, prev))
      .filter((r) => r.actual > r.before && r.actual < 100)
      .sort((a, b) => b.actual - b.before - (a.actual - a.before));
    // Look-ahead: work planned in the next two weeks (weekly) or month (monthly).
    const laFrom = addDays(to, 1);
    const laTo = addDays(to, type === 'weekly' ? 14 : 31);
    data.look_ahead = { from: laFrom, to: laTo };
    data.upcoming = acts
      .filter((a) => a.start_date && a.end_date && a.start_date <= laTo && a.end_date >= laFrom && (progNow.get(a.id) || 0) < 100)
      .map((a) => actRow(a))
      .slice(0, 25);

    // Site records for the period
    const reps = db.prepare('SELECT * FROM reports WHERE project_id = ? AND report_date BETWEEN ? AND ? ORDER BY report_date').all(project.id, from, to).map(decodeReport);
    const labourDays = reps.map((r) => (r.labour || []).reduce((s, l) => s + (Number(l.count) || 0), 0));
    const trades = new Map();
    for (const r of reps) for (const l of r.labour || []) if (l.trade) trades.set(l.trade, (trades.get(l.trade) || 0) + (Number(l.count) || 0));
    const weather = new Map();
    for (const r of reps) if (r.weather?.condition) weather.set(r.weather.condition, (weather.get(r.weather.condition) || 0) + 1);
    const att = periodRegisterData(project.id, from, to);
    const attPresent = att.entries.filter((e) => e.status !== 'absent').length;
    const mat = materialsPeriodData(project.id, from, to);
    data.site = {
      daily_reports: reps.length,
      labour: {
        average: reps.length ? r1(labourDays.reduce((s, n) => s + n, 0) / reps.length) : 0,
        peak: labourDays.length ? Math.max(...labourDays) : 0,
        man_days: labourDays.reduce((s, n) => s + n, 0),
        by_trade: [...trades.entries()].map(([trade, total]) => ({ trade, average: r1(total / reps.length) })).sort((a, b) => b.average - a.average).slice(0, 10),
      },
      equipment: [...new Set(reps.flatMap((r) => (r.equipment || []).map((e) => e.name).filter(Boolean)))].slice(0, 15),
      weather: {
        conditions: [...weather.entries()].map(([condition, days]) => ({ condition, days })),
        hours_lost: r1(reps.reduce((s, r) => s + (Number(r.weather?.hours_lost) || 0), 0)),
        impacts: reps.filter((r) => r.weather?.impact).map((r) => ({ date: r.report_date, impact: r.weather.impact })).slice(0, 8),
      },
      attendance: att.days.length ? { days: att.days.length, average_present: r1(attPresent / att.days.length), absences: att.entries.filter((e) => e.status === 'absent').length } : null,
      materials: mat.rows.filter((m) => m.delivered || m.used || m.wasted).map((m) => ({ name: m.name, unit: m.unit, delivered: m.delivered, used: m.used, wasted: m.wasted, closing: m.closing, low: m.low })).slice(0, 25),
      visitors: reps.flatMap((r) => (r.visitors || []).map((v) => ({ date: r.report_date, name: v.name, organisation: v.organisation, purpose: v.purpose }))).slice(0, 20),
      issues: reps.flatMap((r) => (r.issues || []).map((i) => ({ date: r.report_date, category: i.category, severity: i.severity, description: i.description, action: i.action }))),
      notes: reps.filter((r) => r.notes).map((r) => ({ date: r.report_date, notes: r.notes })).slice(0, 10),
    };
  } else {
    data.milestones = milestonesFrom(sections, frame, fc, asOf);
    const open = db
      .prepare('SELECT r.report_date, r.issues FROM reports r WHERE r.project_id = ? AND r.report_date BETWEEN ? AND ? ORDER BY r.report_date DESC')
      .all(project.id, addDays(asOf, -30), asOf)
      .flatMap((r) => {
        let list = [];
        try {
          list = JSON.parse(r.issues || '[]');
        } catch {}
        return list.map((i) => ({ date: r.report_date, ...i }));
      });
    data.recent_issues = open.slice(0, 15);
  }
  return data;
}

/** Up to `max` site photos from the period's daily reports, spread across the period. */
function periodPhotos(projectId, from, to, max = 6) {
  const all = db
    .prepare(
      `SELECT ph.filename, ph.caption, r.report_date FROM photos ph JOIN reports r ON r.id = ph.report_id
       WHERE r.project_id = ? AND r.report_date BETWEEN ? AND ? ORDER BY r.report_date, ph.id`
    )
    .all(projectId, from, to);
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, i) => all[Math.floor((i * all.length) / max)]);
}

// ------------------------------------------------------------------ narrative

const pct = (n) => (n == null ? '–' : `${n}%`);
const fmt = (iso) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–');

/** Plain-language narrative written from the figures, used when AI is not available. */
export function templateNarrative(type, d, notes) {
  const o = d.overall;
  const vs = o.planned == null ? '' : ` against ${o.planned}% planned (${o.variance >= 0 ? '+' : ''}${o.variance} points)`;
  const sv = o.schedule_variance_days == null ? '' : o.schedule_variance_days > 0 ? ` The project is about ${o.schedule_variance_days} days behind the programme.` : o.schedule_variance_days < 0 ? ` The project is about ${-o.schedule_variance_days} days ahead of the programme.` : ' The project is on programme.';
  const fc = o.forecast_finish ? ` At the current rate, completion is forecast for ${fmt(o.forecast_finish)} (planned ${fmt(d.project.finish)}).` : '';
  const list = (rows, f) => rows.map((r) => `- ${f(r)}`).join('\n');
  const out = {};
  if (TYPES[type].period) {
    out.summary = `Overall progress moved from ${o.start}% to ${o.actual}% this ${type === 'weekly' ? 'week' : 'month'}${vs}.${sv}${fc}${notes ? `\n\n${notes}` : ''}`;
    out.work_done = d.completed.length || d.progressed.length
      ? [d.completed.length ? `Completed:\n${list(d.completed, (r) => `${r.name} (${fmt(r.completed_on)})`)}` : '', d.progressed.length ? `Progressed:\n${list(d.progressed.slice(0, 10), (r) => `${r.name}: ${r.before}% to ${r.actual}%`)}` : ''].filter(Boolean).join('\n\n')
      : 'No progress was recorded against programme activities in this period.';
    out.schedule = `Actual progress is ${o.actual}%${vs}.${sv}${d.behind.length ? `\n\nActivities behind programme:\n${list(d.behind.slice(0, 6), (r) => `${r.name}: ${r.actual}% vs ${r.planned}% planned`)}` : ''}`;
    out.look_ahead = d.upcoming.length ? `Planned for ${fmt(d.look_ahead.from)} to ${fmt(d.look_ahead.to)}:\n${list(d.upcoming.slice(0, 10), (r) => `${r.name} (${fmt(r.start)} – ${fmt(r.finish)})`)}` : 'No programme activities are planned for the coming period.';
    const s = d.site;
    out.challenges = [
      s.issues.length ? `Site issues recorded:\n${list(s.issues.slice(0, 8), (i) => `${i.description}${i.action ? ` – action: ${i.action}` : ''}`)}` : 'No site issues were recorded in this period.',
      s.weather.hours_lost ? `${s.weather.hours_lost} working hours were lost to weather.` : '',
    ].filter(Boolean).join('\n\n');
  } else if (type === 'status') {
    out.summary = `As of ${fmt(d.as_of)} the project is ${o.actual}% complete${vs}.${sv}${fc}${notes ? `\n\n${notes}` : ''}`;
    out.schedule = d.sections.map((s) => `- ${s.name}: ${s.actual}%${s.planned != null ? ` vs ${s.planned}% planned` : ''}`).join('\n') || 'No programme has been uploaded yet.';
    out.remaining = `${o.remaining}% of the work remains: ${d.counts.in_progress} activities in progress and ${d.counts.not_started} not started, out of ${d.counts.total}.`;
    out.risks = d.behind.length ? `Activities furthest behind:\n${list(d.behind.slice(0, 6), (r) => `${r.name}: ${r.actual}% vs ${r.planned}% planned`)}` : 'No activities are significantly behind programme.';
  } else {
    const ms = d.milestones || [];
    out.summary = `${ms.filter((m) => m.actual).length} of ${ms.length} milestones are complete as of ${fmt(d.as_of)}.${sv}${notes ? `\n\n${notes}` : ''}`;
    out.commentary = ms.map((m) => `- ${m.name}: ${m.status}`).join('\n') || 'No milestones yet.';
    out.outlook = fc || 'There is not enough recent progress to forecast completion.';
  }
  return out;
}

function narrativeInput(type, d) {
  // A compact copy of the figures for the AI (it doesn't need curves or IDs).
  const { curve: _c, ...rest } = d;
  return rest;
}

// ------------------------------------------------------------------ storage

function load(req, rid) {
  const ok = db
    .prepare('SELECT pr.id FROM progress_reports pr JOIN projects p ON p.id = pr.project_id WHERE pr.id = ? AND p.company_id = ?')
    .get(rid, req.company.id);
  if (!ok) throw new HttpError(404, 'Report not found');
  return loadById(ok.id);
}

function loadById(id) {
  const r = db.prepare('SELECT * FROM progress_reports WHERE id = ?').get(id);
  if (!r) return null;
  const parse = (s, d) => {
    try {
      return s ? JSON.parse(s) : d;
    } catch {
      return d;
    }
  };
  return { ...r, data: parse(r.data, null), content: parse(r.content, {}) };
}

function save(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  }
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE progress_reports SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

export function progressReportFiles(projectId) {
  return db
    .prepare('SELECT content FROM progress_reports WHERE project_id = ?')
    .all(projectId)
    .flatMap((r) => {
      try {
        return (JSON.parse(r.content || '{}').photos || []).filter((p) => p.source === 'upload').map((p) => p.filename);
      } catch {
        return [];
      }
    });
}

const reportCode = (r) => `${TYPES[r.type].short}-${String(r.number).padStart(3, '0')}`;

function view(r) {
  return {
    id: r.id,
    project_id: r.project_id,
    type: r.type,
    type_name: TYPES[r.type].name,
    code: reportCode(r),
    title: r.title,
    period_from: r.period_from,
    period_to: r.period_to,
    status: r.status,
    error: r.error,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
    published_at: r.published_at,
    published_by: r.published_by,
    data: r.data,
    content: r.content,
    sections: SECTIONS[r.type].map(([key, title]) => ({ key, title })),
  };
}

/** Writes (or rewrites) the narrative in the background; the editor polls until it's ready. */
function writeNarrative(r, project, { keepEdits = false } = {}) {
  const notes = r.content.notes || '';
  const fallback = templateNarrative(r.type, r.data, notes);
  const apply = (texts, source) => {
    const cur = loadById(r.id);
    if (!cur) return; // deleted meanwhile
    const sections = SECTIONS[r.type].map(([key, title]) => {
      const old = (cur.content.sections || []).find((s) => s.key === key);
      return { key, title: keepEdits && old?.title ? old.title : title, text: texts[key] ?? old?.text ?? '' };
    });
    save(r.id, { status: 'draft', content: { ...cur.content, sections, narrative_source: source } });
  };
  if (!aiEnabled()) {
    apply(fallback, 'template');
    return;
  }
  save(r.id, { status: 'generating', error: null });
  (async () => {
    try {
      const images = (r.content.photos || [])
        .filter((p) => p.source === 'upload' && fs.existsSync(path.join(UPLOAD_DIR, p.filename)))
        .slice(0, 6)
        .map((p) => ({ data: fs.readFileSync(path.join(UPLOAD_DIR, p.filename)).toString('base64'), media_type: /\.png$/i.test(p.filename) ? 'image/png' : 'image/jpeg', caption: p.caption }));
      const texts = await generateProgressNarrative({
        type: r.type,
        typeName: TYPES[r.type].name,
        sections: SECTIONS[r.type],
        data: narrativeInput(r.type, r.data),
        notes,
        audience: r.content.prepared_for,
        images,
      });
      apply(texts, 'ai');
    } catch (e) {
      console.error('Progress report narrative failed:', e);
      apply(fallback, 'template');
      save(r.id, { error: `AI could not write the narrative (${describeAIError(e)}), so a plain summary from the figures was used. You can edit it or try "Rewrite with AI".` });
    }
  })();
}

// ------------------------------------------------------------------ routes

/** A report as the editor needs it. */
function full(req, r) {
  const p = companyProject(req, r.project_id);
  return { ...view(r), project: { id: p.id, name: p.name }, access: hasReportsAccess(req), ai: aiEnabled() };
}

export const progressReportsRouter = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const hasReportsAccess = (req) => isPlatformAdmin(req.user) || Boolean(planOf(req.company.id).features.progress_reports);
const requireAccess = (req) => {
  if (!hasReportsAccess(req)) {
    throw new HttpError(402, `Weekly, monthly, status and milestone reports are included in the ${planWith('progress_reports').name} plan and above. Upgrade on the Plan & billing page.`);
  }
};

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `prr-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${path.extname(file.originalname).toLowerCase() === '.png' ? '.png' : '.jpg'}`),
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png)$/.test(file.mimetype)),
});

progressReportsRouter.get('/projects/:id/progress-reports', (req, res) => {
  const p = companyProject(req, req.params.id);
  const rows = db.prepare('SELECT * FROM progress_reports WHERE project_id = ? ORDER BY period_to DESC, id DESC').all(p.id);
  res.json({
    access: hasReportsAccess(req),
    ai: aiEnabled(),
    project: { id: p.id, name: p.name, client: p.client, start_date: p.start_date },
    types: Object.entries(TYPES).map(([key, t]) => ({ key, ...t })),
    reports: rows.map((r) => ({ id: r.id, type: r.type, type_name: TYPES[r.type].name, code: reportCode(r), title: r.title, period_from: r.period_from, period_to: r.period_to, status: r.status, updated_at: r.updated_at, published_at: r.published_at })),
  });
});

progressReportsRouter.post(
  '/projects/:id/progress-reports',
  photoUpload.array('photos', 12),
  wrap(async (req, res) => {
    const uploaded = req.files || [];
    try {
      const p = companyProject(req, req.params.id);
      requireAccess(req);
      const b = req.body || {};
      const type = TYPES[b.type] ? b.type : null;
      if (!type) throw new HttpError(400, 'Choose a report type.');
      const to = isDate(b.to) ? b.to : todayISO();
      let from = TYPES[type].period ? (isDate(b.from) ? b.from : null) : null;
      if (TYPES[type].period && !from) throw new HttpError(400, 'Choose the reporting period.');
      if (from && from > to) throw new HttpError(400, 'The period starts after it ends.');
      if (from && daysBetween(from, to) > 92) throw new HttpError(400, 'A reporting period can be up to 3 months long.');

      const number = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 n FROM progress_reports WHERE project_id = ? AND type = ?').get(p.id, type).n;
      const data = computeReportData(p, type, from, to);
      const captions = (() => {
        try {
          return JSON.parse(b.captions || '[]');
        } catch {
          return [];
        }
      })();
      const photos = [
        ...uploaded.map((f, i) => ({ filename: f.filename, caption: String(captions[i] || '').slice(0, 200), source: 'upload' })),
        ...(from ? periodPhotos(p.id, from, to) : []).map((ph) => ({ filename: ph.filename, caption: ph.caption || `Site, ${fmt(ph.report_date)}`, source: 'report' })),
      ];
      const content = {
        sections: SECTIONS[type].map(([key, title]) => ({ key, title, text: '' })),
        notes: String(b.notes || '').slice(0, 6000),
        prepared_for: String(b.prepared_for || p.client || '').slice(0, 200),
        prepared_by: String(b.prepared_by || req.user.name).slice(0, 200),
        hidden: [],
        milestones: data.milestones || null,
        photos,
      };
      const title = String(b.title || '').trim().slice(0, 200) || `${TYPES[type].name} ${number}`;
      const id = db
        .prepare('INSERT INTO progress_reports (project_id, type, number, title, period_from, period_to, status, data, content, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(p.id, type, number, title, from, to, 'generating', JSON.stringify(data), JSON.stringify(content), req.user.name).lastInsertRowid;
      const r = load(req, id);
      writeNarrative(r, p);
      res.status(201).json(full(req, load(req, id)));
    } catch (e) {
      uploaded.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
      throw e;
    }
  })
);

progressReportsRouter.get('/progress-reports/:rid', (req, res) => {
  res.json(full(req, load(req, req.params.rid)));
});

const editable = (req, r) => {
  requireAccess(req);
  if (r.status === 'published') throw new HttpError(409, 'This report is published. Unpublish it to make changes.');
  if (r.status === 'generating') throw new HttpError(409, 'The narrative is still being written. Please wait a moment.');
};

progressReportsRouter.put('/progress-reports/:rid', (req, res) => {
  const r = load(req, req.params.rid);
  editable(req, r);
  const b = req.body || {};
  const c = { ...r.content };
  if (Array.isArray(b.sections)) {
    c.sections = SECTIONS[r.type].map(([key, title]) => {
      const s = b.sections.find((x) => x?.key === key) || {};
      return { key, title: String(s.title ?? title).slice(0, 120) || title, text: String(s.text ?? '').slice(0, 20000) };
    });
  }
  for (const k of ['prepared_for', 'prepared_by', 'notes']) if (typeof b[k] === 'string') c[k] = b[k].slice(0, k === 'notes' ? 6000 : 200);
  if (Array.isArray(b.hidden)) c.hidden = b.hidden.map(String).slice(0, 30);
  if (Array.isArray(b.milestones) && c.milestones) {
    c.milestones = b.milestones.slice(0, 60).map((m) => ({
      key: String(m.key || crypto.randomBytes(4).toString('hex')).slice(0, 80),
      auto: Boolean(m.auto),
      name: String(m.name || '').slice(0, 200),
      planned: isDate(m.planned) ? m.planned : null,
      actual: isDate(m.actual) ? m.actual : null,
      forecast: isDate(m.forecast) ? m.forecast : null,
      progress: m.progress == null || m.progress === '' ? null : Math.max(0, Math.min(100, Number(m.progress) || 0)),
      status: String(m.status || '').slice(0, 80),
      remarks: String(m.remarks || '').slice(0, 1000),
    }));
  }
  if (Array.isArray(b.photos)) {
    const known = new Map((c.photos || []).map((p) => [p.filename, p]));
    const keep = b.photos.filter((p) => known.has(p?.filename)).map((p) => ({ ...known.get(p.filename), caption: String(p.caption || '').slice(0, 200) }));
    const dropped = (c.photos || []).filter((p) => !keep.some((k) => k.filename === p.filename) && p.source === 'upload');
    dropped.forEach((p) => fs.rm(path.join(UPLOAD_DIR, p.filename), { force: true }, () => {}));
    c.photos = keep;
  }
  const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 200) : r.title;
  save(r.id, { content: c, title });
  res.json(full(req, load(req, r.id)));
});

progressReportsRouter.post('/progress-reports/:rid/photos', photoUpload.array('photos', 12), (req, res) => {
  const files = req.files || [];
  try {
    const r = load(req, req.params.rid);
    editable(req, r);
    if (!files.length) throw new HttpError(400, 'Choose JPEG or PNG photos.');
    const photos = [...(r.content.photos || []), ...files.map((f) => ({ filename: f.filename, caption: '', source: 'upload' }))];
    if (photos.length > 24) throw new HttpError(400, 'A report can have up to 24 photos.');
    save(r.id, { content: { ...r.content, photos } });
    res.json(full(req, load(req, r.id)));
  } catch (e) {
    files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
    throw e;
  }
});

/** Recalculate the figures (e.g. after more daily reports were filed). Text edits are kept. */
progressReportsRouter.post('/progress-reports/:rid/refresh', (req, res) => {
  const r = load(req, req.params.rid);
  editable(req, r);
  const p = companyProject(req, r.project_id);
  const data = computeReportData(p, r.type, r.period_from, r.period_to);
  const c = { ...r.content };
  if (data.milestones && c.milestones) {
    // Update automatic milestones' dates and status; keep remarks and any rows the user added or edited.
    const fresh = new Map(data.milestones.map((m) => [m.key, m]));
    c.milestones = [
      ...c.milestones.map((m) => (m.auto && fresh.has(m.key) ? { ...fresh.get(m.key), remarks: m.remarks } : m)),
      ...data.milestones.filter((m) => !c.milestones.some((x) => x.key === m.key)),
    ];
  }
  save(r.id, { data, content: c });
  res.json(full(req, load(req, r.id)));
});

progressReportsRouter.post('/progress-reports/:rid/rewrite', (req, res) => {
  const r = load(req, req.params.rid);
  editable(req, r);
  if (typeof req.body?.notes === 'string') {
    r.content.notes = req.body.notes.slice(0, 6000);
    save(r.id, { content: r.content });
  }
  writeNarrative(load(req, r.id), companyProject(req, r.project_id), { keepEdits: true });
  res.json(full(req, load(req, r.id)));
});

progressReportsRouter.post('/progress-reports/:rid/publish', (req, res) => {
  const r = load(req, req.params.rid);
  editable(req, r);
  save(r.id, { status: 'published', published_at: new Date().toISOString(), published_by: req.user.name, error: null });
  res.json(full(req, load(req, r.id)));
});

progressReportsRouter.post('/progress-reports/:rid/unpublish', (req, res) => {
  const r = load(req, req.params.rid);
  requireAccess(req);
  if (r.status !== 'published') throw new HttpError(400, 'This report is not published.');
  save(r.id, { status: 'draft', published_at: null, published_by: null });
  res.json(full(req, load(req, r.id)));
});

progressReportsRouter.delete('/progress-reports/:rid', (req, res) => {
  const r = load(req, req.params.rid);
  if (r.status === 'published' && req.user.role !== 'admin') throw new HttpError(403, 'Only company admins can delete a published report.');
  db.prepare('DELETE FROM progress_reports WHERE id = ?').run(r.id);
  for (const p of r.content.photos || []) if (p.source === 'upload') fs.rm(path.join(UPLOAD_DIR, p.filename), { force: true }, () => {});
  res.json({ ok: true });
});

progressReportsRouter.get('/progress-reports/:rid/photo/:file', (req, res) => {
  const r = load(req, req.params.rid);
  const ph = (r.content.photos || []).find((p) => p.filename === req.params.file);
  if (!ph || (ph.source === 'report' && !photoForCompany(req, ph.filename))) throw new HttpError(404, 'Not found');
  res.set('Cache-Control', 'private, max-age=604800');
  res.sendFile(path.join(UPLOAD_DIR, ph.filename));
});

progressReportsRouter.get('/progress-reports/:rid/pdf', (req, res) => {
  const r = load(req, req.params.rid);
  if (r.status === 'generating') throw new HttpError(409, 'The narrative is still being written. Please wait a moment.');
  const p = companyProject(req, r.project_id);
  const c = req.company;
  const name = `${(p.name || 'Project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50)}_${reportCode(r)}${r.status === 'published' ? '' : '_DRAFT'}.pdf`;
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${name}"`);
  renderProgressReportPdf(
    { project: p, report: view(r), branding: { name: c.name, color: c.primary_color, logoPath: c.logo_filename ? path.join(UPLOAD_DIR, c.logo_filename) : null } },
    res
  );
});
