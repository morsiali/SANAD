# SANAD — care problems, routed to the people who solve them

**Live demo:** https://morsiali.github.io/SANAD/ — runs fully in the browser; sign in with any demo account (password `sanad123`). Switch between English and العربية from the top bar.

SANAD is a full-stack web app for coordinated family care in the UAE — older adults, children and
People of Determination. Anyone in a care circle (the person themselves, family, caregivers, doctors,
psychologists, physiotherapists, educators, coordinators, transport, pharmacy, social services) reports a
problem in plain words; SANAD routes it to the right person and tracks it until it is solved. Each person
has a profile with medical, well-being, academic, social, activity and rehab records, shared only with
the care-team members they (or their verified guardian) consent to.

Demo accounts include `huda@sanad.ae` (guardian of Rashid, 11), `grace@sanad.ae` (his teacher),
`salma@sanad.ae` (psychologist), `faisal@sanad.ae` (physiotherapist), `khadija@sanad.ae` (person
receiving care), `majid@sanad.ae` (organisation admin) and `hind@sanad.ae` (a second organisation).
All data is synthetic.

## Run it

Requires Node.js 18.18 or newer.

```bash
npm install
npm run build      # builds the web app into dist/
npm start          # API + app on http://localhost:4000
```

Sign in with any demo account (password `sanad123`), or click a person on the sign-in page.
Sign in as two people in two tabs to watch a problem move between them live.

For development with hot reload: `npm run dev` (app on http://localhost:5173, API on :4000).

Data is saved to `data/sanad.json` (change with `SANAD_DATA=...`). Port: `PORT=...`.
The coordinator can reset the demo from Settings. Back up data and uploaded files with `npm run backup`.

### Real use (not the demo)

Run in production mode with a new data file and a first coordinator — see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**
for every setting, the Docker image and the go-live checklist. The summary of all five phases is in
**[docs/FINAL-REPORT.md](docs/FINAL-REPORT.md)**.

### No server? Single-file demo

`npm run build:demo` writes `dist-demo/index.html` — the whole app in one file, running the same
engine in the browser with data saved in local storage. Open it directly in a browser.

## Workflow

The whole process is drawn as a swimlane map — in the app under **How SANAD works** (with live counts
for every step and links to the matching challenges) and publicly at `#/workflow`, no sign-in needed.
`npm run build:workflow` writes the map as a single shareable file, `dist-workflow/workflow.html`.

Reported → Routed (rule match → availability → best person, or coordinator triage / team queue)
→ Accepted → In progress → Resolved → Confirmed by the family → Closed. Exceptions: hand off
(back to routing), missed response time (escalation to the coordinator), not fixed (reopen).

## Profiles, consent and permissions

See **[docs/PHASE-1.md](docs/PHASE-1.md)** **[docs/PHASE-2.md](docs/PHASE-2.md)** (care plans, tasks, appointments, documents, progress charts and the Today view) **[docs/PHASE-3.md](docs/PHASE-3.md)** (the assistant: cited answers, briefs, handovers, draft plans, clinical safety), **[docs/PHASE-4.md](docs/PHASE-4.md)** (monitoring, standing permissions, suggested timing changes, notification settings, Coming up) and **[docs/PHASE-5.md](docs/PHASE-5.md)** (security, accessibility, monitoring and deployment) for the audit, the delivery plan, the roles and permissions
matrix, the consent and approval rules, test results and known limitations. Copy `.env.example` for the
server settings.

## Languages

English and Arabic, with a full right-to-left layout. Use the language button in the top bar, or
Settings → Language. Arabic covers the interface, every message the system writes (history,
notifications, routing reasons, errors, Ask SANAD answers) and the demo content. Routing and Ask SANAD
also understand problems and questions written in Arabic (e.g. «نفدت أقلام الإنسولين» goes to the pharmacy).

## Publish the live demo (GitHub Pages)

`.github/workflows/deploy-sanad.yml` builds `npm run build:demo` and publishes it to GitHub Pages on
every push to `main` that touches `sanad-app/`. One-time setup in the repository:
Settings → Pages → Build and deployment → Source: **GitHub Actions**.

## Tests

```bash
npm test           # 184 unit + API tests (routing, permissions, consent, approvals, records, medicines, tasks, appointments, documents, assistant, monitoring, security, Arabic)
npm run typecheck
npm run build && npm run e2e   # 95 end-to-end checks in Chromium: several users at once, English, Arabic, phone, automated accessibility (WCAG 2.1 AA) checks
```
`npm run e2e` uses Playwright. The first time, run `npx playwright install chromium`.

## How it is built

| Part | Where | What it does |
|---|---|---|
| Engine | `shared/engine.ts` | Every change is a command (`apply(state, user, action)`) with permission checks, audit history and notifications. Same code runs on the server and in the browser. |
| Routing | `shared/routing.ts` | Keyword/phrase rules → team; urgency inference (safety words can't be under-rated); assignee chosen by availability, skills, workload and continuity of care. Every decision carries its reasons and a confidence score. |
| SLA | `sweep()` in engine | Response time per priority; breaches escalate to the coordinator automatically. |
| Intelligence | `shared/intelligence.ts` | Playbook ranking (relevance × success rate × speed × effort), similar past fixes, next-best actions, and the “Ask SANAD” assistant. Runs locally — no external AI calls. |
| Insights | `shared/analytics.ts` | SLA compliance, median time to solve, ratings, throughput. |
| API | `server/app.ts` | Express: login (scrypt-hashed passwords, signed tokens), `/api/state`, `/api/action`, live updates over Server-Sent Events, export, reset. |
| App | `src/` | React + React Router. Role dashboards, challenges list & drag-and-drop board, challenge workspace, report with live routing preview, Ask SANAD, playbooks, team, routing rules, insights, inbox, settings. |

Workflow: Reported → Routed → Accepted → In progress → Resolved → Closed (confirmed by the reporter
or family). Hand-offs, reassignments, escalations and reopens keep the full history.

Visual design follows grassfeld.com: white canvas, large rounded tinted panels, a condensed heavy
display face (Archivo, standing in for Right Grotesk), Manrope body text, dark ink buttons and a
green-to-blue gradient reserved for SANAD Intelligence.
