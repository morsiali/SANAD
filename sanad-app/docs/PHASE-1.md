# SANAD — Phase 1 report

Phase 1 of the enhancement brief: audit, access-control foundations, people dashboard, the individual
profile and persistent medical records. Everything below is implemented, tested and running in both
modes (server and browser demo). Nothing here is described as done unless it works end to end.

## 1. Audit of the application before Phase 1

| Area | What existed | Gap found |
|---|---|---|
| Stack | Vite + React 18 + TypeScript, react-router (hash routes); Express API; one shared command engine (`apply`) used by server and browser | — |
| Data | Single JSON document (`data/sanad.json` on the server, `localStorage` in the browser demo) | No schema version, no migrations |
| Auth | scrypt password hashes, HMAC-signed tokens, SSE live updates | `/api/accounts` lists demo accounts publicly (demo convenience) |
| Roles | family, caregiver, doctor, coordinator, transport, pharmacy, social | No person-receiving-care, psychologist, physiotherapist, educator or admin; no guardian concept |
| Access | Each user had a list of linked people; `viewFor` filtered problems only and copied the rest of the state | **Any new private record would have reached every user.** No per-domain access, consent, revocation, organisation isolation or audit log |
| Profiles | Name, age, area, care note, care category | No preferences, communication needs, medical record, medicines, other care domains |
| AI | Rule-based “Ask SANAD” over the user's view; no model calls | Approvals, drafts and execution policy missing (Phases 3–4) |
| Tests | 59 unit/API, 48 browser checks | No permission-boundary tests |

## 2. Delivery plan

| Phase | Scope | Status |
|---|---|---|
| 1 | Access control, consent, approvals, audit, people dashboard, profile, medical record & medicines, other domain records | **Done (this report)** |
| 2 | Appointments & calendar, care plans and tasks (states, recurrence, owners, handovers), documents and uploads, progress charts, “Today” view | **Done — see [PHASE-2.md](PHASE-2.md)** |
| 3 | Assistant: permission-scoped retrieval with cited sources, appointment briefs, handovers, draft plans, approval cards | Done ([report](PHASE-3.md)) |
| 4 | Approved execution, notification preferences and quiet hours, background monitoring, refill/coverage forecasting rules | Done ([report](PHASE-4.md)) |
| 5 | Security hardening, accessibility review (text size, reduced motion), monitoring, deployment readiness | Done ([report](PHASE-5.md), [final report](FINAL-REPORT.md)) |

## 3. What Phase 1 implemented

**Roles.** Added *Person receiving care* (`self`), *Psychologist*, *Physiotherapist*, *Educator* and
*Organisation admin*. A parent or legal guardian is a family member whose **authority is verified** by a
coordinator or admin — family relationship alone never grants authority. Platform administration has
no account type and no data backdoor.

**Care teams and domains** (`shared/access.ts`). Access to a person comes from an active membership that
grants domains: overview, medical, psychological well-being, private therapy notes, academic, social,
sports & activity, physiotherapy & rehab, care team. Memberships can be time-limited and are revoked
immediately. Coordinators and admins see the overview and care team of people **in their own
organisation only**, nothing clinical.

**Consent** (`shared/care-engine.ts`). Granting a sensitive domain needs consent from (a) the person
themselves, (b) their verified guardian, or (c) when neither has an account, a coordinator recording
written evidence. Every grant and removal is written to the consent log.

**Approvals.** When a coordinator asks for sensitive access, an approval is created for the authority
holders. It is bound to the exact action (fingerprint), the approver, the target's current state, a 72-hour
expiry and a single execution. A changed target, wrong fingerprint, second use or expiry is refused.
Authorisation is checked again at execution.

**Invitations.** Time-limited (7 days), bound to one email and role, server-generated random codes,
accepted at sign-up through a link or from the Approvals page. SANAD does not send email; the inviter
copies the link (stated in the UI).

