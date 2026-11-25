// Attendance register PDFs: one day (portrait) and a period sheet (landscape, names × dates).
import PDFDocument from 'pdfkit';
import { db } from './db.js';
import { drawBrandHeader, drawFooters, fmtDate, reportPalette } from './pdf.js';

const REASONS = { sick: 'Sick', leave: 'On leave', no_show: 'No-show', suspended: 'Suspended', training: 'Training / off site', other: 'Other' };
const shortDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function statusColors(C) {
  return {
    present: { text: C.good, fill: null, label: 'Present', code: 'P' },
    late: { text: '#8a5a00', fill: '#fdf0c8', label: 'Late', code: 'L' },
    absent: { text: C.bad, fill: '#fbe3e1', label: 'Absent', code: 'A' },
  };
}

// ------------------------------------------------------------------ data

export function dayRegisterData(projectId, date) {
  const day = db.prepare('SELECT * FROM attendance_days WHERE project_id = ? AND date = ?').get(projectId, date);
  if (!day) return null;
  const rows = db
    .prepare(
      `SELECT w.id, w.name, w.trade, w.employer, w.active, e.status, e.time_in, e.absence_reason, e.note
       FROM workers w LEFT JOIN attendance_entries e ON e.worker_id = w.id AND e.day_id = ?
       WHERE w.project_id = ? AND (w.active = 1 OR e.id IS NOT NULL)
       ORDER BY lower(COALESCE(w.trade, 'zzz')), lower(w.name)`
    )
    .all(day.id, projectId)
    .map((r) => ({ ...r }));
  return { day: { ...day }, rows };
}

export function periodRegisterData(projectId, from, to) {
  const days = db
    .prepare('SELECT id, date, taken_by FROM attendance_days WHERE project_id = ? AND date BETWEEN ? AND ? ORDER BY date')
    .all(projectId, from, to)
    .map((d) => ({ ...d }));
  const entries = days.length
    ? db
        .prepare(
          `SELECT e.*, d.date FROM attendance_entries e JOIN attendance_days d ON d.id = e.day_id
           WHERE d.project_id = ? AND d.date BETWEEN ? AND ?`
        )
        .all(projectId, from, to)
    : [];
  const workerIds = new Set(entries.map((e) => e.worker_id));
  const workers = db
    .prepare(`SELECT * FROM workers WHERE project_id = ? ORDER BY lower(COALESCE(trade, 'zzz')), lower(name)`)
    .all(projectId)
    .filter((w) => w.active || workerIds.has(w.id))
    .map((w) => ({ ...w }));
  const grid = new Map(); // `${worker}|${date}` -> entry
  for (const e of entries) grid.set(`${e.worker_id}|${e.date}`, e);
  return { days, workers, grid, entries };
}

// ------------------------------------------------------------------ shared drawing helpers

export function makeDoc({ layout = 'portrait', title, branding }) {
  return new PDFDocument({ size: 'A4', layout, margin: 40, bufferPages: true, info: { Title: title, Author: branding?.name || '' } });
}

export function summaryBoxes(doc, C, y, boxes) {
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const gap = 10;
  const bw = (W - gap * (boxes.length - 1)) / boxes.length;
  boxes.forEach((b, i) => {
    const x = L + i * (bw + gap);
    doc.roundedRect(x, y, bw, 52, 6).fill(C.soft);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.muted).text(b.label.toUpperCase(), x + 10, y + 9, { width: bw - 20 });
    doc.font('Helvetica-Bold').fontSize(20).fillColor(b.color || C.big).text(String(b.value), x + 10, y + 22, { width: bw - 20 });
  });
  return y + 52;
}

export function sectionTitle(doc, C, text) {
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  // Keep a heading with at least its first rows: start a new page if fewer than ~80pt remain.
  if (doc.y + 80 > doc.page.height - doc.page.margins.bottom - 20) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  } else doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.heading).text(text.toUpperCase(), L, doc.y, { width: W });
  doc.rect(L, doc.y + 1.5, W, 1.2).fill(C.rule);
  doc.y += 8;
}

