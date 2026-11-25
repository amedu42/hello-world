// Public homepage (marketing site). Plain server-rendered HTML so it loads fast and search engines
// can read it. Links into the app use APP_ORIGIN when the homepage and app are on different domains
// (e.g. proj4d.com and app.proj4d.com); otherwise they are relative.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICONS = {
  programme: '<path d="M4 5h16M4 10h10M4 15h13M4 20h7"/><circle cx="19" cy="18" r="3"/>',
  gantt: '<path d="M3 4v16h18"/><rect x="6" y="6" width="7" height="3" rx="1"/><rect x="10" y="11" width="8" height="3" rx="1"/><rect x="8" y="16" width="5" height="2.5" rx="1"/>',
  report: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  progress: '<path d="M4 19h16"/><path d="M5 15l4-4 3 3 7-7"/><path d="M15 7h4v4"/>',
  attendance: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 11l2 2 4-4"/>',
  materials: '<path d="M3 8l9-5 9 5-9 5-9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 13h6M9 17h4"/>',
  bell: '<path d="M6 16V11a6 6 0 1112 0v5l2 2H4z"/><path d="M10 21h4"/>',
  team: '<circle cx="8" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M14.5 15.5c.8-.6 1.7-1 2.5-1 2.8 0 5 2.2 5 5"/>',
  ai: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  drawing: '<path d="M3 20h18"/><path d="M5 20V9l7-5 7 5v11"/><path d="M9 20v-6h6v6"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const ticks = (items) => `<ul class="ticks">${items.map((t) => `<li>${icon('check')}<span>${t}</span></li>`).join('')}</ul>`;

const STAGES = [
  ['gantt', 'Plan', 'AI drafts the work programme from your drawings and BOQ. Or upload the one you already have.', '#plan'],
  ['report', 'Track', 'Daily site reports, attendance and materials registers, filed from any phone.', '#track'],
  ['pdf', 'Report', 'Weekly, monthly, status and milestone reports, written up for you and ready to publish.', '#report'],
  ['progress', 'Decide', 'Live progress against plan, slippage warnings, AI insights and alerts.', '#decide'],
];

const FEATURES = [
  ['gantt', 'AI work programme generator', 'Drawings, BOQ and dates in; a phased, linked programme out, as a Gantt PDF or MS Project XML.'],
  ['programme', 'Programme import', 'Bring your existing programme from Excel, CSV, MS Project XML, or a PDF read with AI.'],
  ['report', 'Daily progress reports', 'Work done, crew, plant, weather, deliveries, visitors, issues and photos, in minutes from site.'],
  ['ai', 'AI from site notes', 'Write the day in plain words and AI fills in the report; every report gets a written summary.'],
  ['calendar', 'Weekly and monthly reports', 'Completed work, planned vs actual, look-ahead and challenges, written up from your data.'],
  ['flag', 'Status and milestone reports', 'Schedule variance in days, forecast finish, phase completion and target vs actual milestones.'],
  ['progress', 'Live progress vs plan', 'Duration-weighted progress and an S-curve that update with every report, with slippage flagged early.'],
  ['attendance', 'Attendance register', 'Present, late or absent with reasons, headcount by trade and monthly sheets for payroll.'],
  ['materials', 'Materials register', 'Deliveries, usage and wastage, live stock on hand, low-stock alerts and usage by activity.'],
  ['pdf', 'Branded PDF reports', 'Every report in your logo and colours. On higher plans, your brand only, with no Proj4D footer.'],
  ['bell', 'Reminders and alerts', 'Push notifications for the register, the daily report, high-severity issues, low stock and slippage.'],
  ['team', 'Company accounts', 'Admins and members, private to your company, with everyone working from the same live data.'],
];

const STEPS = [
  ['Set up the project', 'Create the project, then generate the programme with AI or upload your own. Add your crew and materials.'],
  ['Report from site every day', 'The supervisor takes the morning register and files the daily report from their phone each evening.'],
  ['Publish client reports', 'At the end of the week or month, generate the report, review and edit it, then publish the PDF.'],
  ['Act on what you see', 'Progress, attendance and stock update instantly, with alerts and insights when something needs attention.'],
];

const FAQ = [
  ['How much does Proj4D cost?', 'Every new company gets a 7-day free trial of every feature, with no card needed. After that you can stay on the Free plan for as long as you like (up to 3 team members and 2 projects, without the AI features), or choose a paid plan for AI and larger teams. See the plans and pricing page for details, or book a demo and we’ll help you pick the right one.'],
  ['Can AI really create our work programme?', 'Yes. Upload the working drawings (PDF or photos), the bill of quantities and any other documents, set the start and target completion dates and your working days, and AI drafts the phases, tasks, durations and links. Proj4D calculates the dates and critical path. You review and edit it, then download a Gantt PDF or MS Project XML, or use it as the project’s task list.'],
  ['Which reports can Proj4D produce?', 'Daily progress reports, weekly and monthly progress reports, project status (work-in-progress) reports, milestone tracking reports, attendance and materials registers, and AI-generated work programmes. All download as PDFs in your company branding.'],
  ['Can we edit what the AI writes?', 'Always. AI drafts are just that: you can change any text, choose which tables to include, adjust milestones and photos, and only then publish. The figures themselves come from your own programme and site records, not from the AI.'],
  ['Do I need to install anything?', 'No. Proj4D runs in any modern browser on phones, tablets and computers. You can also install it as an app on Android, iPhone and desktop so it opens from its own icon and sends notifications.'],
  ['Which programme files can I upload?', 'Excel (.xlsx), CSV and MS Project XML, including exports from Primavera P6 via Excel. PDF programmes and unusual layouts can be read with AI. Programmes made in Proj4D export to MS Project XML.'],
  ['Is our data private?', 'Each company’s projects, reports, photos and registers are visible only to its own users. Passwords are encrypted and all traffic uses HTTPS. When you use an AI feature, only the content needed for that task is sent to the AI service to produce the result.'],
  ['Can reports carry our branding?', 'Yes. Add your logo and brand colour once and every report and register uses them. On the Professional and Business plans the “Made with Proj4D” footer is removed, so reports carry your brand only.'],
  ['Does it work without internet?', 'Proj4D needs a connection to save. If the signal drops it tells you, and an unfinished daily report is kept on the phone until you submit it.'],
];


// ------------------------------------------------------------------ shared by the homepage and the pricing page

