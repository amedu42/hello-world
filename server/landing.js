// Public homepage (marketing site). Plain server-rendered HTML so it loads fast and search engines
// can read it. Links into the app use APP_ORIGIN when the homepage and app are on different domains
// (e.g. proj4d.com and app.proj4d.com); otherwise they are relative.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICONS = {
  programme: '<path d="M4 5h16M4 10h10M4 15h13M4 20h7"/><circle cx="19" cy="18" r="3"/>',
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
};
const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const FEATURES = [
  ['programme', 'Upload your work programme', 'Import activities from Excel, CSV, MS Project XML or a PDF. Dates and durations set the plan every report is measured against.'],
  ['report', 'Daily reports in minutes', 'Supervisors pick activities, set progress, add weather, labour, issues, visitors and site photos from their phone, even with gloves on.'],
  ['progress', 'Live progress vs plan', 'Overall progress updates with every report, weighted by duration, with an actual-vs-planned curve and early warning when work slips.'],
  ['attendance', 'Attendance register', 'A morning register for the whole crew: present, late or absent with reasons, headcount by trade and a printable monthly sheet.'],
  ['materials', 'Materials register', 'Deliveries, usage and wastage with live stock on hand, low-stock warnings and usage by activity for costing.'],
  ['pdf', 'Professional PDF reports', 'Daily reports, attendance and materials registers as clean PDFs in your company colours and logo, with photos sized for printing.'],
  ['bell', 'Reminders and alerts', 'Push notifications to take the register, file the report, and know at once about high-severity issues, low stock or slippage.'],
  ['team', 'Your whole team', 'Company accounts with admins and members. Every company sees only its own projects, and everyone works from the same live data.'],
  ['ai', 'AI that saves typing', 'Turn a supervisor’s notes into a filled-in report, get a written summary for each day, and spot risks across recent reports.'],
];

const STEPS = [
  ['Set up the project', 'Create the project, upload the programme and add your crew and materials. It takes about ten minutes.'],
  ['Report from site every day', 'Each morning the supervisor takes the register. Each evening they file the daily report from their phone.'],
  ['Everyone sees where things stand', 'Progress, attendance and stock update instantly. Download PDFs for clients and get alerts when something needs attention.'],
];

const FAQ = [
  ['How much does Proj4D cost?', 'You can create a company account and start using Proj4D straight away. For pricing for your team, book a demo or send us a message and we’ll find the right plan.'],
  ['Do I need to install anything?', 'No. Proj4D runs in any modern browser on phones, tablets and computers. You can also install it as an app on Android, iPhone and desktop so it opens from its own icon.'],
  ['Which programme files can I upload?', 'Excel (.xlsx), CSV and MS Project XML exports, including from Primavera P6 via Excel. PDF programmes and unusual layouts can be read with AI.'],
  ['Can supervisors use it on site?', 'Yes. Everything is designed for phones first: large buttons, photo upload from the camera or gallery, drafts saved until you submit, and reminders when something is due.'],
  ['Is our data private?', 'Each company’s projects, reports, photos and registers are visible only to its own users. Passwords are encrypted and all traffic uses HTTPS.'],
  ['Can reports carry our branding?', 'Yes. Add your logo and brand colour once and every PDF report and register uses them.'],
  ['Does it work without internet?', 'Proj4D needs a connection to save reports. If the signal drops, it tells you, and an unfinished daily report is kept on the phone until you submit it.'],
];

