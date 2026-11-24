// Claude-powered features. Every feature has a non-AI fallback so the app works without a key.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import fs from 'node:fs';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

export function aiEnabled() {
  const flag = process.env.PROJ4D_AI || process.env.SITEPULSE_AI; // older SITEPULSE_* name still accepted
  if (flag === 'off') return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || flag === 'on');
}

let client;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

/** One structured-output call. Returns the parsed object or throws a readable Error. */
// Always streamed: the SDK refuses non-streaming calls that could run past 10 minutes, and large
// documents with a big max_tokens easily qualify.
async function structured({ system, content, schema, effort = 'medium', maxTokens = 16000 }) {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: betaZodOutputFormat(schema) },
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    throw new Error('The AI declined this request' + (response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'));
  }
  if (response.stop_reason === 'max_tokens') throw new Error('The AI response was too long and got cut off. Try a smaller input.');
  if (!response.parsed_output) throw new Error('The AI returned an unreadable response.');
  return response.parsed_output;
}

export function describeAIError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'AI is not authorised: check ANTHROPIC_API_KEY.';
  if (err instanceof Anthropic.RateLimitError) return 'AI rate limit reached, please try again in a minute.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service.';
  if (err instanceof Anthropic.BadRequestError) {
    const msg = err.error?.error?.message || err.message || '';
    if (/too long|too many|exceed|pages|size/i.test(msg)) return `The documents are too large for the AI to read in one go (${msg}). Remove some files or split large PDFs.`;
    return `The AI could not process this request (${msg || 'bad request'}).`;
  }
  if (err instanceof Anthropic.APIError) return `AI service error (${err.status ?? 'unknown'}).`;
  return err?.message || 'AI request failed.';
}

// ---------------------------------------------------------------- Programme extraction

const ActivitySchema = z.object({
  activities: z.array(
    z.object({
      code: z.string().nullable().describe('Activity ID / WBS code if shown'),
      name: z.string().describe('Activity / task description'),
      section: z.string().nullable().describe('Parent summary task, phase or area heading'),
      start_date: z.string().nullable().describe('Planned start, YYYY-MM-DD'),
      end_date: z.string().nullable().describe('Planned finish, YYYY-MM-DD'),
      duration_days: z.number().nullable().describe('Planned duration in working days'),
    })
  ),
});

const PROGRAMME_SYSTEM = `You read construction work programmes (Gantt charts, MS Project / Primavera P6 exports, bar charts, schedules) and list the activities a site supervisor reports progress against.
Rules:
- Return only work activities (leaf tasks). Summary/heading rows become the "section" of the activities beneath them, not activities themselves.
- Skip milestones with zero duration, page headers, legends, totals and blank rows.
- Keep the activity wording as written in the programme; fix only obvious OCR breaks.
- Dates as YYYY-MM-DD. Programmes from the UK, Africa, Middle East, Asia and Australia write dates day-first.
- Use null for anything not shown. Do not invent dates or durations.`;

export async function extractActivitiesWithAI({ text, pdfPath }) {
  const content = [];
  if (pdfPath) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(pdfPath).toString('base64') },
    });
    content.push({ type: 'text', text: 'Extract every activity from this work programme.' });
  } else {
    content.push({ type: 'text', text: `Extract every activity from this work programme:\n\n<programme>\n${text}\n</programme>` });
  }
  const out = await structured({ system: PROGRAMME_SYSTEM, content, schema: ActivitySchema, effort: 'medium', maxTokens: 32000 });
  return out.activities
    .filter((a) => a.name?.trim())
    .map((a) => {
      let weight = a.duration_days;
      if (!weight && a.start_date && a.end_date) {
        weight = (Date.parse(a.end_date) - Date.parse(a.start_date)) / 86400000 + 1;
      }
      return {
        code: a.code || null,
        name: a.name.trim(),
        section: a.section || null,
        start_date: /^\d{4}-\d{2}-\d{2}$/.test(a.start_date || '') ? a.start_date : null,
        end_date: /^\d{4}-\d{2}-\d{2}$/.test(a.end_date || '') ? a.end_date : null,
        weight: weight > 0 ? weight : 1,
      };
    });
}

