# SANAD — Phase 2 report

Phase 2 of the enhancement brief: care plans and tasks, appointments and calendar, documents, progress
charts and the “Today” view. Everything below works end to end in server mode and in the browser demo,
and is covered by automated tests. Phase 1 rules (care teams, domains, consent, approvals, audit) apply
to every new item.

## 1. What was implemented

| Area | What works |
|---|---|
| **Care plans** | A plan has a goal in the person's own terms, a section (which decides who can see it) and a progress bar of completed vs total tasks. |
| **Tasks** | Owner, due time, priority, repeat (daily / weekly / monthly), dependencies, completion evidence (note or document), comments and a full history. States: Draft → Awaiting approval → Scheduled → In progress → Completed, with Blocked (resumable), Cancelled and “Could not be done” recorded with a reason. |
| **Approval of tasks** | A professional can ask the person or their verified guardian to approve a task before it is scheduled. Uses the Phase 1 approval engine: bound to the task version, single use, expires in 72 h. Editing a task while it waits cancels the old approval and asks again. |
| **Rules that prevent mistakes** | An owner must be able to see the task's section. Duplicate open tasks (same title, same time) are refused. Dependency loops are refused. A dependent task cannot start until the one before it is completed. A repeating task creates exactly one next occurrence. |
| **Reminders and escalation** | One reminder 3 hours before a task is due. An open task overdue by 2 / 12 / 48 / 96 hours (urgent / high / medium / low) is escalated once to its owner, its creator, the guardian and — for general tasks — the coordinator of the person's organisation. |
| **Handovers** | A carer hands over to another team member. SANAD gathers completed and pending tasks, new records, dose logs, upcoming appointments and open problems — **only items both people are allowed to see**. Only the two of them can see the handover; the receiver acknowledges it. |
| **Cover requests** | A time window that needs cover is sent to caregivers and family on the team (and the coordinator for general cover). Anyone can offer; SANAD checks their other appointments and cover first and shows any clash, with an explicit “keep both”. It cannot be taken twice. |
| **Appointments** | Type, section, time, place, with whom, attendees, notes. Preparation checklist (suggested by type, editable) becomes small tasks due one hour before, and moves when the appointment is rescheduled. Mark attended (with outcome), missed (neutral notice + “book a new time”) or cancelled (preparation steps cancelled too). Attendee clashes are detected. “Add to my calendar” downloads a standard `.ics` file — nothing is sent anywhere. |
| **Calendar** | Two-week agenda for everyone the user can see, with person filter, due tasks and clash warnings. |
| **Documents** | PDF, PNG, JPEG, WebP or text. Each document belongs to a section. The file's content is checked against its type (a renamed web page is refused). Server mode stores files outside the shared data and re-checks access on every download, which is audited; downloads are sent as attachments with `nosniff` and a sandboxing content-security policy. The browser demo keeps small files (≤ 400 KB) inline. |
| **Progress** | One chart per measure (glucose, weight, mood, sleep, stress, pain, attendance, activity minutes), with date filters, the first value in the period as the baseline, the latest value, a plain-language summary, visible gaps (shaded and stated), marker shapes for who recorded each value (not colour alone), units and definitions, a table view, and CSV download (audited). Medical charts say interpretation is for the doctor. A weekly chart shows care-plan tasks due vs completed. Milestones and achievements are listed. No combined score, no causal claims, neutral “higher/lower” wording. |
| **Today** | My tasks, appointments today and tomorrow, medicines due today (with “not logged ≠ taken”), items waiting for approval, overdue items and appointments needing an update, open cover requests, recent updates, and quick actions. |

## 2. Files changed

New: `shared/plans.ts`, `shared/plans-engine.ts`, `src/components/tasks.tsx`, `src/components/appointments.tsx`,
`src/components/documents.tsx`, `src/components/progress.tsx`, `src/pages/Today.tsx`, `src/pages/Calendar.tsx`,
`tests/plans.test.ts`, `docs/PHASE-2.md`.

Changed: `shared/types.ts`, `shared/engine.ts` (views, sweep, upgrade to schema 3), `shared/care-engine.ts`
(approvals can run task actions), `shared/seed.ts`, `shared/messages.ts`, `shared/ar-content.ts`, `server/app.ts`
(`POST /api/documents`, `GET /api/documents/:id`), `src/lib/backend.ts`, `src/lib/store.tsx`, `src/App.tsx`,
`src/components/{Shell,ui}.tsx`, `src/pages/Profile.tsx`, `src/lib/ar-ui.ts`, `src/styles.css`,
`tests/api.test.ts`, `tests/e2e.mjs`, `tests/access.test.ts`.

## 3. Data migration

`upgrade()` moves saved data to schema 3 by adding empty plans, tasks, appointments and documents.
Nothing existing is changed or removed. Uploaded files (server mode) are stored in a `files/` folder next
to the data file.

## 4. Tests and results (this build)

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (unit + API, 7 files) | **100 passed** |
| `npm run e2e` (Chromium, multi-user, English and Arabic) | **74 checks passed, 0 problems** |

New coverage: task states, approval and re-approval after edits, dependencies, evidence, block/resume,
cancel rules, loops, duplicates, owner access, recurrence, one reminder and one escalation, organisation
scoping of escalation; handover limited to shared sections (scenario 3); cover with clash detection and
override (scenario 6 groundwork); appointment visibility, attendee access, preparation steps, reschedule,
cancel, missed appointment (scenario 4 groundwork); document type/size/content checks, server storage,
download access and audit, client-chosen storage keys refused; profile creation end to end (scenario 1);
progress charts, table and CSV; Today; calendar visibility; Arabic and RTL on every new screen.

## 5. Assumptions

- Tasks, plans, appointments and documents reuse the profile sections for visibility (e.g. a therapy
  appointment is in “Psychological well-being”, so a teacher does not see it).
- One reminder per task occurrence; quiet hours and personal notification preferences come in Phase 4.
- A gap in a chart is any interval longer than 7 days or three times the usual interval between values.
- Coordinators can own general tasks for people in their organisation; organisation admins cannot own
  or create care work.

## 6. Missing credentials and dependencies

- No calendar, email, SMS or WhatsApp integration is configured. Calendar entries are offered as `.ics`
  downloads; reminders appear in SANAD's inbox only.
- No virus scanning service is configured; uploads are limited to five safe types with content checks.

## 7. Known limitations

- Browser demo: files and data live in the visitor's browser storage (≈ 5 MB limit), so uploads there are
  limited to 400 KB. Server mode is required for real use.
- Reminders are generated by the server's periodic sweep (every 30 s) or when someone opens the app in
  the browser demo; there is no push delivery yet.
- Charts show recorded values only; there are no targets or reference ranges unless a professional
  records them as a goal.

## 8. Next: Phase 3

Permission-scoped assistant: answers and summaries cited to source records, appointment briefs
(scenario 2), handover drafts, draft plans, missing-information checks, and approval cards — built on the
filtered view so no unauthorised record can enter its context.