export const CSS = `:root { --navy: #16324f; --navy-2: #224b74; --navy-3: #0f2338; --amber: #f2a900; --amber-2: #ffb81a; --ink: #1c2430; --ink-2: #44505f; --muted: #687384; --line: #e1e5eb; --bg: #f4f6f9; --white: #fff; --good: #1f8a4c; --red: #d64545; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 76px; }
body { margin: 0; color: var(--ink); background: var(--white); font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
img { max-width: 100%; height: auto; display: block; }
a { color: var(--navy-2); }
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
.ico { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 50px; padding: 0 24px; border-radius: 10px; font-weight: 700; font-size: 16px; text-decoration: none; border: 2px solid transparent; transition: background .15s, border-color .15s, transform .15s; cursor: pointer; font-family: inherit; text-align: center; }
.btn:hover { transform: translateY(-1px); }
.btn .ico { width: 20px; height: 20px; }
.btn-primary { background: var(--amber); color: #1c1600; }
.btn-primary:hover { background: var(--amber-2); }
.btn-ghost { background: transparent; color: var(--white); border-color: rgba(255,255,255,.45); }
.btn-ghost:hover { border-color: var(--white); background: rgba(255,255,255,.06); }
.btn-navy { background: var(--navy); color: #fff; }
.btn-navy:hover { background: var(--navy-2); }
.btn-wa { background: #1f8a4c; color: #fff; }
.btn-wa:hover { background: #18733f; }
:focus-visible { outline: 3px solid var(--amber); outline-offset: 2px; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--amber); margin-bottom: 14px; }
.eyebrow.dark { color: var(--navy-2); }
.eyebrow .ico { width: 18px; height: 18px; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 99px; background: rgba(242,169,0,.14); color: var(--amber); font-size: 13px; font-weight: 700; }

/* nav */
.nav { position: sticky; top: 0; z-index: 50; background: rgba(22,50,79,.97); backdrop-filter: blur(8px); color: #fff; border-bottom: 3px solid var(--amber); }
.nav .wrap { display: flex; align-items: center; gap: 24px; min-height: 66px; }
.brand { display: flex; align-items: center; gap: 10px; color: #fff; text-decoration: none; font-weight: 800; font-size: 20px; }
.brand img { width: 32px; height: 32px; border-radius: 7px; }
.nav-links { display: flex; gap: 22px; margin-left: 8px; }
.nav-links a { color: #c9d4e2; text-decoration: none; font-weight: 600; font-size: 15px; }
.nav-links a:hover { color: #fff; }
.nav-cta { margin-left: auto; display: flex; gap: 10px; align-items: center; }
.nav-cta .btn { min-height: 42px; padding: 0 18px; font-size: 15px; }
.nav-login { color: #fff; text-decoration: none; font-weight: 700; padding: 8px 10px; }
.menu-btn { display: none; margin-left: auto; background: none; border: 0; color: #fff; padding: 8px; cursor: pointer; }
.mobile-menu { display: none; }

/* hero */
.hero { position: relative; background: radial-gradient(900px 480px at 88% -5%, #2a5a8a 0, transparent 62%), radial-gradient(700px 400px at -10% 110%, #1d4168 0, transparent 60%), var(--navy); color: #fff; padding: 72px 0 0; overflow: hidden; }
.hero-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr); gap: 52px; align-items: center; }
h1 { font-size: clamp(38px, 5.2vw, 62px); line-height: 1.05; margin: 14px 0 20px; letter-spacing: -.025em; }
h1 em { font-style: normal; color: var(--amber); }
.lead { font-size: 19px; color: #d5deea; margin: 0 0 30px; max-width: 34em; }
.cta-row { display: flex; gap: 12px; flex-wrap: wrap; }
.hero-points { display: flex; gap: 8px 20px; flex-wrap: wrap; margin: 22px 0 0; font-size: 14px; color: #c9d4e2; padding: 0; list-style: none; }
.hero-points li { display: flex; align-items: center; gap: 6px; }
.hero-points .ico { width: 18px; height: 18px; color: var(--amber); stroke-width: 2.4; }
.shots { position: relative; padding-bottom: 56px; }
.browser { background: #fff; border-radius: 12px; box-shadow: 0 40px 80px -24px rgba(5,14,26,.7); overflow: hidden; border: 1px solid rgba(255,255,255,.15); }
.browser-bar { display: flex; gap: 6px; align-items: center; padding: 10px 12px; background: #e9edf2; }
.browser-bar i { width: 10px; height: 10px; border-radius: 50%; background: #c7ced8; }
.phone { position: absolute; right: -12px; bottom: 0; width: 32%; max-width: 210px; border: 7px solid #0e1621; border-radius: 26px; overflow: hidden; background: #0e1621; box-shadow: 0 25px 50px -15px rgba(5,14,26,.7); }
.phone img { border-radius: 18px; }
.float-card { position: absolute; left: -26px; bottom: 26px; background: #fff; color: var(--ink); border-radius: 12px; padding: 12px 14px; box-shadow: 0 18px 40px -12px rgba(5,14,26,.55); display: flex; gap: 10px; align-items: center; font-size: 14px; max-width: 250px; }
.float-card .ico { color: var(--amber); width: 28px; height: 28px; }
.float-card b { display: block; font-size: 15px; }
.float-card span { color: var(--muted); font-size: 13px; }

/* lifecycle */
.stages { position: relative; z-index: 2; margin-top: 56px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: #fff; color: var(--ink); border-radius: 16px 16px 0 0; box-shadow: 0 -10px 40px -20px rgba(5,14,26,.5); }
.stage { padding: 26px 24px 24px; text-decoration: none; color: inherit; border-right: 1px solid var(--line); transition: background .15s; position: relative; }
.stage:last-child { border-right: 0; }
.stage:hover { background: #f8fafc; }
.stage .num { font-size: 12px; font-weight: 800; color: var(--muted); letter-spacing: .08em; }
.stage h3 { display: flex; align-items: center; gap: 10px; margin: 6px 0 6px; font-size: 21px; }
.stage h3 .ico { color: var(--navy-2); }
.stage p { margin: 0; color: var(--ink-2); font-size: 15px; }
.stage .go { position: absolute; right: 20px; top: 26px; width: 20px; height: 20px; color: var(--amber); opacity: 0; transition: opacity .15s, transform .15s; }
.stage:hover .go { opacity: 1; transform: translateX(3px); }

/* sections */
section { padding: 92px 0; }
.section-head { max-width: 760px; margin: 0 auto 48px; text-align: center; }
h2 { font-size: clamp(30px, 3.6vw, 44px); line-height: 1.12; margin: 0 0 14px; letter-spacing: -.015em; }
.section-head p { color: var(--ink-2); font-size: 18px; margin: 0; }
.tinted { background: var(--bg); }

.showcase { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 64px; align-items: center; }
.showcase + .showcase { margin-top: 104px; }
.showcase.flip .show-text { order: 2; }
.show-text h3 { font-size: clamp(26px, 2.8vw, 34px); line-height: 1.15; margin: 0 0 14px; letter-spacing: -.01em; }
.show-text > p { color: var(--ink-2); font-size: 17px; margin: 0; }
.ticks { list-style: none; padding: 0; margin: 20px 0 0; }
.ticks li { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 11px; color: var(--ink); }
.ticks .ico { width: 20px; height: 20px; color: var(--good); margin-top: 3px; stroke-width: 2.4; }
.show-media { display: flex; justify-content: center; gap: 16px; align-items: flex-end; position: relative; }
.phone-solo { width: 46%; max-width: 270px; border: 8px solid #0e1621; border-radius: 30px; overflow: hidden; background: #0e1621; box-shadow: 0 30px 60px -24px rgba(8,20,35,.5); }
.phone-solo img { border-radius: 21px; }
.card-shot { border-radius: 12px; overflow: hidden; border: 1px solid var(--line); box-shadow: 0 24px 48px -24px rgba(8,20,35,.4); background: #fff; }
.stackv { display: flex; flex-direction: column; gap: 16px; width: 100%; }

/* AI programme spotlight */
.plan { background: linear-gradient(180deg, var(--navy) 0, var(--navy-3) 100%); color: #fff; overflow: hidden; }
.plan .section-head p { color: #c9d4e2; }
.flow { display: grid; grid-template-columns: minmax(0, .9fr) auto minmax(0, 2.1fr); gap: 22px; align-items: center; }
.inputs { display: flex; flex-direction: column; gap: 12px; }
.input-chip { display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-radius: 12px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.14); }
.input-chip .ico { color: var(--amber); }
.input-chip b { display: block; font-size: 15px; }
.input-chip span { font-size: 13px; color: #b8c5d6; }
.flow-arrow { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 50%; background: var(--amber); color: #1c1600; box-shadow: 0 0 0 8px rgba(242,169,0,.15); }
.flow-arrow .ico { width: 28px; height: 28px; }
.gantt-shot { border-radius: 12px; overflow: hidden; box-shadow: 0 40px 80px -30px rgba(0,0,0,.7); border: 1px solid rgba(255,255,255,.18); background: #fff; }
.outputs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 40px; }
.output { padding: 18px; border-radius: 12px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); }
.output .ico { color: var(--amber); margin-bottom: 8px; }
.output b { display: block; margin-bottom: 4px; }
.output span { color: #c9d4e2; font-size: 14px; }

/* report types */
.report-kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 22px 0 0; }
.kind { padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
.kind b { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.kind b .ico { width: 18px; height: 18px; color: var(--navy-2); }
.kind span { display: block; font-size: 13.5px; color: var(--ink-2); margin-top: 2px; }
.report-media { position: relative; width: 100%; padding: 0 0 40px 0; }
.report-media .card-shot { width: 88%; }
.paper { position: absolute; right: 0; bottom: 0; width: 44%; max-width: 300px; box-shadow: 0 30px 60px -20px rgba(8,20,35,.5); border: 1px solid var(--line); transform: rotate(2deg); background: #fff; }

/* features grid */
.feature-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.feature { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 22px; transition: border-color .15s, box-shadow .15s; }
.feature:hover { border-color: #c8d3e0; box-shadow: 0 12px 30px -20px rgba(8,20,35,.35); }
.feature .ico-wrap { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: #eef3f9; color: var(--navy-2); margin-bottom: 14px; }
.feature h3 { margin: 0 0 6px; font-size: 17px; }
.feature p { margin: 0; color: var(--ink-2); font-size: 14.5px; }

/* how */
.how { background: var(--navy); color: #fff; }
.how .section-head p { color: #c9d4e2; }
.steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; counter-reset: step; }
.step { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; padding: 24px; }
.step::before { counter-increment: step; content: counter(step); display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--amber); color: #1c1600; font-weight: 800; margin-bottom: 14px; }
.step h3 { margin: 0 0 6px; font-size: 18px; }
.step p { margin: 0; color: #c9d4e2; font-size: 15px; }

/* start free */
.start { padding: 0; }
.start-card { margin-top: -46px; position: relative; z-index: 2; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 32px; align-items: center; background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 36px 40px; box-shadow: 0 30px 60px -30px rgba(8,20,35,.35); }
.start-card h2 { font-size: clamp(26px, 3vw, 34px); margin-bottom: 8px; }
.start-card p { margin: 0; color: var(--ink-2); }
.offers { display: grid; gap: 12px; }
.offer { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border-radius: 12px; background: var(--bg); }
.offer .ico { color: var(--good); stroke-width: 2.2; margin-top: 2px; }
.offer b { display: block; }
.offer span { font-size: 14px; color: var(--ink-2); }
.start-cta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }

.install-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 52px; align-items: center; }
.platforms { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 22px; }
.platform { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px; font-size: 14px; color: var(--ink-2); }
.platform b { display: block; color: var(--ink); margin-bottom: 2px; }

.faq-list { max-width: 840px; margin: 0 auto; }
details { border-bottom: 1px solid var(--line); padding: 4px 0; }
summary { cursor: pointer; list-style: none; font-weight: 700; font-size: 18px; padding: 16px 36px 16px 0; position: relative; }
summary::-webkit-details-marker { display: none; }
summary::after { content: '+'; position: absolute; right: 6px; top: 12px; font-size: 26px; font-weight: 400; color: var(--navy-2); }
details[open] summary::after { content: '–'; }
details p { margin: 0 0 18px; color: var(--ink-2); }

.demo { background: linear-gradient(170deg, var(--navy), var(--navy-3)); color: #fff; }
.demo-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 52px; align-items: start; }
.demo p.lead { color: #d5deea; }
.demo-alt { margin-top: 26px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
form.demo-form { background: #fff; color: var(--ink); border-radius: 16px; padding: 26px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; box-shadow: 0 30px 60px -25px rgba(0,0,0,.5); }
.f { display: flex; flex-direction: column; gap: 5px; }
.f.full { grid-column: 1 / -1; }
.f label { font-size: 13px; font-weight: 700; color: var(--ink-2); }
.f input, .f select, .f textarea { font: inherit; font-size: 16px; padding: 11px 12px; border: 1px solid #cfd5de; border-radius: 9px; background: #fff; color: var(--ink); width: 100%; }
.f textarea { resize: vertical; min-height: 96px; }
.hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.form-msg { grid-column: 1 / -1; border-radius: 9px; padding: 12px 14px; font-size: 15px; display: none; }
.form-msg.ok { display: block; background: #e7f5ec; color: #1f6b3e; }
.form-msg.err { display: block; background: #fdecea; color: #b42318; }
.small { font-size: 13px; color: var(--muted); }

footer { background: #0e1621; color: #9aa7b6; padding: 44px 0; font-size: 14px; }
footer .wrap { display: flex; gap: 24px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
footer a { color: #c9d4e2; text-decoration: none; margin-right: 18px; }
footer a:hover { color: #fff; }

@media (max-width: 1080px) {
  .feature-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .outputs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .nav-links { gap: 16px; }
}
@media (max-width: 960px) {
  .hero-grid, .showcase, .install-grid, .demo-grid, .start-card { grid-template-columns: 1fr; }
  .showcase.flip .show-text { order: 0; }
  .feature-grid { grid-template-columns: 1fr 1fr; }
  .stages { grid-template-columns: 1fr 1fr; }
  .stage:nth-child(2) { border-right: 0; }
  .stage:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
  .flow { grid-template-columns: 1fr; }
  .flow-arrow { transform: rotate(90deg); margin: 0 auto; }
  .float-card { left: 8px; }
}
@media (max-width: 860px) { .nav-links { display: none; } }
@media (max-width: 760px) {
  .nav-cta { display: none; }
  .menu-btn { display: block; }
  .mobile-menu.open { display: flex; flex-direction: column; gap: 4px; padding: 8px 20px 18px; background: var(--navy); }
  .mobile-menu a { color: #fff; text-decoration: none; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.1); }
  .mobile-menu .btn { margin-top: 10px; }
  section { padding: 64px 0; }
  .hero { padding: 40px 0 0; }
  .lead { font-size: 17px; }
  .cta-row .btn { flex: 1 1 100%; }
  .feature-grid, .platforms, .steps, .outputs, .report-kinds, form.demo-form { grid-template-columns: 1fr; }
  .stages { grid-template-columns: 1fr; border-radius: 14px 14px 0 0; }
  .stage { border-right: 0; border-bottom: 1px solid var(--line); padding: 20px; }
  .stage .go { opacity: 1; }
  form.demo-form { padding: 20px; }
  .phone { width: 36%; right: 0; }
  .float-card { display: none; }
  .showcase + .showcase { margin-top: 72px; }
  .phone-solo { width: 62%; }
  .start-card { padding: 24px 20px; margin-top: -30px; }
  .paper { width: 48%; }
  .report-media .card-shot { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } .btn:hover, .stage:hover .go { transform: none; } }
`;

