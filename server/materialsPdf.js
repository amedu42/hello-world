// Materials register PDF for a period: stock summary, deliveries log, usage & wastage log, usage by activity.
import { db } from './db.js';
import { drawBrandHeader, drawFooters, fmtDate, reportPalette } from './pdf.js';
import { makeDoc, sectionTitle, signOff, summaryBoxes, table } from './attendancePdf.js';

const r3 = (n) => Math.round(n * 1000) / 1000;
const q = (n) => (n ? r3(n).toLocaleString('en-GB', { maximumFractionDigits: 3 }) : '–');
const q0 = (n) => r3(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 3 });
const shortDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function materialsPeriodData(projectId, from, to) {
  const materials = db.prepare('SELECT * FROM materials WHERE project_id = ? ORDER BY lower(name)').all(projectId).map((m) => ({ ...m }));
  const before = new Map(
    db
      .prepare(
        `SELECT material_id, SUM(CASE WHEN type = 'delivered' THEN quantity ELSE -quantity END) net
         FROM material_movements WHERE project_id = ? AND date < ? GROUP BY material_id`
      )
      .all(projectId, from)
      .map((r) => [r.material_id, r.net || 0])
  );
  const moves = db
    .prepare(
      `SELECT mm.*, m.name AS material, m.unit, a.name AS activity_name, a.code AS activity_code
       FROM material_movements mm JOIN materials m ON m.id = mm.material_id
       LEFT JOIN activities a ON a.id = mm.activity_id
       WHERE mm.project_id = ? AND mm.date BETWEEN ? AND ? ORDER BY mm.date, mm.created_at, mm.id`
    )
    .all(projectId, from, to)
    .map((r) => ({ ...r }));
  const totals = new Map();
  for (const mv of moves) {
    if (!totals.has(mv.material_id)) totals.set(mv.material_id, { delivered: 0, used: 0, wasted: 0 });
    totals.get(mv.material_id)[mv.type] += mv.quantity;
  }
  const rows = materials
    .filter((m) => m.active || totals.has(m.id))
    .map((m) => {
      const t = totals.get(m.id) || { delivered: 0, used: 0, wasted: 0 };
      const opening = r3(m.opening_stock + (before.get(m.id) || 0));
      const closing = r3(opening + t.delivered - t.used - t.wasted);
      return { ...m, opening, ...t, closing, low: m.reorder_level != null && closing <= m.reorder_level, negative: closing < 0, moved: totals.has(m.id) };
    });
  // Usage by activity (used only, not wastage)
  const byAct = new Map();
  for (const mv of moves.filter((x) => x.type === 'used')) {
    const key = mv.activity_id ? `${mv.activity_code ? mv.activity_code + ' ' : ''}${mv.activity_name}` : 'Not linked to an activity';
    if (!byAct.has(key)) byAct.set(key, new Map());
    const m = byAct.get(key);
    const k = `${mv.material}|${mv.unit}`;
    m.set(k, (m.get(k) || 0) + mv.quantity);
  }
  return {
    rows,
    deliveries: moves.filter((m) => m.type === 'delivered'),
    usage: moves.filter((m) => m.type !== 'delivered'),
    byActivity: [...byAct.entries()]
      .sort((a, b) => (a[0] === 'Not linked to an activity') - (b[0] === 'Not linked to an activity') || a[0].localeCompare(b[0]))
      .map(([activity, mats]) => ({ activity, items: [...mats.entries()].map(([k, qty]) => ({ material: k.split('|')[0], unit: k.split('|')[1], qty })) })),
  };
}

