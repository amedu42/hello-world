// Parses an uploaded work programme (Excel, CSV, MS Project XML, PDF or text) into a list of activities.
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import path from 'node:path';
import { aiEnabled, extractActivitiesWithAI } from './ai.js';

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

const iso = (d) => (d && !isNaN(d) ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10) : null);

export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    return null;
  }
  let s = String(v).trim().replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '').replace(/\s+\d{1,2}:\d{2}.*$/, '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(new Date(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    // Day-first by default (UK/Commonwealth programmes); switch if impossible
    let day = a, mon = b;
    if (b > 12 && a <= 12) { day = b; mon = a; }
    return iso(new Date(y, mon - 1, day));
  }
  m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[a-z]*[\s\-,]+(\d{2,4})$/);
  if (m && MONTHS[m[2].toLowerCase()] != null) {
    let y = +m[3]; if (y < 100) y += 2000;
    return iso(new Date(y, MONTHS[m[2].toLowerCase()], +m[1]));
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m && MONTHS[m[1].toLowerCase()] != null) {
    let y = +m[3]; if (y < 100) y += 2000;
    return iso(new Date(y, MONTHS[m[1].toLowerCase()], +m[2]));
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function parseDuration(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  const m = String(v).trim().match(/^([\d.]+)\s*(d|day|days|w|wk|wks|week|weeks|mo|mon|month|months|h|hr|hrs|hours?)?\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'd').toLowerCase();
  if (unit.startsWith('w')) return n * 5;
  if (unit.startsWith('mo')) return n * 20;
  if (unit.startsWith('h')) return n / 8;
  return n;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 86400000 + 1;
  return d > 0 ? d : null;
}

const HEADER_PATTERNS = {
  name: /^(task|activity|activities|task name|activity name|description|activity description|work item|item|name|scope|operation)$/i,
  code: /^(id|activity id|task id|code|activity code|ref|ref\.?|no\.?|item no|wbs|s\/n|sn)$/i,
  section: /^(section|phase|stage|area|zone|trade|package|group|wbs name|element)$/i,
  start: /^(start|start date|planned start|baseline start|early start|begin|from)$/i,
  end: /^(finish|finish date|end|end date|planned finish|baseline finish|early finish|completion|to)$/i,
  duration: /^(duration|dur|original duration|planned duration|days|duration \(days\)|duration\(days\))$/i,
  weight: /^(weight|weighting|weightage|% weight|value|amount|cost|budget|planned value)$/i,
  summary: /^(summary|is summary|outline level|level)$/i,
};

function detectHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const map = {};
    rows[i].forEach((cell, idx) => {
      const c = String(cell ?? '').trim().replace(/\s+/g, ' ');
      for (const [key, re] of Object.entries(HEADER_PATTERNS)) {
        if (map[key] == null && re.test(c)) map[key] = idx;
      }
    });
    if (map.name != null && (map.start != null || map.duration != null || map.end != null || map.code != null)) {
      return { index: i, map };
    }
  }
  return null;
}

function rowsToActivities(rows) {
  const header = detectHeader(rows);
  if (!header) return null;
  const { map } = header;
  const out = [];
  let currentSection = null;
  for (const r of rows.slice(header.index + 1)) {
    const name = String(r[map.name] ?? '').trim();
    if (!name) continue;
    const start = parseDate(r[map.start]);
    const end = parseDate(r[map.end]);
    const duration = parseDuration(r[map.duration]);
    const weightRaw = map.weight != null ? parseFloat(String(r[map.weight] ?? '').replace(/[^\d.]/g, '')) : NaN;
    const summaryCell = map.summary != null ? String(r[map.summary] ?? '').trim().toLowerCase() : '';
    const isSummary = ['yes', 'true', 'y'].includes(summaryCell);
    // A row with a name but no dates/duration is treated as a section heading.
    if (isSummary || (!start && !end && !duration && isNaN(weightRaw))) {
      currentSection = name;
      continue;
    }
    const weight = !isNaN(weightRaw) && weightRaw > 0 ? weightRaw : duration || daysBetween(start, end) || 1;
    out.push({
      code: map.code != null ? String(r[map.code] ?? '').trim() || null : null,
      name,
      section: map.section != null ? String(r[map.section] ?? '').trim() || currentSection : currentSection,
      start_date: start,
      end_date: end,
      weight,
    });
  }
  return out;
}