/** Site header. On the homepage the section links are in-page anchors; elsewhere they go to /home. */
const navHtml = (app, onHome = true) => {
  const h = onHome ? '' : '/home';
  return `<header class="nav">
  <div class="wrap">
    <a class="brand" href="/home"><img src="/icons/icon-192.png" alt="" width="32" height="32" />Proj4D</a>
    <nav class="nav-links" aria-label="Main">
      <a href="${h}#plan">AI programmes</a><a href="${h}#track">Site reporting</a><a href="${h}#report">Client reports</a><a href="${h}#features">Features</a><a href="/pricing">Pricing</a><a href="${h}#faq">FAQ</a>
    </nav>
    <div class="nav-cta">
      <a class="nav-login" href="${app('/login')}">Log in</a>
      <a class="btn btn-primary" href="${app('/signup')}">Start free trial</a>
    </div>
    <button class="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu"><svg class="ico" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  </div>
  <div class="mobile-menu" id="mobile-menu">
    <a href="${h}#plan">AI programmes</a><a href="${h}#track">Site reporting</a><a href="${h}#report">Client reports</a><a href="${h}#features">Features</a><a href="/pricing">Pricing</a><a href="${h}#faq">FAQ</a><a href="${h}#demo">Book a demo</a><a href="${app('/login')}">Log in</a>
    <a class="btn btn-primary" href="${app('/signup')}">Start free trial</a>
  </div>
</header>`;
};

