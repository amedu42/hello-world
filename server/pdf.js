// Renders a daily site report to PDF with pdfkit.
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './db.js';

const C = {
  ink: '#1c2430',
  muted: '#5b6675',
  line: '#d9dee5',
  band: '#16324f',
  accent: '#f2a900',
  soft: '#f3f5f8',
  good: '#1f8a4c',
};

const fmtDate = (d) =>
  d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

export function renderReportPdf({ project, report, items, photos, reportNo }, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `${project.name} – Daily Report ${report.report_date}` } });
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

  // ---------- Header band
  doc.rect(0, 0, doc.page.width, 92).fill(C.band);
  doc.rect(0, 92, doc.page.width, 4).fill(C.accent);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('DAILY SITE REPORT', L, 24, { width: W });
  doc.font('Helvetica').fontSize(11).fillColor('#cfd9e6').text(project.name + (project.code ? `  ·  ${project.code}` : ''), L, 48, { width: W - 150 });
  doc.text(fmtDate(report.report_date), L, 64, { width: W - 150 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text(`Report No. ${reportNo}`, L, 28, { width: W, align: 'right' });

  // ---------- Project facts + progress box
  doc.y = 112;
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
  const by = 110;
  doc.roundedRect(L + W - boxW, by, boxW, 66, 6).fill(C.soft);
  doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8).text('OVERALL PROGRESS', L + W - boxW, by + 9, { width: boxW, align: 'center' });
  doc.fillColor(C.band).font('Helvetica-Bold').fontSize(26).text(`${report.overall_progress ?? 0}%`, L + W - boxW, by + 22, { width: boxW, align: 'center' });
  const pbw = boxW - 24;
  doc.roundedRect(L + W - boxW + 12, by + 54, pbw, 5, 2.5).fill(C.line);
  doc.roundedRect(L + W - boxW + 12, by + 54, Math.max(2, (pbw * (report.overall_progress || 0)) / 100), 5, 2.5).fill(C.accent);
  doc.y = Math.max(fy, by + 76) + 10;

  const section = (title) => {
    ensure(40);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.band).text(title.toUpperCase(), L, doc.y, { width: W });
    doc.rect(L, doc.y + 1.5, W, 1.2).fill(C.accent);
    doc.y += 8;
  };

  const table = (cols, rows) => {
    const pad = 4;
    const drawHead = () => {
      const y = doc.y;
      doc.rect(L, y, W, 18).fill(C.soft);
      let x = L;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted);
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
        doc.y = doc.page.margins.top;
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
    ensure(doc.heightOfString(text, { width: W }) > 200 ? 60 : doc.heightOfString(text, { width: W }) + 6);
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

  section('Material deliveries');
  if (report.materials?.length) {
    table(
      [{ label: 'Material', w: 0.32 }, { label: 'Quantity', w: 0.18 }, { label: 'Supplier', w: 0.22 }, { label: 'Notes', w: 0.28 }],
      report.materials.map((m) => [m.material, m.quantity, m.supplier, m.notes])
    );
  } else empty('No deliveries recorded.');

  section('Site issues');
  if (report.issues?.length) {
    table(
      [
        { label: 'Category', w: 0.15 },
        { label: 'Description', w: 0.42 },
        { label: 'Severity', w: 0.11, color: (r) => (r[2] === 'High' ? '#b42318' : r[2] === 'Medium' ? '#b54708' : C.ink) },
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

  // ---------- Photos
  const usable = photos.filter((p) => /\.(jpe?g|png)$/i.test(p.filename) && fs.existsSync(path.join(UPLOAD_DIR, p.filename)));
  if (usable.length) {
    section('Site photos');
    const gap = 12;
    const pw = (W - gap) / 2;
    const ph = pw * 0.72;
    for (let i = 0; i < usable.length; i += 2) {
      ensure(ph + 30);
      const y = doc.y;
      for (let j = 0; j < 2 && i + j < usable.length; j++) {
        const p = usable[i + j];
        const x = L + j * (pw + gap);
        try {
          doc.image(path.join(UPLOAD_DIR, p.filename), x, y, { fit: [pw, ph], align: 'center', valign: 'center' });
        } catch {
          doc.rect(x, y, pw, ph).strokeColor(C.line).stroke();
        }
        doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(p.caption || p.original_name || '', x, y + ph + 3, { width: pw });
      }
      doc.y = y + ph + 22;
    }
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

  // ---------- Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy2 = doc.page.height - 30;
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted);
    doc.text(`${project.name} · Daily Site Report · ${report.report_date}`, L, fy2, { width: W / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, L + W / 2, fy2, { width: W / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
  doc.end();
}
