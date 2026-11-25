// Daily materials register: a project's materials list with stock, and dated deliveries / usage / wastage.
import express from 'express';
import { planOf } from './plans.js';
import path from 'node:path';
import { db, tx, UPLOAD_DIR } from './db.js';
import { companyProject } from './auth.js';
import { notifyLowStock } from './notifications.js';
import { materialsPeriodData, renderMaterialsPdf } from './materialsPdf.js';

db.exec(`
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'no.',
  category TEXT,
  opening_stock REAL NOT NULL DEFAULT 0,
  reorder_level REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS material_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  type TEXT NOT NULL,                 -- delivered | used | wasted
  quantity REAL NOT NULL,
  supplier TEXT,
  reference TEXT,                     -- delivery note / waybill number
  activity_id INTEGER REFERENCES activities(id) ON DELETE SET NULL,
  location TEXT,
  notes TEXT,
  recorded_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_materials_project ON materials(project_id);
CREATE INDEX IF NOT EXISTS idx_mm_project_date ON material_movements(project_id, date);
CREATE INDEX IF NOT EXISTS idx_mm_material ON material_movements(material_id);
`);

export const TYPES = { delivered: 'Delivered', used: 'Used', wasted: 'Wasted / damaged' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
const clean = (v, max = 120) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const r3 = (n) => Math.round(n * 1000) / 1000;

function materialFor(req, mid) {
  const m = db
    .prepare('SELECT m.* FROM materials m JOIN projects p ON p.id = m.project_id WHERE m.id = ? AND p.company_id = ?')
    .get(mid, req.company.id);
  if (!m) throw new HttpError(404, 'Material not found');
  return { ...m };
}
function movementFor(req, id) {
  const m = db
    .prepare('SELECT mm.* FROM material_movements mm JOIN projects p ON p.id = mm.project_id WHERE mm.id = ? AND p.company_id = ?')
    .get(id, req.company.id);
  if (!m) throw new HttpError(404, 'Entry not found');
  return { ...m };
}

/** Stock per material as at the end of `date` (inclusive), or before it when `before` is true. */
function balances(projectId, date, before = false) {
  const rows = db
    .prepare(
      `SELECT material_id,
         SUM(CASE WHEN type = 'delivered' THEN quantity ELSE -quantity END) AS net
       FROM material_movements WHERE project_id = ? AND date ${before ? '<' : '<='} ?
       GROUP BY material_id`
    )
    .all(projectId, date);
  return new Map(rows.map((r) => [r.material_id, r.net || 0]));
}

function materialsWithStock(projectId, asOf) {
  const bal = balances(projectId, asOf);
  const last = new Map(
    db
      .prepare(`SELECT material_id, MAX(date) d FROM material_movements WHERE project_id = ? AND type = 'delivered' GROUP BY material_id`)
      .all(projectId)
      .map((r) => [r.material_id, r.d])
  );
  const counts = new Map(db.prepare('SELECT material_id, COUNT(*) n FROM material_movements WHERE project_id = ? GROUP BY material_id').all(projectId).map((r) => [r.material_id, r.n]));
  return db
    .prepare(`SELECT * FROM materials WHERE project_id = ? ORDER BY active DESC, lower(COALESCE(category, 'zzz')), lower(name)`)
    .all(projectId)
    .map((m) => {
      const stock = r3(m.opening_stock + (bal.get(m.id) || 0));
      return {
        ...m,
        active: Boolean(m.active),
        stock,
        low: m.reorder_level != null && stock <= m.reorder_level,
        negative: stock < 0,
        last_delivery: last.get(m.id) || null,
        movement_count: counts.get(m.id) || 0,
      };
    });
}

/**
 * One day's materials picture, used by the register page and the daily report PDF.
 * Returns null when the project has no materials at all.
 */
export function materialsDay(projectId, date) {
  const mats = db.prepare('SELECT * FROM materials WHERE project_id = ?').all(projectId);
  if (!mats.length) return null;
  const before = balances(projectId, date, true);
  const moves = db
    .prepare(
      `SELECT mm.*, m.name AS material, m.unit, a.name AS activity_name
       FROM material_movements mm JOIN materials m ON m.id = mm.material_id
       LEFT JOIN activities a ON a.id = mm.activity_id
       WHERE mm.project_id = ? AND mm.date = ? ORDER BY mm.created_at, mm.id`
    )
    .all(projectId, date)
    .map((r) => ({ ...r }));
  const byMat = new Map();
  for (const mv of moves) {
    if (!byMat.has(mv.material_id)) byMat.set(mv.material_id, { delivered: 0, used: 0, wasted: 0 });
    byMat.get(mv.material_id)[mv.type] += mv.quantity;
  }
  const rows = [];
  const low = [];
  for (const m of mats) {
    const opening = r3(m.opening_stock + (before.get(m.id) || 0));
    const d = byMat.get(m.id) || { delivered: 0, used: 0, wasted: 0 };
    const closing = r3(opening + d.delivered - d.used - d.wasted);
    const isLow = m.reorder_level != null && closing <= m.reorder_level;
    if (byMat.has(m.id)) rows.push({ material_id: m.id, name: m.name, unit: m.unit, opening, delivered: r3(d.delivered), used: r3(d.used), wasted: r3(d.wasted), closing, low: isLow, negative: closing < 0 });
    if (m.active && (isLow || closing < 0)) low.push({ name: m.name, unit: m.unit, stock: closing, reorder_level: m.reorder_level });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return {
    date,
    rows,
    low,
    deliveries: moves.filter((m) => m.type === 'delivered'),
    usage: moves.filter((m) => m.type !== 'delivered'),
    movement_count: moves.length,
  };
}

export const materialsRouter = express.Router();

// ---------- materials list

materialsRouter.get('/projects/:id/materials', (req, res) => {
  const p = companyProject(req, req.params.id);
  const asOf = isDate(req.query.date) ? req.query.date : '9999-12-31';
  res.json({ materials: materialsWithStock(p.id, asOf) });
});

function readMaterial(r) {
  const opening = num(r.opening_stock);
  const reorder = num(r.reorder_level);
  if (Number.isNaN(opening) || Number.isNaN(reorder)) throw new HttpError(400, `Stock figures for "${r.name}" must be numbers.`);
  return { name: clean(r.name), unit: clean(r.unit, 20) || 'no.', category: clean(r.category), opening_stock: opening ?? 0, reorder_level: reorder };
}

/** Add one material, or many with {lines: "Name, Unit, Opening stock, Reorder level\n…"}. */
materialsRouter.post('/projects/:id/materials', (req, res) => {
  const p = companyProject(req, req.params.id);
  const b = req.body || {};
  let rows;
  if (typeof b.lines === 'string') {
    rows = b.lines
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = (l.includes('\t') ? l.split('\t') : l.split(',')).map((s) => s.trim());
        return { name: parts[0], unit: parts[1], opening_stock: parts[2], reorder_level: parts[3] };
      });
  } else rows = [b];
  rows = rows.filter((r) => clean(r.name));
  if (!rows.length) throw new HttpError(400, 'Enter at least one material name.');
  if (rows.length > 500) throw new HttpError(400, 'Add at most 500 materials at a time.');
  const parsed = rows.map(readMaterial);
  const existing = new Set(db.prepare('SELECT lower(name) n FROM materials WHERE project_id = ?').all(p.id).map((r) => r.n));
  let added = 0;
  const skipped = [];
  tx(() => {
    const ins = db.prepare('INSERT INTO materials (project_id, name, unit, category, opening_stock, reorder_level) VALUES (?,?,?,?,?,?)');
    for (const m of parsed) {
      if (existing.has(m.name.toLowerCase())) {
        skipped.push(m.name);
        continue;
      }
      existing.add(m.name.toLowerCase());
      ins.run(p.id, m.name, m.unit, m.category, m.opening_stock, m.reorder_level);
      added++;
    }
  });
  const created = added === 1 && rows.length === 1 ? db.prepare('SELECT id FROM materials WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(p.id)?.id : null;
  res.status(201).json({ added, skipped, created_id: created, materials: materialsWithStock(p.id, '9999-12-31') });
});

materialsRouter.put('/materials/:mid', (req, res) => {
  const m = materialFor(req, req.params.mid);
  const b = req.body || {};
  const next = readMaterial({
    name: b.name !== undefined ? b.name : m.name,
    unit: b.unit !== undefined ? b.unit : m.unit,
    category: b.category !== undefined ? b.category : m.category,
    opening_stock: b.opening_stock !== undefined ? b.opening_stock : m.opening_stock,
    reorder_level: b.reorder_level !== undefined ? b.reorder_level : m.reorder_level,
  });
  if (!next.name) throw new HttpError(400, 'Material name is required.');
  const dup = db.prepare('SELECT 1 FROM materials WHERE project_id = ? AND lower(name) = lower(?) AND id != ?').get(m.project_id, next.name, m.id);
  if (dup) throw new HttpError(409, `There is already a material called "${next.name}".`);
  const active = b.active !== undefined ? (b.active ? 1 : 0) : m.active;
  db.prepare('UPDATE materials SET name=?, unit=?, category=?, opening_stock=?, reorder_level=?, active=? WHERE id=?').run(
    next.name, next.unit, next.category, next.opening_stock, next.reorder_level, active, m.id
  );
  res.json({ materials: materialsWithStock(m.project_id, '9999-12-31') });
});

materialsRouter.delete('/materials/:mid', (req, res) => {
  const m = materialFor(req, req.params.mid);
  const used = db.prepare('SELECT 1 FROM material_movements WHERE material_id = ? LIMIT 1').get(m.id);
  if (used) db.prepare('UPDATE materials SET active = 0 WHERE id = ?').run(m.id);
  else db.prepare('DELETE FROM materials WHERE id = ?').run(m.id);
  res.json({ removed: !used, archived: Boolean(used), materials: materialsWithStock(m.project_id, '9999-12-31') });
});

// ---------- daily movements

function readMovement(req, projectId, b, existing = {}) {
  const v = { ...existing, ...b };
  if (!isDate(v.date)) throw new HttpError(400, 'Choose a date.');
  if (!TYPES[v.type]) throw new HttpError(400, 'Choose delivered, used or wasted.');
  const qty = num(v.quantity);
  if (qty == null || Number.isNaN(qty) || qty <= 0) throw new HttpError(400, 'Enter a quantity greater than zero.');
  const mat = db.prepare('SELECT * FROM materials WHERE id = ? AND project_id = ?').get(v.material_id, projectId);
  if (!mat) throw new HttpError(400, 'Choose a material from the list.');
  let activityId = v.activity_id ? Number(v.activity_id) : null;
  if (activityId && !db.prepare('SELECT 1 FROM activities WHERE id = ? AND project_id = ?').get(activityId, projectId)) activityId = null;
  return {
    material_id: mat.id,
    date: v.date,
    type: v.type,
    quantity: qty,
    supplier: v.type === 'delivered' ? clean(v.supplier) : null,
    reference: v.type === 'delivered' ? clean(v.reference, 60) : null,
    activity_id: v.type === 'delivered' ? null : activityId,
    location: clean(v.location),
    notes: clean(v.notes, 500),
    unit: mat.unit,
    name: mat.name,
  };
}

/** Stock check after a change: warns when a material would go below zero on any later day. */
function stockWarning(projectId, materialId) {
  const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  const moves = db.prepare('SELECT date, type, quantity FROM material_movements WHERE material_id = ? ORDER BY date, id').all(materialId);
  let bal = m.opening_stock;
  for (const mv of moves) {
    bal += mv.type === 'delivered' ? mv.quantity : -mv.quantity;
    if (bal < -1e-9) {
      return `${m.name}: usage on ${mv.date} takes stock below zero (${r3(bal)} ${m.unit}). Check that all deliveries and the opening stock are recorded.`;
    }
  }
  return null;
}


/** Current stock (all recorded days) and whether it is at/below the reorder level or negative. */
function stockState(materialId) {
  const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  const net = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'delivered' THEN quantity ELSE -quantity END), 0) n FROM material_movements WHERE material_id = ?").get(materialId).n;
  const stock = r3(m.opening_stock + net);
  return { m, stock, flagged: stock < 0 || (m.reorder_level != null && stock <= m.reorder_level) };
}
function alertIfNewlyLow(req, projectId, materialId, wasFlagged) {
  const after = stockState(materialId);
  if (!wasFlagged && after.flagged && after.m.active) {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    notifyLowStock({ project, material: after.m, stock: after.stock, byUser: req.user });
  }
}

