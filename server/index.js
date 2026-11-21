import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, tx, decodeReport, computeOverall, refreshProject, UPLOAD_DIR } from './db.js';
import { parseProgramme } from './programme.js';
import { renderReportPdf } from './pdf.js';
import { aiEnabled, describeAIError, parseSiteNotes, generateReportSummary, templateSummary, generateInsights } from './ai.js';
import { authRouter, loadSession, sameOrigin, requireUser, companyProject, assertActivityAccess, assertReportAccess, photoForCompany } from './auth.js';

const app = express();
app.disable('x-powered-by');

// Health check for the host (no password, reveals nothing).
app.get('/healthz', (_req, res) => res.send('ok'));

app.set('trust proxy', 1); // behind Render's proxy: lets secure cookies and req.ip work
app.use(express.json({ limit: '5mb' }));
app.use(loadSession);
app.use(sameOrigin);
app.use('/api/auth', authRouter);
// Everything else under /api and /uploads needs a logged-in user; data is scoped to their company.
app.use(['/api', '/uploads'], requireUser);

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
});
const photoUpload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png)$/.test(file.mimetype)),
});
const programmeUpload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });
const logoUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png)$/.test(file.mimetype)),
});
const HEX = /^#[0-9a-f]{6}$/i;

const today = () => new Date().toISOString().slice(0, 10);
const round1 = (n) => Math.round(n * 10) / 10;
const clampPct = (n) => Math.min(100, Math.max(0, round1(Number(n) || 0)));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const getProject = (req, id) => companyProject(req, id);
const requireCompanyAdmin = (req) => {
  if (req.user.role !== 'admin') throw new HttpError(403, 'Only company admins can do this.');
};

/** Planned % complete for an activity on a given date, from its programme dates (linear). */
function plannedPct(a, on = today()) {
  if (!a.start_date || !a.end_date) return null;
  const s = Date.parse(a.start_date), e = Date.parse(a.end_date), t = Date.parse(on);
  if (t < s) return 0;
  if (t >= e) return 100;
  return round1(((t - s) / 86400000 + 1) / ((e - s) / 86400000 + 1) * 100);
}

function plannedOverall(acts, on) {
  const dated = acts.filter((a) => a.start_date && a.end_date);
  if (!dated.length) return null;
  const tw = acts.reduce((s, a) => s + a.weight, 0);
  return round1(dated.reduce((s, a) => s + a.weight * plannedPct(a, on), 0) / tw);
}

function listActivities(projectId) {
  return db
    .prepare('SELECT * FROM activities WHERE project_id = ? ORDER BY sort_order, id')
    .all(projectId)
    .map((a) => ({ ...a, planned: plannedPct(a) }));
}

function defaultWeight(projectId) {
  const ws = db.prepare('SELECT weight FROM activities WHERE project_id = ? ORDER BY weight').all(projectId).map((r) => r.weight);
  return ws.length ? ws[Math.floor(ws.length / 2)] : 1;
}

// ------------------------------------------------------------------ Status

app.get('/api/status', (_req, res) => res.json({ ai: aiEnabled() }));

// ------------------------------------------------------------------ Projects

