# SitePulse – construction project tracking & daily site reports

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
- **Auto-calculated progress**: after each report, every task's progress is set from the most recent report that mentions it. Overall progress is the duration-weighted average (or weighted by a Weight/Value column, or a weight you set per task).
- **PDF daily reports**: branded A4 report with a summary, progress table, all site details, a photo grid and sign-off lines.
- **AI features** (Claude, optional)
  - *Quick fill from notes*: type the day in your own words; AI matches the work to programme activities and fills in the form for you to check.
  - *Report summary*: a short summary at the top of each report and PDF (a standard template summary is used when AI is off).
  - *Project insights*: risks and recommended actions based on the programme and the last 14 reports.
  - *Programme reading*: PDF programmes and spreadsheets with unusual layouts.

## Running it

Requires Node.js 22.13 or later.

```bash
npm install
cp .env.example .env        # optional: add ANTHROPIC_API_KEY to turn on AI features
npm run seed                # optional: demo project with a programme and 6 reports
npm run dev                 # web on http://localhost:5173, API on :3001
```

Production:

```bash
npm run build
npm start                   # serves app + API on http://localhost:3001
```

Data (SQLite database and uploaded photos) is stored in `./data` (change with `DATA_DIR`).
A sample programme is in `samples/sample-programme.csv`.

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
- No user accounts or logins yet. Put it behind your own authentication before exposing it on the internet.