// ---------------------------------------------------------------- Site notes -> report fields

const NotesSchema = z.object({
  activities: z.array(
    z.object({
      activity_id: z.number().nullable().describe('id from the programme list when the work matches one, else null'),
      activity_name: z.string().describe('programme activity name, or a short name for new work'),
      progress: z.number().nullable().describe('cumulative % complete (0-100) if stated or clearly implied, else null'),
      remarks: z.string().describe("what was done today on this activity"),
    })
  ),
  weather: z.object({
    condition: z.string().nullable().describe('one of: Sunny, Partly cloudy, Overcast, Light rain, Heavy rain, Storm, Windy, Hot, Cold, Fog'),
    temp_high: z.number().nullable(),
    temp_low: z.number().nullable(),
    impact: z.string().nullable().describe('effect of weather on work'),
    hours_lost: z.number().nullable(),
  }),
  labour: z.array(z.object({ trade: z.string(), count: z.number() })),
  equipment: z.array(z.object({ name: z.string(), count: z.number(), status: z.string() })),
  materials: z.array(z.object({ material: z.string(), quantity: z.string(), supplier: z.string(), notes: z.string() })),
  visitors: z.array(z.object({ name: z.string(), organisation: z.string(), purpose: z.string(), time: z.string() })),
  issues: z.array(
    z.object({
      category: z.string().describe('one of: Safety, Quality, Design/RFI, Delay, Resources, Access, Utilities, Environmental, Other'),
      description: z.string(),
      severity: z.string().describe('Low, Medium or High'),
      action: z.string().describe('action taken or required, empty if none'),
    })
  ),
  notes: z.string().describe('anything else worth recording that fits no other field'),
});

export async function parseSiteNotes({ notes, activities, date }) {
  const list = activities
    .map((a) => `${a.id}\t${a.code || ''}\t${a.name}${a.section ? ` [${a.section}]` : ''}\tcurrently ${a.progress}%`)
    .join('\n');
  const system = `You turn a construction site supervisor's end-of-day notes into a structured daily site report.
Match work described in the notes to the programme activities (by meaning, not exact words) and use their ids. Work that matches nothing gets activity_id null.
Progress is cumulative percent complete for the whole activity, not today's increment. If the notes give an increment ("another 10%"), add it to the activity's current progress. If no progress figure is given or implied, use null.
Record only what the notes say. Leave lists empty and fields null when the notes don't mention them.`;
  const text = `Report date: ${date}\n\nProgramme activities (id, code, name, current progress):\n<activities>\n${list || '(none uploaded)'}\n</activities>\n\nSupervisor's notes:\n<notes>\n${notes}\n</notes>`;
  return structured({ system, content: [{ type: 'text', text }], schema: NotesSchema, effort: 'low' });
}

// ---------------------------------------------------------------- Report narrative

const SummarySchema = z.object({
  summary: z.string().describe('2-4 short paragraphs of plain text, no markdown'),
});

export async function generateReportSummary({ project, report, items, overall, previousOverall, registers }) {
  const system = `You write the executive summary at the top of a construction daily site report, for the project manager and client.
Plain, factual, professional site-report English. Lead with the work done and the movement in overall progress, then weather impact, attendance and absentees, materials received and used (mention any low stock), then issues needing attention with any actions. Mention visitors only if notable.
Use only the facts given. No markdown, headings or bullet points. Keep it under 180 words.`;
  const payload = {
    project: { name: project.name, code: project.code, location: project.location },
    date: report.report_date,
    overall_progress_percent: overall,
    previous_overall_progress_percent: previousOverall,
    activities_worked: items.map((i) => ({ activity: i.activity_name, progress_before: i.progress_before, progress_now: i.progress, remarks: i.remarks })),
    weather: report.weather,
    labour: report.labour,
    equipment: report.equipment,
    materials_received: report.materials,
    visitors: report.visitors,
    issues: report.issues,
    other_notes: report.notes,
    attendance_register: registers?.attendance?.taken
      ? { present: registers.attendance.present, late: registers.attendance.late, absent: registers.attendance.absent, absentees: registers.attendance.absentees.map((a) => `${a.name} (${a.reason_label})`) }
      : undefined,
    materials_register: registers?.materials?.rows?.length
      ? registers.materials.rows.map((r) => ({ material: r.name, unit: r.unit, received: r.delivered, used: r.used, wasted: r.wasted, closing_stock: r.closing, low_stock: r.low }))
      : undefined,
  };
  const out = await structured({
    system,
    content: [{ type: 'text', text: `<report_data>\n${JSON.stringify(payload, null, 2)}\n</report_data>` }],
    schema: SummarySchema,
    effort: 'low',
    maxTokens: 4000,
  });
  return out.summary.trim();
}