app.get('/api/projects', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM activities a WHERE a.project_id = p.id) AS activity_count,
        (SELECT COUNT(*) FROM reports r WHERE r.project_id = p.id) AS report_count,
        (SELECT MAX(report_date) FROM reports r WHERE r.project_id = p.id) AS last_report
       FROM projects p WHERE p.company_id = ? ORDER BY p.created_at DESC, p.id DESC`
    )
    .all(req.company.id);
  res.json(rows.map((p) => ({ ...p, overall_progress: computeOverall(p.id) })));
});

const PROJECT_FIELDS = ['name', 'code', 'client', 'location', 'contractor', 'supervisor', 'start_date', 'end_date', 'description'];

app.post('/api/projects', (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) throw new HttpError(400, 'Project name is required');
  const vals = PROJECT_FIELDS.map((f) => (b[f] ?? '').toString().trim() || null);
  const r = db
    .prepare(`INSERT INTO projects (company_id, ${PROJECT_FIELDS.join(',')}) VALUES (?, ${PROJECT_FIELDS.map(() => '?').join(',')})`)
    .run(req.company.id, ...vals);
  res.status(201).json(getProject(req, r.lastInsertRowid));
});

app.get('/api/projects/:id', (req, res) => {
  const p = getProject(req, req.params.id);
  const activities = listActivities(p.id);
  const reports = db
    .prepare(
      `SELECT r.id, r.report_date, r.supervisor, r.overall_progress, r.issues, r.weather, r.created_at,
        (SELECT COUNT(*) FROM report_items i WHERE i.report_id = r.id) AS item_count,
        (SELECT COUNT(*) FROM photos ph WHERE ph.report_id = r.id) AS photo_count
       FROM reports r WHERE r.project_id = ? ORDER BY r.report_date DESC`
    )
    .all(p.id)
    .map((r) => {
      const d = decodeReport(r);
      return { ...d, issue_count: d.issues.length, weather: d.weather?.condition || null, issues: undefined };
    });
  const overall = computeOverall(p.id);
  const curve = [...reports].reverse().map((r) => ({ date: r.report_date, actual: r.overall_progress, planned: plannedOverall(activities, r.report_date) }));
  res.json({ ...p, overall_progress: overall, planned_progress: plannedOverall(activities), activities, reports, curve });
});

app.put('/api/projects/:id', (req, res) => {
  getProject(req, req.params.id);
  const b = req.body || {};
  if (b.name !== undefined && !String(b.name).trim()) throw new HttpError(400, 'Project name is required');
  const sets = PROJECT_FIELDS.filter((f) => b[f] !== undefined);
  if (sets.length) {
    db.prepare(`UPDATE projects SET ${sets.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(
      ...sets.map((f) => (b[f] ?? '').toString().trim() || null),
      req.params.id
    );
  }
  res.json(getProject(req, req.params.id));
});

