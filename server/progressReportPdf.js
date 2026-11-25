// PDF for weekly / monthly / status / milestone reports (A4 portrait, company branding).
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './db.js';
import { drawBrandHeader, drawFooters, reportPalette } from './pdf.js';
import { makeDoc, sectionTitle, signOff, summaryBoxes, table } from './attendancePdf.js';

const fmt = (iso) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–');
const fmtShort = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
const pct = (n) => (n == null ? '–' : `${n}%`);
const signed = (n, unit = '') => (n == null ? '–' : `${n > 0 ? '+' : ''}${n}${unit}`);
const qty = (n) => (n == null ? '–' : (Math.round(n * 100) / 100).toLocaleString('en-GB'));

/** Order of blocks per report type. Text blocks are narrative sections; the rest are figures. */
export const LAYOUT = {
  weekly: ['summary', 'curve', 'work_done', 'completed', 'progressed', 'schedule', 'sections', 'behind', 'look_ahead', 'upcoming', 'challenges', 'issues', 'resources', 'photos'],
  status: ['summary', 'curve', 'sections', 'schedule', 'behind', 'remaining', 'milestones', 'risks', 'issues', 'photos'],
  milestone: ['summary', 'milestones', 'commentary', 'outlook', 'photos'],
};
LAYOUT.monthly = LAYOUT.weekly;

export const BLOCK_NAMES = {
  curve: 'Progress curve',
  completed: 'Activities completed',
  progressed: 'Activities progressed',
  sections: 'Progress by phase',
  behind: 'Activities behind programme',
  upcoming: 'Look-ahead activities',
  issues: 'Site issues',
  resources: 'Resources and site conditions',
  milestones: 'Milestones',
  photos: 'Photos',
};

export function kpis(report) {
  const d = report.data;
  const o = d.overall;
  const sv = o.schedule_variance_days;
  const svBox = { label: 'Schedule', value: sv == null ? '–' : sv === 0 ? 'On time' : `${Math.abs(sv)}d ${sv > 0 ? 'behind' : 'ahead'}`, tone: sv > 0 ? 'bad' : sv < 0 ? 'good' : null };
  if (report.type === 'milestone') {
    const ms = report.content.milestones || [];
    const done = ms.filter((m) => m.actual).length;
    const late = ms.filter((m) => /late|overdue|risk/i.test(m.status || '')).length;
    return [
      { label: 'Milestones', value: ms.length },
      { label: 'Completed', value: done },
      { label: 'Late / at risk', value: late, tone: late ? 'bad' : null },
      { label: 'Overall progress', value: pct(o.actual) },
    ];
  }
  if (report.type === 'status') {
    return [
      { label: 'Actual progress', value: pct(o.actual) },
      { label: 'Planned', value: pct(o.planned) },
      svBox,
      { label: 'Forecast finish', value: o.forecast_finish ? fmtShort(o.forecast_finish) : '–' },
    ];
  }
  return [
    { label: 'Overall progress', value: pct(o.actual) },
    { label: `This ${report.type === 'weekly' ? 'week' : 'month'}`, value: signed(o.change, '%'), tone: o.change > 0 ? 'good' : null },
    { label: 'Planned', value: pct(o.planned) },
    svBox,
  ];
}