export function renderLanding({ appOrigin = '', whatsapp = '', businessName = 'Proj4D', contactEmail = '', canonical = '' } = {}) {
  const app = (p) => `${appOrigin}${p}`;
  const wa = String(whatsapp).replace(/[^\d]/g, '');
  const waLink = wa ? `https://wa.me/${wa}?text=${encodeURIComponent("Hi, I'd like to know more about Proj4D.")}` : '';
  const year = new Date().getFullYear();
  const title = 'Proj4D – Construction progress tracking and daily site reports';
  const desc = 'Proj4D turns your work programme and daily site reports into live progress, attendance and materials tracking, with professional PDF reports. Built for contractors, project managers and site supervisors.';
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
:root { --navy: #16324f; --navy-2: #224b74; --amber: #f2a900; --amber-2: #ffb81a; --ink: #1c2430; --ink-2: #44505f; --muted: #687384; --line: #e1e5eb; --bg: #f4f6f9; --white: #fff; --good: #1f8a4c; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 72px; }
body { margin: 0; color: var(--ink); background: var(--white); font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; }
img { max-width: 100%; height: auto; display: block; }
a { color: var(--navy-2); }
.wrap { max-width: 1180px; margin: 0 auto; padding: 0 20px; }
.ico { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 0 22px; border-radius: 10px; font-weight: 700; font-size: 16px; text-decoration: none; border: 2px solid transparent; transition: background .15s, border-color .15s, transform .15s; cursor: pointer; font-family: inherit; }
.btn:hover { transform: translateY(-1px); }
.btn-primary { background: var(--amber); color: #1c1600; }
.btn-primary:hover { background: var(--amber-2); }
.btn-ghost { background: transparent; color: var(--white); border-color: rgba(255,255,255,.45); }
.btn-ghost:hover { border-color: var(--white); background: rgba(255,255,255,.06); }
.btn-outline { background: var(--white); color: var(--navy); border-color: var(--line); }
.btn-wa { background: #1f8a4c; color: #fff; }
.btn-wa:hover { background: #18733f; }
:focus-visible { outline: 3px solid var(--amber); outline-offset: 2px; }

/* nav */
.nav { position: sticky; top: 0; z-index: 50; background: var(--navy); color: #fff; border-bottom: 3px solid var(--amber); }
.nav .wrap { display: flex; align-items: center; gap: 24px; min-height: 64px; }
.brand { display: flex; align-items: center; gap: 10px; color: #fff; text-decoration: none; font-weight: 800; font-size: 20px; }
.brand img { width: 32px; height: 32px; border-radius: 7px; }
.nav-links { display: flex; gap: 22px; margin-left: 8px; }
.nav-links a { color: #c9d4e2; text-decoration: none; font-weight: 600; font-size: 15px; }
.nav-links a:hover { color: #fff; }
.nav-cta { margin-left: auto; display: flex; gap: 10px; align-items: center; }
.nav-cta .btn { min-height: 40px; padding: 0 16px; font-size: 15px; }
.nav-login { color: #fff; text-decoration: none; font-weight: 700; padding: 8px 10px; }
.menu-btn { display: none; margin-left: auto; background: none; border: 0; color: #fff; padding: 8px; cursor: pointer; }
.mobile-menu { display: none; }

/* hero */
.hero { background: radial-gradient(1200px 500px at 85% 0%, #224b74 0, transparent 60%), var(--navy); color: #fff; padding: 64px 0 56px; overflow: hidden; }
.hero-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 48px; align-items: center; }
.eyebrow { display: inline-block; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--amber); margin-bottom: 14px; }
h1 { font-size: clamp(36px, 5vw, 56px); line-height: 1.08; margin: 0 0 18px; letter-spacing: -.02em; }
.lead { font-size: 19px; color: #d5deea; margin: 0 0 28px; max-width: 34em; }
.cta-row { display: flex; gap: 12px; flex-wrap: wrap; }
.hero-points { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 22px; font-size: 14px; color: #c9d4e2; padding: 0; list-style: none; }
.hero-points li { display: flex; align-items: center; gap: 6px; }
.hero-points .ico { width: 18px; height: 18px; color: var(--amber); }
.shots { position: relative; padding-bottom: 40px; }
.browser { background: #fff; border-radius: 12px; box-shadow: 0 30px 60px -20px rgba(8,20,35,.55); overflow: hidden; border: 1px solid rgba(255,255,255,.15); }
.browser-bar { display: flex; gap: 6px; align-items: center; padding: 10px 12px; background: #e9edf2; }
.browser-bar i { width: 10px; height: 10px; border-radius: 50%; background: #c7ced8; }
.phone { position: absolute; right: -10px; bottom: 0; width: 34%; max-width: 210px; border: 7px solid #0e1621; border-radius: 26px; overflow: hidden; background: #0e1621; box-shadow: 0 25px 50px -15px rgba(8,20,35,.6); }
.phone img { border-radius: 18px; }

/* sections */
section { padding: 80px 0; }
.section-head { max-width: 720px; margin: 0 auto 44px; text-align: center; }
h2 { font-size: clamp(28px, 3.4vw, 40px); line-height: 1.15; margin: 0 0 12px; letter-spacing: -.01em; }
.section-head p { color: var(--ink-2); font-size: 18px; margin: 0; }
.trust { padding: 28px 0 8px; background: var(--bg); text-align: center; color: var(--muted); font-weight: 600; }
.features { background: var(--bg); }
.feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.feature { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 24px; }
.feature .ico-wrap { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; background: #eef3f9; color: var(--navy-2); margin-bottom: 14px; }
.feature h3 { margin: 0 0 6px; font-size: 18px; }
.feature p { margin: 0; color: var(--ink-2); font-size: 15px; }

.showcase { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: center; }
.showcase + .showcase { margin-top: 88px; }
.showcase.flip .show-text { order: 2; }
.show-text h3 { font-size: 28px; line-height: 1.2; margin: 0 0 12px; }
.show-text p { color: var(--ink-2); font-size: 17px; }
.ticks { list-style: none; padding: 0; margin: 18px 0 0; }
.ticks li { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; color: var(--ink); }
.ticks .ico { width: 20px; height: 20px; color: var(--good); flex-shrink: 0; margin-top: 3px; stroke-width: 2.4; }
.show-media { display: flex; justify-content: center; gap: 16px; align-items: flex-end; }
.phone-solo { width: 46%; max-width: 270px; border: 8px solid #0e1621; border-radius: 30px; overflow: hidden; background: #0e1621; box-shadow: 0 25px 50px -20px rgba(8,20,35,.45); }
.phone-solo img { border-radius: 21px; }
.card-shot { border-radius: 12px; overflow: hidden; border: 1px solid var(--line); box-shadow: 0 20px 40px -20px rgba(8,20,35,.35); background: #fff; }
.stack { display: flex; flex-direction: column; gap: 16px; width: 100%; }
.paper { width: 78%; max-width: 440px; box-shadow: 0 25px 50px -20px rgba(8,20,35,.45); border: 1px solid var(--line); transform: rotate(-1.5deg); background: #fff; }

.how { background: var(--navy); color: #fff; }
.how .section-head p { color: #c9d4e2; }
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; counter-reset: step; }
.step { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; padding: 26px; }
.step::before { counter-increment: step; content: counter(step); display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--amber); color: #1c1600; font-weight: 800; margin-bottom: 14px; }
.step h3 { margin: 0 0 6px; font-size: 19px; }
.step p { margin: 0; color: #c9d4e2; }

.install { background: var(--bg); }
.install-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 48px; align-items: center; }
.platforms { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 22px; }
.platform { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px; font-size: 14px; color: var(--ink-2); }
.platform b { display: block; color: var(--ink); margin-bottom: 2px; }

.faq-list { max-width: 820px; margin: 0 auto; }
details { border-bottom: 1px solid var(--line); padding: 4px 0; }
summary { cursor: pointer; list-style: none; font-weight: 700; font-size: 18px; padding: 16px 36px 16px 0; position: relative; }
summary::-webkit-details-marker { display: none; }
summary::after { content: '+'; position: absolute; right: 6px; top: 12px; font-size: 26px; font-weight: 400; color: var(--navy-2); }
details[open] summary::after { content: '–'; }
details p { margin: 0 0 18px; color: var(--ink-2); }

.demo { background: linear-gradient(170deg, var(--navy), #0f2338); color: #fff; }
.demo-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 48px; align-items: start; }
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

footer { background: #0e1621; color: #9aa7b6; padding: 40px 0; font-size: 14px; }
footer .wrap { display: flex; gap: 24px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
footer a { color: #c9d4e2; text-decoration: none; margin-right: 18px; }
footer a:hover { color: #fff; }

@media (max-width: 960px) {
  .hero-grid, .showcase, .install-grid, .demo-grid { grid-template-columns: 1fr; }
  .showcase.flip .show-text { order: 0; }
  .feature-grid { grid-template-columns: 1fr 1fr; }
  .steps { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .nav-links, .nav-cta { display: none; }
  .menu-btn { display: block; }
  .mobile-menu.open { display: flex; flex-direction: column; gap: 4px; padding: 8px 20px 18px; background: var(--navy); }
  .mobile-menu a { color: #fff; text-decoration: none; font-weight: 600; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.1); }
  .mobile-menu .btn { margin-top: 10px; }
  section { padding: 56px 0; }
  .hero { padding: 36px 0 24px; }
  .lead { font-size: 17px; }
  .cta-row .btn { flex: 1 1 100%; }
  .feature-grid, .platforms { grid-template-columns: 1fr; }
  form.demo-form { grid-template-columns: 1fr; padding: 20px; }
  .phone { width: 38%; right: 0; }
  .showcase + .showcase { margin-top: 64px; }
  .phone-solo { width: 62%; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } .btn:hover { transform: none; } }
</style>
</head>
<body>
<header class="nav">
  <div class="wrap">
    <a class="brand" href="/home"><img src="/icons/icon-192.png" alt="" width="32" height="32" />Proj4D</a>
    <nav class="nav-links" aria-label="Main">
      <a href="#features">Features</a><a href="#how">How it works</a><a href="#faq">FAQ</a><a href="#demo">Book a demo</a>
    </nav>
    <div class="nav-cta">
      <a class="nav-login" href="${app('/login')}">Log in</a>
      <a class="btn btn-primary" href="${app('/signup')}">Start free</a>
    </div>
    <button class="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu"><svg class="ico" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  </div>
  <div class="mobile-menu" id="mobile-menu">
    <a href="#features">Features</a><a href="#how">How it works</a><a href="#faq">FAQ</a><a href="#demo">Book a demo</a><a href="${app('/login')}">Log in</a>
    <a class="btn btn-primary" href="${app('/signup')}">Start free</a>
  </div>
</header>

<main>
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <span class="eyebrow">Construction progress tracking</span>
      <h1>Every project, every day, on track.</h1>
      <p class="lead">Proj4D turns your work programme and daily site reports into live progress, attendance and materials tracking, with professional PDF reports your clients can trust.</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${app('/signup')}">Create a free company account</a>
        <a class="btn btn-ghost" href="#demo">Book a demo</a>
      </div>
      <ul class="hero-points">
        <li>${icon('check')} Works on any phone</li>
        <li>${icon('check')} Installs as an app</li>
        <li>${icon('check')} Set up in minutes</li>
      </ul>
    </div>
    <div class="shots">
      <div class="browser"><div class="browser-bar"><i></i><i></i><i></i></div>
        <img src="/home/dashboard.webp" width="1600" height="689" alt="Proj4D project dashboard showing overall progress of 6.7% against plan, with an actual versus planned progress chart" fetchpriority="high" />
      </div>
      <div class="phone"><img src="/home/phone-projects.webp" width="600" height="1022" alt="Proj4D project list on a phone" loading="lazy" /></div>
    </div>
  </div>
</section>

<div class="trust"><div class="wrap">Built for contractors, project managers and site supervisors</div></div>

<section class="features" id="features">
  <div class="wrap">
    <div class="section-head">
      <h2>Everything you need to run the site, in one place</h2>
      <p>From the programme to the last bag of cement, Proj4D keeps the office and the site working from the same up-to-date picture.</p>
    </div>
    <div class="feature-grid">
      ${FEATURES.map(([ic, t, d]) => `<article class="feature"><div class="ico-wrap">${icon(ic)}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join('\n      ')}
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="showcase">
      <div class="show-text">
        <span class="eyebrow" style="color:var(--navy-2)">Daily site reports</span>
        <h3>The day’s report, done before the supervisor leaves site</h3>
        <p>Activities come straight from your programme, so reporting progress is a few taps. Anything new can be typed in and is added to the project.</p>
        <ul class="ticks">
          <li>${icon('check')} Progress per activity with previous and planned figures alongside</li>
          <li>${icon('check')} Weather, labour, plant, deliveries, visitors and issues</li>
          <li>${icon('check')} Photos from the camera or gallery, printed at A5 size in the PDF</li>
          <li>${icon('check')} Or write the day in plain words and let AI fill in the form</li>
        </ul>
      </div>
      <div class="show-media"><div class="phone-solo"><img src="/home/phone-report.webp" width="600" height="1022" alt="Daily report form on a phone with activity progress sliders and remarks" loading="lazy" /></div></div>
    </div>

    <div class="showcase flip">
      <div class="show-text">
        <span class="eyebrow" style="color:var(--navy-2)">Attendance and materials</span>
        <h3>Know who is on site and what is in stock</h3>
        <p>The morning register takes a minute: mark the exceptions, the rest are present. Deliveries and usage keep stock levels honest, with warnings before you run out.</p>
        <ul class="ticks">
          <li>${icon('check')} Late arrivals and absences with reasons, headcount by trade</li>
          <li>${icon('check')} Monthly attendance sheets for payroll and subcontractors</li>
          <li>${icon('check')} Stock on hand, low-stock alerts and usage by activity</li>
        </ul>
      </div>
      <div class="show-media">
        <div class="phone-solo"><img src="/home/phone-attendance.webp" width="600" height="1022" alt="Attendance register on a phone with present, late and absent buttons" loading="lazy" /></div>
      </div>
    </div>

    <div class="showcase">
      <div class="show-text">
        <span class="eyebrow" style="color:var(--navy-2)">Progress you can see</span>
        <h3>Spot slippage while there is still time to act</h3>
        <p>The dashboard brings the programme, reports and registers together: overall progress against plan, every task’s status, the attendance trend and materials that need attention.</p>
        <ul class="ticks">
          <li>${icon('check')} Actual vs planned progress curve, updated after every report</li>
          <li>${icon('check')} Tasks flagged as on track, slipping or behind</li>
          <li>${icon('check')} AI insights on risks and recommended actions</li>
        </ul>
      </div>
      <div class="show-media stack">
        <div class="card-shot"><img src="/home/attendance-panel.webp" width="1200" height="302" alt="Attendance panel: 10 present, 1 late, 1 absent, with a 14-day attendance chart" loading="lazy" /></div>
        <div class="card-shot"><img src="/home/materials-panel.webp" width="1200" height="242" alt="Materials panel showing today's deliveries, usage entries and low stock" loading="lazy" /></div>
      </div>
    </div>

    <div class="showcase flip">
      <div class="show-text">
        <span class="eyebrow" style="color:var(--navy-2)">Reports clients trust</span>
        <h3>Professional PDFs in your company colours</h3>
        <p>Every daily report, attendance register and materials register downloads as a clean, printable PDF with your logo, ready to send to clients and keep for your records.</p>
        <ul class="ticks">
          <li>${icon('check')} Summary, progress, weather, resources, issues and visitors</li>
          <li>${icon('check')} Attendance and materials sections from the registers</li>
          <li>${icon('check')} Site photos, each on its own page at A5 size</li>
        </ul>
      </div>
      <div class="show-media"><img class="paper" src="/home/pdf-report.webp" width="900" height="1273" alt="First page of a Proj4D daily site report PDF" loading="lazy" /></div>
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

<section class="install">
  <div class="wrap install-grid">
    <div>
      <span class="eyebrow" style="color:var(--navy-2)">${icon('phone')} On every device</span>
      <h2>Install Proj4D like an app</h2>
      <p style="color:var(--ink-2);font-size:18px">No app store needed. Install Proj4D on your phone or computer and open it from its own icon, with reminders and alerts as notifications.</p>
      <div class="platforms">
        <div class="platform"><b>Android</b>Chrome → ⋮ → Install app</div>
        <div class="platform"><b>iPhone / iPad</b>Safari → Share → Add to Home Screen</div>
        <div class="platform"><b>Computer</b>Chrome or Edge → install icon in the address bar</div>
      </div>
    </div>
    <div class="show-media"><div class="phone-solo"><img src="/home/phone-projects.webp" width="600" height="1022" alt="Proj4D running as an installed app on a phone" loading="lazy" /></div></div>
  </div>
</section>

<section id="faq">
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
      <p class="lead">Book a short demo and we’ll set it up with your programme, answer your questions and talk about pricing for your team.</p>
      <div class="demo-alt">
        ${waLink ? `<a class="btn btn-wa" href="${esc(waLink)}" target="_blank" rel="noopener"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-3.9-1z"/><path d="M9 9.5c0 2.8 2.7 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z"/></svg>Chat on WhatsApp</a>` : ''}
        <a class="btn btn-ghost" href="${app('/signup')}">Or start free now</a>
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
      <div class="f full"><label for="d-msg">What would you like to see?</label><textarea id="d-msg" name="message" maxlength="2000" placeholder="e.g. We run 4 sites and want daily reports and attendance on phones."></textarea></div>
      <div class="hp" aria-hidden="true"><label for="d-web">Website</label><input id="d-web" name="website" tabindex="-1" autocomplete="off" /></div>
      <div class="form-msg" id="form-msg" role="status" aria-live="polite"></div>
      <div class="f full"><button class="btn btn-primary" type="submit">Request a demo</button>
        <span class="small">We’ll only use your details to contact you about Proj4D. See our <a href="${app('/privacy')}">Privacy Policy</a>.</span></div>
    </form>
  </div>
</section>
</main>

<footer>
  <div class="wrap">
    <div><a class="brand" href="/home" style="font-size:17px;margin-bottom:6px"><img src="/icons/icon-192.png" alt="" width="26" height="26" />Proj4D</a>© ${year} ${esc(businessName)}</div>
    <nav aria-label="Footer"><a href="${app('/login')}">Log in</a><a href="${app('/signup')}">Start free</a><a href="#demo">Book a demo</a><a href="${app('/terms')}">Terms</a><a href="${app('/privacy')}">Privacy</a></nav>
  </div>
</footer>

<script>
(function () {
  var btn = document.querySelector('.menu-btn'), menu = document.getElementById('mobile-menu');
  btn.addEventListener('click', function () { var o = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', o); });
  menu.addEventListener('click', function (e) { if (e.target.tagName === 'A') { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
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
