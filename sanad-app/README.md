# SANAD — care problems, routed to the people who solve them

**Live demo:** https://morsiali.github.io/SANAD/ — runs fully in the browser; sign in with any demo account (password `sanad123`). Switch between English and العربية from the top bar.

SANAD is a full-stack web app for elderly-care coordination in the UAE. Anyone in a care circle
(family, caregiver, doctor, coordinator, transport, pharmacy, social services) reports a problem in
plain words. SANAD classifies it, sets its urgency, picks the best available person and tracks it
until the family confirms it is solved.

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
The coordinator can reset the demo from Settings.

### No server? Single-file demo

`npm run build:demo` writes `dist-demo/index.html` — the whole app in one file, running the same
engine in the browser with data saved in local storage. Open it directly in a browser.

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
npm test           # 43 unit + API tests (routing, workflow, permissions, SLA, intelligence, auth, Arabic)
npm run typecheck
npm run build && npm run e2e   # 38 end-to-end checks in Chromium, several users at once, English and Arabic
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
