# SANAD — final report of the enhancement project

All five phases of the brief “Complete and enhance the existing Sanad application” are delivered, tested and live
as a browser demo at https://morsiali.github.io/SANAD/ (synthetic data only). Each phase has its own report:
[Phase 1](PHASE-1.md) · [Phase 2](PHASE-2.md) · [Phase 3](PHASE-3.md) · [Phase 4](PHASE-4.md) · [Phase 5](PHASE-5.md).
How to run it for real people: [DEPLOYMENT.md](DEPLOYMENT.md).

## What SANAD does now

| Phase | Delivered |
|---|---|
| 1 | Care profiles for each person (overview, medical, psychological well-being with private therapy notes, academic, social, activity, physiotherapy, team, history). Twelve roles. Care teams with section-by-section access, consent records, verified guardians, approvals bound to the exact action, and an audit trail. Medicines with dose logs that never assume “taken”. |
| 2 | Care plans and tasks (approval, dependencies, evidence, repeats, reminders, escalation), handovers limited to what both people may see, cover requests with clash checks, appointments with preparation and `.ics` export, documents with content checks and audited downloads, progress charts with gaps and table views, and the Today page. |
| 3 | The SANAD assistant: answers, summaries, appointment briefs, handover drafts, draft plans, missing-information checks and progress reviews — built only from what the user may see, every line cited, clinical decisions refused and turned into professional review requests, nothing created until the user confirms. Optional server-side AI overview with strict checks. |
| 4 | Background monitoring (unlogged doses, refills, unfilled cover, missing appointment outcomes, expiring requests), standing permissions for two low-risk automatic tasks, suggested new times for work that is always late, quiet hours and muting, and the “Coming up” forecast. |
| 5 | Expiring and revocable sessions, sign-in limits, security headers, separate demo and production modes, error handling and reporting, health and status, accessibility checks and fixes, text size and reduced motion, Docker image, backups and a go-live checklist. |

## The rules the brief set, and how they hold

| Rule | Where it is enforced |
|---|---|
| Every feature reaches the right users only | Access is checked in the shared engine on the server for every action and every view, section by section; tested for every role. |
| Never infer a dose was taken; never double a dose | Dose logs are explicit; “not logged” is shown as such everywhere, including monitoring and the assistant. |
| The AI never prescribes, changes doses or treatment, diagnoses or predicts | Refusal runs on the question itself before anything else; model output is checked and rejected if it contains such advice; standing permissions cannot touch medicines or treatment. |
| The model is never the authority for permissions | All permissions are decided by the engine; the assistant reads only the filtered view and acts only through normal, checked actions after a person confirms. |
| Document text and messages are data, not instructions | Quoted, never followed; tested with an injected instruction. |
| Nothing is called “done” until the server confirms | Draft steps and automatic actions show success only after the engine confirms; failures are reported. |
| No fake integrations | Email, SMS, WhatsApp, calendar, pharmacy, hospital and emergency services are shown as not connected; calendar entries are `.ics` downloads. |
| Synthetic data for development and tests | All demo people, records and files are synthetic and labelled. |
| No destructive migrations | Saved data is upgraded from schema 1 to 4 by adding, never removing. |

## Test results (final build)

| Suite | Result |
|---|---|
| Type check | pass |
| Unit and API tests | 184 passed |
| End-to-end (Chromium; many users at once; English, Arabic and phone; automated accessibility checks) | 95 checks passed |
| Production dependencies audit | 0 known vulnerabilities |
| Docker image | builds and runs healthy in production mode |

## Before using it with real people

1. Host it with HTTPS, production mode and a new data file (see the checklist in DEPLOYMENT.md).
2. Connect what is still missing if you need it: email/SMS delivery, an AI model key, virus scanning for uploads.
3. Plan for scale: the JSON data file suits a pilot; move to a database before large-scale use.
4. Add two-factor sign-in, and review data protection and retention rules for your country.
5. Run a usability and accessibility session with families, carers and screen-reader users.
