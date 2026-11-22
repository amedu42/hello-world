// Renders a daily site report to PDF with pdfkit, in the company's colours and with its logo.
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './db.js';

// ------------------------------------------------------------------ colours

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

/** Builds the report palette from a company's primary colour (falls back to SitePulse navy + amber). */
export function reportPalette(primary) {
  const base = { ink: '#1c2430', muted: '#5b6675', line: '#d9dee5', good: '#1f8a4c', bad: '#b42318', warn: '#b54708' };
  if (!primary || !/^#[0-9a-f]{6}$/i.test(primary)) {
    return { ...base, band: '#16324f', onBand: '#ffffff', onBandSub: '#cfd9e6', stripe: '#f2a900', heading: '#16324f', rule: '#f2a900', soft: '#f3f5f8', fill: '#f2a900', big: '#16324f' };
  }
  const p = primary.toLowerCase();
  const onBand = contrast(p, '#ffffff') >= contrast(p, base.ink) ? '#ffffff' : base.ink;
  // Headings and big numbers must stay readable on white: darken light brand colours until they reach 4.5:1.
  let heading = p;
  for (let t = 0.1; contrast(heading, '#ffffff') < 4.5 && t <= 1; t += 0.1) heading = mix(p, '#000000', t);
  return {
    ...base,
    band: p,
    onBand,
    onBandSub: mix(onBand, p, 0.25),
    stripe: mix(p, '#000000', 0.3),
    heading,
    rule: p,
    soft: mix(p, '#ffffff', 0.9),
    fill: p,
    big: heading,
  };
}

/**
 * Company-coloured header band with the logo on a white tile (so any logo stays legible).
 * Returns the band height; content should start below it.
 */
export function drawBrandHeader(doc, { C, branding = {}, title, lines = [], right }) {
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const BAND = 96;
  doc.rect(0, 0, doc.page.width, BAND).fill(C.band);
  doc.rect(0, BAND, doc.page.width, 4).fill(C.stripe);
  let textX = L;
  const logo = branding.logoPath && fs.existsSync(branding.logoPath) ? branding.logoPath : null;
  if (logo) {
    const tileH = 64;
    try {
      const img = doc.openImage(logo);
      const tileW = Math.min(150, Math.max(tileH, (tileH - 12) * (img.width / img.height) + 12));
      doc.roundedRect(L, 16, tileW, tileH, 6).fill('#ffffff');
      doc.image(img, L + 6, 22, { fit: [tileW - 12, tileH - 12], align: 'center', valign: 'center' });
      textX = L + tileW + 16;
    } catch {
      textX = L;
    }
  }
  const textW = W - (textX - L) - 170;
  doc.fillColor(C.onBand).font('Helvetica-Bold').fontSize(18).text(title, textX, 22, { width: textW + 60, lineBreak: false });
  doc.font('Helvetica').fontSize(10.5).fillColor(C.onBandSub);
  lines.slice(0, 2).forEach((line, i) => doc.text(line, textX, 46 + i * 16, { width: textW + 60, lineBreak: false, ellipsis: true }));
  if (right) doc.font('Helvetica-Bold').fontSize(10).fillColor(C.onBand).text(right, L + W - 200, 24, { width: 200, align: 'right' });
  if (branding.name) doc.font('Helvetica').fontSize(9).fillColor(C.onBandSub).text(branding.name, L + W - 200, 40, { width: 200, align: 'right' });
  return BAND;
}

/** The SitePulse app icon (navy tile, amber house outline), drawn as vectors at (x, y) with the given size. */
export function drawSitePulseLogo(doc, x, y, size) {
  const k = size / 32; // icon is designed on a 32 × 32 grid
  doc.save();
  doc.translate(x, y).scale(k);
  doc.roundedRect(0, 0, 32, 32, 7).fill('#16324f');
  doc.path('M7 23h18M10 23V13l6-4 6 4v10').lineWidth(2.6).lineJoin('round').lineCap('round').strokeColor('#f2a900').stroke();
  doc.restore();
}

const SITEPULSE_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');

/**
 * Footer on every page: "Company · Project · Document" on the left; the SitePulse logo with
 * "Made with SitePulse" and "Page x of y" on the right.
 */
