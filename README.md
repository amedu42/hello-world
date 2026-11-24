# Proj4D – construction project tracking & daily site reports

An AI-enabled web app for construction professionals to track project progress and file daily site reports.

## Features

- **Projects home page**: every project as a card with its overall progress, activity count and latest report.
- **Project dashboard**
  - Overall progress % in large type, compared with the planned % for today from the programme (ahead/behind).
  - Progress curve (actual vs planned) across all report dates.
  - Every task with its progress bar, planned-today marker and status (complete, on track, slipping, behind), grouped by programme section, with search and filters.
  - List of daily reports, each viewable on screen and downloadable as a PDF.
- **Work programme upload**: Excel (.xlsx), CSV or MS Project XML. Column headings such as *ID, Task Name, Duration, Start, Finish* are found automatically; summary rows become sections. Preview, edit and import. With AI on, PDF programmes and unusual layouts are read by AI.
- **Daily report form** (end of each day)
  - Activities picked from a drop-down built from the programme, or typed in manually (these are added to the project's task list).
  - Cumulative % progress per activity (number box + slider), showing the previous % and the planned %.
  - Weather, labour, plant & equipment, material deliveries, visitors, site issues (category / severity / action), site photos with captions and notes.
  - Drafts are saved in the browser until you submit.
- **Daily attendance register** (each morning)
  - A workforce list per project (name, trade, employer/subcontractor, phone). Add people one at a time or paste a list (one per line, `Name, Trade, Employer, Phone`, or rows copied from Excel). People who leave are marked as left and keep their history.
  - The supervisor marks each worker **Present**, **Late** (with arrival time) or **Absent** (reason: sick, on leave, no-show, suspended, training/off site, other, plus a note). "Mark everyone present" fills in the rest. Earlier days can be opened and corrected.
  - **PDF downloads** (in the company's colours and logo): a day's register (everyone by trade with status, arrival time, reason and note, absentees, notes, sign-off), and a period register for up to 31 days (landscape sheet: names × dates with P / L / A, each person's totals and attendance %, daily on-site counts, and every absence with its reason).
  - The dashboard's Attendance panel shows today's present/late/absent counts, the absentees with their reasons, and a 14-day chart. The evening daily report's *Labour on site* is pre-filled from that morning's register.
- **Daily materials register**
  - A materials list per project (name, unit, stock on site when you start, optional reorder level). Add one at a time or paste a list (`Name, Unit, Stock, Reorder level`).
  - Each day record **deliveries** (quantity, supplier, delivery note no., condition notes), **usage** (quantity, programme activity, location) and **wastage / damage**. "Save & add another" for quick entry.
  - The register shows each material's opening, received, used, wasted and closing stock for any date, plus stock on hand. Low stock is flagged, and recording usage beyond the recorded stock gives a warning (usually a missing delivery).
  - The dashboard's Materials panel shows today's movements and low-stock items.
  - **PDF download** for one day up to 92 days (landscape, company colour and logo): stock summary (stock at start, received, used, wasted, stock at end, reorder level, status), deliveries log (supplier, delivery note, recorded by), usage and wastage log (activity, location), and totals used per programme activity, with sign-off lines.
- **Daily report PDF** also includes the day's **attendance** (present / late / absent / on site, by trade, absentees with reasons) and **materials** (opening / received / used / wasted / closing, delivery details, usage by activity, low stock). The AI or template summary mentions both.
- **Auto-calculated progress**: after each report, every task's progress is set from the most recent report that mentions it. Overall progress is the duration-weighted average (or weighted by a Weight/Value column, or a weight you set per task).
- **All PDFs** carry the Proj4D logo and "Made with Proj4D" in the footer of every page (a link to the app when `APP_URL` or Render's address is known).
- **PDF daily reports**: branded A4 report with a summary, progress table, all site details, a photo grid and sign-off lines.
- **AI features** (Claude, optional)
  - *Quick fill from notes*: type the day in your own words; AI matches the work to programme activities and fills in the form for you to check.
  - *Report summary*: a short summary at the top of each report and PDF (a standard template summary is used when AI is off).
  - *Project insights*: risks and recommended actions based on the programme and the last 14 reports.
  - *Programme reading*: PDF programmes and spreadsheets with unusual layouts.

## Public homepage

Visitors who aren't logged in see the homepage at `/` (logged-in users go straight to their projects; the homepage is always at `/home`). It is plain server-rendered HTML (`server/landing.js`) with real screenshots in `client/public/home/`, so it loads fast and search engines can read it. It includes features, how it works, installing as an app, FAQ, and a **Book a demo** form.

- Demo requests are saved and listed on the platform owner's **Platform admin** page (status: new / contacted / closed); the owner gets a push notification and, when SMTP is set up, an email. Spam protection: hidden honeypot field, 5 requests per hour per address, same-site check.
- Settings: `CONTACT_WHATSAPP` (shows a WhatsApp button), `CONTACT_EMAIL`, `HOMEPAGE_URL` (canonical URL, link previews, sitemap), and `APP_ORIGIN` if the app later moves to its own domain (e.g. homepage on `proj4d.com`, app on `app.proj4d.com`): every homepage link into the app is then prefixed with it.
- `robots.txt` and `sitemap.xml` are served; the installed app starts at `/login`.
- **Custom domain:** when `APP_URL` (or `HOMEPAGE_URL`) is a custom domain such as `https://proj4d.com`, requests to the default `…onrender.com` address are redirected there (301 for pages, 308 for other requests, path and query kept). `/healthz` is never redirected. Disable with `CANONICAL_REDIRECT=off`.

## Install as an app

Proj4D is an installable web app (PWA). In Chrome on Android, open the site and choose **Install app** (menu ⋮ → *Install app* or *Add to home screen*); on iPhone, Safari → Share → *Add to Home Screen*; on a computer, the install icon in Chrome/Edge's address bar. It then opens full screen from its own icon.

- `client/public/manifest.webmanifest`: name, colours, start page, icons (`client/public/icons/`, including maskable icons for Android).
- `client/public/sw.js`: service worker. It caches only the app's code, icons and an offline page, never API data, photos or PDFs, so everything shown is live; with no connection it shows `offline.html`.
- The server sends `sw.js`, `index.html` and the manifest with `Cache-Control: no-cache` so installed apps pick up new releases immediately; hashed files in `/assets` are cached for a year.

## Push notifications

Each person turns notifications on per device (user menu → **Notifications**, or the prompt on the projects page) and chooses what to receive:

| Notification | When | Default |
|---|---|---|
| Attendance register reminder | At the person's reminder time (08:00) if today's register hasn't been taken (projects with a workforce) | everyone |
| Daily report reminder | At the reminder time (17:00) if today's report hasn't been filed | everyone |
| Attendance register submitted | When a day's register is first saved | admins |
| Daily report submitted | When a new report is filed | admins |
| High-severity site issue | When a report records a new High issue | everyone |
| Low stock | When a material drops to its reorder level or below zero (once a day per material) | everyone |
| Behind schedule | When a project is at least N points behind plan (default 10; once a week per project) | admins |

Reminders use each person's time zone and working days (default Mon–Sat), and are sent up to 4 hours late if the server was briefly down. Nobody is notified about their own action. Tapping a notification opens the related page.

- Uses standard Web Push (`web-push`). The VAPID keys are generated on first start and kept in `DATA_DIR/vapid.json` (or set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`). Keep the data disk so existing subscriptions stay valid.
- iPhone/iPad: works from iOS 16.4 once Proj4D is added to the home screen.
- `PROJ4D_REMINDERS=off` disables the reminder clock (e.g. for a second server instance). The older `SITEPULSE_*` setting names are still accepted.

## Accounts

- **Companies sign up themselves** at `/signup` and become that company's admin. Each company sees only its own projects, tasks, reports, photos and PDFs.
- **Team**: company admins add people (with a temporary password they must change on first login), change roles, reset passwords and remove users. *Admins* manage the team and can delete projects; *members* do everything else.
- **Platform admin**: the user whose email matches `PLATFORM_ADMIN_EMAIL` gets a *Platform admin* page listing every company with usage, and can suspend or reactivate a company (suspended users are logged out and can't log in; data is kept).
- Projects created before accounts existed are assigned to the platform admin's company when that email signs up (or at server start if it already has).
- Passwords are hashed with scrypt; sessions are HTTP-only cookies valid for 30 days; repeated login attempts are rate-limited.
- **Forgot password**: users request a link at `/forgot-password`; it is emailed, works once, expires after 60 minutes, and resetting logs out all their other sessions. Email is sent over SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`); without it, links are written to the server log. Company admins can also reset passwords from the Team page, and the platform admin can create a reset link for any company's admin.
- **Terms of Service** (`/terms`) and **Privacy Policy** (`/privacy`) pages; new companies must accept them at sign-up. Business name, contact email, governing law and effective date come from `LEGAL_BUSINESS_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_GOVERNING_LAW`, `LEGAL_EFFECTIVE_DATE`. The text is a starting template, not legal advice.

## Running it

Requires Node.js 22.13 or later.

```bash
npm install
cp .env.example .env        # optional: add ANTHROPIC_API_KEY to turn on AI features
npm run seed                # optional: demo company + project (log in as demo@example.com / demo-password)
npm run dev                 # web on http://localhost:5173, API on :3001
```

Production:

```bash
npm run build
npm start                   # serves app + API on http://localhost:3001
```

Data (SQLite database and uploaded photos) is stored in `./data` (change with `DATA_DIR`).
A sample programme is in `samples/sample-programme.csv`.

## Deploying to Render

The repo includes `render.yaml` (a Render Blueprint): a Node web service on the Starter plan with a 1 GB persistent disk at `/var/data` for the database and photos.

1. Merge this code into the branch Render will deploy (the repository's default branch).
2. In the Render dashboard: **New + → Blueprint**, connect GitHub and pick this repository.
3. When asked, enter:
   - `PLATFORM_ADMIN_EMAIL`: your email. Then sign up at your site with that email to get the platform admin page.
   - `ANTHROPIC_API_KEY`: optional, turns on the AI features.
4. Click **Apply**. The first build takes a few minutes; the app is then at `https://sitepulse-xxxx.onrender.com`.

Every push to that branch redeploys automatically; data on the disk is kept. Environment variables can be changed later under the service's **Environment** tab.

## Structure

```
server/
  index.js      REST API (projects, activities, reports, PDF, AI endpoints)
  db.js         SQLite schema + progress calculations
  programme.js  programme file parsing (xlsx / csv / MS Project XML / AI fallback)
  ai.js         Claude API calls with structured outputs, plus non-AI fallbacks
  pdf.js        daily report PDF (pdfkit)
  seed.js       demo data
client/src/
  pages/        Home, ProjectDashboard, ReportForm, ReportView
  components/   chart, modals, shared UI
```

## Notes

- One report per project per day. Opening an existing date lets you edit it, and editing or deleting a report recalculates progress.
- Photos must be JPEG or PNG so they can be embedded in the PDF.
- `.mpp` and `.xls` files must be exported to `.xlsx`, `.csv` or MS Project XML first.