/** Simple paginating table. cols: [{label, w (fraction), align, color(row), fill(row)}]; rows: arrays or {group}. */
export function table(doc, C, cols, rows, { fontSize = 9, pad = 4 } = {}) {
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
  const head = () => {
    const y = doc.y;
    doc.rect(L, y, W, 18).fill(C.soft);
    let x = L;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.heading);
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x + pad, y + 5.5, { width: c.w * W - pad * 2, align: c.align || 'left', lineBreak: false });
      x += c.w * W;
    }
    doc.y = y + 18;
  };
  if (doc.y + 40 > bottom()) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  }
  head();
  for (const r of rows) {
    if (r.group) {
      if (doc.y + 34 > bottom()) {
        doc.addPage();
        doc.y = doc.page.margins.top;
        head();
      }
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(r.group, L + pad, y + 5, { width: W - pad * 2 });
      doc.moveTo(L, y + 18).lineTo(L + W, y + 18).lineWidth(0.6).strokeColor(C.line).stroke();
      doc.y = y + 18;
      continue;
    }
    doc.font('Helvetica').fontSize(fontSize);
    const h = Math.max(...cols.map((c, i) => doc.heightOfString(String(r[i] ?? ''), { width: c.w * W - pad * 2 }))) + pad * 2;
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      head();
    }
    const y = doc.y;
    let x = L;
    cols.forEach((c, i) => {
      const fill = c.fill?.(r);
      if (fill) doc.rect(x, y, c.w * W, h).fill(fill);
      doc.font(c.bold?.(r) ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(c.color?.(r) || C.ink);
      doc.text(String(r[i] ?? ''), x + pad, y + pad, { width: c.w * W - pad * 2, align: c.align || 'left' });
      x += c.w * W;
    });
    doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor(C.line).stroke();
    doc.y = y + h;
  }
  doc.y += 6;
}

export function signOff(doc, C, leftLabel, rightLabel) {
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  if (doc.y + 70 > doc.page.height - doc.page.margins.bottom - 20) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  }
  const sy = doc.y + 34;
  doc.moveTo(L, sy).lineTo(L + W * 0.42, sy).lineWidth(0.7).strokeColor(C.ink).stroke();
  doc.moveTo(L + W * 0.58, sy).lineTo(L + W, sy).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(C.muted);
  doc.text(leftLabel, L, sy + 4, { width: W * 0.42 });
  doc.text(rightLabel, L + W * 0.58, sy + 4, { width: W * 0.42 });
  doc.y = sy + 20;
}

// ------------------------------------------------------------------ one day

export function renderDayRegisterPdf({ project, data, branding = {} }, stream) {
  const C = reportPalette(branding.color);
  const S = statusColors(C);
  const { day, rows } = data;
  const doc = makeDoc({ title: `${project.name} – Attendance register ${day.date}`, branding });
  doc.pipe(stream);
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;

  const band = drawBrandHeader(doc, {
    C,
    branding,
    title: 'ATTENDANCE REGISTER',
    lines: [project.name + (project.code ? `  ·  ${project.code}` : ''), fmtDate(day.date)],
    right: day.taken_by ? `Taken by ${day.taken_by}` : '',
  });

  const n = (s) => rows.filter((r) => r.status === s).length;
  const unmarked = rows.filter((r) => !r.status).length;
  const onSite = n('present') + n('late');
  const marked = rows.length - unmarked;
  doc.y = summaryBoxes(doc, C, band + 18, [
    { label: 'Present', value: n('present'), color: S.present.text },
    { label: 'Late', value: n('late'), color: S.late.text },
    { label: 'Absent', value: n('absent'), color: S.absent.text },
    { label: 'On site', value: `${onSite} / ${marked}` },
  ]);
  doc.y += 6;
  if (unmarked) {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(C.muted).text(`${unmarked} worker${unmarked > 1 ? 's were' : ' was'} not marked on this register.`, L, doc.y + 4, { width: W });
  }

  sectionTitle(doc, C, 'Register');
  const tableRows = [];
  let group = null;
  let i = 0;
  for (const r of rows) {
    const g = r.trade || 'General';
    if (g !== group) {
      group = g;
      tableRows.push({ group: `${g} (${rows.filter((x) => (x.trade || 'General') === g).length})` });
    }
    i++;
    const st = S[r.status];
    const detail = r.status === 'absent' ? [REASONS[r.absence_reason] || 'No reason given', r.note].filter(Boolean).join(' – ') : r.note || '';
    const row = [i, r.name + (r.active ? '' : ' (left)'), r.employer || '', st ? st.label : 'Not marked', r.status === 'late' ? r.time_in || '' : '', detail];
    row.status = r.status;
    tableRows.push(row);
  }
  table(doc, C, [
    { label: 'No.', w: 0.06, align: 'right' },
    { label: 'Name', w: 0.27 },
    { label: 'Employer', w: 0.2 },
    { label: 'Status', w: 0.12, color: (r) => (S[r.status] ? S[r.status].text : C.muted), bold: (r) => Boolean(r.status), fill: (r) => S[r.status]?.fill },
    { label: 'Arrived', w: 0.09 },
    { label: 'Reason / note', w: 0.26 },
  ], tableRows);

  const absent = rows.filter((r) => r.status === 'absent');
  sectionTitle(doc, C, `Absentees (${absent.length})`);
  if (absent.length) {
    table(doc, C, [
      { label: 'Name', w: 0.28 },
      { label: 'Trade', w: 0.18 },
      { label: 'Employer', w: 0.18 },
      { label: 'Reason', w: 0.16, color: () => S.absent.text, bold: () => true },
      { label: 'Note', w: 0.2 },
    ], absent.map((r) => [r.name, r.trade || 'General', r.employer || '', REASONS[r.absence_reason] || 'Not given', r.note || '']));
  } else {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.muted).text('No absentees.', L, doc.y, { width: W });
  }

  if (day.notes) {
    sectionTitle(doc, C, 'Notes');
    doc.font('Helvetica').fontSize(9.5).fillColor(C.ink).text(day.notes, L, doc.y, { width: W });
  }

  signOff(doc, C, `Taken by: ${day.taken_by || ''}`, 'Checked by (Site manager)');
  drawFooters(doc, C, [branding.name, project.name, `Attendance register ${day.date}`], branding);
  doc.end();
}

