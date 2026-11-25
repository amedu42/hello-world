// AI work programme generator (premium): documents in, a linked and scheduled programme out,
// downloadable as a Gantt PDF or MS Project XML, and importable as the project's activity list.
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { db, UPLOAD_DIR } from './db.js';
import { companyProject, isPlatformAdmin } from './auth.js';
import { aiEnabled, describeAIError, generateProgrammePlan } from './ai.js';
import { renderProgrammePdf } from './programmePdf.js';
import { planOf } from './plans.js';

db.exec(`
CREATE TABLE IF NOT EXISTS programme_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  inputs TEXT,            -- JSON {start_date, end_date, working_days, holidays, notes}
  files TEXT,             -- JSON [{filename, original_name, mime, size, kind}]
  plan TEXT,              -- JSON {title, scope_summary, assumptions, tasks:[{uid, name, outline, duration, preds:[{uid,type,lag}], basis}]}
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | generating | ready | failed
  error TEXT,
  generated_at TEXT,
  generated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS programme_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  project_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// A restart interrupts any generation that was running.
db.prepare("UPDATE programme_drafts SET status = 'failed', error = 'Generation was interrupted (the server restarted). Please try again.' WHERE status = 'generating'").run();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_TOTAL_BYTES = 22 * 1024 * 1024; // keeps the AI request under the API's 32 MB limit once base64-encoded
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whether the user's company may use the generator (Starter plan and above, or the trial). */
export function hasProgrammeAccess(req) {
  if (process.env.PREMIUM_PROGRAMMES === 'all') return true;
  if (isPlatformAdmin(req.user)) return true;
  return planOf(req.company.id).features.programmes;
}

/** Generations per company per day: the plan's allowance, or PROGRAMME_DAILY_LIMIT if set. */
const dailyLimit = (req) => Number(process.env.PROGRAMME_DAILY_LIMIT) || planOf(req.company.id).programmes_per_day || 10;

// ------------------------------------------------------------------ dates & calendar

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
const toDate = (iso) => new Date(iso + 'T00:00:00Z');
const toIso = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * 86400000));

export function normaliseInputs(raw = {}) {
  const wd = Array.isArray(raw.working_days) ? [...new Set(raw.working_days.map(Number).filter((n) => n >= 0 && n <= 6))].sort() : [1, 2, 3, 4, 5, 6];
  return {
    start_date: isDate(raw.start_date) ? raw.start_date : null,
    end_date: isDate(raw.end_date) ? raw.end_date : null,
    working_days: wd.length ? wd : [1, 2, 3, 4, 5, 6],
    holidays: [...new Set((Array.isArray(raw.holidays) ? raw.holidays : []).filter(isDate))].sort().slice(0, 200),
    notes: String(raw.notes || '').slice(0, 8000),
  };
}

/** Working-day calendar: index i is the i-th working day from the project start. */
export function makeCalendar({ start_date, working_days, holidays }) {
  const work = new Set(working_days);
  const hol = new Set(holidays);
  const days = [];
  let d = start_date;
  const isWork = (iso) => work.has(toDate(iso).getUTCDay()) && !hol.has(iso);
  const grow = (n) => {
    while (days.length <= n) {
      if (isWork(d)) days.push(d);
      d = addDays(d, 1);
      if (days.length === 0 && d > addDays(start_date, 400)) throw new Error('The working calendar has no working days.');
    }
  };
  return {
    isWork,
    date: (i) => {
      grow(Math.max(0, i));
      return days[Math.max(0, i)];
    },
    /** Working days from the start date up to and including `iso`. */
    countTo(iso) {
      let n = 0;
      for (let x = start_date; x <= iso; x = addDays(x, 1)) if (isWork(x)) n++;
      return n;
    },
  };
}

// ------------------------------------------------------------------ scheduling

const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];

export function cleanTasks(tasks) {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const name = String(t?.name || '').trim().slice(0, 200);
    if (!name) continue;
    let uid = String(t.uid || '').slice(0, 40) || crypto.randomBytes(4).toString('hex');
    while (seen.has(uid)) uid = crypto.randomBytes(4).toString('hex');
    seen.add(uid);
    out.push({
      uid,
      name,
      outline: Math.min(6, Math.max(1, Math.round(Number(t.outline) || 1))),
      duration: Math.min(2000, Math.max(0, Math.round(Number(t.duration) || 0))),
      preds: (Array.isArray(t.preds) ? t.preds : [])
        .map((p) => ({ uid: String(p?.uid || ''), type: LINK_TYPES.includes(p?.type) ? p.type : 'FS', lag: Math.max(-500, Math.min(500, Math.round(Number(p?.lag) || 0))) }))
        .filter((p) => p.uid && p.uid !== uid)
        .slice(0, 20),
      basis: t.basis ? String(t.basis).slice(0, 500) : null,
    });
  }
  // The first row can't be indented under nothing; each row can be at most one level deeper than the one above.
  let prev = 0;
  for (const t of out) {
    t.outline = Math.min(t.outline, prev + 1);
    prev = t.outline;
  }
  return out;
}

/**
 * Forward/backward pass over the linked tasks. Returns rows in display order with
 * id (row number, the project summary is 1), wbs, summary/milestone flags, start/finish dates,
 * duration, critical flag and predecessor text. Indices are working days, finish is exclusive.
 */
export function schedulePlan(plan, inputs) {
  const tasks = plan.tasks || [];
  const warnings = [];
  const cal = makeCalendar(inputs);
  const n = tasks.length;
  const summary = tasks.map((t, i) => i + 1 < n && tasks[i + 1].outline > t.outline);
  const children = tasks.map(() => []); // direct children
  const parent = new Array(n).fill(-1);
  const stack = [];
  tasks.forEach((t, i) => {
    while (stack.length && tasks[stack[stack.length - 1]].outline >= t.outline) stack.pop();
    if (stack.length) {
      parent[i] = stack[stack.length - 1];
      children[parent[i]].push(i);
    }
    stack.push(i);
  });
  const leavesOf = (i) => (summary[i] ? children[i].flatMap(leavesOf) : [i]);
  const index = new Map(tasks.map((t, i) => [t.uid, i]));

  // Links between leaf tasks (a link from a summary means "all of its tasks").
  const preds = tasks.map(() => []);
  tasks.forEach((t, i) => {
    if (summary[i]) return;
    for (const p of t.preds) {
      const j = index.get(p.uid);
      if (j === undefined) continue;
      // A task can't follow its own phase (that would be a loop).
      let a = parent[i];
      while (a >= 0 && a !== j) a = parent[a];
      if (a === j) continue;
      for (const leaf of leavesOf(j)) if (leaf !== i) preds[i].push({ j: leaf, type: p.type, lag: p.lag });
    }
  });

  // Topological order (Kahn); links that would form a loop are ignored.
  const succs = tasks.map(() => []);
  preds.forEach((ps, i) => ps.forEach((p) => succs[p.j].push(i)));
  const indeg = preds.map((ps) => ps.length);
  const queue = [];
  indeg.forEach((d, i) => !summary[i] && d === 0 && queue.push(i));
  const order = [];
  while (queue.length) {
    const i = queue.shift();
    order.push(i);
    for (const s of succs[i]) if (--indeg[s] === 0) queue.push(s);
  }
  const leafCount = summary.filter((s) => !s).length;
  if (order.length < leafCount) {
    const stuck = tasks.map((_, i) => i).filter((i) => !summary[i] && !order.includes(i));
    warnings.push(`Circular links were found and ignored for: ${stuck.slice(0, 5).map((i) => tasks[i].name).join(', ')}${stuck.length > 5 ? '…' : ''}.`);
    for (const i of stuck) {
      preds[i] = preds[i].filter((p) => order.includes(p.j));
      order.push(i);
    }
  }

  const dur = tasks.map((t, i) => (summary[i] ? 0 : t.duration));
  const ES = new Array(n).fill(0);
  const EF = new Array(n).fill(0);
  for (const i of order) {
    let es = 0;
    for (const p of preds[i]) {
      if (p.type === 'FS') es = Math.max(es, EF[p.j] + p.lag);
      else if (p.type === 'SS') es = Math.max(es, ES[p.j] + p.lag);
      else if (p.type === 'FF') es = Math.max(es, EF[p.j] + p.lag - dur[i]);
      else es = Math.max(es, ES[p.j] + p.lag - dur[i]); // SF
    }
    ES[i] = Math.max(0, es);
    EF[i] = ES[i] + dur[i];
  }
  const projectEF = Math.max(0, ...order.map((i) => EF[i]));

  // Backward pass for total float.
  const LF = new Array(n).fill(projectEF);
  const LS = new Array(n).fill(projectEF);
  for (const i of [...order].reverse()) {
    let lf = projectEF;
    for (const s of succs[i]) {
      const link = preds[s].find((p) => p.j === i);
      if (!link) continue;
      if (link.type === 'FS') lf = Math.min(lf, LS[s] - link.lag);
      else if (link.type === 'SS') lf = Math.min(lf, LS[s] - link.lag + dur[i]);
      else if (link.type === 'FF') lf = Math.min(lf, LF[s] - link.lag);
      else lf = Math.min(lf, LF[s] - link.lag + dur[i]);
    }
    LF[i] = lf;
    LS[i] = lf - dur[i];
  }

  // Summaries roll up their tasks.
  for (let i = n - 1; i >= 0; i--) {
    if (!summary[i]) continue;
    const kids = children[i];
    ES[i] = Math.min(...kids.map((k) => ES[k]));
    EF[i] = Math.max(...kids.map((k) => EF[k]));
  }

  const startDate = (i) => cal.date(ES[i]);
  const finishDate = (i) => (EF[i] > ES[i] ? cal.date(EF[i] - 1) : ES[i] > 0 ? cal.date(ES[i] - 1) : cal.date(0));

  // WBS numbers under the project summary row ("1").
  const counters = [];
  const rows = tasks.map((t, i) => {
    counters.length = t.outline;
    counters[t.outline - 1] = (counters[t.outline - 1] || 0) + 1;
    const milestone = !summary[i] && t.duration === 0;
    return {
      ...t,
      id: i + 2,
      wbs: '1.' + counters.slice(0, t.outline).map((c) => c || 1).join('.'),
      summary: summary[i],
      milestone,
      parent: parent[i] >= 0 ? tasks[parent[i]].uid : null,
      start: milestone ? finishDate(i) : startDate(i),
      finish: finishDate(i),
      duration: summary[i] ? EF[i] - ES[i] : t.duration,
      es: ES[i],
      ef: EF[i],
      float: summary[i] ? null : LS[i] - ES[i],
      critical: !summary[i] && LS[i] - ES[i] <= 0,
    };
  });
  const rowById = new Map(rows.map((r) => [r.uid, r]));
  for (const r of rows) {
    r.pred_text = r.preds
      .map((p) => {
        const pr = rowById.get(p.uid);
        if (!pr) return null;
        return `${pr.id}${p.type !== 'FS' || p.lag ? p.type : ''}${p.lag ? (p.lag > 0 ? '+' : '') + p.lag + 'd' : ''}`;
      })
      .filter(Boolean)
      .join(', ');
  }

  const project = {
    id: 1,
    name: plan.title || 'Programme',
    start: cal.date(0),
    finish: rows.length ? (projectEF > 0 ? cal.date(projectEF - 1) : cal.date(0)) : inputs.start_date,
    duration: projectEF,
  };
  if (inputs.end_date && rows.length) {
    const available = cal.countTo(inputs.end_date);
    if (project.finish > inputs.end_date) {
      warnings.push(
        `The programme finishes on ${fmtShort(project.finish)}, ${projectEF - available} working day${projectEF - available === 1 ? '' : 's'} after the target completion date (${fmtShort(inputs.end_date)}). Shorten durations or overlap tasks to bring it in.`
      );
    }
    project.available_days = available;
  }
  return { project, rows, warnings };
}

export const fmtShort = (iso) => {
  if (!iso) return '';
  const d = toDate(iso);
  return `${DAY_NAMES[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
};

/** Leaf tasks as project activities (for the daily report drop-down and progress weighting). */
export function planActivities(schedule) {
  const byUid = new Map(schedule.rows.map((r) => [r.uid, r]));
  return schedule.rows
    .filter((r) => !r.summary && !r.milestone)
    .map((r) => ({
      code: r.wbs,
      name: r.name,
      section: r.parent ? byUid.get(r.parent)?.name || null : null,
      start_date: r.start,
      end_date: r.finish,
      weight: Math.max(1, r.duration),
    }));
}

// ------------------------------------------------------------------ MS Project XML

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LINK_CODE = { FF: 0, FS: 1, SF: 2, SS: 3 };

export function renderMsProjectXml({ project, schedule, inputs, company }) {
  const { rows } = schedule;
  const P = schedule.project;
  const now = new Date().toISOString().slice(0, 19);
  const hours = (d) => `PT${d * 8}H0M0S`;
  const t8 = (d) => `${d}T08:00:00`;
  const t17 = (d) => `${d}T17:00:00`;
  const minutesPerWeek = inputs.working_days.length * 480;

  const weekDays = [1, 2, 3, 4, 5, 6, 7]
    .map((dt) => {
      const working = inputs.working_days.includes(dt - 1);
      return `<WeekDay><DayType>${dt}</DayType><DayWorking>${working ? 1 : 0}</DayWorking>${
        working
          ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>'
          : ''
      }</WeekDay>`;
    })
    .join('');
  const exceptions = inputs.holidays.length
    ? `<Exceptions>${inputs.holidays
        .map(
          (h) =>
            `<Exception><EnteredByOccurrences>0</EnteredByOccurrences><TimePeriod><FromDate>${h}T00:00:00</FromDate><ToDate>${h}T23:59:00</ToDate></TimePeriod><Occurrences>1</Occurrences><Name>Holiday</Name><Type>1</Type><DayWorking>0</DayWorking></Exception>`
        )
        .join('')}</Exceptions>`
    : '';

  const uidOf = new Map(rows.map((r, i) => [r.uid, i + 2]));
  const task = (f) =>
    `<Task><UID>${f.uid}</UID><ID>${f.id}</ID><Name>${esc(f.name)}</Name><Active>1</Active><Manual>0</Manual><Type>1</Type><IsNull>0</IsNull><CreateDate>${now}</CreateDate>` +
    `<WBS>${f.wbs}</WBS><OutlineNumber>${f.wbs}</OutlineNumber><OutlineLevel>${f.level}</OutlineLevel><Priority>500</Priority>` +
    `<Start>${f.start}</Start><Finish>${f.finish}</Finish><Duration>${hours(f.duration)}</Duration><DurationFormat>7</DurationFormat>` +
    `<Milestone>${f.milestone ? 1 : 0}</Milestone><Summary>${f.summary ? 1 : 0}</Summary><Critical>${f.critical ? 1 : 0}</Critical>` +
    `<PercentComplete>0</PercentComplete><ConstraintType>0</ConstraintType><CalendarUID>-1</CalendarUID>` +
    (f.notes ? `<Notes>${esc(f.notes)}</Notes>` : '') +
    (f.links || []).join('') +
    `</Task>`;

  const tasks = [
    // UID 0 is MS Project's hidden project summary task; row 1 is the visible project summary, as on contractor programmes.
    task({ uid: 0, id: 0, name: P.name, wbs: '0', level: 0, start: t8(P.start), finish: t17(P.finish), duration: P.duration, summary: true }),
    task({ uid: 1, id: 1, name: P.name, wbs: '1', level: 1, start: t8(P.start), finish: t17(P.finish), duration: P.duration, summary: true }),
    ...rows.map((r) =>
      task({
        uid: uidOf.get(r.uid),
        id: r.id,
        name: r.name,
        wbs: r.wbs,
        level: r.outline + 1,
        start: r.milestone && r.es > 0 ? t17(r.start) : t8(r.start),
        finish: r.milestone && r.es === 0 ? t8(r.finish) : t17(r.finish),
        duration: r.duration,
        summary: r.summary,
        milestone: r.milestone,
        critical: r.critical,
        notes: r.basis,
        links: r.summary
          ? []
          : r.preds
              .filter((p) => uidOf.has(p.uid))
              .map(
                (p) =>
                  `<PredecessorLink><PredecessorUID>${uidOf.get(p.uid)}</PredecessorUID><Type>${LINK_CODE[p.type]}</Type><CrossProject>0</CrossProject><LinkLag>${p.lag * 4800}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`
              ),
      })
    ),
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
<SaveVersion>14</SaveVersion><Name>${esc(P.name)}.xml</Name><Title>${esc(P.name)}</Title><Company>${esc(company || '')}</Company><Author>Proj4D</Author>
<CreationDate>${now}</CreationDate><ScheduleFromStart>1</ScheduleFromStart><StartDate>${t8(P.start)}</StartDate><FinishDate>${t17(P.finish)}</FinishDate>
<CalendarUID>1</CalendarUID><DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime>
<MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>${minutesPerWeek}</MinutesPerWeek><DaysPerMonth>${Math.round((inputs.working_days.length * 52) / 12)}</DaysPerMonth>
<DefaultTaskType>1</DefaultTaskType><DurationFormat>7</DurationFormat><WeekStartDay>1</WeekStartDay>
<Calendars><Calendar><UID>1</UID><Name>${esc(project.name)} calendar</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>${weekDays}</WeekDays>${exceptions}</Calendar></Calendars>
<Tasks>${tasks.join('\n')}</Tasks>
</Project>
`;
}

// ------------------------------------------------------------------ documents → AI content

const KINDS = ['drawing', 'boq', 'spec', 'other'];
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const ALLOWED_EXT = ['.pdf', '.xlsx', '.xlsm', '.csv', '.txt', ...Object.keys(IMAGE_TYPES)];
const KIND_LABEL = { drawing: 'Working drawing', boq: 'Bill of quantities', spec: 'Specification / other project document', other: 'Other document' };

function guessKind(name) {
  const n = name.toLowerCase();
  if (/boq|bill|quantit|bq|estimate|cost/.test(n) || /\.(xlsx|xlsm|csv)$/.test(n)) return 'boq';
  if (/spec|scope|brief|letter|contract|report/.test(n)) return 'spec';
  return 'drawing';
}

async function sheetText(file) {
  const ext = path.extname(file.original_name).toLowerCase();
  const p = path.join(UPLOAD_DIR, file.filename);
  if (ext === '.csv' || ext === '.txt') {
    const raw = fs.readFileSync(p, 'utf8');
    if (ext === '.txt') return raw;
    return Papa.parse(raw.trim(), { skipEmptyLines: true }).data.map((r) => r.join(' | ')).join('\n');
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(p);
  const parts = [];
  wb.eachSheet((ws) => {
    const lines = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = (row.values || []).slice(1).map((v) => {
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : '');
        return v;
      });
      if (cells.some((c) => String(c).trim())) lines.push(cells.join(' | '));
    });
    if (lines.length) parts.push(`Sheet: ${ws.name}\n${lines.join('\n')}`);
  });
  return parts.join('\n\n');
}

async function documentBlocks(files) {
  const blocks = [];
  for (const f of files) {
    const ext = path.extname(f.original_name).toLowerCase();
    const label = `${KIND_LABEL[f.kind] || 'Document'}: ${f.original_name}`;
    const p = path.join(UPLOAD_DIR, f.filename);
    if (!fs.existsSync(p)) continue;
    if (ext === '.pdf') {
      blocks.push({ type: 'text', text: label });
      blocks.push({ type: 'document', title: f.original_name.slice(0, 200), source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(p).toString('base64') } });
    } else if (IMAGE_TYPES[ext]) {
      blocks.push({ type: 'text', text: label });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[ext], data: fs.readFileSync(p).toString('base64') } });
    } else {
      let text = await sheetText(f);
      if (text.length > 300000) text = text.slice(0, 300000) + '\n…(truncated)';
      blocks.push({ type: 'text', text: `${label}\n<document>\n${text}\n</document>` });
    }
  }
  return blocks;
}

function briefText({ project, inputs, cal, files }) {
  const days = inputs.working_days.map((d) => DAY_NAMES[d]).join(', ');
  const lines = [
    `Prepare the work programme for this project.`,
    ``,
    `Project: ${project.name}${project.code ? ` (${project.code})` : ''}`,
    project.client && `Client: ${project.client}`,
    project.location && `Location: ${project.location}`,
    project.contractor && `Contractor: ${project.contractor}`,
    project.description && `Description: ${project.description}`,
    `Start date: ${inputs.start_date} (${fmtShort(inputs.start_date)})`,
    inputs.end_date && `Target completion date: ${inputs.end_date} (${fmtShort(inputs.end_date)}) = ${cal.countTo(inputs.end_date)} working days available`,
    `Working days: ${days} (${inputs.working_days.length} per week), 8 hours per day.`,
    inputs.holidays.length ? `Non-working holidays: ${inputs.holidays.join(', ')}` : null,
    `Documents provided: ${files.length ? files.map((f) => `${f.original_name} [${f.kind}]`).join('; ') : 'none (plan from the description and notes)'}`,
    inputs.notes && `\nNotes and instructions from the contractor:\n<notes>\n${inputs.notes}\n</notes>`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** Turns the AI's phases/refs into the stored task list. */
function planFromAI(out) {
  const tasks = [];
  const uidByRef = new Map();
  const rand = () => crypto.randomBytes(4).toString('hex');
  for (const ph of out.phases || []) {
    tasks.push({ uid: rand(), name: ph.name, outline: 1, duration: 0, preds: [] });
    for (const t of ph.tasks || []) {
      const uid = rand();
      if (t.ref) uidByRef.set(t.ref, uid);
      tasks.push({ uid, name: t.name, outline: 2, duration: t.duration_days, preds: t.predecessors || [], basis: t.basis });
    }
  }
  for (const t of tasks) {
    t.preds = t.preds
      .map((p) => ({ uid: uidByRef.get(p.ref), type: p.type, lag: p.lag_days }))
      .filter((p) => p.uid);
  }
  // A phase with no tasks would become a zero-length row: drop it.
  const keep = tasks.filter((t, i) => t.outline === 2 || tasks[i + 1]?.outline === 2);
  return { title: out.title, scope_summary: out.scope_summary, assumptions: out.assumptions || [], tasks: cleanTasks(keep) };
}

// ------------------------------------------------------------------ storage helpers

function loadDraft(projectId) {
  const row = db.prepare('SELECT * FROM programme_drafts WHERE project_id = ?').get(projectId);
  if (!row) return null;
  const parse = (s, d) => {
    try {
      return s ? JSON.parse(s) : d;
    } catch {
      return d;
    }
  };
  return { ...row, inputs: normaliseInputs(parse(row.inputs, {})), files: parse(row.files, []), plan: parse(row.plan, null) };
}

function ensureDraft(project) {
  let d = loadDraft(project.id);
  if (!d) {
    const inputs = normaliseInputs({ start_date: project.start_date, end_date: project.end_date });
    db.prepare('INSERT INTO programme_drafts (project_id, inputs, files) VALUES (?, ?, ?)').run(project.id, JSON.stringify(inputs), '[]');
    d = loadDraft(project.id);
  }
  return d;
}

function saveDraft(projectId, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  }
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE programme_drafts SET ${sets.join(', ')} WHERE project_id = ?`).run(...vals, projectId);
}

/** Files to delete from disk when a project goes. */
export function generatorFiles(projectId) {
  return (loadDraft(projectId)?.files || []).map((f) => f.filename);
}

function view(req, project, d) {
  const out = {
    access: hasProgrammeAccess(req),
    ai: aiEnabled(),
    daily_limit: dailyLimit(req),
    max_total_mb: Math.round(MAX_TOTAL_BYTES / 1024 / 1024),
    project: { id: project.id, name: project.name, activity_count: db.prepare('SELECT COUNT(*) n FROM activities WHERE project_id = ?').get(project.id).n },
  };
  if (!d) return out;
  out.draft = {
    inputs: d.inputs,
    files: d.files.map(({ filename, original_name, size, kind, mime }) => ({ id: filename, name: original_name, size, kind, mime })),
    status: d.status,
    error: d.error,
    generated_at: d.generated_at,
    generated_by: d.generated_by,
  };
  if (d.plan && d.inputs.start_date) {
    const schedule = schedulePlan(d.plan, d.inputs);
    out.draft.plan = { title: d.plan.title, scope_summary: d.plan.scope_summary, assumptions: d.plan.assumptions || [] };
    out.draft.schedule = schedule;
    out.draft.activities = planActivities(schedule);
  }
  return out;
}

// ------------------------------------------------------------------ routes

export const programmeGenRouter = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const docUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `prog-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase())),
});

const base = '/projects/:id/programme-generator';
const premium = (req) => {
  if (!hasProgrammeAccess(req)) throw new HttpError(403, 'The AI work programme generator is included in the Starter plan and above. Upgrade on the Plan & billing page.');
};

programmeGenRouter.get(base, (req, res) => {
  const p = companyProject(req, req.params.id);
  res.json(view(req, p, hasProgrammeAccess(req) ? ensureDraft(p) : null));
});

programmeGenRouter.put(`${base}/inputs`, (req, res) => {
  const p = companyProject(req, req.params.id);
  premium(req);
  const d = ensureDraft(p);
  if (d.status === 'generating') throw new HttpError(409, 'Please wait for the current generation to finish.');
  const inputs = normaliseInputs({ ...d.inputs, ...(req.body || {}) });
  if (inputs.start_date && inputs.end_date && inputs.end_date < inputs.start_date) throw new HttpError(400, 'The target completion date is before the start date.');
  saveDraft(p.id, { inputs });
  res.json(view(req, p, loadDraft(p.id)));
});

programmeGenRouter.post(
  `${base}/files`,
  docUpload.array('files', 20),
  wrap(async (req, res) => {
    const uploaded = req.files || [];
    const drop = () => uploaded.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
    try {
      const p = companyProject(req, req.params.id);
      premium(req);
      if (!uploaded.length) throw new HttpError(400, 'Choose PDF, image (JPEG/PNG/WebP), Excel (.xlsx) or CSV files. Save Word documents as PDF first.');
      const d = ensureDraft(p);
      const total = d.files.reduce((s, f) => s + f.size, 0) + uploaded.reduce((s, f) => s + f.size, 0);
      if (total > MAX_TOTAL_BYTES) throw new HttpError(413, `Documents can total up to ${Math.round(MAX_TOTAL_BYTES / 1048576)} MB. Remove some files or upload smaller PDFs (e.g. only the plans, sections and elevations needed).`);
      const kind = KINDS.includes(req.body?.kind) ? req.body.kind : null;
      const files = [
        ...d.files,
        ...uploaded.map((f) => ({ filename: f.filename, original_name: f.originalname.slice(0, 200), mime: f.mimetype, size: f.size, kind: kind || guessKind(f.originalname) })),
      ];
      saveDraft(p.id, { files });
      res.json(view(req, p, loadDraft(p.id)));
    } catch (e) {
      drop();
      throw e;
    }
  })
);

programmeGenRouter.put(`${base}/files/:fid`, (req, res) => {
  const p = companyProject(req, req.params.id);
  premium(req);
  const d = ensureDraft(p);
  const files = d.files.map((f) => (f.filename === req.params.fid && KINDS.includes(req.body?.kind) ? { ...f, kind: req.body.kind } : f));
  saveDraft(p.id, { files });
  res.json(view(req, p, loadDraft(p.id)));
});

programmeGenRouter.delete(`${base}/files/:fid`, (req, res) => {
  const p = companyProject(req, req.params.id);
  premium(req);
  const d = ensureDraft(p);
  const f = d.files.find((x) => x.filename === req.params.fid);
  if (!f) throw new HttpError(404, 'File not found');
  saveDraft(p.id, { files: d.files.filter((x) => x !== f) });
  fs.rm(path.join(UPLOAD_DIR, f.filename), { force: true }, () => {});
  res.json(view(req, p, loadDraft(p.id)));
});

programmeGenRouter.post(
  `${base}/generate`,
  wrap(async (req, res) => {
    const p = companyProject(req, req.params.id);
    premium(req);
    if (!aiEnabled()) throw new HttpError(400, 'AI is not configured on the server yet (set ANTHROPIC_API_KEY).');
    const d = ensureDraft(p);
    if (d.status === 'generating') throw new HttpError(409, 'A programme is already being generated for this project.');
    if (!d.inputs.start_date) throw new HttpError(400, 'Enter the proposed start date first.');
    if (!d.files.length && d.inputs.notes.trim().length < 40) {
      throw new HttpError(400, 'Upload the drawings and BOQ, or describe the work in the notes, so the AI has something to plan from.');
    }
    const used = db.prepare("SELECT COUNT(*) n FROM programme_generations WHERE company_id = ? AND created_at > datetime('now', '-1 day')").get(req.company.id).n;
    const limit = dailyLimit(req);
    if (used >= limit && !isPlatformAdmin(req.user)) throw new HttpError(429, `Your company has used today's ${limit} programme generations. Please try again tomorrow.`);

    db.prepare('INSERT INTO programme_generations (company_id, project_id) VALUES (?, ?)').run(req.company.id, p.id);
    saveDraft(p.id, { status: 'generating', error: null });
    res.json(view(req, p, loadDraft(p.id)));

    // Runs in the background; the page polls for the result.
    const who = req.user.name;
    (async () => {
      try {
        const cal = makeCalendar(d.inputs);
        const docs = await documentBlocks(d.files);
        const out = await generateProgrammePlan({ brief: briefText({ project: p, inputs: d.inputs, cal, files: d.files }), docs });
        const plan = planFromAI(out);
        if (!plan.tasks.length) throw new Error('The AI did not return any tasks. Add more detail to the notes or documents and try again.');
        saveDraft(p.id, { status: 'ready', plan, error: null, generated_at: new Date().toISOString(), generated_by: who });
      } catch (e) {
        console.error('Programme generation failed:', e);
        saveDraft(p.id, { status: 'failed', error: describeAIError(e) });
      }
    })();
  })
);