app.delete('/api/projects/:id', (req, res) => {
  getProject(req, req.params.id);
  requireCompanyAdmin(req);
  const files = db
    .prepare('SELECT ph.filename FROM photos ph JOIN reports r ON r.id = ph.report_id WHERE r.project_id = ?')
    .all(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  for (const f of files) fs.rm(path.join(UPLOAD_DIR, f.filename), { force: true }, () => {});
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Programme & activities

app.post(
  '/api/projects/:id/programme/preview',
  programmeUpload.single('file'),
  wrap(async (req, res) => {
    getProject(req, req.params.id);
    if (!req.file) throw new HttpError(400, 'No file uploaded');
    try {
      const result = await parseProgramme(req.file.path, req.file.originalname, req.file.mimetype);
      db.prepare('UPDATE projects SET programme_file = ? WHERE id = ?').run(req.file.originalname, req.params.id);
      res.json(result);
    } catch (e) {
      throw new HttpError(422, describeAIError(e));
    } finally {
      fs.rm(req.file.path, { force: true }, () => {});
    }
  })
);

app.post('/api/projects/:id/activities/bulk', (req, res) => {
  const p = getProject(req, req.params.id);
  const { activities = [], mode = 'append' } = req.body || {};
  const clean = activities
    .filter((a) => a?.name?.trim())
    .map((a) => ({
      code: a.code?.toString().trim() || null,
      name: a.name.trim(),
      section: a.section?.trim() || null,
      start_date: a.start_date || null,
      end_date: a.end_date || null,
      weight: Number(a.weight) > 0 ? Number(a.weight) : 1,
    }));
  const stats = tx(() => {
    const existing = db.prepare('SELECT * FROM activities WHERE project_id = ?').all(p.id);
    const key = (a) => (a.code ? `c:${a.code.toLowerCase()}` : `n:${a.name.toLowerCase()}`);
    const byKey = new Map(existing.map((a) => [key(a), a]));
    const byName = new Map(existing.map((a) => [a.name.toLowerCase(), a]));
    let order = mode === 'replace' ? 0 : db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM activities WHERE project_id = ?').get(p.id).m;
    const touched = new Set();
    let added = 0, updated = 0, removed = 0;
    const ins = db.prepare('INSERT INTO activities (project_id, code, name, section, start_date, end_date, weight, source, sort_order) VALUES (?,?,?,?,?,?,?,?,?)');
    const upd = db.prepare('UPDATE activities SET code=?, name=?, section=?, start_date=?, end_date=?, weight=?, source=?, sort_order=? WHERE id=?');
    for (const a of clean) {
      const match = byKey.get(key(a)) || byName.get(a.name.toLowerCase());
      order++;
      if (match && !touched.has(match.id)) {
        upd.run(a.code, a.name, a.section, a.start_date, a.end_date, a.weight, 'programme', order, match.id);
        touched.add(match.id);
        updated++;
      } else {
        ins.run(p.id, a.code, a.name, a.section, a.start_date, a.end_date, a.weight, 'programme', order);
        added++;
      }
    }
    if (mode === 'replace') {
      // Remove programme activities no longer in the programme, unless progress was reported against them.
      for (const a of existing) {
        if (touched.has(a.id) || a.source === 'manual') continue;
        const used = db.prepare('SELECT 1 FROM report_items WHERE activity_id = ? LIMIT 1').get(a.id);
        if (!used) {
          db.prepare('DELETE FROM activities WHERE id = ?').run(a.id);
          removed++;
        }
      }
    }
    refreshProject(p.id);
    return { added, updated, removed };
  });
  res.json({ ...stats, activities: listActivities(p.id), overall_progress: computeOverall(p.id) });
});

app.post('/api/projects/:id/activities', (req, res) => {
  const p = getProject(req, req.params.id);
  const b = req.body || {};
  if (!b.name?.trim()) throw new HttpError(400, 'Activity name is required');
  const order = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 m FROM activities WHERE project_id = ?').get(p.id).m;
  db.prepare('INSERT INTO activities (project_id, code, name, section, start_date, end_date, weight, source, sort_order) VALUES (?,?,?,?,?,?,?,?,?)').run(
    p.id, b.code || null, b.name.trim(), b.section || null, b.start_date || null, b.end_date || null,
    Number(b.weight) > 0 ? Number(b.weight) : defaultWeight(p.id), 'manual', order
  );
  refreshProject(p.id);
  res.status(201).json({ activities: listActivities(p.id), overall_progress: computeOverall(p.id) });
});

app.put('/api/activities/:aid', (req, res) => {
  const a = assertActivityAccess(req, req.params.aid);
  const b = req.body || {};
  const next = {
    code: b.code !== undefined ? b.code || null : a.code,
    name: b.name !== undefined ? String(b.name).trim() || a.name : a.name,
    section: b.section !== undefined ? b.section || null : a.section,
    start_date: b.start_date !== undefined ? b.start_date || null : a.start_date,
    end_date: b.end_date !== undefined ? b.end_date || null : a.end_date,
    weight: b.weight !== undefined && Number(b.weight) > 0 ? Number(b.weight) : a.weight,
  };
  db.prepare('UPDATE activities SET code=?, name=?, section=?, start_date=?, end_date=?, weight=? WHERE id=?').run(
    next.code, next.name, next.section, next.start_date, next.end_date, next.weight, a.id
  );
  refreshProject(a.project_id);
  res.json({ activities: listActivities(a.project_id), overall_progress: computeOverall(a.project_id) });
});

app.delete('/api/activities/:aid', (req, res) => {
  const a = assertActivityAccess(req, req.params.aid);
  db.prepare('DELETE FROM activities WHERE id = ?').run(a.id);
  refreshProject(a.project_id);
  res.json({ activities: listActivities(a.project_id), overall_progress: computeOverall(a.project_id) });
});

app.delete('/api/projects/:id/activities', (req, res) => {
  const p = getProject(req, req.params.id);
  db.prepare('DELETE FROM activities WHERE project_id = ?').run(p.id);
  refreshProject(p.id);
  res.json({ activities: [], overall_progress: 0 });
});

// ------------------------------------------------------------------ Daily reports

function loadReport(req, rid) {
  assertReportAccess(req, rid);
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(rid);
  if (!row) throw new HttpError(404, 'Report not found');
  const report = decodeReport(row);
  const items = db.prepare('SELECT * FROM report_items WHERE report_id = ? ORDER BY id').all(rid).map((i) => ({ ...i }));
  const photos = db.prepare('SELECT * FROM photos WHERE report_id = ? ORDER BY id').all(rid).map((p) => ({ ...p, url: `/uploads/${p.filename}` }));
  const reportNo = db.prepare('SELECT COUNT(*) n FROM reports WHERE project_id = ? AND report_date <= ?').get(report.project_id, report.report_date).n;
  return { report, items, photos, reportNo };
}

const arr = (v) => (Array.isArray(v) ? v : []);
const keepRows = (rows, key) => arr(rows).filter((r) => r && String(r[key] ?? '').trim());

/** Progress of an activity as of the last report dated before `date` (excluding `excludeReportId`). */
function progressBefore(activityId, projectId, date, excludeReportId) {
  const r = db
    .prepare(
      `SELECT ri.progress FROM report_items ri JOIN reports r ON r.id = ri.report_id
       WHERE ri.activity_id = ? AND r.project_id = ? AND r.report_date < ? AND r.id != ?
       ORDER BY r.report_date DESC, ri.id DESC LIMIT 1`
    )
    .get(activityId, projectId, date, excludeReportId ?? -1);
  return r ? r.progress : 0;
}

async function saveReport(req, res, existingId) {
  const project = existingId
    ? (assertReportAccess(req, existingId), getProject(req, db.prepare('SELECT project_id FROM reports WHERE id = ?').get(existingId).project_id))
    : getProject(req, req.params.id);
  let data;
  try {
    data = JSON.parse(req.body?.data || '{}');
  } catch {
    throw new HttpError(400, 'Invalid report data');
  }
  const date = data.report_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new HttpError(400, 'Report date is required');
  const dup = db.prepare('SELECT id FROM reports WHERE project_id = ? AND report_date = ? AND id != ?').get(project.id, date, existingId ?? -1);
  if (dup) throw new HttpError(409, `A report for ${date} already exists for this project. Open it to edit instead.`);

  const rawItems = arr(data.items).filter((i) => i && (i.activity_id || String(i.activity_name || '').trim()));
  if (!rawItems.length) throw new HttpError(400, 'Add at least one activity with its progress');

  const fields = {
    supervisor: String(data.supervisor || '').trim() || null,
    weather: data.weather && typeof data.weather === 'object' ? data.weather : {},
    labour: keepRows(data.labour, 'trade').map((l) => ({ trade: String(l.trade).trim(), count: Number(l.count) || 0 })),
    equipment: keepRows(data.equipment, 'name'),
    materials: keepRows(data.materials, 'material'),
    visitors: keepRows(data.visitors, 'name'),
    issues: keepRows(data.issues, 'description'),
    notes: String(data.notes || '').trim() || null,
  };

  const captions = (() => {
    try { return JSON.parse(req.body?.captions || '[]'); } catch { return []; }
  })();
  const removePhotos = arr(data.remove_photo_ids).map(Number);

  const reportId = tx(() => {
    let rid = existingId;
    const enc = (v) => JSON.stringify(v);
    if (rid) {
      db.prepare('UPDATE reports SET report_date=?, supervisor=?, weather=?, labour=?, equipment=?, materials=?, visitors=?, issues=?, notes=? WHERE id=?').run(
        date, fields.supervisor, enc(fields.weather), enc(fields.labour), enc(fields.equipment), enc(fields.materials), enc(fields.visitors), enc(fields.issues), fields.notes, rid
      );
      db.prepare('DELETE FROM report_items WHERE report_id = ?').run(rid);
    } else {
      rid = db
        .prepare('INSERT INTO reports (project_id, report_date, supervisor, weather, labour, equipment, materials, visitors, issues, notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(project.id, date, fields.supervisor, enc(fields.weather), enc(fields.labour), enc(fields.equipment), enc(fields.materials), enc(fields.visitors), enc(fields.issues), fields.notes)
        .lastInsertRowid;
    }

    const insItem = db.prepare('INSERT INTO report_items (report_id, activity_id, activity_name, progress_before, progress, remarks) VALUES (?,?,?,?,?,?)');
    const seen = new Set();
    for (const it of rawItems) {
      let act = it.activity_id ? db.prepare('SELECT * FROM activities WHERE id = ? AND project_id = ?').get(it.activity_id, project.id) : null;
      if (!act) {
        const name = String(it.activity_name).trim();
        act = db.prepare('SELECT * FROM activities WHERE project_id = ? AND lower(name) = lower(?)').get(project.id, name);
        if (!act) {
          // Manually entered task not on the programme: add it to the project's activity list.
          const order = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 m FROM activities WHERE project_id = ?').get(project.id).m;
          const id = db
            .prepare('INSERT INTO activities (project_id, name, section, weight, source, sort_order) VALUES (?,?,?,?,?,?)')
            .run(project.id, name, 'Additional works', defaultWeight(project.id), 'manual', order).lastInsertRowid;
          act = db.prepare('SELECT * FROM activities WHERE id = ?').get(id);
        }
      }
      if (seen.has(act.id)) continue;
      seen.add(act.id);
      insItem.run(rid, act.id, act.name, progressBefore(act.id, project.id, date, rid), clampPct(it.progress), String(it.remarks || '').trim() || null);
    }

    if (removePhotos.length) {
      for (const pid of removePhotos) {
        const ph = db.prepare('SELECT * FROM photos WHERE id = ? AND report_id = ?').get(pid, rid);
        if (ph) {
          db.prepare('DELETE FROM photos WHERE id = ?').run(pid);
          fs.rm(path.join(UPLOAD_DIR, ph.filename), { force: true }, () => {});
        }
      }
    }
    for (const [idx, f] of (req.files || []).entries()) {
      db.prepare('INSERT INTO photos (report_id, filename, original_name, caption) VALUES (?,?,?,?)').run(rid, f.filename, f.originalname, String(captions[idx] || '').trim() || null);
    }
    refreshProject(project.id);
    return rid;
  });

  // Narrative summary (AI when available, template otherwise).
  const { report, items } = loadReport(req, reportId);
  const prev = db.prepare('SELECT overall_progress FROM reports WHERE project_id = ? AND report_date < ? ORDER BY report_date DESC LIMIT 1').get(project.id, date);
  const ctx = { project, report, items, overall: report.overall_progress, previousOverall: prev?.overall_progress ?? null };
  let summary, source = 'template', aiError = null;
  if (aiEnabled() && data.ai_summary !== false) {
    try {
      summary = await generateReportSummary(ctx);
      source = 'ai';
    } catch (e) {
      aiError = describeAIError(e);
      console.warn('AI summary failed:', aiError);
    }
  }
  if (!summary) summary = templateSummary(ctx);
  db.prepare('UPDATE reports SET summary = ?, summary_source = ? WHERE id = ?').run(summary, source, reportId);
  res.status(existingId ? 200 : 201).json({ ...loadReport(req, reportId), ai_error: aiError });
}

app.post('/api/projects/:id/reports', photoUpload.array('photos', 30), wrap((req, res) => saveReport(req, res, null)));
app.put('/api/reports/:rid', photoUpload.array('photos', 30), wrap((req, res) => saveReport(req, res, Number(req.params.rid))));

app.get('/api/reports/:rid', (req, res) => {
  const data = loadReport(req, req.params.rid);
  res.json({ ...data, project: getProject(req, data.report.project_id) });
});

app.delete('/api/reports/:rid', (req, res) => {
  const { report, photos } = loadReport(req, req.params.rid);
  db.prepare('DELETE FROM reports WHERE id = ?').run(report.id);
  for (const p of photos) fs.rm(path.join(UPLOAD_DIR, p.filename), { force: true }, () => {});
  refreshProject(report.project_id);
  res.json({ ok: true });
});

app.get('/api/reports/:rid/pdf', (req, res) => {
  const data = loadReport(req, req.params.rid);
  const project = getProject(req, data.report.project_id);
  const safe = (project.code || project.name).replace(/[^\w-]+/g, '_').slice(0, 40);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${safe}_Daily_Report_${data.report.report_date}.pdf"`);
  const branding = {
    name: req.company.name,
    color: req.company.primary_color,
    logoPath: req.company.logo_filename ? path.join(UPLOAD_DIR, req.company.logo_filename) : null,
  };
  renderReportPdf({ project, ...data, branding }, res);
});

app.post(
  '/api/reports/:rid/summary',
  wrap(async (req, res) => {
    const { report, items } = loadReport(req, req.params.rid);
    const project = getProject(req, report.project_id);
    if (!aiEnabled()) throw new HttpError(400, 'AI is not configured on the server (set ANTHROPIC_API_KEY).');
    const prev = db.prepare('SELECT overall_progress FROM reports WHERE project_id = ? AND report_date < ? ORDER BY report_date DESC LIMIT 1').get(project.id, report.report_date);
    try {
      const summary = await generateReportSummary({ project, report, items, overall: report.overall_progress, previousOverall: prev?.overall_progress ?? null });
      db.prepare("UPDATE reports SET summary = ?, summary_source = 'ai' WHERE id = ?").run(summary, report.id);
      res.json({ summary });
    } catch (e) {
      throw new HttpError(502, describeAIError(e));
    }
  })
);

// ------------------------------------------------------------------ Company branding (logo + colour on PDFs)

const requireAdminRole = (req) => {
  if (req.user.role !== 'admin') throw new HttpError(403, 'Only company admins can change company settings.');
};

app.get('/api/company/logo', (req, res) => {
  if (!req.company.logo_filename) throw new HttpError(404, 'No logo');
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(UPLOAD_DIR, req.company.logo_filename));
});

app.put('/api/company', (req, res) => {
  requireAdminRole(req);
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) throw new HttpError(400, 'Company name is required');
    db.prepare('UPDATE companies SET name = ? WHERE id = ?').run(name.slice(0, 120), req.company.id);
  }
  if (b.primary_color !== undefined) {
    const c = b.primary_color ? String(b.primary_color).trim() : null;
    if (c && !HEX.test(c)) throw new HttpError(400, 'Colour must be a hex value like #1F5FA8');
    db.prepare('UPDATE companies SET primary_color = ? WHERE id = ?').run(c ? c.toLowerCase() : null, req.company.id);
  }
  res.json({ ok: true });
});

app.post('/api/company/logo', logoUpload.single('logo'), (req, res) => {
  try {
    requireAdminRole(req);
    if (!req.file) throw new HttpError(400, 'Upload a PNG or JPEG image up to 2 MB.');
  } catch (e) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    throw e;
  }
  const old = req.company.logo_filename;
  db.prepare('UPDATE companies SET logo_filename = ? WHERE id = ?').run(req.file.filename, req.company.id);
  if (old) fs.rm(path.join(UPLOAD_DIR, old), { force: true }, () => {});
  res.json({ ok: true, logo_version: req.file.filename });
});