export function drawFooters(doc, C, leftParts) {
  const L = doc.page.margins.left;
  const range = doc.bufferedPageRange();
  const made = 'Made with SitePulse';
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const W = doc.page.width - L - doc.page.margins.right;
    const fy = doc.page.height - 30;
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.rect(L, fy - 8, W, 0.6).fill(C.rule);

    doc.font('Helvetica').fontSize(7.5);
    const page = `Page ${i + 1} of ${range.count}`;
    const pageW = doc.widthOfString(page);
    doc.font('Helvetica-Bold');
    const madeW = doc.widthOfString(made);
    const ICON = 9;
    const GAP = 4;
    const SEP = 14;
    const blockW = ICON + GAP + madeW + SEP + pageW;
    const bx = L + W - blockW;

    // Left: document details (truncated so it never runs into the right-hand block)
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted);
    const maxW = Math.max(60, bx - L - 16);
    let left = leftParts.filter(Boolean).join(' · ');
    if (doc.widthOfString(left) > maxW) {
      while (left.length > 1 && doc.widthOfString(left + '…') > maxW) left = left.slice(0, -1);
      left = left.trimEnd() + '…';
    }
    doc.text(left, L, fy, { lineBreak: false });

    // Right: [logo] Made with SitePulse  ·  Page x of y
    drawSitePulseLogo(doc, bx, fy - 1.5, ICON);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#16324f').text(made, bx + ICON + GAP, fy, { lineBreak: false });
    if (SITEPULSE_URL) doc.link(bx, fy - 2, ICON + GAP + madeW, 11, SITEPULSE_URL);
    doc.font('Helvetica').fillColor(C.muted).text('·', bx + ICON + GAP + madeW + SEP / 2 - 1.5, fy, { lineBreak: false });
    doc.text(page, L + W - pageW, fy, { lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
}

export const fmtDate = (d) =>
  d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

// A5 is 148 × 210 mm = 419.5 × 595.3 pt.
const A5_SHORT = 419.5;
const A5_LONG = 595.3;

export function renderReportPdf({ project, report, items, photos, reportNo, registers = {}, branding = {} }, stream) {
  const C = reportPalette(branding.color);
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `${project.name} – Daily Report ${report.report_date}`, Author: branding.name || '' } });
  doc.pipe(stream);
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
  const top = () => doc.page.margins.top;

  const ensure = (h) => {
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = top();
    }
  };

  // ---------- Header band
  const BAND = drawBrandHeader(doc, {
    C,
    branding,
    title: 'DAILY SITE REPORT',
    lines: [project.name + (project.code ? `  ·  ${project.code}` : ''), fmtDate(report.report_date)],
    right: `Report No. ${reportNo}`,
  });

  // ---------- Project facts + progress box
  doc.y = BAND + 18;
  const facts = [
    ['Client', project.client],
    ['Location', project.location],
    ['Contractor', project.contractor],
    ['Supervisor', report.supervisor || project.supervisor],
  ].filter(([, v]) => v);
  const boxW = 150;
  let fy = doc.y;
  doc.fontSize(9);
  for (const [k, v] of facts) {
    doc.font('Helvetica-Bold').fillColor(C.muted).text(k.toUpperCase(), L, fy, { width: 80 });
    doc.font('Helvetica').fillColor(C.ink).text(v, L + 80, fy, { width: W - boxW - 100 });
    fy = Math.max(doc.y, fy + 14) + 2;
  }
  const by = BAND + 14;
  doc.roundedRect(L + W - boxW, by, boxW, 66, 6).fill(C.soft);
  doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8).text('OVERALL PROGRESS', L + W - boxW, by + 9, { width: boxW, align: 'center' });
  doc.fillColor(C.big).font('Helvetica-Bold').fontSize(26).text(`${report.overall_progress ?? 0}%`, L + W - boxW, by + 22, { width: boxW, align: 'center' });
  const pbw = boxW - 24;
  doc.roundedRect(L + W - boxW + 12, by + 54, pbw, 5, 2.5).fill('#ffffff');
  doc.roundedRect(L + W - boxW + 12, by + 54, Math.max(2, (pbw * (report.overall_progress || 0)) / 100), 5, 2.5).fill(C.fill);
  doc.y = Math.max(fy, by + 76) + 10;

  const section = (title) => {
    ensure(40);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.heading).text(title.toUpperCase(), L, doc.y, { width: W });
    doc.rect(L, doc.y + 1.5, W, 1.2).fill(C.rule);
    doc.y += 8;
  };

  const table = (cols, rows) => {
    const pad = 4;
    const drawHead = () => {
      const y = doc.y;
      doc.rect(L, y, W, 18).fill(C.soft);
      let x = L;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.heading);
      for (const c of cols) {
        doc.text(c.label.toUpperCase(), x + pad, y + 5, { width: c.w * W - pad * 2, align: c.align || 'left' });
        x += c.w * W;
      }
      doc.y = y + 18;
    };
    ensure(40);
    drawHead();
    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    for (const r of rows) {
      const h = Math.max(...cols.map((c, i) => doc.heightOfString(String(r[i] ?? ''), { width: c.w * W - pad * 2 }))) + pad * 2;
      if (doc.y + h > bottom()) {
        doc.addPage();
        doc.y = top();
        drawHead();
        doc.font('Helvetica').fontSize(9).fillColor(C.ink);
      }
      const y = doc.y;
      let x = L;
      cols.forEach((c, i) => {
        doc.fillColor(c.color?.(r) || C.ink).text(String(r[i] ?? ''), x + pad, y + pad, { width: c.w * W - pad * 2, align: c.align || 'left' });
        x += c.w * W;
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.y = y + h;
    }
    doc.y += 6;
  };

  const para = (text) => {
    doc.font('Helvetica').fontSize(9.5).fillColor(C.ink);
    const h = doc.heightOfString(text, { width: W });
    ensure(h > 200 ? 60 : h + 6);
    doc.text(text, L, doc.y, { width: W, lineGap: 2 });
    doc.y += 4;
  };

  const empty = (t) => {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.muted).text(t, L, doc.y, { width: W });
    doc.y += 4;
  };

  // ---------- Summary
  if (report.summary) {
    section('Summary');
    para(report.summary);
  }

  // ---------- Activities
  section("Today's activities & progress");
  if (items.length) {
    table(
      [
        { label: 'Activity', w: 0.38 },
        { label: 'Previous', w: 0.1, align: 'right' },
        { label: 'Today', w: 0.1, align: 'right' },
        { label: 'Change', w: 0.1, align: 'right', color: (r) => (r[3].startsWith('+') && r[3] !== '+0%' ? C.good : C.muted) },
        { label: 'Remarks', w: 0.32 },
      ],
      items.map((i) => {
        const d = Math.round((i.progress - (i.progress_before || 0)) * 10) / 10;
        return [i.activity_name, `${i.progress_before ?? 0}%`, `${i.progress}%`, `${d >= 0 ? '+' : ''}${d}%`, i.remarks || ''];
      })
    );
  } else empty('No activities recorded.');

  // ---------- Attendance register (only for projects that use it)
  const att = registers.attendance;
  if (att) {
    section('Attendance');
    if (!att.taken) {
      empty('No attendance register was taken on this day.');
    } else {
      ensure(60);
      const stats = [
        ['Present', att.present, C.good],
        ['Late', att.late, '#8a5a00'],
        ['Absent', att.absent, C.bad],
        ['On site', `${att.on_site} of ${att.present + att.late + att.absent}`, C.big],
      ];
      const gap = 8;
      const bw = (W - gap * 3) / 4;
      const y0 = doc.y;
      stats.forEach(([label, value, col], i) => {
        const x = L + i * (bw + gap);
        doc.roundedRect(x, y0, bw, 38, 5).fill(C.soft);
        doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted).text(label.toUpperCase(), x + 8, y0 + 7, { width: bw - 16 });
        doc.font('Helvetica-Bold').fontSize(14).fillColor(col).text(String(value), x + 8, y0 + 17, { width: bw - 16 });
      });
      doc.y = y0 + 46;
      if (att.trade_counts.length) {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text('On site by trade: ', L, doc.y, { continued: true, width: W });
        doc.font('Helvetica').text(att.trade_counts.map((t) => `${t.trade} ${t.count}`).join('  ·  '));
        doc.y += 4;
      }
      if (att.absentees.length) {
        table(
          [
            { label: 'Absentee', w: 0.3 },
            { label: 'Trade', w: 0.2 },
            { label: 'Reason', w: 0.2, color: () => C.bad },
            { label: 'Note', w: 0.3 },
          ],
          att.absentees.map((a) => [a.name, a.trade || 'General', a.reason_label, a.note || ''])
        );
      } else {
        empty('No absentees.');
      }
      if (att.taken_by) doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(`Register taken by ${att.taken_by}.`, L, doc.y, { width: W });
    }
  }

  // ---------- Weather
  const w = report.weather || {};
  section('Weather conditions');
  const wRows = [
    ['Condition', w.condition],
    ['Temperature', w.temp_high != null || w.temp_low != null ? `${w.temp_low ?? '–'}°C to ${w.temp_high ?? '–'}°C` : null],
    ['Rainfall', w.rainfall],
    ['Wind', w.wind],
    ['Impact on works', w.impact],
    ['Hours lost', w.hours_lost ? `${w.hours_lost} h` : null],
  ].filter(([, v]) => v != null && v !== '');
  if (wRows.length) table([{ label: 'Item', w: 0.3 }, { label: 'Detail', w: 0.7 }], wRows);
  else empty('Not recorded.');

  // ---------- Resources
  const labour = report.labour || [];
  const equipment = report.equipment || [];
  if (labour.length || equipment.length) {
    section('Resources on site');
    if (labour.length) {
      const total = labour.reduce((s, l) => s + (Number(l.count) || 0), 0);
      table([{ label: 'Trade / labour', w: 0.75 }, { label: 'No.', w: 0.25, align: 'right' }], [...labour.map((l) => [l.trade, l.count]), ['Total', total]]);
    }
    if (equipment.length) {
      table(
        [{ label: 'Plant / equipment', w: 0.55 }, { label: 'No.', w: 0.15, align: 'right' }, { label: 'Status', w: 0.3 }],
        equipment.map((e) => [e.name, e.count, e.status])
      );
    }
  }

  // ---------- Materials: from the materials register when it has entries for the day, otherwise the
  // report's own delivery list (older reports and projects that don't use the register).
  const mat = registers.materials;
  const fmtQ = (n) => (n ? String(Math.round(n * 1000) / 1000) : '–');
  const sub = (t) => {
    ensure(30);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.heading).text(t, L, doc.y + 2, { width: W });
    doc.y += 3;
  };
  if (mat && mat.movement_count) {
    section('Materials');
    table(
      [
        { label: 'Material', w: 0.3 },
        { label: 'Unit', w: 0.1 },
        { label: 'Opening', w: 0.11, align: 'right' },
        { label: 'Received', w: 0.11, align: 'right', color: (r) => (r[3] !== '–' ? C.good : C.muted) },
        { label: 'Used', w: 0.1, align: 'right' },
        { label: 'Wasted', w: 0.1, align: 'right', color: (r) => (r[5] !== '–' ? C.warn : C.muted) },
        { label: 'Closing', w: 0.18, align: 'right', color: (r) => (r.flag ? C.bad : C.ink) },
      ],
      mat.rows.map((r) => {
        const row = [r.name, r.unit, fmtQ(r.opening) === '–' ? '0' : fmtQ(r.opening), fmtQ(r.delivered), fmtQ(r.used), fmtQ(r.wasted), `${fmtQ(r.closing) === '–' ? '0' : fmtQ(r.closing)}${r.negative ? ' (check)' : r.low ? ' (low)' : ''}`];
        row.flag = r.low || r.negative;
        return row;
      })
    );
    if (mat.deliveries.length) {
      sub('Deliveries received');
      table(
        [
          { label: 'Material', w: 0.28 },
          { label: 'Quantity', w: 0.14, align: 'right' },
          { label: 'Supplier', w: 0.22 },
          { label: 'Delivery note', w: 0.14 },
          { label: 'Notes', w: 0.22 },
        ],
        mat.deliveries.map((d) => [d.material, `${fmtQ(d.quantity)} ${d.unit}`, d.supplier || '', d.reference || '', d.notes || ''])
      );
    }
    if (mat.usage.length) {
      sub('Materials used');
      table(
        [
          { label: 'Material', w: 0.28 },
          { label: 'Quantity', w: 0.14, align: 'right' },
          { label: 'Type', w: 0.12, color: (r) => (r[2] === 'Wasted' ? C.warn : C.ink) },
          { label: 'Activity / location', w: 0.26 },
          { label: 'Notes', w: 0.2 },
        ],
        mat.usage.map((u) => [u.material, `${fmtQ(u.quantity)} ${u.unit}`, u.type === 'wasted' ? 'Wasted' : 'Used', [u.activity_name, u.location].filter(Boolean).join(' – '), u.notes || ''])
      );
    }
  } else {
    section('Material deliveries');
    if (report.materials?.length) {
      table(
        [{ label: 'Material', w: 0.32 }, { label: 'Quantity', w: 0.18 }, { label: 'Supplier', w: 0.22 }, { label: 'Notes', w: 0.28 }],
        report.materials.map((m) => [m.material, m.quantity, m.supplier, m.notes])
      );
    } else empty(mat ? 'No materials received or used.' : 'No deliveries recorded.');
  }
  if (mat?.low?.length) {
    ensure(24);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.bad).text('Low stock at end of day: ', L, doc.y, { continued: true, width: W });
    doc.font('Helvetica').fillColor(C.ink).text(
      mat.low.map((l) => `${l.name} ${fmtQ(l.stock) === '–' ? 0 : fmtQ(l.stock)} ${l.unit}${l.reorder_level != null ? ` (reorder at ${l.reorder_level})` : ''}`).join('; ')
    );
    doc.y += 4;
  }

  section('Site issues');
  if (report.issues?.length) {
    table(
      [
        { label: 'Category', w: 0.15 },
        { label: 'Description', w: 0.42 },
        { label: 'Severity', w: 0.11, color: (r) => (r[2] === 'High' ? C.bad : r[2] === 'Medium' ? C.warn : C.ink) },
        { label: 'Action', w: 0.32 },
      ],
      report.issues.map((i) => [i.category, i.description, i.severity, i.action])
    );
  } else empty('No issues reported.');

  section('Visitors');
  if (report.visitors?.length) {
    table(
      [{ label: 'Name', w: 0.25 }, { label: 'Organisation', w: 0.25 }, { label: 'Purpose', w: 0.36 }, { label: 'Time', w: 0.14 }],
      report.visitors.map((v) => [v.name, v.organisation, v.purpose, v.time])
    );
  } else empty('No visitors recorded.');

  if (report.notes) {
    section('Additional notes');
    para(report.notes);
  }

  // ---------- Sign-off
  ensure(70);
  doc.moveDown(1);
  const sy = doc.y + 20;
  doc.moveTo(L, sy).lineTo(L + W * 0.42, sy).lineWidth(0.7).strokeColor(C.ink).stroke();
  doc.moveTo(L + W * 0.58, sy).lineTo(L + W, sy).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(C.muted);
  doc.text(`Prepared by: ${report.supervisor || ''}`, L, sy + 4, { width: W * 0.42 });
  doc.text('Reviewed by (Project Manager)', L + W * 0.58, sy + 4, { width: W * 0.42 });

  // ---------- Photos: one per page, each as large as an A5 frame (148 × 210 mm, turned to match the
  // photo) allows inside the page margins, never stretched or cropped. Portrait photos reach the full
  // A5 width (148 mm); landscape photos the full content width (~182 mm).
  const usable = photos.filter((p) => /\.(jpe?g|png)$/i.test(p.filename) && fs.existsSync(path.join(UPLOAD_DIR, p.filename)));
  usable.forEach((p, idx) => {
    let img;
    try {
      img = doc.openImage(path.join(UPLOAD_DIR, p.filename));
    } catch {
      return;
    }
    doc.addPage();
    doc.y = top();
    section(`Site photo ${idx + 1} of ${usable.length}`);
    // Width/height as displayed, after EXIF rotation (orientations 5–8 swap the sides).
    const rotated = img.orientation > 4;
    const iw = rotated ? img.height : img.width;
    const ih = rotated ? img.width : img.height;
    const portrait = ih > iw;
    const captionH = 40;
    const fw = Math.min(portrait ? A5_SHORT : A5_LONG, W);
    const fh = Math.min(portrait ? A5_LONG : A5_SHORT, bottom() - doc.y - captionH);
    const s = Math.min(fw / iw, fh / ih);
    const dw = iw * s;
    const dh = ih * s;
    const x = L + (W - dw) / 2;
    const y = doc.y + 6;
    doc.image(img, x, y, { width: dw, height: dh });
    doc.rect(x, y, dw, dh).lineWidth(0.5).strokeColor(C.line).stroke();
    const caption = p.caption || p.original_name || '';
    if (caption) doc.font('Helvetica').fontSize(10).fillColor(C.ink).text(caption, x, y + dh + 8, { width: dw, align: 'center' });
  });

  // ---------- Footer on every page
  drawFooters(doc, C, [branding.name, project.name, `Daily Site Report ${report.report_date}`]);
  doc.end();
}