**Records** (`shared/records.ts`). One record model for every domain, with author, source
(self-reported / caregiver observation / professional entry / AI-generated), timestamp, verification,
version and full edit history. Kind-level rules: only doctors enter diagnoses and follow-up
instructions, only psychologists write private progress notes, only physiotherapists create plans and
exercises, educators write assessments and IEPs. Stale edits are rejected (optimistic concurrency).
Professional entries can only be withdrawn by their author.

**Medicines.** Name, strength, dose, route, times, dates, prescriber, instructions, reminder preference,
supply. Dose logs distinguish taken, missed, skipped and not known; an unlogged dose is never treated as
taken. A missed dose notifies the household with neutral wording that defers to the prescriber or
pharmacist — never “double the next dose”. Dose changes by non-doctors return to “not verified”.
Refill reminders are a transparent rule (units on hand ÷ daily use), labelled as such.

**Audit log.** Every write, access change, approval decision and export is recorded. People only see
entries for domains they can see.

**Screens.** People dashboard (cards with preferred name, relationship, communication needs, care
category, next medicine, open problems, last update and scoped alerts; search, filters, grouping);
profile with permission-aware tabs (overview, medical & medicines, well-being incl. private notes,
academic, social, activity, rehab, care team & permissions, activity history); approvals page;
role-aware dashboard callouts; sign-up for the person receiving care, guardian claims and invitations.
Fully bilingual (English/Arabic, RTL).

**Routing.** New routing rules send school matters to the student's educator, physio questions to their
physiotherapist and therapy questions to their psychologist — only when that professional is on the
person's care team. Coordinators only receive problems from their own organisation.

## 4. Files changed

New: `shared/access.ts`, `shared/records.ts`, `shared/care-engine.ts`, `src/lib/people.ts`,
`src/components/records.tsx`, `src/components/careteam.tsx`, `src/pages/People.tsx`,
`src/pages/Profile.tsx`, `src/pages/Approvals.tsx`, `tests/access.test.ts`, `docs/PHASE-1.md`,
`.env.example`.

Changed: `shared/types.ts`, `shared/engine.ts` (filtered `viewFor`, `upgrade`, sign-up), `shared/routing.ts`,
`shared/seed.ts`, `shared/messages.ts`, `shared/ar-content.ts`, `server/app.ts`, `src/lib/backend.ts`,
`src/App.tsx`, `src/components/Shell.tsx`, `src/pages/{Dashboard,Team,Register,Inbox,Report,Challenges,Analytics,Settings}.tsx`,
`src/lib/{ar-ui,format,roles}.ts`, `src/styles.css`, `tests/api.test.ts`, `tests/e2e.mjs`.

## 5. Data migration

`upgrade()` in `shared/engine.ts` runs when saved data is loaded (schema 1 → 2). It **adds** the new
collections, puts existing people and coordinators in the default organisation, and turns each existing
care link into a membership with that role's usual domains (consent marked “recorded — carried over”).
Nothing is deleted. The browser demo stores data under a new key, so earlier demo data is left untouched
in the visitor's browser and the demo starts from the new synthetic data.

## 6. Tests and results (run on this build)

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (unit + API, 6 files) | **84 passed** |
| `npm run e2e` (Chromium, multi-user, English and Arabic) | **64 checks passed, 0 problems** |

New coverage includes: the educator boundary (scenario 7) through view, API state, export, assistant and
direct links; organisation isolation; consent grant and revocation; unverified guardians; recorded
consent; approval binding, wrong fingerprint, wrong approver, single use, decline, expiry and stale target;
invitation email/role/expiry/reuse; secure codes; diagnosis restriction, verification, edit history,
stale edits; audit visibility; dose logging, neutral missed-dose notice, refill rule, re-verification;
migration of old data; Arabic and RTL on every profile tab.

## 7. Roles and permissions matrix (default domains)

`●` default · `○` can be granted with consent · `—` never