const footerHtml = (app, businessName) => `<footer>
  <div class="wrap">
    <div><a class="brand" href="/home" style="font-size:17px;margin-bottom:6px"><img src="/icons/icon-192.png" alt="" width="26" height="26" />Proj4D</a>© ${new Date().getFullYear()} ${esc(businessName)}</div>
    <nav aria-label="Footer"><a href="${app('/login')}">Log in</a><a href="${app('/signup')}">Start free trial</a><a href="/pricing">Pricing</a><a href="/home#demo">Book a demo</a><a href="${app('/terms')}">Terms</a><a href="${app('/privacy')}">Privacy</a></nav>
  </div>
</footer>`;

const MENU_JS = `var btn = document.querySelector('.menu-btn'), menu = document.getElementById('mobile-menu');
  btn.addEventListener('click', function () { var o = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', o); });
  menu.addEventListener('click', function (e) { if (e.target.tagName === 'A') { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });`;

const headTags = ({ title, desc, canonical, path = '/', og }) => `<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
${canonical ? `<link rel="canonical" href="${esc(canonical)}${path}" />` : ''}
<meta name="theme-color" content="#16324f" />
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${esc(og)}" />
${canonical ? `<meta property="og:url" content="${esc(canonical)}${path}" />` : ''}
<meta name="twitter:card" content="summary_large_image" />`;