materialsRouter.post('/projects/:id/material-movements', (req, res) => {
  const p = companyProject(req, req.params.id);
  const v = readMovement(req, p.id, req.body || {});
  const was = stockState(v.material_id).flagged;
  db.prepare(
    'INSERT INTO material_movements (project_id, material_id, date, type, quantity, supplier, reference, activity_id, location, notes, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(p.id, v.material_id, v.date, v.type, v.quantity, v.supplier, v.reference, v.activity_id, v.location, v.notes, req.user.name);
  alertIfNewlyLow(req, p.id, v.material_id, was);
  res.status(201).json({ ok: true, warning: stockWarning(p.id, v.material_id), day: materialsDay(p.id, v.date) });
});

materialsRouter.put('/material-movements/:mvid', (req, res) => {
  const mv = movementFor(req, req.params.mvid);
  const v = readMovement(req, mv.project_id, req.body || {}, mv);
  const was = stockState(v.material_id).flagged;
  db.prepare('UPDATE material_movements SET material_id=?, date=?, type=?, quantity=?, supplier=?, reference=?, activity_id=?, location=?, notes=? WHERE id=?').run(
    v.material_id, v.date, v.type, v.quantity, v.supplier, v.reference, v.activity_id, v.location, v.notes, mv.id
  );
  alertIfNewlyLow(req, mv.project_id, v.material_id, was);
  res.json({ ok: true, warning: stockWarning(mv.project_id, v.material_id) || (v.material_id !== mv.material_id ? stockWarning(mv.project_id, mv.material_id) : null), day: materialsDay(mv.project_id, v.date) });
});

materialsRouter.delete('/material-movements/:mvid', (req, res) => {
  const mv = movementFor(req, req.params.mvid);
  db.prepare('DELETE FROM material_movements WHERE id = ?').run(mv.id);
  res.json({ ok: true, warning: stockWarning(mv.project_id, mv.material_id), day: materialsDay(mv.project_id, mv.date) });
});

materialsRouter.get('/projects/:id/materials/day/:date', (req, res) => {
  const p = companyProject(req, req.params.id);
  const { date } = req.params;
  if (!isDate(date)) throw new HttpError(400, 'Invalid date');
  const activities = db.prepare('SELECT id, code, name, section FROM activities WHERE project_id = ? ORDER BY sort_order, id').all(p.id);
  res.json({
    project: { id: p.id, name: p.name, code: p.code },
    date,
    types: TYPES,
    materials: materialsWithStock(p.id, date),
    day: materialsDay(p.id, date),
    activities,
  });
});

/** Dashboard panel: stock on hand, low stock and today's activity. */
materialsRouter.get('/projects/:id/materials-overview', (req, res) => {
  const p = companyProject(req, req.params.id);
  const today = isDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
  const materials = materialsWithStock(p.id, today).filter((m) => m.active);
  const day = materials.length ? materialsDay(p.id, today) : null;
  const since = new Date(Date.parse(today) - 6 * 86400000).toISOString().slice(0, 10);
  const week = db
    .prepare(`SELECT type, COUNT(*) n FROM material_movements WHERE project_id = ? AND date BETWEEN ? AND ? GROUP BY type`)
    .all(p.id, since, today);
  res.json({
    materials,
    low: materials.filter((m) => m.low || m.negative),
    today: day ? { deliveries: day.deliveries.length, usage: day.usage.length, rows: day.rows } : null,
    week: Object.fromEntries(week.map((w) => [w.type, w.n])),
  });
});

// ---------- PDF download (one day up to ~3 months)

materialsRouter.get('/projects/:id/materials-pdf', (req, res) => {
  const p = companyProject(req, req.params.id);
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'Choose a start and end date.');
  if (from > to) throw new HttpError(400, 'The start date must be before the end date.');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 92) throw new HttpError(400, 'Choose a period of up to 92 days.');
  const branding = {
    name: req.company.name,
    color: req.company.primary_color,
    logoPath: req.company.logo_filename ? path.join(UPLOAD_DIR, req.company.logo_filename) : null,
    white_label: planOf(req.company.id).features.white_label, // no "Made with Proj4D" footer
  };
  const safe = (p.code || p.name).replace(/[^\w-]+/g, '_').slice(0, 40);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${safe}_Materials_${from === to ? from : `${from}_to_${to}`}.pdf"`);
  renderMaterialsPdf({ project: p, from, to, data: materialsPeriodData(p.id, from, to), branding }, res);
});