app.delete('/api/company/logo', (req, res) => {
  requireAdminRole(req);
  const old = req.company.logo_filename;
  db.prepare('UPDATE companies SET logo_filename = NULL WHERE id = ?').run(req.company.id);
  if (old) fs.rm(path.join(UPLOAD_DIR, old), { force: true }, () => {});
  res.json({ ok: true });
});

// ------------------------------------------------------------------ AI assistants

app.post(
  '/api/projects/:id/ai/parse-notes',
  wrap(async (req, res) => {
    const p = getProject(req, req.params.id);
    if (!aiEnabled()) throw new HttpError(400, 'AI is not configured on the server (set ANTHROPIC_API_KEY).');
    const notes = String(req.body?.notes || '').trim();
    if (!notes) throw new HttpError(400, 'Type or paste your site notes first');
    const date = req.body?.date || today();
    const activities = db.prepare('SELECT id, code, name, section, progress FROM activities WHERE project_id = ? ORDER BY sort_order, id').all(p.id);
    try {
      const out = await parseSiteNotes({ notes, activities, date });
      const ids = new Set(activities.map((a) => a.id));
      out.activities = out.activities.map((a) => ({ ...a, activity_id: ids.has(a.activity_id) ? a.activity_id : null }));
      res.json(out);
    } catch (e) {
      throw new HttpError(502, describeAIError(e));
    }
  })
);