/** Template narrative used when AI is not configured or fails. */
export function templateSummary({ project, report, items, overall, previousOverall, registers }) {
  const parts = [];
  const delta = previousOverall != null ? Math.round((overall - previousOverall) * 10) / 10 : null;
  parts.push(
    `On ${report.report_date}, work progressed on ${items.length} activit${items.length === 1 ? 'y' : 'ies'} at ${project.name}. ` +
      `Overall project progress stands at ${overall}%` +
      (delta != null ? ` (${delta >= 0 ? '+' : ''}${delta}% since the previous report).` : '.')
  );
  const top = [...items].sort((a, b) => (b.progress - (b.progress_before || 0)) - (a.progress - (a.progress_before || 0))).slice(0, 3);
  if (top.length) parts.push('Main activities: ' + top.map((i) => `${i.activity_name} (${i.progress}%)`).join('; ') + '.');
  const w = report.weather || {};
  if (w.condition) parts.push(`Weather: ${w.condition}${w.impact ? ` – ${w.impact}` : ''}${w.hours_lost ? ` (${w.hours_lost} h lost)` : ''}.`);
  const labour = (report.labour || []).reduce((s, l) => s + (Number(l.count) || 0), 0);
  if (labour) parts.push(`${labour} operatives on site.`);
  const att = registers?.attendance;
  if (att?.taken) parts.push(`Attendance: ${att.on_site} on site (${att.late} late), ${att.absent} absent.`);
  const mat = registers?.materials;
  if (mat?.deliveries?.length) parts.push(`Materials received: ${mat.deliveries.map((d) => `${d.material} ${d.quantity} ${d.unit}`).join(', ')}.`);
  else if (report.materials?.length) parts.push(`Deliveries: ${report.materials.map((m) => m.material).join(', ')}.`);
  if (mat?.low?.length) parts.push(`Low stock: ${mat.low.map((l) => l.name).join(', ')}.`);
  if (report.issues?.length) parts.push(`${report.issues.length} site issue(s) recorded: ${report.issues.map((i) => i.description).join('; ')}.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------- Project insights

const InsightSchema = z.object({
  headline: z.string().describe('one sentence status of the project'),
  status: z.string().describe('On track, At risk, or Behind'),
  risks: z.array(z.object({ title: z.string(), detail: z.string() })).describe('up to 4'),
  recommendations: z.array(z.string()).describe('up to 4 concrete next actions'),
});

export async function generateInsights({ project, activities, reports, overall, planned }) {
  const system = `You are an experienced construction project controls engineer. From the programme and recent daily reports, give a short, honest status assessment.
Base every point on the data: compare actual against planned progress, look for recurring issues, weather losses, resourcing trends and activities that have stalled. Be specific (name activities). No generic advice.`;
  const data = {
    project: { name: project.name, start: project.start_date, end: project.end_date },
    today: new Date().toISOString().slice(0, 10),
    overall_actual_percent: overall,
    overall_planned_percent_today: planned,
    activities: activities.map((a) => ({ name: a.name, start: a.start_date, end: a.end_date, actual: a.progress, planned_today: a.planned })),
    recent_reports: reports.map((r) => ({
      date: r.report_date,
      overall: r.overall_progress,
      weather: r.weather,
      labour_total: (r.labour || []).reduce((s, l) => s + (Number(l.count) || 0), 0),
      issues: r.issues,
      summary: r.summary,
    })),
  };
  return structured({
    system,
    content: [{ type: 'text', text: `<project_data>\n${JSON.stringify(data)}\n</project_data>` }],
    schema: InsightSchema,
    effort: 'medium',
    maxTokens: 8000,
  });
}

// ---------------------------------------------------------------- Work programme generator (premium)

const PlanSchema = z.object({
  title: z.string().describe('Programme title, usually the project name in capitals, e.g. "GUOBADIA COMPLEX RENOVATION"'),
  scope_summary: z.string().describe('3-6 sentences: what the documents show will be built, as the planner understood it'),
  assumptions: z.array(z.string()).describe('Planning assumptions: crew sizes, productivity, curing times, lead times, anything not in the documents'),
  phases: z.array(
    z.object({
      name: z.string().describe('Phase / work section, e.g. "Substructure (Building Extension)"'),
      tasks: z.array(
        z.object({
          ref: z.string().describe('Unique id for this task across the whole programme, e.g. "T1", "T2"'),
          name: z.string().describe('Short verb-led task name, e.g. "Excavation of wall trenches and column footings"'),
          duration_days: z.number().describe('Whole working days; 0 only for milestones'),
          predecessors: z.array(
            z.object({
              ref: z.string().describe('ref of an earlier task'),
              type: z.enum(['FS', 'SS', 'FF', 'SF']),
              lag_days: z.number().describe('Working days of lag; negative for lead/overlap'),
            })
          ),
          basis: z.string().nullable().describe('BOQ item(s) / quantities / drawing this task and its duration are based on, briefly'),
        })
      ),
    })
  ),
});

const PLANNER_SYSTEM = `You are a senior construction planner who prepares contract work programmes (Gantt charts) in MS Project for building contractors.
From the drawings, bill of quantities (BOQ), dates and notes you are given, produce a realistic, logically linked programme of works.

How to work:
- Read every document. Use the drawings for scope and build sequence (number of floors, structural system, foundations, roof, openings, services, external works) and the BOQ for quantities, which drive durations.
- Size each duration from the quantity and a realistic output rate for a typical crew in the project's region and construction method. Note the main rates in the assumptions.
- Sequence work the way it is built: mobilisation and setting out, procurement and approvals, demolition/strip-out where relevant, substructure, frame and slabs floor by floor, blockwork/walls, roof, services first fix, plastering/screeds, services second fix, finishes, external works, testing and commissioning, snagging, handover.
- Link every task (except the first) with predecessors so the logic drives the dates. Use FS normally; SS/FF with lags where trades overlap (e.g. blockwork and lintels). Allow concrete curing and striking times as lags or tasks. Include long-lead procurement running in parallel.
- Add zero-duration milestones for key events, such as "Substructure complete", "Roof watertight", "Practical completion".
- The programme must finish on or before the target completion date given the working calendar. If that is not realistic, still plan the most efficient logical sequence (overlap trades, parallel work fronts) and say so clearly in the assumptions.
- Group tasks into phases in construction order. Typically 30-150 tasks depending on the size of the job; more detail for the near-term work.
- Task names are concise and verb-led, written the way site teams write them: "Blockwork to lintel level", "Shuttering and iron work for lintels", "Casting of lintels".
- Do not invent scope the documents do not support. Where the documents are thin, plan the typical scope for the described building and list what you assumed.
- Do not output any dates: the system calculates them from your durations and links.`;

/**
 * Asks Claude for a phased, linked programme. docs: content blocks for the uploaded files.
 * brief: text describing the project, calendar and notes.
 */
export async function generateProgrammePlan({ brief, docs }) {
  const content = [...docs, { type: 'text', text: brief }];
  return structured({ system: PLANNER_SYSTEM, content, schema: PlanSchema, effort: 'high', maxTokens: 64000 });
}
