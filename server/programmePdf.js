// Work programme as a Gantt chart PDF (A3 landscape), laid out like an MS Project print:
// ID / Task Name / Duration / Start / Finish on the left, bars on a timescale on the right.
import PDFDocument from 'pdfkit';
import { drawBrandHeader, drawFooters, reportPalette } from './pdf.js';
import { fmtShort } from './programmeGen.js';

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const toMs = (iso) => Date.parse(iso + 'T00:00:00Z');
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

const COLORS = {
  task: '#6f9fd8',
  taskEdge: '#3b6fb0',
  critical: '#e06060',
  criticalEdge: '#b42318',
  summary: '#1c2430',
  projectSummary: '#7b8794',
  link: '#5b6675',
  nonWork: '#eef1f5',
  grid: '#e3e7ec',
};

const durLabel = (d) => `${d} day${d === 1 ? '' : 's'}`;

export function renderProgrammePdf({ project, schedule, inputs, branding = {} }, stream) {
  const C = reportPalette(branding.color);
  const doc = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 28, bufferPages: true, info: { Title: `${schedule.project.name} – Work Programme`, Author: branding.name || '' } });
  doc.pipe(stream);

  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const P = schedule.project;
  const work = new Set(inputs.working_days);
  const hol = new Set(inputs.holidays);

  // ---------------------------------------------------------------- columns
  const cols = [
    { key: 'id', label: 'ID', w: 30, align: 'right' },
    { key: 'name', label: 'Task Name', w: 262 },
    { key: 'dur', label: 'Duration', w: 50 },
    { key: 'start', label: 'Start', w: 66 },
    { key: 'finish', label: 'Finish', w: 66 },
  ];
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const GX = L + tableW; // gantt left edge
  const GW = W - tableW;

  // ---------------------------------------------------------------- timescale
  // Start on the Sunday/Monday before the start; leave room after the finish for bar labels.
  const s0 = toMs(P.start);
  const startMs = s0 - ((new Date(s0).getUTCDay() + 6) % 7) * DAY; // Monday on/before the start
  const spanDays = Math.max(14, Math.round((toMs(P.finish) - startMs) / DAY) + 1);
  const totalDays = Math.ceil(spanDays * 1.18) + 2;
  const pxDay = GW / totalDays;
  const endMs = startMs + totalDays * DAY;
  const xOf = (iso) => GX + ((toMs(iso) - startMs) / DAY) * pxDay;
  const scale = pxDay >= 11 ? 'days' : pxDay >= 2.4 ? 'weeks' : 'months';

  // ---------------------------------------------------------------- layout constants
  const HEADER_H = 100;
  const TS_TOP = HEADER_H + 10;
  const TS_H = 26;
  const ROWS_TOP = TS_TOP + TS_H;
  const LEGEND_H = 46;
  const ROWS_BOTTOM = doc.page.height - 40 - LEGEND_H;
  const FS = 7.6;

  const all = [
    { id: 1, name: P.name, outline: 0, summary: true, project: true, duration: P.duration, start: P.start, finish: P.finish, preds: [] },
    ...schedule.rows,
  ];
  const nameW = (r) => cols[1].w - 8 - r.outline * 9;
  const fontFor = (r) => (r.summary ? 'Helvetica-Bold' : 'Helvetica');
  const rowHeight = (r) => {
    doc.font(fontFor(r)).fontSize(FS);
    const lh = doc.currentLineHeight(true);
    const lines = Math.min(2, Math.max(1, Math.round(doc.heightOfString(r.name, { width: nameW(r) }) / lh)));
    return Math.max(15, lines * lh + 6);
  };

  // Paginate rows.
  const pages = [];
  let cur = [];
  let y = ROWS_TOP;
  for (const r of all) {
    const h = rowHeight(r);
    if (y + h > ROWS_BOTTOM && cur.length) {
      pages.push(cur);
      cur = [];
      y = ROWS_TOP;
    }
    cur.push({ r, y, h });
    y += h;
  }
  if (cur.length) pages.push(cur);

  const headerLines = [
    P.name,
    `Start ${fmtShort(P.start)}  ·  Finish ${fmtShort(P.finish)}  ·  ${durLabel(P.duration)}${inputs.end_date ? `  ·  Target ${fmtShort(inputs.end_date)}` : ''}`,
  ].filter(Boolean);
  const printed = fmtShort(new Date().toISOString().slice(0, 10));

  pages.forEach((rows, pi) => {
    if (pi > 0) doc.addPage();
    drawBrandHeader(doc, { C, branding, title: 'Work Programme', lines: headerLines, right: `Printed ${printed}` });
    drawTimescale();
    const bottom = rows[rows.length - 1].y + rows[rows.length - 1].h;
    drawGrid(bottom);
    const pos = new Map();
    rows.forEach(({ r, y, h }, i) => {
      if (i % 2 === 1) doc.rect(L, y, tableW, h).fill('#fafbfc');
      drawRowText(r, y, h);
      pos.set(r.uid ?? 'project', { r, y, h });
    });
    // Links first, so bars sit on top of them.
    rows.forEach(({ r, y, h }) => drawLinks(r, y, h, pos));
    rows.forEach(({ r, y, h }) => drawBar(r, y, h));
    // Row separators in the table.
    doc.lineWidth(0.4).strokeColor(COLORS.grid);
    rows.forEach(({ y }) => doc.moveTo(L, y).lineTo(GX, y).stroke());
    doc.rect(L, ROWS_TOP, W, bottom - ROWS_TOP).lineWidth(0.6).strokeColor('#9aa5b1').stroke();
    drawLegend();
  });

  drawFooters(doc, C, [branding.name, P.name, 'Work programme']);
  doc.end();

  // ---------------------------------------------------------------- drawing helpers

  function drawTimescale() {
    const top = TS_TOP;
    const half = TS_H / 2;
    doc.rect(L, top, W, TS_H).fill(C.soft);
    // Column headings
    let x = L;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.heading);
    for (const c of cols) {
      doc.text(c.label, x + 4, top + half - 3, { width: c.w - 8, align: c.align || 'left', lineBreak: false });
      x += c.w;
    }
    doc.lineWidth(0.5).strokeColor('#9aa5b1');
    doc.rect(L, top, W, TS_H).stroke();
    doc.moveTo(GX, top + half).lineTo(GX + GW, top + half).stroke();

    const label = (text, x0, x1, row, align = 'center') => {
      const w = x1 - x0;
      doc.font(row === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(row === 0 ? 7 : 6.2).fillColor(C.ink);
      if (doc.widthOfString(text) > w - 2) return;
      doc.text(text, x0 + 1, top + row * half + 3.5, { width: w - 2, align, lineBreak: false });
    };
    const tick = (x0, row) => {
      if (x0 <= GX + 0.1 || x0 >= GX + GW) return;
      doc.lineWidth(0.4).strokeColor('#b7c0ca').moveTo(x0, top + row * half).lineTo(x0, top + (row + 1) * half).stroke();
    };
    const dayX = (ms) => GX + ((ms - startMs) / DAY) * pxDay;

    if (scale === 'days') {
      for (let ms = startMs; ms < endMs; ms += 7 * DAY) {
        const d = new Date(ms);
        const x0 = dayX(ms);
        tick(x0, 0);
        label(`${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`, x0, Math.min(GX + GW, dayX(ms + 7 * DAY)), 0, 'left');
      }
      for (let ms = startMs; ms < endMs; ms += DAY) {
        const x0 = dayX(ms);
        tick(x0, 1);
        label(LETTERS[new Date(ms).getUTCDay()], x0, x0 + pxDay, 1);
      }
    } else if (scale === 'weeks') {
      monthTicks(0, (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`);
      for (let ms = startMs; ms < endMs; ms += 7 * DAY) {
        const x0 = dayX(ms);
        tick(x0, 1);
        label(String(new Date(ms).getUTCDate()), x0, x0 + 7 * pxDay, 1);
      }
    } else {
      // Quarters on top, months below.
      let d = new Date(startMs);
      d = new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
      while (d.getTime() < endMs) {
        const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1));
        const x0 = Math.max(GX, dayX(d.getTime()));
        tick(dayX(d.getTime()), 0);
        label(`Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`, x0, Math.min(GX + GW, dayX(next.getTime())), 0);
        d = next;
      }
      monthTicks(1, (m) => MONTHS[m.getUTCMonth()], true);
    }

    function monthTicks(row, text, short) {
      let d = new Date(startMs);
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      while (d.getTime() < endMs) {
        const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
        const x0 = Math.max(GX, dayX(d.getTime()));
        tick(dayX(d.getTime()), row);
        const t = text(d);
        label(short && dayX(next.getTime()) - x0 < 14 ? t[0] : t, x0, Math.min(GX + GW, dayX(next.getTime())), row);
        d = next;
      }
    }
  }

  function drawGrid(bottom) {
    // Non-working days shaded when days are wide enough to see.
    if (pxDay >= 3) {
      for (let ms = startMs; ms < endMs; ms += DAY) {
        const iso = isoOf(ms);
        if (!work.has(new Date(ms).getUTCDay()) || hol.has(iso)) doc.rect(GX + ((ms - startMs) / DAY) * pxDay, ROWS_TOP, pxDay, bottom - ROWS_TOP).fill(COLORS.nonWork);
      }
    }
    // Vertical week/month lines
    doc.lineWidth(0.3).strokeColor(COLORS.grid);
    if (scale === 'months') {
      let d = new Date(startMs);
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      for (; d.getTime() < endMs; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
        const x = GX + ((d.getTime() - startMs) / DAY) * pxDay;
        doc.moveTo(x, ROWS_TOP).lineTo(x, bottom).stroke();
      }
    } else {
      for (let ms = startMs + 7 * DAY; ms < endMs; ms += 7 * DAY) {
        const x = GX + ((ms - startMs) / DAY) * pxDay;
        doc.moveTo(x, ROWS_TOP).lineTo(x, bottom).stroke();
      }
    }
    // Table column lines
    doc.lineWidth(0.5).strokeColor('#c3cad3');
    let x = L;
    for (const c of cols) {
      x += c.w;
      doc.moveTo(x, TS_TOP).lineTo(x, bottom).stroke();
    }
  }

  function drawRowText(r, y, h) {
    const ty = y + 4;
    let x = L;
    const color = C.ink;
    const cells = {
      id: String(r.id),
      name: r.name,
      dur: durLabel(r.duration),
      start: fmtShort(r.start),
      finish: fmtShort(r.finish),
    };
    for (const c of cols) {
      const font = c.key === 'name' && r.summary ? 'Helvetica-Bold' : 'Helvetica';
      doc.font(font).fontSize(FS).fillColor(c.key === 'id' ? C.muted : color);
      if (c.key === 'name') {
        const ind = r.outline * 9;
        doc.text(cells.name, x + 4 + ind, ty, { width: nameW(r), height: h - 4, ellipsis: true });
      } else {
        doc.text(cells[c.key], x + 4, ty, { width: c.w - 8, align: c.align || 'left', lineBreak: false });
      }
      x += c.w;
    }
  }

  function barBox(r, y, h) {
    const x0 = xOf(r.start);
    const x1 = xOf(r.finish) + pxDay;
    return { x0, x1, mid: y + h / 2 };
  }

  function drawBar(r, y, h) {
    const { x0, x1, mid } = barBox(r, y, h);
    if (r.milestone) {
      const cx = xOf(r.finish) + (r.es > 0 ? pxDay : 0);
      const s = 4.2;
      doc.path(`M${cx} ${mid - s} L${cx + s} ${mid} L${cx} ${mid + s} L${cx - s} ${mid} Z`).fill(r.critical ? COLORS.criticalEdge : COLORS.summary);
      barLabel(`${r.name}  ${fmtShort(r.finish).slice(4)}`, cx + s + 3, mid);
      return;
    }
    const w = Math.max(1.5, x1 - x0);
    if (r.summary) {
      const col = r.project ? COLORS.projectSummary : COLORS.summary;
      const bh = r.project ? 4.5 : 3.2;
      doc.rect(x0, mid - bh / 2, w, bh).fill(col);
      // Bracket ends pointing down, like MS Project summary bars
      const t = 3.2;
      doc.path(`M${x0} ${mid - bh / 2} L${x0 + t} ${mid - bh / 2} L${x0} ${mid + bh / 2 + t} Z`).fill(col);
      doc.path(`M${x0 + w} ${mid - bh / 2} L${x0 + w - t} ${mid - bh / 2} L${x0 + w} ${mid + bh / 2 + t} Z`).fill(col);
      return;
    }
    const bh = 7;
    doc.rect(x0, mid - bh / 2, w, bh).fillAndStroke(r.critical ? COLORS.critical : COLORS.task, r.critical ? COLORS.criticalEdge : COLORS.taskEdge);
    doc.lineWidth(0.5);
    barLabel(r.name, x0 + w + 3, mid, x0);
  }

  /** Task name beside its bar: to the right if there's room, otherwise to the left of the bar. */
  function barLabel(text, x, mid, leftEdge) {
    doc.font('Helvetica').fontSize(6.3).fillColor(C.ink);
    let t = text;
    const room = GX + GW - x - 2;
    if (doc.widthOfString(t) <= room) {
      doc.text(t, x, mid - 3.3, { lineBreak: false });
      return;
    }
    if (leftEdge != null && leftEdge - GX - 4 > Math.min(doc.widthOfString(t), 120)) {
      const w = Math.min(doc.widthOfString(t), leftEdge - GX - 4);
      doc.text(t, leftEdge - w - 3, mid - 3.3, { width: w, lineBreak: false, ellipsis: true });
      return;
    }
    if (room > 30) doc.text(t, x, mid - 3.3, { width: room, lineBreak: false, ellipsis: true });
  }

  function drawLinks(r, y, h, pos) {
    if (!r.preds?.length || r.summary) return;
    const me = barBox(r, y, h);
    doc.lineWidth(0.5).strokeColor(COLORS.link);
    for (const p of r.preds) {
      const from = pos.get(p.uid);
      if (!from || from.r.summary) continue;
      const pb = barBox(from.r, from.y, from.h);
      const down = from.y < y;
      const fromX = from.r.milestone ? xOf(from.r.finish) + (from.r.es > 0 ? pxDay : 0) : p.type === 'SS' || p.type === 'SF' ? pb.x0 : pb.x1;
      const toX = r.milestone ? xOf(r.finish) + (r.es > 0 ? pxDay : 0) : p.type === 'FF' || p.type === 'SF' ? me.x1 : me.x0;
      const tipY = down ? me.mid - 4 : me.mid + 4;
      if (p.type === 'FS' && toX >= fromX + 2) {
        // Out of the end of the predecessor, then down into the start of the successor.
        const ax = Math.max(toX + Math.min(3, (me.x1 - me.x0) / 2), fromX + 2);
        doc.moveTo(fromX, pb.mid).lineTo(ax, pb.mid).lineTo(ax, tipY).stroke();
        arrow(ax, tipY, down ? 'down' : 'up');
      } else {
        const outX = fromX + (p.type === 'SS' || p.type === 'SF' ? -4 : 4);
        const inX = toX + (p.type === 'FF' || p.type === 'SF' ? 5 : -5);
        const midY = down ? from.y + from.h : from.y;
        doc.moveTo(fromX, pb.mid).lineTo(outX, pb.mid).lineTo(outX, midY).lineTo(inX, midY).lineTo(inX, me.mid).lineTo(toX, me.mid).stroke();
        arrow(toX, me.mid, p.type === 'FF' || p.type === 'SF' ? 'left' : 'right');
      }
    }
  }

  function arrow(x, y, dir) {
    const s = 2.4;
    const pts = {
      down: `M${x - s} ${y - s} L${x + s} ${y - s} L${x} ${y} Z`,
      up: `M${x - s} ${y + s} L${x + s} ${y + s} L${x} ${y} Z`,
      right: `M${x - s} ${y - s} L${x - s} ${y + s} L${x} ${y} Z`,
      left: `M${x + s} ${y - s} L${x + s} ${y + s} L${x} ${y} Z`,
    }[dir];
    doc.path(pts).fill(COLORS.link);
  }

  function drawLegend() {
    const top = ROWS_BOTTOM + 8;
    doc.rect(L, top, W, LEGEND_H - 8).lineWidth(0.5).strokeColor('#c3cad3').stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.ink).text(`Project: ${P.name}`, L + 8, top + 8, { width: 300, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(`Date: ${printed}`, L + 8, top + 21, { width: 300, lineBreak: false });
    const items = [
      ['Task', (x, y) => doc.rect(x, y - 3.5, 26, 7).fillAndStroke(COLORS.task, COLORS.taskEdge)],
      ['Critical task', (x, y) => doc.rect(x, y - 3.5, 26, 7).fillAndStroke(COLORS.critical, COLORS.criticalEdge)],
      ['Milestone', (x, y) => doc.path(`M${x + 13} ${y - 4} L${x + 17} ${y} L${x + 13} ${y + 4} L${x + 9} ${y} Z`).fill(COLORS.summary)],
      ['Summary', (x, y) => {
        doc.rect(x, y - 1.6, 26, 3.2).fill(COLORS.summary);
        doc.path(`M${x} ${y - 1.6} L${x + 3} ${y - 1.6} L${x} ${y + 4.5} Z M${x + 26} ${y - 1.6} L${x + 23} ${y - 1.6} L${x + 26} ${y + 4.5} Z`).fill(COLORS.summary);
      }],
      ['Project summary', (x, y) => doc.rect(x, y - 2.2, 26, 4.5).fill(COLORS.projectSummary)],
      ['Link', (x, y) => {
        doc.lineWidth(0.6).strokeColor(COLORS.link).moveTo(x, y).lineTo(x + 22, y).stroke();
        arrow(x + 26, y, 'right');
      }],
      ['Non-working day', (x, y) => doc.rect(x, y - 4, 26, 8).fill(COLORS.nonWork)],
    ];
    const startX = L + 330;
    const colW = (W - 340) / 4;
    items.forEach(([text, draw], i) => {
      const x = startX + (i % 4) * colW;
      const yy = top + 12 + Math.floor(i / 4) * 14;
      draw(x, yy);
      doc.font('Helvetica').fontSize(7.5).fillColor(C.ink).text(text, x + 34, yy - 3.5, { lineBreak: false });
    });
  }
}