| Role | Overview | Medical | Well-being | Private notes | Academic | Social | Activity | Rehab | Care team |
|---|---|---|---|---|---|---|---|---|---|
| Person receiving care (adult) | ● | ● | ● | — | ● | ● | ● | ● | ● manages |
| Verified guardian | ● | ● | ● | — | ● | ● | ● | ● | ● manages |
| Family caregiver | ● | ● | ● | — | ○ | ● | ● | ● | ● |
| Caregiver | ● | ● | ● | — | ○ | ○ | ● | ● | ○ |
| Doctor | ● | ● | ● | — | ○ | ○ | ● | ● | ○ |
| Psychologist | ● | ○ | ● | ● | ○ | ● | ○ | ○ | ○ |
| Physiotherapist | ● | ○ | ○ | — | ○ | ○ | ● | ● | ○ |
| Educator | ● | ○ | ○ | — | ● | ● | ○ | ○ | ○ |
| Coordinator (own organisation) | ● | ○* | ○* | — | ○* | ○* | ○* | ○* | ● manages |
| Organisation admin (own organisation) | ● | — | — | — | — | — | — | — | ● manages, verifies authority |
| Transport / Pharmacy / Social services | ● | Pharmacy ● | — | — | — | Social services ● | — | — | — |

\* only through a care-team membership granted with consent, like anyone else.
Private therapy notes can only be shared with a psychologist; they stay out of household information.
Defaults apply when someone joins a care team; they are not access by themselves. Write access additionally depends on the record kind
(see `RECORD_KINDS` in `shared/records.ts`).

## 8. Approval policy (Phase 1 scope)

| Action | Policy |
|---|---|
| Read records | Only domains granted; enforced in `viewFor` before anything leaves the server |
| Add/edit own records, log doses | Allowed for members with write access to the domain |
| Diagnoses, follow-up instructions, therapy notes, rehab plans, IEPs | Restricted to the matching professional role |
| Grant sensitive access | Person / verified guardian, or approval by them, or coordinator with recorded evidence when nobody holds authority |
| Remove access | Immediate, by the person, guardian or coordinator; members can leave |
| Verify guardian authority | Coordinator or admin of the person's organisation, with written evidence |

The AI autonomy rules (read-only / draft / pre-authorised / explicit approval / never autonomous) build
on this approval engine in Phases 3–4.

## 9. Assumptions

- One household per family account; organisation switching is for coordinators/admins only.
- An adult who creates their own profile has authority over it; adults invited as “person receiving care”
  need a coordinator to verify identity before their authority is used.
- Approval expiry 72 hours; invitation expiry 7 days; maximum time-limited access 730 days.
- Photos are stored inline (≤ 100 KB); document upload arrives in Phase 2.

## 10. Missing credentials and dependencies

- **Email/SMS/WhatsApp:** not configured. Invitations are shared by copying a link; no messages are sent.
- **AI model:** none configured. “Ask SANAD” is rule-based and runs on the user's filtered view.
- **Hospital, pharmacy, school, calendar, wearable integrations:** none. Nothing in the app claims they exist.

## 11. Known limitations

- **Browser demo (GitHub Pages)** runs the engine in the visitor's browser, so the full synthetic dataset
  is in that browser's storage. Access rules are enforced on screen, but real protection needs **server
  mode** (`npm start`), where only the filtered view leaves the server.
- `/api/accounts` lists demo accounts for the sign-in page; disable for production.
- Routing rules and response-time settings are shared across organisations.
- The workspace reset is available to coordinators (demo feature).
- Single JSON file storage; no field-level encryption at rest.

## 12. Production-readiness checklist (open items)

- [ ] Move storage to a database with per-organisation tenancy and encryption at rest
- [ ] Remove `/api/accounts` and the demo reset; add rate limiting and session expiry
- [ ] Email delivery for invitations (adapter + configuration check)
- [ ] Identity verification for people receiving care and guardians
- [ ] Clinical-safety review of medicine wording and refill rules by a pharmacist
- [ ] Legal review of consent model for minors and adults lacking capacity (UAE law)
- [ ] Accessibility audit with screen-reader users; text-size and reduced-motion settings (Phase 5)
- [ ] Data export and deletion request workflow (Phase 5)