async function readXlsx(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        let v = cell.value;
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          v = v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : '');
        }
        vals[col - 1] = v;
      });
      rows.push(vals);
    });
    sheets.push(rows);
  });
  return sheets;
}

function readMsProjectXml(text) {
  const tasks = [...text.matchAll(/<Task>([\s\S]*?)<\/Task>/g)].map((m) => m[1]);
  if (!tasks.length) return null;
  const tag = (blk, t) => (blk.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1];
  const out = [];
  const sectionsByLevel = {};
  for (const t of tasks) {
    const name = tag(t, 'Name');
    if (!name) continue;
    const level = parseInt(tag(t, 'OutlineLevel') || '1', 10);
    if (tag(t, 'Summary') === '1') {
      sectionsByLevel[level] = name;
      continue;
    }
    const start = parseDate(tag(t, 'Start'));
    const end = parseDate(tag(t, 'Finish'));
    const durM = (tag(t, 'Duration') || '').match(/PT(\d+)H/);
    const duration = durM ? +durM[1] / 8 : null;
    out.push({
      code: tag(t, 'WBS') || tag(t, 'ID') || null,
      name: name.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
      section: sectionsByLevel[level - 1] || null,
      start_date: start,
      end_date: end,
      weight: duration || daysBetween(start, end) || 1,
    });
  }
  return out;
}

/**
 * Returns { activities, method, warnings } where method describes how the programme was read.
 */
export async function parseProgramme(filePath, originalName, mimeType) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const warnings = [];
  let rowsSets = null;
  let rawText = null;

  if (ext === '.xlsx' || ext === '.xlsm') {
    rowsSets = await readXlsx(filePath);
  } else if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    const fs = await import('node:fs');
    rawText = fs.readFileSync(filePath, 'utf8');
    const parsed = Papa.parse(rawText.trim(), { skipEmptyLines: true });
    rowsSets = [parsed.data];
  } else if (ext === '.xml') {
    const fs = await import('node:fs');
    rawText = fs.readFileSync(filePath, 'utf8');
    const acts = readMsProjectXml(rawText);
    if (acts?.length) return { activities: acts, method: 'MS Project XML', warnings };
  } else if (ext === '.pdf' || mimeType === 'application/pdf') {
    if (!aiEnabled()) {
      throw new Error('Reading PDF programmes requires AI to be configured (set ANTHROPIC_API_KEY). Upload an Excel/CSV export instead.');
    }
    const acts = await extractActivitiesWithAI({ pdfPath: filePath });
    return { activities: acts, method: 'AI (PDF)', warnings };
  } else if (ext === '.xls' || ext === '.mpp') {
    throw new Error(`${ext} files are not supported. Please export the programme to .xlsx, .csv or MS Project XML (.xml).`);
  }

  if (rowsSets) {
    for (const rows of rowsSets) {
      const acts = rowsToActivities(rows);
      if (acts?.length) return { activities: acts, method: ext === '.xlsx' || ext === '.xlsm' ? 'Excel columns' : 'CSV columns', warnings };
    }
  }

  // Couldn't recognise the columns: fall back to AI extraction over a text rendering.
  if (aiEnabled()) {
    const text =
      rawText ??
      (rowsSets || [])
        .map((rows) => rows.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c ?? '')).join(' | ')).join('\n'))
        .join('\n\n');
    if (text.trim()) {
      const acts = await extractActivitiesWithAI({ text });
      warnings.push('Column headings were not recognised, so the activities were extracted by AI. Please review them.');
      return { activities: acts, method: 'AI (text)', warnings };
    }
  }
  throw new Error(
    'Could not find an activity list in this file. Make sure it has a header row with columns such as "Activity", "Start", "Finish" and "Duration".'
  );
}
