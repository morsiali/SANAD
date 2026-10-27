# SANAD — Phase 5 report

Phase 5 of the enhancement brief: security hardening, accessibility, monitoring and deployment readiness.
Nothing in this phase changes what people can see or do; it makes the platform safer, easier to use and ready
to run for real.

## 1. What was implemented

| Area | What works |
|---|---|
| **Sessions** | Sign-ins now expire (12 hours by default). Tokens carry their issue time and are signed; changed or forged tokens are refused. Changing a password signs out every other session and keeps the current one. "Sign out on all devices" in Settings. |
| **Sign-in limits** | After 5 failed attempts for an email (or 20 from one address) in 15 minutes, sign-in pauses with a "try again in" message, even with the right password. Messages never reveal whether an email exists. New accounts are limited per address. |
| **Security headers** | Every response: a content security policy (scripts only from SANAD itself; no framing), no-sniff, deny framing, no referrer, restricted browser features; HSTS in production. The whole app runs under this policy in the end-to-end tests. |
| **Real use vs. demo** | Demo mode (default for development and the public demo) keeps the sample people, demo accounts list and reset. In production (`NODE_ENV=production`) a new data file starts **empty** with one care coordinator from the environment (password at least 12 characters); the demo accounts list, reset and demo hints are switched off; and SANAD **refuses to start** on a data file that still has accounts with the demo password. |
| **Errors** | Malformed or oversized requests get a short message, never a stack trace. A page that fails to draw shows "Something went wrong on this page — nothing you saved was lost" instead of a blank screen. Unexpected browser errors are reported to the server (message and page path only, rate-limited). |
| **Dependencies** | `npm audit` for production dependencies: **0 known vulnerabilities** (fixed a body-parser issue; moved to React Router 7, which also closes two advisories). |
| **Accessibility** | Automated WCAG 2.1 AA checks (axe-core) now run in the end-to-end tests on 40 page views: visitor pages, family, coordinator, admin, physiotherapist, Arabic and phone width, including the assistant and drafts. Fixed: avatar colours with too little contrast (now darkened automatically to 4.5:1), light grey text, the green and amber labels, dimmed workflow rows, charts that mixed "image" with buttons inside, and an unlabelled Report button on phones. |
| **Text size and motion** | Settings → Display: Standard, Large or Larger text for the whole app, and "Reduce motion" (also follows the device's own setting). Saved on the device. |
| **Keyboard** | "Skip to content" is the first stop and now moves focus to the page (it used to change the page address). Visible focus outline everywhere. |
| **Health and monitoring** | `GET /api/health` (process up) and `GET /api/ready` (data can be saved; background checks are running). One JSON log line per API request with route, status and time only — no bodies, ids, tokens or query strings (tested). Coordinators and admins see **Settings → System status**: uptime, mode, storage, AI model connected or not, requests, server errors, refused requests, failed sign-ins and pauses, browser errors, background checks and open alerts. |
| **Deployment** | `Dockerfile` (built and run in this phase: production mode, empty workspace, health check reported *healthy*), `npm run backup` (data file and uploaded files into a dated folder), graceful shutdown, startup messages that say which mode is running, and `docs/DEPLOYMENT.md` with every setting and a go-live checklist. |

## 2. Files changed

New: `server/config.ts`, `server/ops.ts`, `server/backup.ts`, `src/lib/display.ts`, `src/lib/errors.ts`,
`src/components/ErrorBoundary.tsx`, `tests/security.test.ts`, `Dockerfile`, `.dockerignore`, `docs/DEPLOYMENT.md`,
`docs/PHASE-5.md`, `docs/FINAL-REPORT.md`.

Changed: `server/app.ts`, `server/index.ts`, `shared/seed.ts` (empty workspace), `src/lib/backend.ts`,
`src/lib/store.tsx`, `src/main.tsx`, `src/App.tsx`, `src/components/{Shell,ui,WorkflowMap,progress,assistant}.tsx`,
`src/pages/{Settings,SignIn}.tsx`, `src/lib/ar-ui.ts`, `src/styles.css`, `tests/e2e.mjs`, `package.json`
(React Router 7, axe-core for tests, `backup` script), `.gitignore`, `.env.example`, `README.md`.

## 3. Data migration

None. Existing demo data keeps working in demo mode. Existing sign-ins end once (the token format changed), so
people sign in again.

## 4. Tests and results (this build)

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (unit + API, 12 files) | **184 passed** |
| `npm run e2e` (Chromium, multi-user, English and Arabic) | **95 checks passed, 0 problems** |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Docker image | built; runs in production mode; `/api/ready` OK; health check *healthy*; sign-in, headers and empty workspace checked in a browser |
| Production mode (final code, `npm start`) | demo hints, demo accounts and reset hidden; coordinator pages open with no browser errors under the security policy |

New coverage: headers; tampered, forged and expired tokens; password change and "sign out everywhere"; sign-in
pauses; no email enumeration; demo-only routes hidden; empty workspace start; refusal of weak first passwords and of
demo data in production; readiness and metrics (no personal data, coordinators and admins only); browser error
reports trimmed and limited; logs without tokens or ids; automated accessibility checks; skip link; display
settings that survive a reload.

## 5. Assumptions

- Twelve-hour sessions and the sign-in limits suit shared family devices; both are configurable.
- Display settings belong to the device, not the account, because they are about the screen in front of you.
- Automated accessibility checks find many problems but not all; a review with screen-reader users is still advised.

## 6. Missing credentials and dependencies

- Email, SMS and WhatsApp delivery: not connected (notifications are in-app).
- AI model: not connected in the demo; set `ANTHROPIC_API_KEY` on the server to enable the overview.
- HTTPS certificate and reverse proxy: supplied by the hosting environment.
- Virus scanning for uploads: not connected.

## 7. Known limitations

- One process with a JSON data file: right for a pilot, not for large scale (a database is the next step).
- No two-factor sign-in or single sign-on yet.
- Building the Docker image in this sandbox needed a mirror for the base image and the sandbox's network proxy; the
  `Dockerfile` itself is standard and uses the official `node:22-alpine` image.