export function renderLanding({ appOrigin = '', whatsapp = '', businessName = 'Proj4D', contactEmail = '', canonical = '' } = {}) {
  const app = (p) => `${appOrigin}${p}`;
  const wa = String(whatsapp).replace(/[^\d]/g, '');
  const waLink = wa ? `https://wa.me/${wa}?text=${encodeURIComponent("Hi, I'd like to know more about Proj4D.")}` : '';
  const year = new Date().getFullYear();
  const title = 'Proj4D – AI construction project management: programmes, site reports and progress';
  const desc =
    'Proj4D drafts your work programme from drawings and a BOQ with AI, records daily site progress, attendance and materials from any phone, and produces weekly, monthly, status and milestone reports your clients trust. Free 7-day trial.';
  const og = canonical ? `${canonical}/home/og-image.png` : '/home/og-image.png';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Proj4D',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, Android, iOS, Windows, macOS',
    description: desc,
    ...(canonical ? { url: canonical } : {}),
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
${canonical ? `<link rel="canonical" href="${esc(canonical)}/" />` : ''}
<meta name="theme-color" content="#16324f" />
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${esc(og)}" />
${canonical ? `<meta property="og:url" content="${esc(canonical)}/" />` : ''}
<meta name="twitter:card" content="summary_large_image" />
<link rel="preload" as="image" href="/home/dashboard.webp" fetchpriority="high" />
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>
${CSS}
</style>
</head>
<body>
${navHtml(app)}

<main>
<section class="hero">
  <div class="wrap">
    <div class="hero-grid">
      <div>
        <span class="pill">${icon('ai')} AI-powered construction project management</span>
        <h1>From drawings to handover, <em>every project on track.</em></h1>
        <p class="lead">Generate your work programme from drawings and a BOQ, record progress from site every day, and send weekly, monthly and milestone reports your clients trust. One app, on any phone.</p>
        <div class="cta-row">
          <a class="btn btn-primary" href="${app('/signup')}">Start your 7-day free trial</a>
          <a class="btn btn-ghost" href="#demo">Book a demo</a>
        </div>
        <ul class="hero-points">
          <li>${icon('check')} No card needed</li>
          <li>${icon('check')} Free plan for small teams</li>
          <li>${icon('check')} Installs on any phone</li>
        </ul>
      </div>
      <div class="shots">
        <div class="browser"><div class="browser-bar"><i></i><i></i><i></i></div>
          <img src="/home/dashboard.webp" width="1600" height="689" alt="Proj4D project dashboard showing overall progress against plan with an actual versus planned progress chart" fetchpriority="high" />
        </div>
        <div class="float-card">${icon('gantt')}<div><b>Programme ready</b><span>38 days · 41 tasks · critical path found</span></div></div>
        <div class="phone"><img src="/home/phone-projects.webp" width="600" height="1022" alt="Proj4D project list on a phone" loading="lazy" /></div>
      </div>
    </div>
    <nav class="stages" aria-label="What Proj4D does">
      ${STAGES.map(([ic, t, d, href], i) => `<a class="stage" href="${href}"><span class="num">0${i + 1}</span><h3>${icon(ic)}${esc(t)}</h3><p>${esc(d)}</p>${icon('arrow', 'go')}</a>`).join('\n      ')}
    </nav>
  </div>
</section>

<section class="plan" id="plan">
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">${icon('ai')} 01 · Plan</span>
      <h2>Your work programme, drafted by AI in minutes</h2>
      <p>Upload the working drawings and bill of quantities, set your dates and working days, and get a phased, logically linked programme you can edit, download and track against. No more building it from scratch in another tool.</p>
    </div>
    <div class="flow">
      <div class="inputs">
        <div class="input-chip">${icon('drawing')}<div><b>Working drawings</b><span>PDF or photos of plans, sections, elevations</span></div></div>
        <div class="input-chip">${icon('sheet')}<div><b>Bill of quantities</b><span>Excel, CSV or PDF</span></div></div>
        <div class="input-chip">${icon('calendar')}<div><b>Dates and calendar</b><span>Start, target completion, working days, holidays</span></div></div>
        <div class="input-chip">${icon('edit')}<div><b>Your notes</b><span>Method, phasing, access, client milestones</span></div></div>
      </div>
      <div class="flow-arrow" aria-hidden="true">${icon('arrow')}</div>
      <div class="gantt-shot"><img src="/home/programme-gantt.webp" width="1489" height="652" alt="AI-generated work programme as a Gantt chart with phases, linked tasks and the critical path in red" loading="lazy" /></div>
    </div>
    <div class="outputs">
      <div class="output">${icon('gantt')}<b>Phases, tasks and links</b><span>Durations sized from your BOQ quantities, with realistic sequencing and overlaps.</span></div>
      <div class="output">${icon('flag')}<b>Dates and critical path</b><span>Calculated on your working calendar, with a warning if it overruns the target date.</span></div>
      <div class="output">${icon('download')}<b>Gantt PDF and MS Project XML</b><span>A3 Gantt chart for the client, or open and refine it in MS Project.</span></div>
      <div class="output">${icon('check')}<b>Becomes your task list</b><span>One click turns it into the project’s activities for daily reporting.</span></div>
    </div>
  </div>
</section>

<section id="track">
  <div class="wrap">
    <div class="showcase">
      <div class="show-text">
        <span class="eyebrow dark">${icon('report')} 02 · Track</span>
        <h3>The day’s report, done before the supervisor leaves site</h3>
        <p>Activities come straight from the programme, so reporting progress is a few taps. Or the supervisor writes the day in plain words and AI fills in the form.</p>
        ${ticks([
          'Progress per activity, with previous and planned figures alongside',
          'Crew counts, plant, weather and hours lost, deliveries, visitors and site issues',
          'Photos from the camera or gallery, printed large in the PDF',
          'An AI summary at the top of every report',
        ])}
      </div>
      <div class="show-media"><div class="phone-solo"><img src="/home/phone-report.webp" width="600" height="1022" alt="Daily report form on a phone with activity progress and remarks" loading="lazy" /></div></div>
    </div>

    <div class="showcase flip">
      <div class="show-text">
        <span class="eyebrow dark">${icon('attendance')} Registers</span>
        <h3>Know who is on site and what is in stock</h3>
        <p>The morning register takes a minute: mark the exceptions, the rest are present. Deliveries and usage keep stock levels honest, with warnings before you run out.</p>
        ${ticks(['Late arrivals and absences with reasons, headcount by trade', 'Monthly attendance sheets for payroll and subcontractors', 'Stock on hand, low-stock alerts and usage by activity'])}
      </div>
      <div class="show-media"><div class="phone-solo"><img src="/home/phone-attendance.webp" width="600" height="1022" alt="Attendance register on a phone with present, late and absent buttons" loading="lazy" /></div></div>
    </div>
  </div>
</section>

<section class="tinted" id="report">
  <div class="wrap">
    <div class="showcase">
      <div class="show-text">
        <span class="eyebrow dark">${icon('pdf')} 03 · Report</span>
        <h3>Client reports that write themselves, and that you approve</h3>
        <p>Proj4D calculates the numbers from your programme and site records. AI writes the narrative. You edit anything, choose what to include, then publish a branded PDF.</p>
        <div class="report-kinds">
          <div class="kind"><b>${icon('calendar')} Weekly and monthly</b><span>Completed work, planned vs actual, look-ahead, challenges</span></div>
          <div class="kind"><b>${icon('progress')} Project status (WIP)</b><span>Completion by phase, schedule variance, forecast finish</span></div>
          <div class="kind"><b>${icon('flag')} Milestone tracking</b><span>Target vs actual completion for key phases</span></div>
          <div class="kind"><b>${icon('report')} Daily progress</b><span>The day’s work, crew, plant, weather and issues</span></div>
        </div>
        ${ticks(['Planned vs actual S-curve, KPIs and tables included automatically', 'Add notes and photos; refresh the figures any time', 'Drafts are watermarked until you publish'])}
      </div>
      <div class="show-media">
        <div class="report-media">
          <div class="card-shot"><img src="/home/report-editor.webp" width="1600" height="950" alt="Weekly progress report editor showing KPIs and an editable executive summary" loading="lazy" /></div>
          <img class="paper" src="/home/progress-report.webp" width="900" height="1273" alt="Published weekly progress report PDF with KPIs, summary and progress curve" loading="lazy" />
        </div>
      </div>
    </div>
  </div>
</section>

<section id="decide">
  <div class="wrap">
    <div class="showcase flip">
      <div class="show-text">
        <span class="eyebrow dark">${icon('progress')} 04 · Decide</span>
        <h3>Spot slippage while there is still time to act</h3>
        <p>The dashboard brings the programme, reports and registers together: overall progress against plan, every task’s status, the attendance trend and materials that need attention.</p>
        ${ticks(['Actual vs planned progress, updated after every report', 'Tasks flagged as on track, slipping or behind', 'AI insights on risks and recommended actions', 'Push alerts for serious issues, low stock and missed reports'])}
      </div>
      <div class="show-media stackv">
        <div class="card-shot"><img src="/home/attendance-panel.webp" width="1200" height="302" alt="Attendance panel with a 14-day attendance chart" loading="lazy" /></div>
        <div class="card-shot"><img src="/home/materials-panel.webp" width="1200" height="242" alt="Materials panel showing deliveries, usage and low stock" loading="lazy" /></div>
      </div>
    </div>
  </div>
</section>

<section class="tinted" id="features">
  <div class="wrap">
    <div class="section-head">
      <h2>Everything you need to run the project, in one place</h2>
      <p>From the first drawing to the last bag of cement, the office, the site and the client work from the same up-to-date picture.</p>
    </div>
    <div class="feature-grid">
      ${FEATURES.map(([ic, t, d]) => `<article class="feature"><div class="ico-wrap">${icon(ic)}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join('\n      ')}
    </div>
  </div>
</section>

<section class="how" id="how">
  <div class="wrap">
    <div class="section-head">
      <h2>How it works</h2>
      <p>No long rollout. Most teams file their first report on day one.</p>
    </div>
    <div class="steps">
      ${STEPS.map(([t, d]) => `<div class="step"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('\n      ')}
    </div>
  </div>
</section>

<section class="start">
  <div class="wrap">
    <div class="start-card">
      <div>
        <h2>Try everything free for 7 days</h2>
        <p>Create your company account and use every feature, AI included, with your own projects and team. No card needed.</p>
        <div class="start-cta">
          <a class="btn btn-primary" href="${app('/signup')}">Start your free trial</a>
          <a class="btn btn-navy" href="/pricing">See plans and pricing</a>
        </div>
      </div>
      <div class="offers">
        <div class="offer">${icon('check')}<div><b>7-day free trial</b><span>Every feature, including AI programmes and client reports.</span></div></div>
        <div class="offer">${icon('check')}<div><b>Free plan, forever</b><span>Daily reports, registers and PDFs for teams of up to 3.</span></div></div>
        <div class="offer">${icon('shield')}<div><b>Your data stays yours</b><span>Private to your company, encrypted in transit.</span></div></div>
      </div>
    </div>
  </div>
</section>

<section class="install">
  <div class="wrap install-grid">
    <div>
      <span class="eyebrow dark">${icon('phone')} On every device</span>
      <h2>Install Proj4D like an app</h2>
      <p style="color:var(--ink-2);font-size:18px">No app store needed. Install Proj4D on your phone or computer, open it from its own icon and get reminders and alerts as notifications.</p>
      <div class="platforms">
        <div class="platform"><b>Android</b>Chrome → ⋮ → Install app</div>
        <div class="platform"><b>iPhone / iPad</b>Safari → Share → Add to Home Screen</div>
        <div class="platform"><b>Computer</b>Chrome or Edge → install icon in the address bar</div>
      </div>
    </div>
    <div class="show-media"><div class="phone-solo"><img src="/home/phone-projects.webp" width="600" height="1022" alt="Proj4D running as an installed app on a phone" loading="lazy" /></div></div>
  </div>
</section>

<section class="tinted" id="faq">
  <div class="wrap">
    <div class="section-head"><h2>Questions</h2></div>
    <div class="faq-list">
      ${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n      ')}
    </div>
  </div>
</section>

<section class="demo" id="demo">
  <div class="wrap demo-grid">
    <div>
      <h2>See Proj4D on your own project</h2>
      <p class="lead">Book a short demo. Bring your drawings, BOQ or current programme and we’ll show you the programme, daily reporting and client reports on your own job, and help you choose the right plan.</p>
      <div class="demo-alt">
        ${waLink ? `<a class="btn btn-wa" href="${esc(waLink)}" target="_blank" rel="noopener"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-3.9-1z"/><path d="M9 9.5c0 2.8 2.7 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z"/></svg>Chat on WhatsApp</a>` : ''}
        <a class="btn btn-ghost" href="${app('/signup')}">Or start your free trial now</a>
        ${contactEmail ? `<span class="small" style="color:#c9d4e2">Email: <a style="color:#fff" href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a></span>` : ''}
      </div>
    </div>
    <form class="demo-form" id="demo-form" novalidate>
      <div class="f"><label for="d-name">Your name *</label><input id="d-name" name="name" autocomplete="name" required maxlength="120" /></div>
      <div class="f"><label for="d-company">Company *</label><input id="d-company" name="company" autocomplete="organization" required maxlength="120" /></div>
      <div class="f"><label for="d-email">Work email *</label><input id="d-email" name="email" type="email" autocomplete="email" required maxlength="160" /></div>
      <div class="f"><label for="d-phone">Phone / WhatsApp</label><input id="d-phone" name="phone" type="tel" autocomplete="tel" maxlength="40" /></div>
      <div class="f full"><label for="d-size">Team size</label>
        <select id="d-size" name="team_size"><option value="">Choose…</option><option>1–10 people</option><option>11–50 people</option><option>51–200 people</option><option>200+ people</option></select>
      </div>
      <div class="f full"><label for="d-msg">What would you like to see?</label><textarea id="d-msg" name="message" maxlength="2000" placeholder="e.g. We run 4 sites and want AI programmes, daily reports and monthly client reports."></textarea></div>
      <div class="hp" aria-hidden="true"><label for="d-web">Website</label><input id="d-web" name="website" tabindex="-1" autocomplete="off" /></div>
      <div class="form-msg" id="form-msg" role="status" aria-live="polite"></div>
      <div class="f full"><button class="btn btn-primary" type="submit">Request a demo</button>
        <span class="small">We’ll only use your details to contact you about Proj4D. See our <a href="${app('/privacy')}">Privacy Policy</a>.</span></div>
    </form>
  </div>
</section>
</main>

${footerHtml(app, businessName)}

<script>
(function () {
  ${MENU_JS}
  var form = document.getElementById('demo-form'), msg = document.getElementById('form-msg');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {}; new FormData(form).forEach(function (v, k) { data[k] = String(v).trim(); });
    msg.className = 'form-msg';
    if (!data.name || !data.company || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(data.email)) { msg.textContent = 'Please enter your name, company and a valid email address.'; msg.className = 'form-msg err'; return; }
    var b = form.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Sending…';
    fetch('/api/public/demo-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); })
      .then(function () { form.reset(); msg.textContent = 'Thank you! We’ll be in touch within one working day to arrange your demo.'; msg.className = 'form-msg ok'; })
      .catch(function (err) { msg.textContent = err.message; msg.className = 'form-msg err'; })
      .finally(function () { b.disabled = false; b.textContent = 'Request a demo'; });
  });
})();
</script>
</body>
</html>`;
}

// ------------------------------------------------------------------ Plans & pricing page

const money = (amount, cur) =>
  (cur === 'NGN' ? '₦' : '$') + Number(amount).toLocaleString('en-US', Number.isInteger(amount) || cur === 'NGN' ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perMonthOfYear = (amount, cur) => money(Math.round((amount / 12) * (cur === 'NGN' ? 1 : 100)) / (cur === 'NGN' ? 1 : 100), cur);

const PLAN_CARD_FEATURES = {
  free: ['Daily site reports and PDFs', 'Attendance and materials registers', 'Programme upload (Excel, CSV, MS Project)', 'Progress tracking and notifications'],
  starter: ['Everything in Free', 'AI report summaries', 'AI work programme generator (PDF and MS Project)', 'Read PDF programmes with AI'],
  professional: ['Everything in Starter', 'Fill reports from site notes with AI', 'AI project insights', 'Weekly, monthly, status and milestone reports with AI', 'Reports without Proj4D branding (your logo only)'],
  business: ['Everything in Professional', 'Priority support'],
};

const PRICING_FAQ = [
  ['How does the free trial work?', 'Every new company gets 7 days of every feature, AI included, with no card needed. When the trial ends you move to the Free plan automatically unless you choose a paid plan. Nothing is deleted.'],
  ['How do I pay?', 'Paid plans are billed through Paystack by card, bank transfer or USSD. Nigerian customers pay in naira; customers elsewhere can pay in US dollars.'],
  ['Monthly or yearly?', 'Either. Yearly billing costs the same as 10 months, so you get 2 months free.'],
  ['Can I change or cancel my plan?', 'Yes, any time from the Plan & billing page in the app. If you cancel, you keep your plan until the end of the period you’ve paid for, then move to the Free plan. A new plan starts straight away and is charged in full; unused time on the previous plan isn’t refunded.'],
  ['What happens if we go over a plan’s limits?', 'Nothing is deleted. You can’t add more members or projects than your plan allows, and if a team is larger than the plan (for example after the trial), the newest members are paused until you upgrade.'],
  ['What counts as a team member?', 'Anyone in your company who can log in to Proj4D: admins and members. Clients don’t need an account to receive your PDF reports.'],
  ['What is the daily AI programme limit?', 'The number of work programmes your company can generate with AI each day: 5 on Starter, 20 on Professional and 50 on Business. Editing and downloading a programme doesn’t count.'],
  ['Do you offer custom plans?', 'For large contractors or several companies under one group, book a demo and we’ll talk about the right setup.'],
];

/** Public plans and pricing page, rendered on each request so it always shows the current prices. */
export function renderPricing({ appOrigin = '', businessName = 'Proj4D', canonical = '', plans, prices, trialDays = 7 } = {}) {
  const app = (p) => `${appOrigin}${p}`;
  const title = 'Plans and pricing – Proj4D';
  const desc = `Proj4D plans for construction teams: a Free plan, and Starter, Professional and Business plans with AI work programmes and client reports. Pay in naira or US dollars, monthly or yearly. ${trialDays}-day free trial, no card needed.`;
  const og = canonical ? `${canonical}/home/og-image.png` : '/home/og-image.png';
  const limit = (n, word) => (n == null ? `Unlimited ${word}` : `Up to ${n} ${word}`);
  const priceAttrs = (key) =>
    ['NGN', 'USD']
      .flatMap((c) =>
        ['monthly', 'annually'].map((i) => {
          const a = prices[key]?.[c]?.[i];
          return a == null ? '' : `data-${c.toLowerCase()}-${i}="${esc(money(a, c))}" data-${c.toLowerCase()}-${i}-pm="${esc(perMonthOfYear(a, c))}"`;
        })
      )
      .join(' ');

  const cards = plans
    .map((p) => {
      const free = p.key === 'free';
      const featured = p.key === 'professional';
      return `<article class="tier ${featured ? 'featured' : ''}">
        ${featured ? '<div class="flag">Most popular</div>' : ''}
        <h2>${esc(p.name)}</h2>
        <p class="blurb">${esc(p.blurb)}</p>
        <div class="price" ${free ? '' : priceAttrs(p.key)}>
          <span class="amount">${free ? '₦0' : esc(money(prices[p.key]?.NGN?.monthly ?? 0, 'NGN'))}</span><span class="per">${free ? ' forever' : '/month'}</span>
        </div>
        <div class="price-note">${free ? 'No card, no time limit' : '<span class="pm"></span>'}</div>
        <a class="btn ${featured ? 'btn-primary' : 'btn-outline'}" href="${app('/signup')}">${free ? 'Start free' : `Start ${trialDays}-day free trial`}</a>
        <ul class="ticks">
          <li>${icon('check')}<span><b>${esc(limit(p.members, 'members'))}</b></span></li>
          <li>${icon('check')}<span><b>${esc(limit(p.projects, 'projects'))}</b></span></li>
          ${p.programmes_per_day ? `<li>${icon('check')}<span><b>Up to ${p.programmes_per_day} AI programmes a day</b></span></li>` : ''}
          ${(PLAN_CARD_FEATURES[p.key] || []).map((f) => `<li>${icon('check')}<span>${esc(f)}</span></li>`).join('')}
          ${free ? `<li class="no"><span>No AI features</span></li>` : ''}
        </ul>
      </article>`;
    })
    .join('\n');

  // Comparison table
  const yes = `<span class="yes" aria-label="Included">${icon('check')}</span>`;
  const no = '<span class="no-mark" aria-label="Not included">–</span>';
  const has = (p, f) => (p.features[f] ? yes : no);
  const rows = [
    ['Team', [
      ['Team members', (p) => (p.members == null ? 'Unlimited' : p.members)],
      ['Projects', (p) => (p.projects == null ? 'Unlimited' : p.projects)],
      ['Company accounts with admins and members', () => yes],
    ]],
    ['Site reporting and tracking', [
      ['Daily progress reports with photos', () => yes],
      ['Attendance register', () => yes],
      ['Materials register and stock', () => yes],
      ['Programme upload (Excel, CSV, MS Project XML)', () => yes],
      ['Live progress vs plan and dashboard', () => yes],
      ['Reminders and push notifications', () => yes],
      ['Install as an app on phone and computer', () => yes],
    ]],
    ['AI', [
      ['AI report summaries', (p) => has(p, 'summaries')],
      ['AI work programme generator', (p) => (p.features.programmes ? `${p.programmes_per_day} a day` : no)],
      ['Read PDF programmes with AI', (p) => has(p, 'programme_pdf')],
      ['Fill reports from site notes with AI', (p) => has(p, 'notes')],
      ['AI project insights', (p) => has(p, 'insights')],
    ]],
    ['Client reports and branding', [
      ['PDF reports with your logo and colours', () => yes],
      ['Weekly and monthly progress reports', (p) => has(p, 'progress_reports')],
      ['Project status (WIP) reports', (p) => has(p, 'progress_reports')],
      ['Milestone tracking reports', (p) => has(p, 'progress_reports')],
      ['No Proj4D branding on PDFs', (p) => has(p, 'white_label')],
    ]],
    ['Support', [
      ['Email and WhatsApp support', () => yes],
      ['Priority support', (p) => (p.key === 'business' ? yes : no)],
    ]],
  ];
  const table = `<table class="compare">
    <thead><tr><th scope="col"><span class="sr">Feature</span></th>${plans.map((p) => `<th scope="col">${esc(p.name)}</th>`).join('')}</tr></thead>
    ${rows
      .map(
        ([group, items]) =>
          `<tbody><tr class="group"><th colspan="${plans.length + 1}" scope="colgroup">${esc(group)}</th></tr>${items
            .map(([label, f]) => `<tr><th scope="row">${esc(label)}</th>${plans.map((p) => `<td>${f(p)}</td>`).join('')}</tr>`)
            .join('')}</tbody>`
      )
      .join('')}
  </table>`;

  return `<!doctype html>
<html lang="en">
<head>
${headTags({ title, desc, canonical, path: '/pricing', og })}
<style>
${CSS}
.p-hero { background: radial-gradient(900px 420px at 85% -10%, #2a5a8a 0, transparent 62%), var(--navy); color: #fff; padding: 64px 0 120px; text-align: center; }
.p-hero h1 { margin: 10px auto 14px; max-width: 16em; }
.p-hero .lead { margin: 0 auto 26px; }
.toggles { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.seg { display: inline-flex; padding: 4px; border-radius: 12px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18); }
.seg button { font: inherit; font-weight: 700; font-size: 15px; color: #d5deea; background: none; border: 0; padding: 9px 16px; border-radius: 9px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: #fff; color: var(--navy); }
.seg .save { font-size: 12px; color: var(--amber); margin-left: 4px; }
.seg button[aria-pressed="true"] .save { color: var(--good); }
.plans { margin-top: -84px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; position: relative; z-index: 2; align-items: stretch; }
.tier { position: relative; background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 26px 22px; display: flex; flex-direction: column; box-shadow: 0 24px 48px -30px rgba(8,20,35,.4); }
.tier.featured { border: 2px solid var(--amber); box-shadow: 0 30px 60px -28px rgba(242,169,0,.45); }
.tier .flag { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--amber); color: #1c1600; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; padding: 3px 12px; border-radius: 99px; white-space: nowrap; }
.tier h2 { font-size: 22px; margin: 0; }
.tier .blurb { color: var(--muted); font-size: 14px; margin: 4px 0 16px; min-height: 2.8em; }
.tier .price { display: flex; align-items: baseline; flex-wrap: wrap; }
.tier .amount { font-size: 36px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.tier .per { color: var(--muted); font-weight: 600; margin-left: 3px; }
.tier .price-note { min-height: 22px; font-size: 13px; color: var(--muted); margin: 2px 0 16px; }
.tier .btn { width: 100%; }
.btn-outline { background: #fff; color: var(--navy); border-color: #cfd5de; }
.btn-outline:hover { border-color: var(--navy); }
.tier .ticks { margin-top: 20px; font-size: 14.5px; }
.tier .ticks li { margin-bottom: 9px; }
.tier .ticks .no { color: var(--muted); padding-left: 30px; }
.trial-line { text-align: center; margin: 26px 0 0; color: var(--ink-2); }
.trial-line b { color: var(--ink); }
.pay-logos { display: flex; gap: 10px 22px; justify-content: center; flex-wrap: wrap; margin-top: 10px; font-size: 14px; color: var(--muted); }
.pay-logos span { display: inline-flex; align-items: center; gap: 6px; }
.pay-logos .ico { width: 18px; height: 18px; color: var(--good); }
.compare-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; background: #fff; }
table.compare { width: 100%; border-collapse: collapse; min-width: 760px; font-size: 15px; }
.compare th, .compare td { padding: 12px 16px; border-bottom: 1px solid var(--line); text-align: center; }
.compare thead th { position: sticky; top: 0; background: #fff; font-size: 16px; padding-top: 18px; padding-bottom: 14px; }
.compare tbody th[scope=row] { text-align: left; font-weight: 500; color: var(--ink); }
.compare tr.group th { text-align: left; background: var(--bg); font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--navy-2); padding: 10px 16px; }
.compare td { font-weight: 600; color: var(--ink); }
.compare .yes .ico { width: 20px; height: 20px; color: var(--good); stroke-width: 2.6; vertical-align: middle; }
.compare .no-mark { color: #b5bdc8; }
.compare tbody tr:last-child td, .compare tbody tr:last-child th { border-bottom-color: var(--line); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.cta-band { background: var(--navy); color: #fff; text-align: center; }
.cta-band p { color: #c9d4e2; font-size: 18px; margin: 0 auto 26px; max-width: 40em; }
.cta-band .cta-row { justify-content: center; }
@media (max-width: 1080px) { .plans { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 16px; } }
@media (max-width: 760px) {
  .p-hero { padding: 40px 0 100px; }
  .plans { grid-template-columns: 1fr; gap: 24px; }
  .seg { width: 100%; }
  .seg button { flex: 1; padding: 9px 8px; }
  .tier .blurb { min-height: 0; }
}
</style>
</head>
<body>
${navHtml(app, false)}
<main>
<section class="p-hero">
  <div class="wrap">
    <span class="pill">${icon('check')} ${trialDays}-day free trial on every plan · no card needed</span>
    <h1>Simple plans that grow with your projects</h1>
    <p class="lead">Start free, then add AI programmes, client reports and bigger teams when you need them. Pay in naira or US dollars, monthly or yearly.</p>
    <div class="toggles">
      <div class="seg" role="group" aria-label="Billing period">
        <button type="button" data-interval="monthly" aria-pressed="true">Monthly</button>
        <button type="button" data-interval="annually" aria-pressed="false">Yearly <span class="save">2 months free</span></button>
      </div>
      <div class="seg" role="group" aria-label="Currency">
        <button type="button" data-currency="ngn" aria-pressed="true">₦ Naira</button>
        <button type="button" data-currency="usd" aria-pressed="false">$ US dollar</button>
      </div>
    </div>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap">
    <div class="plans">
      ${cards}
    </div>
    <p class="trial-line"><b>Every new company starts with ${trialDays} days of every feature.</b> After the trial, keep going on the Free plan or choose the plan that fits.</p>
    <div class="pay-logos"><span>${icon('shield')} Secure payments by Paystack</span><span>${icon('check')} Card, bank transfer or USSD</span><span>${icon('check')} Cancel any time</span></div>
  </div>
</section>

<section class="tinted" id="compare">
  <div class="wrap">
    <div class="section-head"><h2>Compare plans</h2><p>Everything included in each plan.</p></div>
    <div class="compare-wrap">${table}</div>
  </div>
</section>

<section id="faq">
  <div class="wrap">
    <div class="section-head"><h2>Billing questions</h2></div>
    <div class="faq-list">
      ${PRICING_FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n      ')}
    </div>
  </div>
</section>

<section class="cta-band">
  <div class="wrap">
    <h2>Not sure which plan fits?</h2>
    <p>Start the free trial with your own project, or book a short demo and we’ll help you choose.</p>
    <div class="cta-row">
      <a class="btn btn-primary" href="${app('/signup')}">Start your free trial</a>
      <a class="btn btn-ghost" href="/home#demo">Book a demo</a>
    </div>
  </div>
</section>
</main>
${footerHtml(app, businessName)}
<script>
(function () {
  ${MENU_JS}
  var state = { interval: 'monthly', currency: 'ngn' };
  try { if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Africa/Lagos') state.currency = 'usd'; } catch (e) {}
  try { var saved = JSON.parse(localStorage.getItem('p4d_pricing') || 'null'); if (saved) state = saved; } catch (e) {}
  function render() {
    document.querySelectorAll('[data-interval]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.interval === state.interval); });
    document.querySelectorAll('[data-currency]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.currency === state.currency); });
    var yearly = state.interval === 'annually';
    document.querySelectorAll('.tier').forEach(function (card) {
      var price = card.querySelector('.price'), amount = card.querySelector('.amount'), per = card.querySelector('.per'), pm = card.querySelector('.pm');
      var key = 'data-' + state.currency + '-' + state.interval;
      if (!price.hasAttribute(key)) { amount.textContent = state.currency === 'ngn' ? '₦0' : '$0'; return; }
      amount.textContent = price.getAttribute(key);
      per.textContent = yearly ? '/year' : '/month';
      if (pm) pm.textContent = yearly ? price.getAttribute(key + '-pm') + ' a month, billed yearly' : 'Billed monthly';
    });
    try { localStorage.setItem('p4d_pricing', JSON.stringify(state)); } catch (e) {}
  }
  document.querySelectorAll('[data-interval]').forEach(function (b) { b.addEventListener('click', function () { state.interval = b.dataset.interval; render(); }); });
  document.querySelectorAll('[data-currency]').forEach(function (b) { b.addEventListener('click', function () { state.currency = b.dataset.currency; render(); }); });
  render();
})();
</script>
</body>
</html>`;
}
