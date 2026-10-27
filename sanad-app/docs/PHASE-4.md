# SANAD — Phase 4 report

Phase 4 of the enhancement brief: approved execution, notification preferences and quiet hours, background
monitoring, administrative forecasting and controlled adaptation. Everything runs on the server's periodic check
(every 30 seconds, and after every change) and in the browser demo, with the same rules and permissions, in
English and Arabic.

## 1. What was implemented

| Area | What works |
|---|---|
| **Notification settings** (Settings) | Quiet hours with start, end and time zone. Routine notifications that arrive in quiet hours are kept silently in the inbox ("held until 07:00") and are not counted on the bell until they end. Urgent items (escalations, urgent problems, cover about to start) still come through unless the person turns that off. Task reminders, task updates and monitoring notices can each be switched off; new assignments, escalations and approval requests cannot. Other people's settings are never sent to anyone else. |
| **Channels, stated honestly** | In-app (inbox and bell) is on. Email, SMS and WhatsApp are shown as *not available — no delivery service is connected*. Nothing pretends to send. |
| **Background monitoring** (Today, profile overview) | Five rules, each with "Why am I seeing this?": doses with nothing logged 2 hours after their time (never called missed or taken); a medicine about 7 days from running out by the recorded supply; cover starting within 24 hours with no one assigned (urgent, to the person's guardian and their organisation's coordinator); an appointment that ended 12 hours ago without an outcome; a request that expires within 12 hours (to its approvers only). Each notifies the right people **once**, only people who can see that section, stays open while the condition holds and closes by itself when it is dealt with. |
| **Standing permissions** (pre-authorised actions, profile → Care team) | The person or their verified guardian can let SANAD do two low-risk things on its own: create a refill task for a chosen team member who can see medicines, and create a "record what happened" task for whoever booked an appointment that ended without an outcome. Each permission has an end date (up to 365 days), can be turned off at any time, shows who gave it and how often it was used. SANAD acts **with the giver's own permissions**, marks the task as created by SANAD, records it in the activity history, and if it cannot act (for example the owner lost access) it creates nothing and tells the giver. A list shows what SANAD never does on its own: change, start or stop medicines or doses; diagnose or change treatment; give access; send anything outside SANAD; mark doses. |
| **Controlled adaptation** (Today, Plans & tasks) | When a daily or weekly task was done more than 2 hours late at least 3 of the last 5 times, SANAD suggests moving it to the time it is usually done, with the evidence. It never changes what is done, who does it or how often. Only someone who manages the task (its creator, owner, the person or guardian, or the organisation's coordinator) can accept; accepting runs a normal edit with all its checks. A dismissed suggestion is not repeated for 14 days. |
| **Approved execution** | Approvals from Phase 1–2 run the exact approved action once and only if nothing changed; standing permissions add pre-authorised actions with the same rules; drafts from the assistant (Phase 3) run step by step only after confirmation. |
| **Coming up** (new page) | The next 7, 14 or 30 days, by day: when each medicine runs out, cover with no one assigned, tasks with no owner, busy days (one person with 5 or more items due), appointments with unfinished preparation, requests about to expire and standing permissions ending. Each item says how it was worked out. Built from the user's own view, so a coordinator sees no medicine supplies and a teacher sees nothing about people outside their class. It states that it is not a prediction about anyone's health. |

## 2. Files changed

New: `shared/monitor.ts`, `shared/monitor-messages.ts`, `shared/notify.ts`, `shared/forecast.ts`,
`src/components/monitoring.tsx`, `src/pages/Forecast.tsx`, `tests/monitor.test.ts`, `tests/monitor-api.test.ts`,
`docs/PHASE-4.md`.

Changed: `shared/types.ts` (notification settings, alerts, standing permissions, proposals), `shared/engine.ts`
(quiet hours and muting in every notification, settings action, monitor in the periodic check, views, upgrade to
schema 4), `shared/care-engine.ts`, `shared/plans-engine.ts` (reminder group and links), `shared/messages.ts`
(translation of SANAD-written task titles), `shared/ar-content.ts`, `shared/seed.ts`, `src/App.tsx`,
`src/components/{Shell,assistant}.tsx`, `src/pages/{Today,Profile,Inbox,Settings}.tsx`, `src/lib/ar-ui.ts`,
`src/styles.css`, `tests/e2e.mjs`, `tests/access.test.ts`, `tests/plans.test.ts`.

## 3. Data migration

`upgrade()` moves saved data to schema 4 by adding empty alerts, standing permissions and suggestions. Nothing
existing is changed or removed.

## 4. Tests and results (this build)

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (unit + API, 11 files) | **169 passed** |
| `npm run e2e` (Chromium, multi-user, English and Arabic) | **89 checks passed, 0 problems** |

New coverage: quiet hours (held, urgent through, urgent held when not allowed), muting that never drops
escalations or assignments, settings validation and privacy; unlogged-dose wording and recipients, no repeat
notifications, automatic closing; cover and expiring-request alerts and their audiences; standing permissions
(only the person or guardian, limits, owner must see medicines, runs with the giver's permissions, recorded, runs
once, failure reported with nothing created, withdrawal); suggestions (evidence, only time changes, who may
decide, no repeat after dismissal); forecast scoping (coordinator sees no supplies); schema upgrade; the API for
all of these; and in the browser: Today, accepting a suggestion, turning on a standing permission, quiet hours,
"Coming up", and every new screen in Arabic.

## 5. Assumptions

- The thresholds are fixed and stated on screen: 2 hours for unlogged doses, 7 days of supply, 24 hours for cover,
  12 hours for a missing outcome or an expiring request, 3 late of the last 5 for a suggestion, 5 items for a busy day.
- Times of day for monitoring and suggestions use the server's clock; quiet hours use each person's chosen time zone.
- Standing permissions cover only creating tasks inside SANAD; they never send anything outside it.

## 6. Missing credentials and dependencies

- **No email, SMS, WhatsApp or push delivery is configured.** Notifications are in-app only, and the settings
  page says so. Connecting a provider (for example an SMTP or SMS service) is needed before off-app delivery
  and is listed for Phase 5 readiness.
- No pharmacy, calendar or hospital integration: refills and follow-ups become tasks for people, not orders.

## 7. Known limitations

- The browser demo runs the checks when the page is open (and every 30 seconds); nothing runs while no one has it open.
- Held notifications are released by time only; there is no daily digest.
- Tasks SANAD creates are titled in English in the data and shown translated in Arabic.

## 8. Next: Phase 5

Security review and hardening, accessibility (text size, reduced motion, screen reader and keyboard), health
checks and error reporting, deployment checklist and the final report.