programmeGenRouter.put(`${base}/plan`, (req, res) => {
  const p = companyProject(req, req.params.id);
  premium(req);
  const d = ensureDraft(p);
  if (d.status === 'generating') throw new HttpError(409, 'Please wait for the current generation to finish.');
  const b = req.body || {};
  const plan = {
    title: String(b.title ?? d.plan?.title ?? p.name).trim().slice(0, 200) || p.name,
    scope_summary: d.plan?.scope_summary || null,
    assumptions: d.plan?.assumptions || [],
    tasks: cleanTasks(b.tasks ?? d.plan?.tasks ?? []),
  };
  saveDraft(p.id, { plan, status: d.status === 'draft' || d.status === 'failed' ? 'ready' : d.status });
  res.json(view(req, p, loadDraft(p.id)));
});

function scheduledOrThrow(req) {
  const p = companyProject(req, req.params.id);
  premium(req);
  const d = loadDraft(p.id);
  if (!d?.plan?.tasks?.length || !d.inputs.start_date) throw new HttpError(404, 'Generate the programme first.');
  return { p, d, schedule: schedulePlan(d.plan, d.inputs) };
}

const fileSafe = (s) => String(s || 'programme').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'programme';

programmeGenRouter.get(`${base}/xml`, (req, res) => {
  const { p, d, schedule } = scheduledOrThrow(req);
  const xml = renderMsProjectXml({ project: p, schedule, inputs: d.inputs, company: req.company.name });
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${fileSafe(p.name)}_Work_Programme.xml"`);
  res.send(xml);
});

programmeGenRouter.get(`${base}/pdf`, (req, res) => {
  const { p, d, schedule } = scheduledOrThrow(req);
  const c = req.company;
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${fileSafe(p.name)}_Work_Programme.pdf"`);
  renderProgrammePdf(
    {
      project: p,
      schedule,
      inputs: d.inputs,
      branding: { name: c.name, color: c.primary_color, logoPath: c.logo_filename ? path.join(UPLOAD_DIR, c.logo_filename) : null },
    },
    res
  );
});
