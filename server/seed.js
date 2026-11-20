// Creates a demo project with a programme and a week of daily reports: `npm run seed`
import { db, tx, refreshProject, decodeReport } from './db.js';
import { parseProgramme } from './programme.js';
import { templateSummary } from './ai.js';

const parsed = await parseProgramme('samples/sample-programme.csv', 'sample-programme.csv');

// Shift the sample programme so the demo project started 16 days ago.
const BASE = Date.parse('2026-01-05');
const offset = Date.parse(new Date().toISOString().slice(0, 10)) - 16 * 86400000 - BASE;
const shift = (d) => (d ? new Date(Date.parse(d) + offset).toISOString().slice(0, 10) : d);
const activities = parsed.activities.map((a) => ({ ...a, start_date: shift(a.start_date), end_date: shift(a.end_date) }));

const projectId = tx(() => {
  const pid = db
    .prepare('INSERT INTO projects (name, code, client, location, contractor, supervisor, start_date, end_date, description) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('Riverside Office Block (demo)', 'RVB-01', 'Acme Holdings Ltd', 'Plot 14, Riverside Drive', 'BuildRight Construction', 'J. Okafor', shift('2026-01-05'), shift('2026-08-31'), 'Two-storey reinforced concrete office building with steel roof.')
    .lastInsertRowid;
  const ins = db.prepare('INSERT INTO activities (project_id, code, name, section, start_date, end_date, weight, sort_order) VALUES (?,?,?,?,?,?,?,?)');
  activities.forEach((a, i) => ins.run(pid, a.code, a.name, a.section, a.start_date, a.end_date, a.weight, i + 1));
  return pid;
});

const act = (code) => db.prepare('SELECT * FROM activities WHERE project_id = ? AND code = ?').get(projectId, code);
const days = [
  { date: '2026-01-05', w: { condition: 'Sunny', temp_high: 32, temp_low: 23 }, items: [['1.1', 20, 'Setting out and hoarding posts along north boundary']], labour: 10 },
  { date: '2026-01-06', w: { condition: 'Sunny', temp_high: 33, temp_low: 24 }, items: [['1.1', 45, 'Hoarding panels fixed on north and east']], labour: 12, mat: ['Hoarding panels', '60 no', 'BuildCo'] },
  { date: '2026-01-07', w: { condition: 'Light rain', temp_high: 28, temp_low: 22, impact: 'Work stopped 2 hours in the morning', hours_lost: 2 }, items: [['1.1', 60, 'Site office container placed']], labour: 9, issue: ['Delay', 'Rain stopped work 08:00–10:00', 'Low', 'Lost time recorded'] },
  { date: '2026-01-08', w: { condition: 'Partly cloudy', temp_high: 31, temp_low: 23 }, items: [['1.1', 80, 'Welfare facilities installed'], ['1.2', 10, 'Vegetation clearance started']], labour: 14, visitor: ['A. Bello', 'Acme Holdings', 'Site walk with client', '10:00'] },
  { date: '2026-01-09', w: { condition: 'Sunny', temp_high: 34, temp_low: 24 }, items: [['1.1', 100, 'Site set-up complete'], ['1.2', 35, 'Clearance of east half']], labour: 15, issue: ['Safety', 'Two operatives without hard hats', 'Medium', 'Toolbox talk held, PPE issued'] },
  { date: '2026-01-12', w: { condition: 'Sunny', temp_high: 33, temp_low: 24 }, items: [['1.2', 60, 'Clearance of west half, spoil carted away']], labour: 13, mat: ['Diesel', '400 L', 'FuelPlus'] },
];

for (const d of days) {
  d.date = shift(d.date);
  const rid = db
    .prepare('INSERT INTO reports (project_id, report_date, supervisor, weather, labour, equipment, materials, visitors, issues, notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(
      projectId, d.date, 'J. Okafor', JSON.stringify(d.w),
      JSON.stringify([{ trade: 'General labourers', count: d.labour - 3 }, { trade: 'Carpenters', count: 3 }]),
      JSON.stringify(d.date >= shift('2026-01-08') ? [{ name: 'Excavator 20t', count: 1, status: 'Working' }] : []),
      JSON.stringify(d.mat ? [{ material: d.mat[0], quantity: d.mat[1], supplier: d.mat[2], notes: '' }] : []),
      JSON.stringify(d.visitor ? [{ name: d.visitor[0], organisation: d.visitor[1], purpose: d.visitor[2], time: d.visitor[3] }] : []),
      JSON.stringify(d.issue ? [{ category: d.issue[0], description: d.issue[1], severity: d.issue[2], action: d.issue[3] }] : []),
      null
    ).lastInsertRowid;
  for (const [code, progress, remarks] of d.items) {
    const a = act(code);
    const prev = db
      .prepare('SELECT ri.progress FROM report_items ri JOIN reports r ON r.id = ri.report_id WHERE ri.activity_id = ? AND r.report_date < ? ORDER BY r.report_date DESC LIMIT 1')
      .get(a.id, d.date);
    db.prepare('INSERT INTO report_items (report_id, activity_id, activity_name, progress_before, progress, remarks) VALUES (?,?,?,?,?,?)').run(rid, a.id, a.name, prev?.progress ?? 0, progress, remarks);
  }
}
refreshProject(projectId);

const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
let prevOverall = null;
for (const r of db.prepare('SELECT * FROM reports WHERE project_id = ? ORDER BY report_date').all(projectId)) {
  const report = decodeReport(r);
  const items = db.prepare('SELECT * FROM report_items WHERE report_id = ?').all(r.id);
  const summary = templateSummary({ project, report, items, overall: r.overall_progress, previousOverall: prevOverall });
  db.prepare("UPDATE reports SET summary = ?, summary_source = 'template' WHERE id = ?").run(summary, r.id);
  prevOverall = r.overall_progress;
}
console.log(`Seeded demo project #${projectId} with ${activities.length} activities and ${days.length} daily reports.`);