export function renderProgressReportPdf({ project, report, branding = {} }, stream) {
  const C = reportPalette(branding.color);
  const d = report.data;
  const draft = report.status !== 'published';
  const doc = makeDoc({ title: `${project.name} – ${report.type_name} ${report.code}`, branding });
  doc.pipe(stream);
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
  const ensure = (h) => {
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  };

  const period = d.from ? `${fmt(d.from)} – ${fmt(d.to)}` : `As of ${fmt(d.as_of)}`;
  const bandH = drawBrandHeader(doc, {
    C,
    branding,
    title: report.type_name,
    lines: [project.name + (project.code ? ` (${project.code})` : ''), period],
    right: `${report.code}${draft ? ' · DRAFT' : ''}`,
  });
  doc.y = bandH + 16;

  // Report details
  const details = [
    ['Report', report.title],
    ['Prepared for', report.content.prepared_for],
    ['Prepared by', report.content.prepared_by],
    ['Issued', report.published_at ? fmt(report.published_at.slice(0, 10)) : 'Draft – not yet issued'],
    d.project.location && ['Location', d.project.location],
    d.project.start && ['Contract period', `${fmt(d.project.start)} – ${fmt(d.project.finish)}`],
  ].filter((x) => x && x[1]);
  const colW = W / 2;
  const detailsTop = doc.y;
  details.forEach(([k, v], i) => {
    const x = L + (i % 2) * colW;
    const y = detailsTop + Math.floor(i / 2) * 15;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.muted).text(`${k}:`, x, y, { width: 80, lineBreak: false });
    doc.font('Helvetica').fillColor(C.ink).text(String(v), x + 82, y, { width: colW - 90, lineBreak: false, ellipsis: true });
  });
  doc.y = detailsTop + Math.ceil(details.length / 2) * 15 + 10;

  const boxes = kpis(report).map((b) => ({ ...b, color: b.tone === 'bad' ? C.bad : b.tone === 'good' ? C.good : undefined }));
  doc.y = summaryBoxes(doc, C, doc.y, boxes) + 6;


  // ---------------------------------------------------------------- blocks

  function narrative(title, text) {
    sectionTitle(doc, C, title);
    const paras = text.replace(/\r/g, '').split(/\n{2,}/);
    for (const para of paras) {
      const lines = para.split('\n');
      for (const line of lines) {
        const bullet = /^\s*[-•*]\s+/.test(line);
        const t = line.replace(/^\s*[-•*]\s+/, '').trim();
        if (!t) continue;
        doc.font('Helvetica').fontSize(9.5).fillColor(C.ink);
        const h = doc.heightOfString(t, { width: W - (bullet ? 14 : 0) });
        ensure(Math.min(h, 40) + 4);
        if (bullet) {
          doc.circle(L + 4, doc.y + 4.6, 1.6).fill(C.heading);
          doc.font('Helvetica').fontSize(9.5).fillColor(C.ink).text(t, L + 14, doc.y, { width: W - 14, lineGap: 1.5 });
        } else {
          doc.text(t, L, doc.y, { width: W, lineGap: 1.5 });
        }
        doc.y += 2;
      }
      doc.y += 5;
    }
  }

  function note(text) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.muted).text(text, L, doc.y, { width: W });
    doc.y += 6;
  }

  const tone = (r) => (r.status === 'Behind' || r.status === 'Late start' ? C.bad : r.status === 'Slipping' ? C.warn : r.status === 'Complete' ? C.good : C.ink);

  const BLOCKS = {
    curve() {
      const c = d.curve;
      if (!c || (!c.actual.length && !c.planned.length)) return;
      sectionTitle(doc, C, 'Progress curve: planned vs actual');
      drawCurve(c);
    },
    completed() {
      sectionTitle(doc, C, `Activities completed (${d.completed.length})`);
      if (!d.completed.length) return note('No activities were completed in this period.');
      table(doc, C, [{ label: 'Activity', w: 0.5 }, { label: 'Phase', w: 0.28 }, { label: 'Completed', w: 0.22 }], d.completed.map((r) => [r.name, r.section || '', fmt(r.completed_on)]));
    },
    progressed() {
      if (!d.progressed.length) return;
      sectionTitle(doc, C, `Activities progressed (${d.progressed.length})`);
      table(
        doc,
        C,
        [
          { label: 'Activity', w: 0.4 },
          { label: 'Before', w: 0.13, align: 'right' },
          { label: 'Now', w: 0.13, align: 'right' },
          { label: 'Planned', w: 0.11, align: 'right' },
          { label: 'Status', w: 0.23, color: (r) => tone(r.raw) },
        ],
        d.progressed.map((r) => Object.assign([r.name, pct(r.before), pct(r.actual), pct(r.planned), r.status], { raw: r }))
      );
    },
    sections() {
      if (!d.sections?.length) return;
      sectionTitle(doc, C, 'Progress by phase');
      table(
        doc,
        C,
        [
          { label: 'Phase', w: 0.32 },
          { label: 'Share', w: 0.1, align: 'right' },
          { label: 'Actual', w: 0.11, align: 'right' },
          { label: 'Planned', w: 0.11, align: 'right' },
          { label: 'Variance', w: 0.12, align: 'right', color: (r) => (r.raw.planned != null && r.raw.actual - r.raw.planned < -5 ? C.bad : C.ink) },
          { label: 'Planned finish', w: 0.24 },
        ],
        d.sections.map((s) => Object.assign([s.name, pct(s.share), pct(s.actual), pct(s.planned), s.planned == null ? '–' : signed(Math.round((s.actual - s.planned) * 10) / 10, ' pts'), s.actual_finish ? `Done ${fmt(s.actual_finish)}` : fmt(s.planned_finish)], { raw: s }))
      );
    },
    behind() {
      sectionTitle(doc, C, 'Activities behind programme');
      if (!d.behind.length) return note('No activities are more than 10 points behind programme.');
      table(
        doc,
        C,
        [{ label: 'Activity', w: 0.42 }, { label: 'Actual', w: 0.12, align: 'right' }, { label: 'Planned', w: 0.12, align: 'right' }, { label: 'Variance', w: 0.12, align: 'right', color: () => C.bad }, { label: 'Planned finish', w: 0.22 }],
        d.behind.map((r) => [r.name, pct(r.actual), pct(r.planned), signed(r.variance, ' pts'), fmt(r.finish)])
      );
    },
    upcoming() {
      sectionTitle(doc, C, `Look-ahead: ${fmt(d.look_ahead.from)} – ${fmt(d.look_ahead.to)}`);
      if (!d.upcoming.length) return note('No programme activities are planned for this period.');
      table(
        doc,
        C,
        [{ label: 'Activity', w: 0.42 }, { label: 'Phase', w: 0.22 }, { label: 'Start', w: 0.13 }, { label: 'Finish', w: 0.13 }, { label: 'Now', w: 0.1, align: 'right' }],
        d.upcoming.map((r) => [r.name, r.section || '', fmt(r.start), fmt(r.finish), pct(r.actual)])
      );
    },
    issues() {
      const list = d.site?.issues || d.recent_issues || [];
      sectionTitle(doc, C, d.site ? 'Site issues this period' : 'Site issues (last 30 days)');
      if (!list.length) return note('No site issues were recorded.');
      table(
        doc,
        C,
        [{ label: 'Date', w: 0.13 }, { label: 'Category', w: 0.14 }, { label: 'Issue', w: 0.38 }, { label: 'Severity', w: 0.1, color: (r) => (r.raw.severity === 'High' ? C.bad : C.ink) }, { label: 'Action', w: 0.25 }],
        list.slice(0, 30).map((i) => Object.assign([fmt(i.date), i.category || '', i.description || '', i.severity || '', i.action || ''], { raw: i }))
      );
    },
    resources() {
      const s = d.site;
      if (!s) return;
      sectionTitle(doc, C, 'Resources and site conditions');
      const rows = [
        ['Daily reports filed', String(s.daily_reports)],
        ['Labour on site', s.daily_reports ? `Average ${s.labour.average} a day, peak ${s.labour.peak} (${s.labour.man_days} man-days)` : '–'],
        s.labour.by_trade.length && ['Main trades (average a day)', s.labour.by_trade.map((t) => `${t.trade} ${t.average}`).join(', ')],
        s.equipment.length && ['Equipment', s.equipment.join(', ')],
        ['Weather', s.weather.conditions.length ? s.weather.conditions.map((w) => `${w.condition} ${w.days}d`).join(', ') + (s.weather.hours_lost ? `; ${s.weather.hours_lost} hours lost` : '; no time lost') : 'Not recorded'],
        s.attendance && ['Attendance register', `${s.attendance.days} days taken, average ${s.attendance.average_present} present, ${s.attendance.absences} absences`],
        s.visitors.length && ['Visitors', s.visitors.map((v) => `${v.name}${v.organisation ? ` (${v.organisation})` : ''}`).join(', ')],
      ].filter(Boolean);
      table(doc, C, [{ label: 'Item', w: 0.28, bold: () => true }, { label: 'Details', w: 0.72 }], rows);
      if (s.materials.length) {
        ensure(60);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.heading).text('Materials', L, doc.y);
        doc.y += 4;
        table(
          doc,
          C,
          [{ label: 'Material', w: 0.34 }, { label: 'Unit', w: 0.1 }, { label: 'Received', w: 0.14, align: 'right' }, { label: 'Used', w: 0.14, align: 'right' }, { label: 'Wasted', w: 0.12, align: 'right' }, { label: 'In stock', w: 0.16, align: 'right', color: (r) => (r.raw.low ? C.bad : C.ink) }],
          s.materials.map((m) => Object.assign([m.name, m.unit, qty(m.delivered), qty(m.used), qty(m.wasted), qty(m.closing) + (m.low ? ' (low)' : '')], { raw: m }))
        );
      }
    },
    milestones() {
      const ms = report.content.milestones || [];
      sectionTitle(doc, C, 'Milestones: target vs actual');
      if (!ms.length) return note('No milestones. Upload a programme with phases, or add milestones to the report.');
      table(
        doc,
        C,
        [
          { label: 'Milestone', w: 0.3 },
          { label: 'Target', w: 0.13 },
          { label: 'Actual date', w: 0.15 },
          { label: 'Status', w: 0.19, color: (r) => (/late|overdue|risk/i.test(r.raw.status) ? C.bad : /on time|complete/i.test(r.raw.status) ? C.good : C.ink) },
          { label: 'Remarks', w: 0.23 },
        ],
        ms.map((m) => Object.assign([m.name, fmt(m.planned), m.actual ? fmt(m.actual) : m.forecast ? `${fmt(m.forecast)} (fc)` : m.progress != null ? `${m.progress}% done` : '–', m.status || '', m.remarks || ''], { raw: m }))
      );
    },
    photos() {
      const photos = (report.content.photos || []).filter((p) => /\.(jpe?g|png)$/i.test(p.filename) && fs.existsSync(path.join(UPLOAD_DIR, p.filename)));
      if (!photos.length) return;
      ensure(220); // keep the heading with the first row of photos
      sectionTitle(doc, C, 'Photos');
      const gap = 12;
      const cw = (W - gap) / 2;
      const ch = 150;
      for (let i = 0; i < photos.length; i += 2) {
        ensure(ch + 30);
        const y = doc.y;
        let rowH = 0;
        photos.slice(i, i + 2).forEach((p, j) => {
          const x = L + j * (cw + gap);
          try {
            const img = doc.openImage(path.join(UPLOAD_DIR, p.filename));
            const k = Math.min(cw / img.width, ch / img.height);
            const w = img.width * k, h = img.height * k;
            doc.rect(x, y, cw, ch).fill(C.soft);
            doc.image(img, x + (cw - w) / 2, y + (ch - h) / 2, { width: w, height: h });
          } catch {
            doc.rect(x, y, cw, ch).fill(C.soft);
          }
          doc.font('Helvetica').fontSize(8).fillColor(C.muted);
          const capH = p.caption ? doc.heightOfString(p.caption, { width: cw }) : 0;
          if (p.caption) doc.text(p.caption, x, y + ch + 4, { width: cw });
          rowH = Math.max(rowH, ch + 8 + capH);
        });
        doc.y = y + rowH + 8;
      }
    },
  };

  function drawCurve(c) {
    const H = 165;
    ensure(H + 40);
    const top = doc.y + 4;
    const left = L + 28;
    const w = W - 36;
    const pts = [...c.planned, ...c.actual].map((p) => p.date);
    const t0 = Date.parse(pts.sort()[0]);
    const t1 = Math.max(Date.parse(pts[pts.length - 1]), Date.parse(c.as_of));
    const span = Math.max(1, t1 - t0);
    const X = (iso) => left + ((Date.parse(iso) - t0) / span) * w;
    const Y = (v) => top + H - (Math.max(0, Math.min(100, v)) / 100) * H;
    doc.lineWidth(0.4).strokeColor(C.line);
    doc.font('Helvetica').fontSize(7).fillColor(C.muted);
    for (const v of [0, 25, 50, 75, 100]) {
      doc.moveTo(left, Y(v)).lineTo(left + w, Y(v)).stroke();
      doc.text(`${v}%`, L, Y(v) - 3, { width: 24, align: 'right' });
    }
    const line = (series, color, dash, width) => {
      if (series.length < 2) {
        if (series.length === 1) doc.circle(X(series[0].date), Y(series[0].pct), 2.2).fill(color);
        return;
      }
      doc.save();
      doc.lineWidth(width).strokeColor(color);
      if (dash) doc.dash(4, { space: 3 });
      series.forEach((p, i) => (i ? doc.lineTo(X(p.date), Y(p.pct)) : doc.moveTo(X(p.date), Y(p.pct))));
      doc.stroke();
      doc.restore();
    };
    line(c.planned.filter((p) => p.pct != null), '#8a94a3', true, 1.4);
    line(c.actual, C.fill, false, 2.2);
    // As-of marker
    const ax = X(c.as_of);
    doc.save().lineWidth(0.7).strokeColor(C.heading).dash(2, { space: 2 }).moveTo(ax, top).lineTo(ax, top + H).stroke().restore();
    doc.font('Helvetica').fontSize(7).fillColor(C.heading).text(`Report date ${fmt(c.as_of)}`, Math.min(ax + 3, left + w - 90), top + 2, { lineBreak: false });
    // x labels
    doc.fillColor(C.muted).fontSize(7);
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    for (const t of [t0, t0 + span / 2, t1]) doc.text(fmt(iso(t)), Math.max(L, Math.min(X(iso(t)) - 30, left + w - 60)), top + H + 4, { width: 60, align: 'center', lineBreak: false });
    // legend
    const ly = top + H + 18;
    doc.save().lineWidth(1.4).strokeColor('#8a94a3').dash(4, { space: 3 }).moveTo(left, ly + 3).lineTo(left + 22, ly + 3).stroke().restore();
    doc.fillColor(C.ink).fontSize(8).text('Planned', left + 27, ly, { lineBreak: false });
    doc.lineWidth(2.2).strokeColor(C.fill).moveTo(left + 80, ly + 3).lineTo(left + 102, ly + 3).stroke();
    doc.text('Actual (from daily reports)', left + 107, ly, { lineBreak: false });
    doc.y = ly + 18;
  }

  function watermark() {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const oldBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font('Helvetica-Bold').fontSize(120).fillColor('#9aa5b1').fillOpacity(0.12).text('DRAFT', 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center', lineBreak: false });
      doc.restore();
      doc.page.margins.bottom = oldBottom;
    }
  }

  // ---------------------------------------------------------------- body (after the helpers above are defined)
  const hidden = new Set(report.content.hidden || []);
  const sections = new Map((report.content.sections || []).map((s) => [s.key, s]));

  for (const block of LAYOUT[report.type]) {
    if (hidden.has(block)) continue;
    if (sections.has(block) || ['summary', 'work_done', 'schedule', 'look_ahead', 'challenges', 'remaining', 'risks', 'commentary', 'outlook'].includes(block)) {
      const s = sections.get(block);
      if (s?.text?.trim()) narrative(s.title, s.text);
      continue;
    }
    BLOCKS[block]?.();
  }

  // Sign-off
  sectionTitle(doc, C, 'Approval');
  signOff(doc, C, `Prepared by: ${report.content.prepared_by || ''}`, 'Reviewed / approved by (name, signature, date)');

  if (draft) watermark();
  drawFooters(doc, C, [branding.name, project.name, `${report.type_name} ${report.code}`]);
  doc.end();
}