export function renderMaterialsPdf({ project, from, to, data, branding = {} }, stream) {
  const C = reportPalette(branding.color);
  const single = from === to;
  const period = single ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
  const doc = makeDoc({ layout: 'landscape', title: `${project.name} – Materials register ${single ? from : `${from} to ${to}`}`, branding });
  doc.pipe(stream);
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const { rows, deliveries, usage, byActivity } = data;
  const movements = deliveries.length + usage.length;

  const band = drawBrandHeader(doc, {
    C,
    branding,
    title: 'MATERIALS REGISTER',
    lines: [project.name + (project.code ? `  ·  ${project.code}` : ''), period],
    right: `${movements} entr${movements === 1 ? 'y' : 'ies'}`,
  });
  const low = rows.filter((r) => r.active && (r.low || r.negative));
  doc.y = summaryBoxes(doc, C, band + 18, [
    { label: 'Materials tracked', value: rows.filter((r) => r.active).length },
    { label: 'Deliveries', value: deliveries.length, color: C.good },
    { label: 'Usage entries', value: usage.filter((u) => u.type === 'used').length },
    { label: 'Wastage entries', value: usage.filter((u) => u.type === 'wasted').length, color: usage.some((u) => u.type === 'wasted') ? C.warn : undefined },
    { label: `Low stock ${single ? 'at end of day' : 'at end'}`, value: low.length, color: low.length ? C.bad : undefined },
  ]);

  const empty = (t) => doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.muted).text(t, L, doc.y, { width: W });

  // ---------- Stock summary
  sectionTitle(doc, C, 'Stock summary');
  if (!rows.length) empty('No materials on this project yet.');
  else {
    table(
      doc,
      C,
      [
        { label: 'Material', w: 0.25, bold: (r) => r.flag },
        { label: 'Unit', w: 0.08 },
        { label: single ? 'Opening' : 'Stock at start', w: 0.1, align: 'right' },
        { label: 'Received', w: 0.1, align: 'right', color: (r) => (r[3] !== '–' ? C.good : C.muted) },
        { label: 'Used', w: 0.09, align: 'right' },
        { label: 'Wasted', w: 0.09, align: 'right', color: (r) => (r[5] !== '–' ? C.warn : C.muted) },
        { label: single ? 'Closing' : 'Stock at end', w: 0.11, align: 'right', bold: () => true, color: (r) => (r.flag ? C.bad : C.ink) },
        { label: 'Reorder at', w: 0.09, align: 'right' },
        { label: 'Status', w: 0.09, color: (r) => (r.flag ? C.bad : C.muted), bold: (r) => r.flag },
      ],
      rows.map((r) => {
        const row = [r.name + (r.active ? '' : ' (archived)'), r.unit, q0(r.opening), q(r.delivered), q(r.used), q(r.wasted), q0(r.closing), r.reorder_level != null ? q0(r.reorder_level) : '–', r.negative ? 'Check records' : r.low ? 'Low' : 'OK'];
        row.flag = r.low || r.negative;
        return row;
      }),
      { fontSize: 8.5 }
    );
    if (rows.some((r) => r.negative)) {
      doc.font('Helvetica').fontSize(8).fillColor(C.muted).text('"Check records": more was used than was recorded as in stock. A delivery or the opening stock is probably missing.', L, doc.y, { width: W });
    }
  }

  // ---------- Deliveries log
  sectionTitle(doc, C, `Deliveries received (${deliveries.length})`);
  if (!deliveries.length) empty('No deliveries in this period.');
  else {
    table(
      doc,
      C,
      [
        { label: 'Date', w: 0.08 },
        { label: 'Material', w: 0.22 },
        { label: 'Quantity', w: 0.11, align: 'right', bold: () => true },
        { label: 'Supplier', w: 0.17 },
        { label: 'Delivery note', w: 0.11 },
        { label: 'Notes', w: 0.2 },
        { label: 'Recorded by', w: 0.11 },
      ],
      deliveries.map((d) => [shortDate(d.date), d.material, `${q0(d.quantity)} ${d.unit}`, d.supplier || '', d.reference || '', d.notes || '', d.recorded_by || '']),
      { fontSize: 8.5 }
    );
  }

  // ---------- Usage & wastage log
  sectionTitle(doc, C, `Usage and wastage (${usage.length})`);
  if (!usage.length) empty('No usage recorded in this period.');
  else {
    table(
      doc,
      C,
      [
        { label: 'Date', w: 0.08 },
        { label: 'Material', w: 0.2 },
        { label: 'Quantity', w: 0.11, align: 'right', bold: () => true },
        { label: 'Type', w: 0.08, color: (r) => (r[3] === 'Wasted' ? C.warn : C.ink) },
        { label: 'Activity / location', w: 0.28 },
        { label: 'Notes', w: 0.25 },
      ],
      usage.map((u) => [shortDate(u.date), u.material, `${q0(u.quantity)} ${u.unit}`, u.type === 'wasted' ? 'Wasted' : 'Used', [u.activity_name, u.location].filter(Boolean).join(' – '), u.notes || '']),
      { fontSize: 8.5 }
    );
  }

  // ---------- Usage by activity
  if (byActivity.length) {
    sectionTitle(doc, C, 'Materials used by activity');
    const tableRows = [];
    for (const g of byActivity) {
      tableRows.push({ group: g.activity });
      for (const it of g.items) tableRows.push(['', it.material, `${q0(it.qty)} ${it.unit}`]);
    }
    table(doc, C, [{ label: '', w: 0.04 }, { label: 'Material', w: 0.5 }, { label: 'Total used', w: 0.46 }], tableRows, { fontSize: 8.5 });
  }

  if (low.length) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.bad).text('Needs attention: ', L, doc.y, { continued: true, width: W });
    doc.font('Helvetica').fillColor(C.ink).text(low.map((r) => `${r.name} ${q0(r.closing)} ${r.unit}${r.negative ? ' (check records)' : r.reorder_level != null ? ` (reorder at ${q0(r.reorder_level)})` : ''}`).join('; '));
  }

  signOff(doc, C, 'Storekeeper', 'Checked by (Site manager)');
  drawFooters(doc, C, [branding.name, project.name, `Materials register ${single ? from : `${from} to ${to}`}`]);
  doc.end();
}