app.post(
  '/api/projects/:id/ai/insights',
  wrap(async (req, res) => {
    const p = getProject(req, req.params.id);
    if (!aiEnabled()) throw new HttpError(400, 'AI is not configured on the server (set ANTHROPIC_API_KEY).');
    const activities = listActivities(p.id);
    const reports = db.prepare('SELECT * FROM reports WHERE project_id = ? ORDER BY report_date DESC LIMIT 14').all(p.id).map(decodeReport).reverse();
    if (!reports.length) throw new HttpError(400, 'Submit at least one daily report first.');
    try {
      res.json(await generateInsights({ project: p, activities, reports, overall: computeOverall(p.id), planned: plannedOverall(activities) }));
    } catch (e) {
      throw new HttpError(502, describeAIError(e));
    }
  })
);

// ------------------------------------------------------------------ Static

app.get('/uploads/:file', (req, res) => {
  const photo = photoForCompany(req, req.params.file);
  if (!photo) throw new HttpError(404, 'Not found');
  res.set('Cache-Control', 'private, max-age=604800');
  res.sendFile(path.join(UPLOAD_DIR, photo.filename));
});
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong on the server.' : err.message });
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => console.log(`SitePulse API on http://localhost:${PORT}  (AI ${aiEnabled() ? 'enabled' : 'disabled – set ANTHROPIC_API_KEY to enable'})`));