// ------------------------------------------------------------------ period sheet

export function renderPeriodRegisterPdf({ project, from, to, data, branding = {} }, stream) {
  const C = reportPalette(branding.color);
  const S = statusColors(C);
  const { days, workers, grid, entries } = data;
  const doc = makeDoc({ layout: 'landscape', title: `${project.name} – Attendance ${from} to ${to}`, branding });
  doc.pipe(stream);
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  const band = drawBrandHeader(doc, {
    C,
    branding,
    title: 'ATTENDANCE REGISTER',
    lines: [project.name + (project.code ? `  ·  ${project.code}` : ''), `${fmtDate(from)} – ${fmtDate(to)}`],
    right: `${days.length} register${days.length === 1 ? '' : 's'} taken`,
  });

  const count = (s) => entries.filter((e) => e.status === s).length;
  const totalMarks = entries.length;
  const rate = totalMarks ? Math.round(((count('present') + count('late')) / totalMarks) * 1000) / 10 : 0;
  doc.y = summaryBoxes(doc, C, band + 18, [
    { label: 'Workers', value: workers.length },
    { label: 'Registers taken', value: days.length },
    { label: 'Attendance', value: `${rate}%` },
    { label: 'Late arrivals', value: count('late'), color: S.late.text },
    { label: 'Absences', value: count('absent'), color: S.absent.text },
  ]);

  // Every calendar day in the range is a column; days without a register are shaded.
  const dates = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) dates.push(new Date(t).toISOString().slice(0, 10));
  const taken = new Set(days.map((d) => d.date));

  const NO = 20, NAME = 128, TRADE = 78, TOT = 24;
  const dayW = (W - NO - NAME - TRADE - TOT * 4) / dates.length;
  const ROW = 15;
  const HEAD = 26;
  const xDay = (i) => L + NO + NAME + TRADE + i * dayW;
  const xTot = (k) => L + NO + NAME + TRADE + dates.length * dayW + k * TOT;

  const header = () => {
    const y = doc.y;
    doc.rect(L, y, W, HEAD).fill(C.soft);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.heading);
    doc.text('NO.', L, y + 9, { width: NO - 3, align: 'right' });
    doc.text('NAME', L + NO + 4, y + 9, { width: NAME - 8 });
    doc.text('TRADE', L + NO + NAME + 2, y + 9, { width: TRADE - 4 });
    dates.forEach((d, i) => {
      const dt = new Date(d + 'T00:00:00Z');
      const wd = 'SMTWTFS'[dt.getUTCDay()];
      if (!taken.has(d)) doc.rect(xDay(i), y, dayW, HEAD).fill('#e9ecf0');
      doc.fillColor(C.heading).font('Helvetica-Bold').fontSize(6.5).text(String(dt.getUTCDate()), xDay(i), y + 5, { width: dayW, align: 'center' });
      doc.font('Helvetica').fontSize(6).fillColor(C.muted).text(wd, xDay(i), y + 15, { width: dayW, align: 'center' });
    });
    [['P', S.present.text], ['L', S.late.text], ['A', S.absent.text], ['%', C.heading]].forEach(([t, col], k) => {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(col).text(t, xTot(k), y + 9, { width: TOT, align: 'center' });
    });
    doc.y = y + HEAD;
  };

  sectionTitle(doc, C, 'Attendance sheet');
  if (!workers.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.muted).text('No workers on this project.', L, doc.y);
  } else {
    header();
    workers.forEach((w, idx) => {
      if (doc.y + ROW > bottom() - 30) {
        doc.addPage();
        doc.y = doc.page.margins.top;
        header();
      }
      const y = doc.y;
      if (idx % 2 === 1) doc.rect(L, y, W, ROW).fill('#fafbfc');
      doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(String(idx + 1), L, y + 4, { width: NO - 3, align: 'right' });
      doc.fillColor(C.ink).text(w.name + (w.active ? '' : ' (left)'), L + NO + 4, y + 4, { width: NAME - 8, lineBreak: false, ellipsis: true });
      doc.fillColor(C.muted).text(w.trade || '', L + NO + NAME + 2, y + 4, { width: TRADE - 4, lineBreak: false, ellipsis: true });
      const tally = { present: 0, late: 0, absent: 0 };
      dates.forEach((d, i) => {
        const x = xDay(i);
        if (!taken.has(d)) {
          doc.rect(x, y, dayW, ROW).fill('#e9ecf0');
          return;
        }
        const e = grid.get(`${w.id}|${d}`);
        if (!e) {
          doc.font('Helvetica').fontSize(7).fillColor('#b8c0cc').text('·', x, y + 4, { width: dayW, align: 'center' });
          return;
        }
        tally[e.status]++;
        const st = S[e.status];
        if (st.fill) doc.rect(x + 0.5, y + 0.5, dayW - 1, ROW - 1).fill(st.fill);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(st.text).text(st.code, x, y + 4, { width: dayW, align: 'center' });
      });
      const marks = tally.present + tally.late + tally.absent;
      const pct = marks ? Math.round(((tally.present + tally.late) / marks) * 100) + '%' : '–';
      [[tally.present, S.present.text], [tally.late, S.late.text], [tally.absent, S.absent.text], [pct, C.ink]].forEach(([v, col], k) => {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(col).text(String(v), xTot(k), y + 4, { width: TOT, align: 'center' });
      });
      doc.moveTo(L, y + ROW).lineTo(L + W, y + ROW).lineWidth(0.3).strokeColor(C.line).stroke();
      doc.y = y + ROW;
    });

    // Daily on-site totals
    const y = doc.y;
    doc.rect(L, y, W, ROW + 2).fill(C.soft);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.heading).text('ON SITE', L + NO + 4, y + 5, { width: NAME + TRADE - 8 });
    dates.forEach((d, i) => {
      if (!taken.has(d)) return;
      const onSite = workers.filter((w) => ['present', 'late'].includes(grid.get(`${w.id}|${d}`)?.status)).length;
      doc.font('Helvetica-Bold').fontSize(7).fillColor(C.ink).text(String(onSite), xDay(i), y + 5, { width: dayW, align: 'center' });
    });
    doc.y = y + ROW + 8;

    // Vertical grid lines for day columns (drawn per page area is overkill; legend explains the shading)
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(
      'P = present   L = late   A = absent   · = not marked   shaded column = no register taken that day   % = attendance on registers taken',
      L, doc.y, { width: W }
    );
  }

  // Absence details
  const absences = entries
    .filter((e) => e.status === 'absent')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => {
      const w = workers.find((x) => x.id === e.worker_id);
      return [shortDate(e.date), w?.name || '', w?.trade || 'General', REASONS[e.absence_reason] || 'Not given', e.note || ''];
    });
  sectionTitle(doc, C, `Absences (${absences.length})`);
  if (absences.length) {
    table(doc, C, [
      { label: 'Date', w: 0.13 },
      { label: 'Name', w: 0.25 },
      { label: 'Trade', w: 0.15 },
      { label: 'Reason', w: 0.15, color: () => S.absent.text, bold: () => true },
      { label: 'Note', w: 0.32 },
    ], absences, { fontSize: 8.5 });
  } else {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.muted).text('No absences in this period.', L, doc.y, { width: W });
  }

  signOff(doc, C, 'Prepared by', 'Approved by (Project manager)');
  drawFooters(doc, C, [branding.name, project.name, `Attendance ${from} to ${to}`], branding);
  doc.end();
}
