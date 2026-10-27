// The SANAD assistant: answers, summaries, briefs and drafts built only from the viewer's filtered view.
//
// Safety model
//  - Input is the View the server already filtered for this user; every tool checks the section again.
//  - Tools are read-only and allowlisted, with a per-request call budget.
//  - Every sentence about a person cites the items it came from (SourceRef ids).
//  - Record text is quoted as data; nothing in it is ever followed as an instruction.
//  - Clinical decisions (diagnosis, doses, stopping or changing treatment, predictions) are refused and
//    turned into a request for professional review. Emergencies get a call-for-help message only.
//  - Drafts are proposals. Nothing happens until a person confirms, and then each step runs as a normal
//    action through the same permission checks as the rest of SANAD.
import type { Action, Appointment, CareRecord, CareTask, Domain, Msg, Priority, Recipient, RecordSource, Recurrence, Role, User, View } from './types';
import { authorityHolders, hasAuthority, isLive, isMinor, membershipFor } from './access';
import { dayKey, doseSlots, kindOf, refillForecast, slotTime } from './records';
import { isOpenTask, isOverdue } from './plans';
import { describeSeries, measureSeries, seriesGaps } from './progress';
import { isActive, normalize } from './routing';
import { ask, type Answer } from './intelligence';
import { msg } from './messages';
import { contentAr } from './ar-content';

const H = 3_600_000;
const DAY = 24 * H;

export type Intent =
  | 'summary'
  | 'appointment_brief'
  | 'handover'
  | 'plan'
  | 'missing'
  | 'progress'
  | 'meds'
  | 'allergies'
  | 'appointments'
  | 'measure'
  | 'team'
  | 'tasks'
  | 'refuse'
  | 'emergency'
  | 'which_person'
  | 'no_access'
  | 'legacy';

export const PERSON_INTENTS: Intent[] = ['summary', 'appointment_brief', 'handover', 'plan', 'missing', 'progress', 'meds', 'allergies', 'appointments', 'measure', 'team', 'tasks'];

export interface AssistRequest {
  question: string;
  recipientId?: string | null;
  /** Set by buttons ("Prepare a brief", "Draft a plan"); otherwise worked out from the question. */
  intent?: Intent;
  /** Appointment for a brief, or the receiver of a handover. */
  targetId?: string | null;
}

export type SourceType = 'record' | 'medication' | 'dose' | 'task' | 'plan' | 'appointment' | 'document' | 'problem' | 'profile';

export interface SourceRef {
  id: string;
  type: SourceType;
  recipientId: string;
  domain: Domain;
  title: string;
  at: number;
  by?: string;
  source?: RecordSource;
  verified?: boolean;
}

export interface Line {
  m: Msg;
  cites: string[];
  tone?: 'warn' | 'info' | 'ok';
}

export interface Block {
  title: Msg;
  lines: Line[];
  /** Shown when the block has no lines (so "nothing found" is said, not hidden). */
  empty?: Msg;
}

export interface Suggestion {
  m: Msg;
  intent?: Intent;
  recipientId?: string;
  targetId?: string;
  /** "Why am I seeing this?" */
  why: Msg;
}

export interface DraftTask {
  key: string;
  title: string;
  notes: string;
  ownerId: string | null;
  ownerOptions: string[];
  dueAt: number | null;
  recurrence: Recurrence;
  priority: Priority;
  needsApproval: boolean;
  include: boolean;
  why: Msg;
  duplicateOf?: string;
}

export interface PlanDraft {
  kind: 'plan';
  recipientId: string;
  template: string;
  title: string;
  goal: string;
  domain: Domain;
  domainOptions: Domain[];
  tasks: DraftTask[];
  /** Approval by the person or their verified guardian will be requested for each task. */
  approvers: string[];
}

export interface HandoverDraft {
  kind: 'handover';
  recipientId: string;
  toUserId: string | null;
  options: string[];
  hours: number;
  note: Msg;
  /** True when the viewer can see which sections the receiver has. */
  receiverKnown: boolean;
}

export interface ReviewDraft {
  kind: 'review';
  recipientId: string;
  domain: Domain;
  ownerId: string | null;
  ownerOptions: string[];
  title: string;
  notes: string;
  /** The question as asked, so the screen can word the request in the user's language. */
  question: string;
}

export interface BriefDraft {
  kind: 'brief';
  recipientId: string;
  domain: Domain;
  appointmentId: string;
  title: Msg;
}

export type Draft = PlanDraft | HandoverDraft | ReviewDraft | BriefDraft;

export interface AssistantAnswer {
  intent: Intent;
  recipientId: string | null;
  headline: Msg;
  blocks: Block[];
  sources: SourceRef[];
  notes: Msg[];
  suggestions: Suggestion[];
  draft?: Draft;
  refused?: boolean;
  emergency?: boolean;
  legacy?: Answer;
  /** "rules": built by SANAD's rules. "model": the overview was written by the configured AI model from these facts. */
  engine: 'rules' | 'model';
  overview?: { text: string; cites: string[] }[];
  modelNote?: Msg;
  tools: string[];
  /** The tool budget ran out; the answer is partial. */
  partial?: boolean;
}

// ---------------------------------------------------------------- language

const N = (s: string) => normalize(s);
const has = (n: string, re: RegExp) => re.test(n);

const P = {
  emergency:
    /\b(emergency|cant breathe|can not breathe|not breathing|chest pain|unconscious|collapsed|having a stroke|seizure|bleeding (a lot|heavily)|suicid|kill (my|him|her)self|overdose)\b|طوارء|طواري|لا يتنفس|ما يتنفس|الم في صدر|الم صدر|فاقد وعي|اغماء|انتحار|جرعه زاءده/,
  dosing:
    /\b(should (i|we|she|he|they) (take|give|stop|skip|double|increase|decrease|change)|how (much|many) .{0,30}(give|take)|(increase|decrease|reduce|raise|lower|double|change|adjust|stop|start|skip|halve) (the |her |his |my |their |this )?(dose|dosage|medicine|medication|meds|insulin|tablets?|pills?|metformin|treatment)|should \w+ (take|give|stop|skip|double|increase|decrease|change)|extra (\w+ )?(dose|tablet|pill|units?)|(more|less|another) (\w+ )?(insulin|metformin|tablets?|pills?|units|dose)|what dose|prescribe|prescription for|replace (her|his|the) (medicine|medication))\b|زياده جرعه|زياده (ال)?جرعه|تقليل جرعه|خفض جرعه|كم جرعه|اوقف دواء|ايقاف دواء|يوقف دواء|نوقف دواء|وصف دواء|اوصف|هل اعطيه|هل اعطيها|(ازيد|نزيد|يزيد|انقص|اقلل|نقلل|اوقف|نوقف|يوقف|اضاعف|اغير|نغير) (\S+ )?(جرعه|دواء|انسولين|حبوب)/,
  diagnose:
    /\b(diagnos\w*|what (is|s) wrong with|does (she|he|they) have|is (it|this|she|he) (cancer|dementia|depressed|depression|a stroke|serious|dangerous|infected)|will (she|he|they) (get worse|deteriorate|recover|die|relapse)|predict\w*|prognosis|how long (will|does) (she|he) (have|live)|is\b.{0,40}\b(dangerous|normal|too high|too low|serious|worrying))\b|تشخيص|شخص حال|هل (هو|هي) مصاب|هل عنده|هل عندها|هل سيتدهور|هل ستتدهور|\sتوقع/,
  handover: /\b(hand ?over|handoff|hand off|shift notes?|pass on to)\b|تسليم|تسلم/,
  plan: /\b(draft|make|create|suggest|build|write|start|set up|propose)\b.{0,40}\bplan\b|\bplan (for|to)\b|خطه|خطة/,
  brief: /\b(brief|briefing|prepare|preparation|get ready|ready for)\b.{0,50}\b(appointment|visit|session|review|meeting|clinic|doctor|physio|therapy)\b|\b(appointment|visit) (brief|summary|prep)\b|تحضير|حضر|جهز|ملخص موعد/,
  missing: /\b(missing|incomplete|not recorded|out of date|gaps? in (the )?(profile|record)|what (is|s) missing|what should be added|complete (the|her|his) profile)\b|ناقص|مفقود|غير مكتمل|ينقص/,
  progress: /\b(progress|trend|trends|explain (these|the) (changes|chart)|over time|improv\w*|getting better|chart)\b|تقدم|تطور|منحني/,
  summary: /\b(what (has )?(changed|happened)|whats new|what is new|summar\w*|update me|catch me up|recent(ly)?|this week|last week|overview)\b|ملخص|ماذا تغير|ما الجديد|جديد|اخر مستجدات|مستجدات/,
  meds: /\b(medicines?|medications?|meds|tablets?|pills?|insulin|doses?)\b|ادويه|دواء|حبوب|انسولين|جرعات/,
  allergies: /\b(allerg\w*|precautions?)\b|حساسيه/,
  appointments: /\b(appointments?|visits?|sessions?|clinic|next (visit|session))\b|موعد|مواعيد|زياره|جلسه/,
  measure: /\b(glucose|sugar|weight|blood pressure|pain|mood|sleep|attendance|stress|reading|readings|measurement)\b|سكر|وزن|ضغط|\sالم\s|مزاج|نوم|حضور|قراءه|قراءات/,
  team: /\b(care team|who (is|s) (on|in) (the|her|his) team|who (looks after|cares for|is responsible)|team members?)\b|فريق رعايه|فريق/,
  tasks: /\b(tasks?|to ?dos?|what (is|s) due|overdue|due today)\b|مهام|مهمه|متاخر/,
};

const MEASURE_WORDS: [RegExp, RegExp][] = [
  [/glucose|sugar|سكر/, /glucose|sugar/i],
  [/weight|وزن/, /weight/i],
  [/blood pressure|ضغط/, /pressure/i],
];

export function detectIntent(question: string): Intent | null {
  const n = N(question);
  if (has(n, P.emergency)) return 'emergency';
  if (has(n, P.dosing) || has(n, P.diagnose)) return 'refuse';
  if (has(n, P.handover)) return 'handover';
  if (has(n, P.plan)) return 'plan';
  if (has(n, P.brief)) return 'appointment_brief';
  if (has(n, P.missing)) return 'missing';
  if (has(n, P.progress)) return 'progress';
  if (has(n, P.allergies)) return 'allergies';
  if (has(n, P.meds)) return 'meds';
  if (has(n, P.summary)) return 'summary';
  if (has(n, P.measure)) return 'measure';
  if (has(n, P.appointments)) return 'appointments';
  if (has(n, P.team)) return 'team';
  if (has(n, P.tasks)) return 'tasks';
  return null;
}

/** Which kind of clinical decision was asked for (for the refusal wording and the review owner). */
function refusalKind(question: string): 'dose' | 'diagnose' {
  return has(N(question), P.dosing) ? 'dose' : 'diagnose';
}

const ar = (s: string) => contentAr[s] ?? '';
/** How the person likes to be called, or their first name. */
const firstName = (r: Recipient) => r.preferredName?.trim() || r.name.split(' ')[0];

function namesOf(r: Recipient): string[] {
  const out = [r.name, r.name.split(' ')[0], r.preferredName ?? '', ar(r.name), ar(r.name).split(' ')[0], r.preferredName ? ar(r.preferredName) : ''];
  return out.filter((x) => x && x.trim().length >= 3).map((x) => N(x).trim());
}

/** People mentioned in the question, among everyone in the view (including ones the viewer cannot open). */
export function mentionedPeople(view: View, question: string): Recipient[] {
  const n = N(question);
  // Also match possessives ("Khadija's" → "khadijas") and Arabic attached prepositions ("لفاطمة", "بفاطمة", "وفاطمة").
  const words = new Set(n.trim().split(' ').flatMap((w) => [w, w.replace(/s$/, ''), w.replace(/^[لبوف](?=\S{3,})/, '')]));
  return view.recipients.filter((r) => namesOf(r).some((x) => n.includes(` ${x} `) || (!x.includes(' ') && words.has(x))));
}

// ---------------------------------------------------------------- tools

export const TOOL_BUDGET = 16;

class BudgetSpent extends Error {}

/**
 * The only ways the assistant reads data. Each one re-checks the section against the view's access map,
 * so even a view built incorrectly could not leak a section into an answer.
 */
class Tools {
  calls = 0;
  used: string[] = [];
  sources = new Map<string, SourceRef>();
  constructor(
    readonly view: View,
    readonly rid: string,
    readonly now: number,
    readonly budget = TOOL_BUDGET,
  ) {}

  can(d: Domain): boolean {
    const r = this.view.recipients.find((x) => x.id === this.rid);
    return !!r && !r.limited && !!this.view.access[this.rid]?.includes(d);
  }

  private call(name: string) {
    if (this.calls >= this.budget) throw new BudgetSpent(name);
    this.calls += 1;
    this.used.push(name);
  }

  cite(ref: SourceRef): string {
    if (!this.can(ref.domain)) throw new Error(`refused to cite ${ref.domain}`);
    this.sources.set(ref.id, ref);
    return ref.id;
  }

  citeRecord(r: CareRecord) {
    return this.cite({ id: r.id, type: 'record', recipientId: r.recipientId, domain: r.domain, title: r.title, at: r.observedAt, by: r.authorId, source: r.source, verified: r.verification === 'verified' });
  }
  citeTask(t: CareTask) {
    return this.cite({ id: t.id, type: 'task', recipientId: t.recipientId, domain: t.domain, title: t.title, at: t.dueAt ?? t.updatedAt, by: t.createdBy });
  }
  citeAppt(a: Appointment) {
    return this.cite({ id: a.id, type: 'appointment', recipientId: a.recipientId, domain: a.domain, title: a.title, at: a.startAt, by: a.createdBy });
  }

  profile(): Recipient {
    this.call('get_profile');
    const r = this.view.recipients.find((x) => x.id === this.rid)!;
    this.cite({ id: `profile:${r.id}`, type: 'profile', recipientId: r.id, domain: 'overview', title: r.name, at: r.updatedAt ?? 0 });
    return r;
  }

  records(opts: { domains?: Domain[]; kinds?: string[]; since?: number; until?: number } = {}): CareRecord[] {
    this.call('search_records');
    return this.view.records
      .filter((r) => r.recipientId === this.rid && !r.archived && this.can(r.domain))
      .filter((r) => (!opts.domains || opts.domains.includes(r.domain)) && (!opts.kinds || opts.kinds.includes(r.kind)))
      .filter((r) => (opts.since === undefined || r.observedAt >= opts.since) && (opts.until === undefined || r.observedAt <= opts.until))
      .sort((a, b) => b.observedAt - a.observedAt);
  }

  medications() {
    this.call('list_medications');
    if (!this.can('medical')) return [];
    return this.view.medications.filter((m) => m.recipientId === this.rid && m.active);
  }

  doseLogs(since: number) {
    this.call('list_dose_logs');
    if (!this.can('medical')) return [];
    return this.view.doseLogs.filter((l) => l.recipientId === this.rid && slotTime(l.slot) >= since && slotTime(l.slot) <= this.now);
  }

  tasks(): CareTask[] {
    this.call('list_tasks');
    return this.view.tasks.filter((t) => t.recipientId === this.rid && t.kind !== 'handover' && this.can(t.domain));
  }

  appointments(): Appointment[] {
    this.call('list_appointments');
    return this.view.appointments.filter((a) => a.recipientId === this.rid && this.can(a.domain)).sort((a, b) => a.startAt - b.startAt);
  }

  documents() {
    this.call('list_documents');
    return this.view.documents.filter((d) => d.recipientId === this.rid && !d.archived && this.can(d.domain));
  }

  problems() {
    this.call('list_problems');
    return this.view.challenges.filter((c) => c.recipientId === this.rid && isActive(c));
  }

  team(): User[] {
    this.call('list_team');
    const r = this.view.recipients.find((x) => x.id === this.rid);
    return this.view.users.filter((u) => u.role !== 'admin' && (u.recipients.includes(this.rid) || (u.role === 'coordinator' && !!r?.orgId && u.orgId === r.orgId)));
  }
}

// ---------------------------------------------------------------- helpers

const userName = (view: View, id: string | null | undefined) => view.users.find((u) => u.id === id)?.name ?? '';
const first = (s: string) => s.split(' ')[0];

/** Sections another team member can see — known only when the viewer can see the care team. */
function domainsOf(view: View, userId: string, rid: string, now: number): Domain[] | null {
  if (userId === view.me) return view.access[rid] ?? [];
  const u = view.users.find((x) => x.id === userId);
  if (!u) return null;
  const m = view.memberships.find((x) => x.userId === userId && x.recipientId === rid && isLive(x, now));
  if (m) return ['overview', ...m.domains.filter((d) => d !== 'overview')];
  if (u.role === 'coordinator') {
    const r = view.recipients.find((x) => x.id === rid);
    if (r?.orgId && r.orgId === u.orgId) return ['overview', 'team'];
  }
  // Without care-team access the viewer simply does not know.
  return view.access[rid]?.includes('team') ? [] : null;
}

const recLine = (r: CareRecord, view: View): Msg =>
  r.value !== null && r.value !== undefined
    ? msg('as_rec_val', { title: r.title, v: r.value, unit: r.unit ?? '', kind: r.kind, src: `@src_${r.source}`, by: userName(view, r.authorId), at: r.observedAt })
    : msg('as_rec', { title: r.title, kind: r.kind, src: `@src_${r.source}`, by: userName(view, r.authorId), at: r.observedAt });

/** Record text is quoted as data, shortened, never interpreted or followed. */
const quote = (s: string, n = 160) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

function windowDays(question: string, fallback: number): number {
  const n = N(question);
  const d = n.match(/\b(\d{1,3}) ?(days?|يوم|ايام)(?=\s)/);
  if (d) return Math.min(180, Math.max(1, Number(d[1])));
  if (/\b(two|2) weeks?\b|اسبوعين/.test(n)) return 14;
  if (/\bmonth\b|شهر/.test(n)) return 30;
  if (/\bweek\b|اسبوع/.test(n)) return 7;
  if (/\btoday\b|\sيوم\s/.test(n)) return 1;
  return fallback;
}

function at(hour: number, from: number, addDays: number): number {
  const d = new Date(from + addDays * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

// ---------------------------------------------------------------- the answer builders

type Ctx = { view: View; me: User; r: Recipient; T: Tools; now: number; q: string; req: AssistRequest };

function adherenceLines(c: Ctx, days: number, cites: (id: string) => void = () => undefined): Line[] {
  const { T, now } = c;
  const meds = T.medications();
  if (!meds.length) return [];
  const since = now - days * DAY;
  const logs = T.doseLogs(since);
  const out: Line[] = [];
  for (const m of meds) {
    const counts = { taken: 0, missed: 0, skipped: 0, unknown: 0 };
    let slots = 0;
    let unlogged = 0;
    for (let d = 0; d <= days; d++) {
      const day = dayKey(now - d * DAY);
      for (const s of doseSlots(m, logs, day)) {
        const t = slotTime(s.slot);
        if (t < since || t > now) continue;
        slots += 1;
        if (s.log) counts[s.log.status] += 1;
        else unlogged += 1;
      }
    }
    if (!slots) continue;
    const id = T.cite({ id: m.id, type: 'medication', recipientId: m.recipientId, domain: 'medical', title: m.name, at: m.updatedAt, by: m.authorId, source: m.source, verified: m.verification === 'verified' });
    cites(id);
    out.push({
      m: msg('as_adherence', { med: m.name, n: slots, taken: counts.taken, missed: counts.missed, skipped: counts.skipped, unknown: counts.unknown, unlogged, days }),
      cites: [id, ...logs.filter((l) => l.medicationId === m.id).slice(0, 12).map((l) => T.cite({ id: l.id, type: 'dose', recipientId: l.recipientId, domain: 'medical', title: m.name, at: slotTime(l.slot), by: l.by }))],
      tone: counts.missed || unlogged ? 'warn' : undefined,
    });
  }
  return out;
}

function seriesLines(c: Ctx, from: number, domains?: Domain[]): { lines: Line[]; medical: boolean } {
  const { T, now } = c;
  const recs = T.records({ since: from, until: now, domains });
  const series = measureSeries(recs, c.r.id, from, now);
  let medical = false;
  const lines: Line[] = [];
  for (const s of series) {
    const d = describeSeries(s);
    if (s.domain === 'medical') medical = true;
    const cites = s.points.map((p) => T.citeRecord(p));
    const label: string | Msg = s.kind === 'measurement' ? s.title : msg('as_kind', { Kind: s.kind });
    lines.push({
      m:
        s.points.length === 1
          ? msg('as_series_one', { label, v: d.last.value ?? 0, unit: s.unit, at: d.last.observedAt })
          : msg('as_series', { label, n: s.points.length, a: d.first.value ?? 0, at: d.first.observedAt, b: d.last.value ?? 0, at2: d.last.observedAt, unit: s.unit, lo: d.min, hi: d.max, dir: `@as_dir_${d.direction}` }),
      cites,
    });
    const gs = seriesGaps(s.points, now);
    if (gs.length) lines.push({ m: msg('as_series_gap', { label, at: gs[0].from, at2: gs[0].to, n: gs.length }), cites: [cites[cites.length - 1]], tone: 'info' });
  }
  return { lines, medical };
}

function summary(c: Ctx): AssistantAnswer {
  const { T, now, view, r, q } = c;
  const days = windowDays(q, 7);
  const since = now - days * DAY;
  const blocks: Block[] = [];
  const notes: Msg[] = [];

  const recs = T.records({ since });
  blocks.push({
    title: msg('as_b_new', { days }),
    lines: recs.slice(0, 10).map((x) => ({ m: recLine(x, view), cites: [T.citeRecord(x)] })),
    empty: msg('as_none_new', { days }),
  });
  if (recs.length > 10) notes.push(msg('as_more', { n: recs.length - 10 }));
  const quoted = recs.filter((x) => x.body && ['observation', 'behaviour', 'checkin', 'teacher_note', 'social_obs', 'pain'].includes(x.kind)).slice(0, 3);
  if (quoted.length) blocks.push({ title: msg('as_b_said'), lines: quoted.map((x) => ({ m: msg('as_quote', { title: x.title, text: quote(x.body), by: userName(view, x.authorId) }), cites: [T.citeRecord(x)] })) });

  if (T.can('medical')) {
    const lines = adherenceLines(c, Math.min(days, 14));
    if (lines.length) {
      blocks.push({ title: msg('as_b_doses', { days: Math.min(days, 14) }), lines });
      notes.push(msg('as_not_logged'));
    }
  }

  const tasks = T.tasks();
  const done = tasks.filter((t) => t.status === 'completed' && (t.completedAt ?? 0) >= since);
  const overdue = tasks.filter((t) => isOverdue(t, now));
  const waiting = tasks.filter((t) => t.status === 'awaiting_approval');
  blocks.push({
    title: msg('as_b_tasks'),
    lines: [
      ...(done.length ? [{ m: msg('as_tasks_done', { n: done.length, days, list: done.slice(0, 4).map((t) => t.title).join(', ') }), cites: done.slice(0, 8).map((t) => T.citeTask(t)) }] : []),
      ...overdue.slice(0, 5).map((t) => ({ m: msg('as_task_overdue', { title: t.title, at: t.dueAt ?? now, who: userName(view, t.ownerId) || '@as_nobody' }), cites: [T.citeTask(t)], tone: 'warn' as const })),
      ...(waiting.length ? [{ m: msg('as_tasks_waiting', { n: waiting.length }), cites: waiting.map((t) => T.citeTask(t)) }] : []),
    ],
    empty: msg('as_none_tasks', { days }),
  });

  const appts = T.appointments();
  const past = appts.filter((a) => a.startAt >= since && a.startAt <= now);
  const next = appts.filter((a) => a.status === 'scheduled' && a.startAt > now && a.startAt < now + 7 * DAY);
  blocks.push({
    title: msg('as_b_appts'),
    lines: [
      ...past.map((a) => ({
        m: msg(a.status === 'scheduled' && a.endAt < now ? 'as_appt_needs_update' : 'as_appt_past', { title: a.title, at: a.startAt, status: a.status }),
        cites: [T.citeAppt(a)],
        tone: (a.status === 'missed' || (a.status === 'scheduled' && a.endAt < now) ? 'warn' : undefined) as Line['tone'],
      })),
      ...next.map((a) => ({ m: msg('as_appt_next', { title: a.title, at: a.startAt, place: a.location || a.withWhom }), cites: [T.citeAppt(a)] })),
    ],
    empty: msg('as_none_appts'),
  });

  const docs = T.documents().filter((d) => d.uploadedAt >= since);
  if (docs.length)
    blocks.push({
      title: msg('as_b_docs'),
      lines: docs.map((d) => ({ m: msg('as_doc', { title: d.title, by: userName(view, d.uploadedBy), at: d.uploadedAt }), cites: [T.cite({ id: d.id, type: 'document', recipientId: d.recipientId, domain: d.domain, title: d.title, at: d.uploadedAt, by: d.uploadedBy, source: d.source })] })),
    });

  const probs = T.problems();
  if (probs.length)
    blocks.push({
      title: msg('as_b_problems'),
      lines: probs.slice(0, 5).map((p) => ({ m: msg('as_problem', { ref: p.ref, title: p.title, stage: p.stage }), cites: [T.cite({ id: p.id, type: 'problem', recipientId: p.recipientId, domain: 'overview', title: p.title, at: p.updatedAt })] })),
    });

  const total = blocks.reduce((s, b) => s + b.lines.length, 0);
  return finish(c, 'summary', msg(total ? 'as_h_summary' : 'as_h_summary_empty', { name: firstName(r), days }), blocks, notes, [
    { m: msg('sq_missing', { name: firstName(r) }), intent: 'missing', why: msg('why_after_summary') },
    { m: msg('sq_progress', { name: firstName(r) }), intent: 'progress', why: msg('why_after_summary') },
  ]);
}

function pickAppointment(c: Ctx): Appointment | null {
  const { T, now, req, q } = c;
  const appts = T.appointments();
  if (req.targetId) return appts.find((a) => a.id === req.targetId) ?? null;
  const upcoming = appts.filter((a) => a.status === 'scheduled' && a.endAt >= now);
  const n = N(q);
  const kind = /doctor|clinic|medical|طبيب|عياده/.test(n) ? 'medical' : /therap|psycholog|نفسي|علاج نفسي/.test(n) ? 'therapy' : /physio|rehab|طبيعي/.test(n) ? 'physio' : /school|teacher|مدرس|معلم/.test(n) ? 'school' : null;
  return (kind ? upcoming.find((a) => a.kind === kind) : null) ?? upcoming[0] ?? null;
}

/** Problems worth raising at an appointment in each section. */
const RELATED_CATEGORIES: Partial<Record<Domain, string[]>> = {
  medical: ['medication', 'clinical'],
  rehab: ['rehab', 'equipment', 'daily_care'],
  activity: ['rehab', 'equipment'],
  wellbeing: ['wellbeing'],
  academic: ['learning'],
};

function brief(c: Ctx): AssistantAnswer {
  const { T, now, view, r } = c;
  const a = pickAppointment(c);
  if (!a) {
    return finish(c, 'appointment_brief', msg('as_h_no_appt', { name: firstName(r) }), [], [], [{ m: msg('sq_summary', { name: firstName(r) }), intent: 'summary', why: msg('why_no_appt') }]);
  }
  const aid = T.citeAppt(a);
  const blocks: Block[] = [];
  const notes: Msg[] = [];
  const att = a.attendeeIds.map((id) => userName(view, id)).filter(Boolean);
  blocks.push({
    title: msg('as_b_appt'),
    lines: [
      { m: msg('as_appt_detail', { title: a.title, at: a.startAt, place: a.location || '—', who: a.withWhom || '—' }), cites: [aid] },
      ...(att.length ? [{ m: msg('as_appt_attending', { people: att.join(', ') }), cites: [aid] }] : []),
      ...(a.notes ? [{ m: msg('as_quote', { title: a.title, text: quote(a.notes), by: userName(view, a.createdBy) }), cites: [aid] }] : []),
    ],
  });

  // Since the last appointment in the same section (or the last 30 days).
  const prev = T.appointments().filter((x) => x.domain === a.domain && x.status === 'completed' && x.startAt < a.startAt).pop();
  const since = prev ? prev.startAt : now - 30 * DAY;
  const domains: Domain[] = a.domain === 'overview' ? ['medical', 'wellbeing', 'rehab', 'activity', 'social', 'academic'] : a.domain === 'rehab' ? ['rehab', 'activity'] : [a.domain];
  const recent = T.records({ domains, since }).filter((x) => x.value === null || x.value === undefined);
  const s = seriesLines(c, since, domains);
  blocks.push({
    title: prev ? msg('as_b_since_prev', { at: prev.startAt }) : msg('as_b_since', { days: 30 }),
    lines: [...s.lines, ...recent.slice(0, 8).map((x) => ({ m: x.body && ['observation', 'behaviour', 'teacher_note', 'social_obs', 'completion', 'checkin'].includes(x.kind) ? msg('as_quote', { title: x.title, text: quote(x.body), by: userName(view, x.authorId) }) : recLine(x, view), cites: [T.citeRecord(x)] }))],
    empty: msg('as_none_since'),
  });
  if (s.medical) notes.push(msg('as_for_doctor'));

  if (a.domain === 'medical' && T.can('medical')) {
    const meds = T.medications();
    blocks.push({
      title: msg('as_b_meds'),
      lines: meds.map((m) => ({
        m: msg(m.verification === 'verified' ? 'as_med' : 'as_med_unverified', { med: m.name, strength: m.strength || '', dose: m.dose || '—', times: m.times.join(', ') || '—', by: m.prescriber || '—' }),
        cites: [T.cite({ id: m.id, type: 'medication', recipientId: m.recipientId, domain: 'medical', title: m.name, at: m.updatedAt, by: m.authorId, source: m.source, verified: m.verification === 'verified' })],
        tone: m.verification === 'verified' ? undefined : ('info' as const),
      })),
      empty: msg('as_none_meds'),
    });
    const adh = adherenceLines(c, 14);
    if (adh.length) {
      blocks.push({ title: msg('as_b_doses', { days: 14 }), lines: adh });
      notes.push(msg('as_not_logged'));
    }
    const allergies = T.records({ domains: ['medical'], kinds: ['allergy'] });
    blocks.push({ title: msg('as_b_allergies'), lines: allergies.map((x) => ({ m: msg('as_allergy', { title: x.title, text: quote(x.body || '—', 100) }), cites: [T.citeRecord(x)] })), empty: msg('as_none_allergies') });
  }
  if ((a.domain === 'rehab' || a.domain === 'activity') && T.can('rehab')) {
    const plan = T.records({ domains: ['rehab'], kinds: ['rehab_plan', 'exercise', 'restriction'] });
    blocks.push({ title: msg('as_b_rehab'), lines: plan.map((x) => ({ m: msg('as_quote', { title: x.title, text: quote(x.body || '—', 120), by: userName(view, x.authorId) }), cites: [T.citeRecord(x)] })), empty: msg('as_none_rehab') });
    const done = T.records({ domains: ['rehab'], kinds: ['completion'], since: now - 14 * DAY });
    blocks[blocks.length - 1].lines.push({ m: msg('as_completions', { n: done.length, days: 14 }), cites: done.map((x) => T.citeRecord(x)), tone: done.length ? undefined : 'info' });
  }

  // Things to raise: open problems, overdue tasks in this section, missed appointments.
  const raise: Line[] = [];
  const related = RELATED_CATEGORIES[a.domain];
  for (const p of T.problems().filter((x) => !related || related.includes(x.category)).slice(0, 4)) raise.push({ m: msg('as_problem', { ref: p.ref, title: p.title, stage: p.stage }), cites: [T.cite({ id: p.id, type: 'problem', recipientId: p.recipientId, domain: 'overview', title: p.title, at: p.updatedAt })] });
  const tasks = T.tasks();
  for (const t of tasks.filter((t) => isOverdue(t, now) && domains.includes(t.domain)).slice(0, 3)) raise.push({ m: msg('as_task_overdue', { title: t.title, at: t.dueAt ?? now, who: userName(view, t.ownerId) || '@as_nobody' }), cites: [T.citeTask(t)], tone: 'warn' });
  for (const m of T.appointments().filter((x) => x.status === 'missed' && x.startAt >= since)) raise.push({ m: msg('as_appt_missed', { title: m.title, at: m.startAt }), cites: [T.citeAppt(m)], tone: 'warn' });
  blocks.push({ title: msg('as_b_raise'), lines: raise, empty: msg('as_none_raise') });

  const prep = tasks.filter((t) => t.appointmentId === a.id);
  blocks.push({
    title: msg('as_b_prep'),
    lines: prep.map((t) => ({ m: msg('as_prep', { title: t.title, status: t.status }), cites: [T.citeTask(t)], tone: (isOpenTask(t) ? 'info' : 'ok') as Line['tone'] })),
    empty: msg('as_none_prep'),
  });

  notes.push(msg('as_brief_note'));
  const days = Math.max(0, Math.round((a.startAt - now) / DAY));
  return finish(c, 'appointment_brief', msg('as_h_brief', { title: a.title, at: a.startAt, name: firstName(r) }), blocks, notes, [{ m: msg('sq_missing', { name: firstName(r) }), intent: 'missing', why: msg('why_brief_missing') }], {
    kind: 'brief',
    recipientId: r.id,
    domain: a.domain,
    appointmentId: a.id,
    title: msg('as_brief_title', { title: a.title, day: a.startAt }),
  }, days);
}

function handover(c: Ctx): AssistantAnswer {
  const { T, now, view, r, req, q, me } = c;
  // Handovers go to people on the person's care team (the engine checks this again).
  const options = T.team().filter((u) => u.id !== me.id && u.role !== 'coordinator' && u.recipients.includes(r.id)).map((u) => u.id);
  const n = N(q);
  const named = req.targetId ?? options.find((id) => {
    const u = view.users.find((x) => x.id === id)!;
    return [u.name, first(u.name), ar(u.name), first(ar(u.name))].filter((x) => x && x.length >= 3).some((x) => n.includes(` ${N(x).trim()} `));
  }) ?? null;
  const to = named && options.includes(named) ? named : null;
  const hours = Math.min(72, Math.max(4, /\b(\d{1,2}) ?(hours?|ساعه|ساعات)(?=\s)/.test(n) ? Number(n.match(/\b(\d{1,2}) ?(hours?|ساعه|ساعات)(?=\s)/)![1]) : 24));
  const since = now - hours * H;
  const toDomains = to ? domainsOf(view, to, r.id, now) : null;
  const both = (d: Domain) => T.can(d) && (!toDomains || toDomains.includes(d));

  const tasks = T.tasks().filter((t) => both(t.domain));
  const done = tasks.filter((t) => t.status === 'completed' && (t.completedAt ?? 0) >= since);
  const open = tasks.filter((t) => isOpenTask(t) && t.status !== 'draft' && (!t.dueAt || t.dueAt < now + DAY));
  const recs = T.records({ since }).filter((x) => both(x.domain));
  const appts = T.appointments().filter((a) => a.status === 'scheduled' && a.startAt >= now && a.startAt < now + 2 * DAY && both(a.domain));
  const blocks: Block[] = [
    { title: msg('as_b_done', { hours }), lines: done.map((t) => ({ m: msg('as_task_done', { title: t.title, at: t.completedAt ?? now, who: userName(view, t.ownerId) || '@as_nobody' }), cites: [T.citeTask(t)], tone: 'ok' as const })), empty: msg('as_none_done') },
    { title: msg('as_b_todo'), lines: open.map((t) => ({ m: msg(isOverdue(t, now) ? 'as_task_overdue' : 'as_task_due', { title: t.title, at: t.dueAt ?? now, who: userName(view, t.ownerId) || '@as_nobody' }), cites: [T.citeTask(t)], tone: (isOverdue(t, now) ? 'warn' : undefined) as Line['tone'] })), empty: msg('as_none_todo') },
    { title: msg('as_b_new_h', { hours }), lines: recs.slice(0, 10).map((x) => ({ m: recLine(x, view), cites: [T.citeRecord(x)] })), empty: msg('as_none_new_h') },
  ];
  if (both('medical')) {
    const logs = T.doseLogs(since);
    const meds = T.medications();
    blocks.push({
      title: msg('as_b_doses_h', { hours }),
      lines: logs
        .sort((a, b) => slotTime(b.slot) - slotTime(a.slot))
        .slice(0, 10)
        .map((l) => {
          const m = meds.find((x) => x.id === l.medicationId);
          return { m: msg('as_dose', { med: m?.name ?? '', at: slotTime(l.slot), status: l.status, by: userName(view, l.by) }), cites: [T.cite({ id: l.id, type: 'dose', recipientId: l.recipientId, domain: 'medical', title: m?.name ?? '', at: slotTime(l.slot), by: l.by })], tone: (l.status === 'missed' ? 'warn' : undefined) as Line['tone'] };
        }),
      empty: msg('as_none_doses_h'),
    });
  }
  blocks.push({ title: msg('as_b_coming'), lines: appts.map((a) => ({ m: msg('as_appt_next', { title: a.title, at: a.startAt, place: a.location || a.withWhom }), cites: [T.citeAppt(a)] })), empty: msg('as_none_coming') });

  const notes: Msg[] = [msg(to && toDomains ? 'as_handover_scope' : 'as_handover_scope_unknown', { name: to ? first(userName(view, to)) : '' })];
  if (!options.length) notes.push(msg('as_handover_nobody'));
  const counts = { done: done.length, open: open.length, recs: recs.length };
  return finish(
    c,
    'handover',
    msg(to ? 'as_h_handover_to' : 'as_h_handover', { name: firstName(r), to: to ? first(userName(view, to)) : '', hours }),
    blocks,
    notes,
    [],
    options.length ? { kind: 'handover', recipientId: r.id, toUserId: to, options, hours, note: msg('as_handover_note', { ...counts, hours, name: firstName(r) }), receiverKnown: !!toDomains } : undefined,
  );
}

// Plan templates. Steps are deliberately practical and observational: no targets, doses or treatments,
// which belong to the professionals on the team.
interface Step {
  title: string;
  notes: string;
  roles: Role[];
  recurrence: Recurrence;
  inDays: number;
  hour: number;
  priority?: Priority;
}
interface Template {
  id: string;
  match: RegExp;
  domains: Domain[];
  title: string;
  goal: string;
  steps: Step[];
}

const HOUSE: Role[] = ['self', 'family', 'caregiver'];
export const PLAN_TEMPLATES: Template[] = [
  {
    id: 'sleep',
    match: /sleep|نوم/,
    domains: ['wellbeing'],
    title: 'Better sleep routine',
    goal: 'Feel rested, in their own words. Any clinical target comes from the professional on the team.',
    steps: [
      { title: 'Record hours slept each morning', notes: 'Use the Sleep entry in the well-being section.', roles: HOUSE, recurrence: 'daily', inDays: 1, hour: 9 },
      { title: 'Keep a calm evening routine and note what helped', notes: 'Describe what happened; avoid labels.', roles: HOUSE, recurrence: 'daily', inDays: 1, hour: 20 },
      { title: 'Review two weeks of sleep entries together', notes: 'Look at the entries with the person and agree next steps.', roles: ['psychologist', 'doctor', 'family', 'self'], recurrence: 'none', inDays: 14, hour: 10 },
    ],
  },
  {
    id: 'glucose',
    match: /glucose|sugar|diabet|سكر/,
    domains: ['medical'],
    title: 'Regular blood sugar records',
    goal: 'Readings recorded consistently so the doctor can review them. Targets and treatment come from the doctor.',
    steps: [
      { title: 'Record the fasting glucose reading', notes: 'Enter it as a measurement with its unit.', roles: ['caregiver', 'family', 'self'], recurrence: 'daily', inDays: 1, hour: 8 },
      { title: 'Check supplies: test strips and insulin pens', notes: 'Update the supply count on the medicines list.', roles: ['family', 'caregiver', 'self'], recurrence: 'weekly', inDays: 3, hour: 18 },
      { title: 'Doctor reviews the recorded readings', notes: 'Review only; any change to treatment is the doctor’s decision.', roles: ['doctor'], recurrence: 'none', inDays: 14, hour: 10, priority: 'high' },
    ],
  },
  {
    id: 'medication',
    match: /medic|adherence|tablet|pill|dose|دواء|ادويه|جرعات/,
    domains: ['medical'],
    title: 'Medicines logged on time',
    goal: 'Every scheduled dose is logged as taken, missed or skipped. Doses themselves are never changed here.',
    steps: [
      { title: 'Log each dose as taken, missed or skipped', notes: 'A reminder is not a dose: only log what you know.', roles: ['caregiver', 'family', 'self'], recurrence: 'daily', inDays: 1, hour: 21 },
      { title: 'Update the supply count', notes: 'So refill reminders stay accurate.', roles: ['family', 'caregiver', 'self'], recurrence: 'weekly', inDays: 7, hour: 18 },
      { title: 'Verify the medicine list with the doctor', notes: 'The doctor confirms names, doses and times.', roles: ['doctor'], recurrence: 'none', inDays: 7, hour: 10 },
    ],
  },
  {
    id: 'walking',
    match: /walk|mobility|exercis|physio|rehab|knee|\blegs?\b|strength|مشي|حركه|تمارين|علاج طبيعي|ركبه/,
    domains: ['rehab', 'activity'],
    title: 'Home exercise routine',
    goal: 'Follow the physiotherapist’s programme and record how it went. Exercises and limits come from the physiotherapist.',
    steps: [
      { title: 'Do the home exercise programme', notes: 'Follow the assigned exercises and any recorded restrictions.', roles: ['self', 'caregiver', 'family'], recurrence: 'daily', inDays: 1, hour: 10 },
      { title: 'Record pain or difficulty after exercises', notes: 'Use the 0–10 pain entry.', roles: ['self', 'caregiver', 'family'], recurrence: 'daily', inDays: 1, hour: 11 },
      { title: 'Physiotherapist reviews progress', notes: 'Review the completions and pain entries together.', roles: ['physio'], recurrence: 'none', inDays: 14, hour: 10 },
    ],
  },
  {
    id: 'mood',
    match: /mood|stress|anxi|worr|\blow\b|wellbeing|well being|\bcop(e|ing)\b|مزاج|توتر|قلق|نفسي/,
    domains: ['wellbeing'],
    title: 'Well-being check-ins',
    goal: 'Notice how they feel, in their own words, and share it with the right person.',
    steps: [
      { title: 'Short well-being check-in', notes: 'Ask how they feel and record it in their words.', roles: HOUSE, recurrence: 'daily', inDays: 1, hour: 17 },
      { title: 'Note what helped on harder days', notes: 'Describe what happened before and after.', roles: HOUSE, recurrence: 'weekly', inDays: 7, hour: 18 },
      { title: 'Psychologist reviews the check-ins', notes: 'Agree any next steps with the person.', roles: ['psychologist'], recurrence: 'none', inDays: 14, hour: 16 },
    ],
  },
  {
    id: 'social',
    match: /lonel|isolat|social|friend|club|activit|وحده|عزله|اجتماع|اصدقاء|نادي/,
    domains: ['social', 'activity'],
    title: 'Connection they choose',
    goal: 'Take part in activities they choose, as often as they want. More is not automatically better.',
    steps: [
      { title: 'Ask what they would like to do and with whom', notes: 'Record their choice as a personal social goal.', roles: HOUSE, recurrence: 'none', inDays: 2, hour: 17 },
      { title: 'Arrange one chosen activity', notes: 'Check transport and any recorded restrictions first.', roles: ['family', 'caregiver', 'self'], recurrence: 'weekly', inDays: 7, hour: 16 },
      { title: 'Ask how it went', notes: 'Record what went well or was hard, in their words.', roles: HOUSE, recurrence: 'weekly', inDays: 8, hour: 18 },
    ],
  },
  {
    id: 'school',
    match: /school|homework|\bclass\b|teacher|learn|\bread(ing)?\b|\bwrit(e|ing)\b|\biep\b|مدرس|واجب|معلم|تعلم|قراءه|كتابه/,
    domains: ['academic'],
    title: 'School support',
    goal: 'Use the agreed accommodations and keep school and family in step.',
    steps: [
      { title: 'Weekly note from the class teacher', notes: 'What went well and what was hard this week.', roles: ['educator'], recurrence: 'weekly', inDays: 5, hour: 14 },
      { title: 'Practise with the agreed accommodation at home', notes: 'For example speech-to-text for longer writing.', roles: ['family', 'self'], recurrence: 'weekly', inDays: 3, hour: 17 },
      { title: 'Review the learning goal together', notes: 'Teacher, family and the student.', roles: ['educator', 'family'], recurrence: 'none', inDays: 21, hour: 14 },
    ],
  },
];

const GENERIC: Template = {
  id: 'generic',
  match: /.^/,
  domains: ['overview'],
  title: 'New care plan',
  goal: 'Describe the goal in the person’s own words.',
  steps: [
    { title: 'Agree the goal with the person', notes: 'Write it in their words.', roles: HOUSE, recurrence: 'none', inDays: 2, hour: 17 },
    { title: 'First step towards the goal', notes: '', roles: HOUSE, recurrence: 'none', inDays: 5, hour: 10 },
    { title: 'Review how it is going', notes: '', roles: ['family', 'self', 'caregiver'], recurrence: 'none', inDays: 14, hour: 10 },
  ],
};

function plan(c: Ctx): AssistantAnswer {
  const { T, now, view, r, q, me } = c;
  const writable: Domain[] = (view.access[r.id] ?? []).filter((d) => d !== 'team' && d !== 'wellbeing_notes');
  if (me.role === 'admin' || !writable.length) return finish(c, 'plan', msg('as_h_plan_cannot', { name: firstName(r) }), [], [], []);
  const n = N(q);
  // The goal named in the question; otherwise a reasonable starting point from the user's role and the person's recorded needs.
  const named = PLAN_TEMPLATES.find((x) => x.match.test(n));
  const byRole: Partial<Record<Role, string>> = { physio: 'walking', psychologist: 'mood', educator: 'school' };
  const needs = r.needs ?? [];
  const guessId =
    byRole[me.role] ??
    (me.role === 'doctor' ? 'medication' : needs.includes('recovery') || needs.includes('mobility') ? 'walking' : needs.includes('chronic') ? 'medication' : r.living === 'alone' ? 'social' : null);
  const guess = PLAN_TEMPLATES.find((x) => x.id === guessId && x.domains.some((d) => writable.includes(d)));
  const tpl = named ?? guess ?? GENERIC;
  const domain: Domain | null = tpl.domains.find((d) => writable.includes(d)) ?? (tpl === GENERIC ? (writable.includes('overview') ? 'overview' : writable[0]) : null);
  if (!domain) {
    const holders = authorityHolders(view, r.id, now).map((m) => userName(view, m.userId)).filter(Boolean);
    return finish(c, 'plan', msg('as_h_plan_domain', { name: firstName(r), domain: tpl.domains[0], who: holders.length ? holders.join(', ') : '@as_their_team' }), [], [], []);
  }
  const team = T.team();
  const open = T.tasks().filter((t) => isOpenTask(t));
  const canOwn = (u: User) => {
    if (u.role === 'admin') return false;
    const ds = domainsOf(view, u.id, r.id, now);
    return !!ds && ds.includes(domain);
  };
  const candidates = team.filter(canOwn).map((u) => u.id);
  if (!candidates.includes(me.id) && canOwn(me)) candidates.unshift(me.id);
  const authority = !!hasAuthority(view, me.id, r.id, now);
  const approvers = authority ? [] : authorityHolders(view, r.id, now).map((m) => m.userId).filter((id) => id !== me.id);
  const tasks: DraftTask[] = tpl.steps.map((s, i) => {
    const owner = s.roles.map((role) => candidates.find((id) => view.users.find((u) => u.id === id)?.role === role)).find(Boolean) ?? (candidates.includes(me.id) ? me.id : null);
    const dup = open.find((t) => t.title.toLowerCase() === s.title.toLowerCase());
    const ownerUser = view.users.find((u) => u.id === owner);
    return {
      key: `s${i + 1}`,
      title: s.title,
      notes: s.notes,
      ownerId: owner,
      ownerOptions: candidates,
      dueAt: at(s.hour, now, s.inDays),
      recurrence: s.recurrence,
      priority: s.priority ?? 'medium',
      // Anyone without authority asks the person or their verified guardian first (SANAD finds them when the task is created).
      needsApproval: !authority,
      include: !dup,
      why: owner ? msg(owner === me.id ? 'why_owner_me' : 'why_owner', { role: ownerUser?.role ?? 'family', domain }) : msg('why_owner_none', { domain }),
      duplicateOf: dup?.id,
    };
  });
  const lines: Line[] = tasks.map((t) => ({
    m: msg(t.duplicateOf ? 'as_step_dup' : 'as_step', { title: t.title, who: t.ownerId ? userName(view, t.ownerId) : '@as_nobody', at: t.dueAt ?? now, rec: `@rec_${t.recurrence}` }),
    cites: t.duplicateOf ? [T.citeTask(open.find((x) => x.id === t.duplicateOf)!)] : [],
    tone: t.duplicateOf ? ('info' as const) : undefined,
  }));
  // Ground the draft in what is already recorded for this section.
  const context = T.records({ domains: [domain], since: now - 30 * DAY }).slice(0, 4);
  const blocks: Block[] = [{ title: msg('as_b_steps'), lines }];
  if (context.length) blocks.push({ title: msg('as_b_context'), lines: context.map((x) => ({ m: recLine(x, view), cites: [T.citeRecord(x)] })) });
  const notes: Msg[] = [msg('as_plan_note')];
  if (tpl.domains[0] === 'medical' || domain === 'rehab') notes.push(msg('as_plan_clinical'));
  if (approvers.length) notes.push(msg('as_plan_approval', { people: approvers.map((id) => userName(view, id)).join(', ') }));
  else if (!authority) notes.push(msg('as_plan_approval_unknown'));
  if (tpl === GENERIC) notes.push(msg('as_plan_generic'));
  else if (!named) notes.push(msg('as_plan_guess'));
  const draft: PlanDraft = { kind: 'plan', recipientId: r.id, template: tpl.id, title: tpl.title, goal: tpl.goal, domain, domainOptions: writable, tasks, approvers };
  return finish(c, 'plan', msg('as_h_plan', { name: firstName(r), title: tpl.title, n: tasks.length, domain }), blocks, notes, [], draft);
}

function missing(c: Ctx): AssistantAnswer {
  const { T, now, view, r } = c;
  const p = T.profile();
  const pid = `profile:${r.id}`;
  const lines: Line[] = [];
  const gap = (k: string, cites: string[], params: Record<string, string | number> = {}) => lines.push({ m: msg(k, { name: firstName(r), ...params }), cites, tone: 'warn' });
  if (!p.communication?.trim()) gap('as_miss_comm', [pid]);
  if (!p.languages?.length) gap('as_miss_lang', [pid]);
  if (T.can('medical')) {
    const allergies = T.records({ domains: ['medical'], kinds: ['allergy'] });
    if (!allergies.length) gap('as_miss_allergy', [pid]);
    const meds = T.medications();
    for (const m of meds.filter((x) => x.verification !== 'verified')) gap('as_miss_med_verify', [T.cite({ id: m.id, type: 'medication', recipientId: m.recipientId, domain: 'medical', title: m.name, at: m.updatedAt, by: m.authorId, source: m.source, verified: false })], { med: m.name });
    for (const m of meds.filter((x) => x.reminders && (x.onHand == null || !x.perDose))) gap('as_miss_supply', [T.cite({ id: m.id, type: 'medication', recipientId: m.recipientId, domain: 'medical', title: m.name, at: m.updatedAt })], { med: m.name });
    for (const m of meds.filter((x) => refillForecast(x, now).due)) gap('as_miss_refill', [T.cite({ id: m.id, type: 'medication', recipientId: m.recipientId, domain: 'medical', title: m.name, at: m.updatedAt })], { med: m.name, n: refillForecast(m, now).daysLeft ?? 0 });
    const conditions = T.records({ domains: ['medical'], kinds: ['condition', 'diagnosis'] }).filter((x) => x.verification !== 'verified');
    for (const x of conditions.slice(0, 3)) gap('as_miss_unverified', [T.citeRecord(x)], { title: x.title });
    const series = measureSeries(T.records({ domains: ['medical'] }), r.id, 0, now);
    for (const s of series) {
      const last = s.points[s.points.length - 1];
      if (now - last.observedAt > 14 * DAY) gap('as_miss_stale', [T.citeRecord(last)], { label: s.title, at: last.observedAt });
    }
  }
  if (T.can('rehab')) {
    const planRecs = T.records({ domains: ['rehab'], kinds: ['rehab_plan', 'exercise'] });
    if (planRecs.length && !T.records({ domains: ['rehab'], kinds: ['completion'], since: now - 7 * DAY }).length) gap('as_miss_completion', [T.citeRecord(planRecs[0])]);
  }
  if (T.can('academic') && isMinor(r) && !T.records({ domains: ['academic'], kinds: ['school'] }).length) gap('as_miss_school', [pid]);
  const appts = T.appointments().filter((a) => a.status === 'scheduled' && a.endAt < now);
  for (const a of appts) gap('as_miss_outcome', [T.citeAppt(a)], { title: a.title, at: a.startAt });
  const tasks = T.tasks();
  for (const t of tasks.filter((x) => isOpenTask(x) && !x.ownerId && x.status !== 'draft').slice(0, 4)) gap('as_miss_owner', [T.citeTask(t)], { title: t.title });
  for (const t of tasks.filter((x) => isOverdue(x, now)).slice(0, 4)) gap('as_miss_overdue', [T.citeTask(t)], { title: t.title, at: t.dueAt ?? now });
  if (T.can('team')) {
    const live = view.memberships.filter((m) => m.recipientId === r.id && isLive(m, now));
    if (!live.some((m) => m.authority !== 'none' && m.authorityVerified)) gap(isMinor(r) ? 'as_miss_guardian' : 'as_miss_authority', [pid]);
    for (const m of live.filter((x) => x.authority !== 'none' && !x.authorityVerified)) gap('as_miss_auth_pending', [pid], { who: userName(view, m.userId) });
  }
  const blocks: Block[] = [{ title: msg('as_b_missing'), lines, empty: msg('as_none_missing') }];
  return finish(c, 'missing', msg(lines.length ? 'as_h_missing' : 'as_h_missing_none', { name: firstName(r), n: lines.length }), blocks, [msg('as_missing_scope')], [
    { m: msg('sq_summary', { name: firstName(r) }), intent: 'summary', why: msg('why_after_missing') },
  ]);
}

function progress(c: Ctx): AssistantAnswer {
  const { T, now, view, r, q } = c;
  const days = windowDays(q, 30);
  const from = now - days * DAY;
  const s = seriesLines(c, from);
  const blocks: Block[] = [{ title: msg('as_b_measures', { days }), lines: s.lines, empty: msg('as_none_measures', { days }) }];
  const tasks = T.tasks().filter((t) => t.dueAt && t.dueAt >= from && t.dueAt <= now);
  const done = tasks.filter((t) => t.status === 'completed');
  if (tasks.length) blocks.push({ title: msg('as_b_plan_tasks'), lines: [{ m: msg('as_tasks_rate', { done: done.length, n: tasks.length, days }), cites: tasks.slice(0, 12).map((t) => T.citeTask(t)) }] });
  const ms = T.records({ kinds: ['milestone', 'achievement', 'assessment'], since: from });
  if (ms.length) blocks.push({ title: msg('as_b_milestones'), lines: ms.map((x) => ({ m: recLine(x, view), cites: [T.citeRecord(x)], tone: 'ok' as const })) });
  const notes = [msg('as_progress_note')];
  if (s.medical) notes.push(msg('as_for_doctor'));
  return finish(c, 'progress', msg(s.lines.length ? 'as_h_progress' : 'as_h_progress_none', { name: firstName(r), days }), blocks, notes, [
    { m: msg('sq_plan', { name: firstName(r) }), intent: 'plan', why: msg('why_after_progress') },
  ]);
}

function meds(c: Ctx): AssistantAnswer {
  const { T, now, view, r } = c;
  if (!T.can('medical')) return finish(c, 'meds', msg('as_h_section_no', { name: firstName(r), domain: 'medical' }), [], [], []);
  const list = T.medications();
  const today = dayKey(now);
  const logs = T.doseLogs(now - DAY);
  const blocks: Block[] = [
    {
      title: msg('as_b_meds'),
      lines: list.map((m) => ({
        m: msg(m.verification === 'verified' ? 'as_med' : 'as_med_unverified', { med: m.name, strength: m.strength || '', dose: m.dose || '—', times: m.times.join(', ') || '—', by: m.prescriber || '—' }),
        cites: [T.cite({ id: m.id, type: 'medication', recipientId: m.recipientId, domain: 'medical', title: m.name, at: m.updatedAt, by: m.authorId, source: m.source, verified: m.verification === 'verified' })],
        tone: m.verification === 'verified' ? undefined : ('info' as const),
      })),
      empty: msg('as_none_meds'),
    },
  ];
  const todayLines: Line[] = [];
  for (const m of list) {
    for (const s of doseSlots(m, logs, today)) {
      const time = slotTime(s.slot);
      todayLines.push({
        m: s.log ? msg('as_dose', { med: m.name, at: time, status: s.log.status, by: userName(view, s.log.by) }) : msg(time < now ? 'as_dose_unlogged' : 'as_dose_later', { med: m.name, at: time }),
        cites: [m.id, ...(s.log ? [T.cite({ id: s.log.id, type: 'dose', recipientId: s.log.recipientId, domain: 'medical', title: m.name, at: time, by: s.log.by })] : [])],
        tone: s.log?.status === 'missed' || (!s.log && time < now) ? 'warn' : undefined,
      });
    }
  }
  if (list.length) blocks.push({ title: msg('as_b_today'), lines: todayLines, empty: msg('as_none_today') });
  const refill = list.filter((m) => refillForecast(m, now).due);
  if (refill.length) blocks.push({ title: msg('as_b_refill'), lines: refill.map((m) => ({ m: msg('as_refill', { med: m.name, n: refillForecast(m, now).daysLeft ?? 0 }), cites: [m.id], tone: 'warn' as const })) });
  return finish(c, 'meds', msg('as_h_meds', { name: firstName(r), n: list.length }), blocks, [msg('as_not_logged'), msg('as_no_dosing')], [
    { m: msg('sq_summary', { name: firstName(r) }), intent: 'summary', why: msg('why_after_meds') },
  ]);
}

function allergies(c: Ctx): AssistantAnswer {
  const { T, r } = c;
  if (!T.can('medical')) return finish(c, 'allergies', msg('as_h_section_no', { name: firstName(r), domain: 'medical' }), [], [], []);
  const list = T.records({ domains: ['medical'], kinds: ['allergy'] });
  const restrictions = T.can('rehab') ? T.records({ domains: ['rehab'], kinds: ['restriction'] }) : [];
  const blocks: Block[] = [{ title: msg('as_b_allergies'), lines: [...list, ...restrictions].map((x) => ({ m: msg(x.verification === 'verified' ? 'as_allergy_v' : 'as_allergy', { title: x.title, text: quote(x.body || '—', 120) }), cites: [T.citeRecord(x)] })), empty: msg('as_none_allergies') }];
  return finish(c, 'allergies', msg(list.length ? 'as_h_allergies' : 'as_h_allergies_none', { name: firstName(r), n: list.length }), blocks, [], []);
}

function appointments(c: Ctx): AssistantAnswer {
  const { T, now, r } = c;
  const next = T.appointments().filter((a) => a.status === 'scheduled' && a.endAt >= now).slice(0, 5);
  const blocks: Block[] = [{ title: msg('as_b_coming_all'), lines: next.map((a) => ({ m: msg('as_appt_next', { title: a.title, at: a.startAt, place: a.location || a.withWhom }), cites: [T.citeAppt(a)] })), empty: msg('as_none_coming_all') }];
  return finish(
    c,
    'appointments',
    next.length ? msg('as_h_appts', { name: firstName(r), title: next[0].title, at: next[0].startAt }) : msg('as_h_appts_none', { name: firstName(r) }),
    blocks,
    [],
    next.length ? [{ m: msg('sq_brief', { title: next[0].title }), intent: 'appointment_brief', targetId: next[0].id, why: msg('why_next_appt', { at: next[0].startAt }) }] : [],
  );
}

function measure(c: Ctx): AssistantAnswer {
  const { T, now, r, q } = c;
  const n = N(q);
  const all = measureSeries(T.records(), r.id, 0, now);
  const wanted = all.filter((s) => {
    for (const [inQ, inTitle] of MEASURE_WORDS) if (inQ.test(n)) return inTitle.test(s.title);
    if (/pain|\sالم\s/.test(n)) return s.kind === 'pain';
    if (/mood|مزاج/.test(n)) return s.kind === 'checkin';
    if (/sleep|نوم/.test(n)) return s.kind === 'sleep';
    if (/stress|توتر/.test(n)) return s.kind === 'stress';
    if (/attendance|حضور/.test(n)) return s.kind === 'attendance';
    return true;
  });
  const lines: Line[] = wanted.map((s) => {
    const last = s.points[s.points.length - 1];
    const prev = s.points[s.points.length - 2];
    const label: string | Msg = s.kind === 'measurement' ? s.title : msg('as_kind', { Kind: s.kind });
    return {
      m: prev
        ? msg('as_latest_prev', { label, v: last.value ?? 0, unit: s.unit, at: last.observedAt, src: `@src_${last.source}`, p: prev.value ?? 0, at2: prev.observedAt })
        : msg('as_latest', { label, v: last.value ?? 0, unit: s.unit, at: last.observedAt, src: `@src_${last.source}` }),
      cites: [T.citeRecord(last), ...(prev ? [T.citeRecord(prev)] : [])],
    };
  });
  const medical = wanted.some((s) => s.domain === 'medical');
  return finish(c, 'measure', msg(lines.length ? 'as_h_measure' : 'as_h_measure_none', { name: firstName(r) }), [{ title: msg('as_b_latest'), lines, empty: msg('as_none_measure') }], medical ? [msg('as_for_doctor')] : [], [
    { m: msg('sq_progress', { name: firstName(r) }), intent: 'progress', why: msg('why_after_measure') },
  ]);
}

function team(c: Ctx): AssistantAnswer {
  const { T, now, view, r } = c;
  const people = T.team();
  const lines: Line[] = people.map((u) => {
    const m = view.memberships.find((x) => x.userId === u.id && x.recipientId === r.id && isLive(x, now));
    return {
      m: m && T.can('team') ? msg('as_member_rel', { name: u.name, role: u.role, rel: m.relationship }) : msg('as_member', { name: u.name, role: u.role }),
      cites: [`profile:${r.id}`],
    };
  });
  T.profile();
  return finish(c, 'team', msg('as_h_team', { name: firstName(r), n: people.length }), [{ title: msg('as_b_team'), lines, empty: msg('as_none_team') }], T.can('team') ? [] : [msg('as_team_limited')], []);
}

function tasksAnswer(c: Ctx): AssistantAnswer {
  const { T, now, view, r } = c;
  const open = T.tasks().filter((t) => isOpenTask(t) && t.kind !== 'coverage');
  const overdue = open.filter((t) => isOverdue(t, now));
  const soon = open.filter((t) => !isOverdue(t, now) && t.dueAt && t.dueAt < now + 7 * DAY).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const waiting = open.filter((t) => t.status === 'awaiting_approval');
  const blocks: Block[] = [
    { title: msg('as_b_overdue'), lines: overdue.map((t) => ({ m: msg('as_task_overdue', { title: t.title, at: t.dueAt ?? now, who: userName(view, t.ownerId) || '@as_nobody' }), cites: [T.citeTask(t)], tone: 'warn' as const })), empty: msg('as_none_overdue') },
    { title: msg('as_b_soon'), lines: soon.slice(0, 8).map((t) => ({ m: msg('as_task_due', { title: t.title, at: t.dueAt ?? now, who: userName(view, t.ownerId) || '@as_nobody' }), cites: [T.citeTask(t)] })), empty: msg('as_none_soon') },
  ];
  if (waiting.length) blocks.push({ title: msg('as_b_waiting'), lines: waiting.map((t) => ({ m: msg('as_task_waiting', { title: t.title }), cites: [T.citeTask(t)] })) });
  return finish(c, 'tasks', msg('as_h_tasks', { name: firstName(r), n: overdue.length, m: soon.length }), blocks, [], []);
}

function refuse(c: Ctx): AssistantAnswer {
  const { T, view, r, q, me } = c;
  const kind = refusalKind(q);
  const n = N(q);
  const psych = /depress|anxi|mood|psycholog|crisis|نفسي|اكتءاب|قلق/.test(n);
  const domain: Domain = psych ? 'wellbeing' : 'medical';
  const role: Role = psych ? 'psychologist' : 'doctor';
  const team = T.team();
  // When the viewer can't see who has which sections, suggest the professional anyway; SANAD checks their access when the request is created.
  const pros = team.filter((u) => u.role === role && (domainsOf(view, u.id, r.id, c.now) ?? [domain]).includes(domain));
  const can = T.can(domain) && me.role !== 'admin' && !!(membershipFor(view, me.id, r.id, c.now) || me.role === 'coordinator');
  const notes = [msg('as_refuse_why')];
  const draft: ReviewDraft | undefined = can
    ? { kind: 'review', recipientId: r.id, domain, ownerId: pros[0]?.id ?? null, ownerOptions: pros.map((u) => u.id), title: `Professional review: ${quote(c.req.question, 80)}`, notes: `Question raised by ${me.name}: “${quote(c.req.question, 400)}”`, question: quote(c.req.question, 400) }
    : undefined;
  if (!can) notes.push(msg('as_refuse_contact'));
  else if (!pros.length) notes.push(msg('as_refuse_no_pro', { roles: role }));
  return finish(c, 'refuse', msg(kind === 'dose' ? 'as_h_refuse_dose' : 'as_h_refuse_dx', { name: firstName(r), roles: role }), [], notes, [], draft, undefined, true);
}

function finish(c: Ctx, intent: Intent, headline: Msg, blocks: Block[], notes: Msg[], suggestions: Suggestion[], draft?: Draft, _days?: number, refused?: boolean): AssistantAnswer {
  const { T, view, r } = c;
  const scope = (view.access[r.id] ?? []).filter((d) => d !== 'team' && d !== 'wellbeing_notes');
  if (intent !== 'refuse') notes.push(msg('as_scope', { domains: scope.join(',') }));
  // Every cited id must be a source we registered (and so one the viewer may see).
  for (const b of blocks) for (const l of b.lines) l.cites = [...new Set(l.cites)].filter((id) => T.sources.has(id));
  return {
    intent,
    recipientId: r.id,
    headline,
    blocks,
    sources: [...T.sources.values()].sort((a, b) => b.at - a.at),
    notes,
    suggestions: suggestions.map((s) => ({ recipientId: r.id, ...s })),
    draft,
    refused,
    engine: 'rules',
    tools: T.used,
  };
}

function bare(intent: Intent, headline: Msg, extra: Partial<AssistantAnswer> = {}): AssistantAnswer {
  return { intent, recipientId: null, headline, blocks: [], sources: [], notes: [], suggestions: [], engine: 'rules', tools: [], ...extra };
}

// ---------------------------------------------------------------- entry point

export function assist(view: View, req: AssistRequest, now = Date.now(), budget = TOOL_BUDGET): AssistantAnswer {
  const q = String(req.question ?? '').slice(0, 600).trim();
  const me = view.users.find((u) => u.id === view.me) as User;
  // Safety checks run on the words themselves, so a button or a crafted request cannot skip them.
  const detected = detectIntent(q);
  const intent = detected === 'emergency' || detected === 'refuse' ? detected : req.intent ?? detected;

  if (intent === 'emergency') return bare('emergency', msg('as_h_emergency'), { emergency: true, notes: [msg('as_emergency_note')] });

  // Who is this about?
  const mine = view.recipients.filter((x) => !x.limited && view.access[x.id]);
  const named = mentionedPeople(view, q);
  let r: Recipient | undefined = req.recipientId ? view.recipients.find((x) => x.id === req.recipientId) : named[0];
  // Asked about someone by id who is not in this user's view at all: say no, never fall back to someone else.
  if (req.recipientId && !r) return bare('no_access', msg('as_h_no_access_anon'));
  if (r && (r.limited || !view.access[r.id])) return bare('no_access', msg('as_h_no_access', { name: r.name.split(' ')[0] }));
  if (!r && mine.length === 1 && (intent && intent !== 'legacy')) r = mine[0];

  // A person's name on its own ("Tell me about Fatima") means a summary of them.
  if (!intent && r && !req.recipientId && q.split(/\s+/).length <= 6 && !/san-?\s?\d/i.test(q)) return assist(view, { ...req, intent: 'summary', recipientId: r.id }, now, budget);
  if (!intent || intent === 'legacy') return bare('legacy', msg('as_h_legacy'), { legacy: ask(view, q, now) });
  if (!r) {
    if (intent === 'summary' || intent === 'tasks') return bare('legacy', msg('as_h_legacy'), { legacy: ask(view, q, now) });
    if (intent === 'refuse') return bare('refuse', msg('as_h_refuse_general'), { refused: true, notes: [msg('as_refuse_why')] });
    return bare('which_person', msg('as_h_which'), {
      suggestions: mine.slice(0, 8).map((p) => ({ m: msg('sq_person', { name: p.name }), intent, recipientId: p.id, why: msg('why_person') })),
    });
  }

  const T = new Tools(view, r.id, now, budget);
  const c: Ctx = { view, me, r, T, now, q, req };
  try {
    switch (intent) {
      case 'refuse':
        return refuse(c);
      case 'summary':
        return summary(c);
      case 'appointment_brief':
        return brief(c);
      case 'handover':
        return handover(c);
      case 'plan':
        return plan(c);
      case 'missing':
        return missing(c);
      case 'progress':
        return progress(c);
      case 'meds':
        return meds(c);
      case 'allergies':
        return allergies(c);
      case 'appointments':
        return appointments(c);
      case 'measure':
        return measure(c);
      case 'team':
        return team(c);
      case 'tasks':
        return tasksAnswer(c);
      default:
        return bare('legacy', msg('as_h_legacy'), { legacy: ask(view, q, now) });
    }
  } catch (e) {
    if (e instanceof BudgetSpent) {
      return { ...bare(intent, msg('as_h_partial', { name: firstName(r) })), recipientId: r.id, partial: true, sources: [...T.sources.values()], tools: T.used, notes: [msg('as_budget', { n: budget })] };
    }
    throw e;
  }
}

// ---------------------------------------------------------------- suggestions for the current page

export interface PageContext {
  recipientId?: string | null;
  tab?: string | null;
}

/** Suggestions for where the user is now, each with the reason it is shown. Built from the filtered view only. */
export function pageSuggestions(view: View, ctx: PageContext, now = Date.now()): Suggestion[] {
  const me = view.users.find((u) => u.id === view.me);
  if (!me || me.role === 'admin') return [];
  const people = view.recipients.filter((x) => !x.limited && view.access[x.id]);
  const out: Suggestion[] = [];
  const forPerson = (r: Recipient) => {
    const can = (d: Domain) => !!view.access[r.id]?.includes(d);
    const name = firstName(r);
    const next = view.appointments.filter((a) => a.recipientId === r.id && a.status === 'scheduled' && a.startAt > now && a.startAt < now + 3 * DAY).sort((a, b) => a.startAt - b.startAt)[0];
    if (next) out.push({ m: msg('sq_brief', { title: next.title }), intent: 'appointment_brief', recipientId: r.id, targetId: next.id, why: msg('why_next_appt', { at: next.startAt }) });
    const fresh = view.records.filter((x) => x.recipientId === r.id && !x.archived && x.createdAt >= now - 7 * DAY && x.authorId !== me.id).length;
    if (fresh) out.push({ m: msg('sq_summary', { name }), intent: 'summary', recipientId: r.id, why: msg('why_fresh', { n: fresh }) });
    const overdue = view.tasks.filter((t) => t.recipientId === r.id && isOverdue(t, now)).length;
    if (overdue) out.push({ m: msg('sq_tasks', { name }), intent: 'tasks', recipientId: r.id, why: msg('why_overdue', { n: overdue }) });
    if (ctx.tab === 'progress') out.unshift({ m: msg('sq_progress', { name }), intent: 'progress', recipientId: r.id, why: msg('why_tab_progress') });
    if (ctx.tab === 'plans') out.unshift({ m: msg('sq_plan', { name }), intent: 'plan', recipientId: r.id, why: msg('why_tab_plans') });
    if (!ctx.tab || ctx.tab === 'overview') out.push({ m: msg('sq_missing', { name }), intent: 'missing', recipientId: r.id, why: msg('why_profile') });
    if (['caregiver', 'family'].includes(me.role) && view.users.some((u) => u.id !== me.id && u.recipients.includes(r.id) && u.role !== 'coordinator'))
      out.push({ m: msg('sq_handover', { name }), intent: 'handover', recipientId: r.id, why: msg('why_handover') });
    if (can('medical') && ctx.tab === 'medical') out.unshift({ m: msg('sq_meds', { name }), intent: 'meds', recipientId: r.id, why: msg('why_tab_medical') });
  };
  const here = ctx.recipientId ? people.find((p) => p.id === ctx.recipientId) : undefined;
  if (here) forPerson(here);
  else for (const p of people.slice(0, 3)) forPerson(p);
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.intent}|${s.recipientId}|${s.targetId ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 6);
}

// ---------------------------------------------------------------- turning a confirmed draft into actions

export interface DraftStep {
  key: string;
  label: Msg;
  /** Builds the action once earlier steps have run (e.g. tasks need the new plan's id). */
  build: (created: Record<string, string>) => Action;
}

export interface PlanEdits {
  title: string;
  goal: string;
  domain: Domain;
  tasks: DraftTask[];
}

/**
 * The exact actions a confirmed draft performs. Each runs through the normal engine, with the
 * confirming user's own permissions; nothing here can do more than that user could by hand.
 */
export function draftSteps(d: Draft, edits: { plan?: PlanEdits; handover?: { toUserId: string; hours: number; note: string }; review?: { ownerId: string | null; title: string; notes: string }; brief?: { title: string; text: string } } = {}, now = Date.now()): DraftStep[] {
  if (d.kind === 'plan') {
    const p = edits.plan ?? { title: d.title, goal: d.goal, domain: d.domain, tasks: d.tasks };
    const steps: DraftStep[] = [{ key: 'plan', label: msg('st_plan', { title: p.title }), build: () => ({ type: 'add_plan', recipientId: d.recipientId, title: p.title, goal: p.goal, domain: p.domain }) }];
    for (const t of p.tasks.filter((x) => x.include)) {
      steps.push({
        key: t.key,
        label: msg(t.needsApproval ? 'st_task_approval' : 'st_task', { title: t.title }),
        build: (created) => ({
          type: 'add_task',
          recipientId: d.recipientId,
          task: { title: t.title, notes: t.notes, domain: p.domain, ownerId: t.ownerId, priority: t.priority, dueAt: t.dueAt, recurrence: t.recurrence, dependsOn: [], needsApproval: t.needsApproval, evidenceRequired: false, planId: created.plan ?? null },
        }),
      });
    }
    return steps;
  }
  if (d.kind === 'handover') {
    const h = edits.handover ?? { toUserId: d.toUserId ?? '', hours: d.hours, note: '' };
    return [{ key: 'handover', label: msg('st_handover'), build: () => ({ type: 'create_handover', recipientId: d.recipientId, toUserId: h.toUserId, note: h.note, hours: h.hours }) }];
  }
  if (d.kind === 'review') {
    const v = edits.review ?? { ownerId: d.ownerId, title: d.title, notes: d.notes };
    return [
      {
        key: 'review',
        label: msg('st_review'),
        build: () => ({ type: 'add_task', recipientId: d.recipientId, task: { title: v.title, notes: v.notes, domain: d.domain, ownerId: v.ownerId, priority: 'high', dueAt: now + 2 * DAY, recurrence: 'none', dependsOn: [], needsApproval: false, evidenceRequired: false, planId: null } }),
      },
    ];
  }
  const b = edits.brief ?? { title: 'Appointment brief', text: '' };
  return [
    {
      key: 'brief',
      label: msg('st_brief'),
      build: () => ({ type: 'add_document', recipientId: d.recipientId, domain: d.domain, title: b.title, description: 'Prepared by the SANAD assistant from the records listed in it; reviewed and saved by a team member.', fileName: 'appointment-brief.txt', mime: 'text/plain', size: 0, dataUrl: `data:text/plain;base64,${utf8ToBase64(b.text)}`, aiDraft: true }),
    },
  ];
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Where a source opens in the app. */
export function sourceLink(s: SourceRef): string {
  if (s.type === 'problem') return `/app/challenges/${s.id}`;
  const base = `/app/people/${s.recipientId}`;
  const byType: Partial<Record<SourceType, string>> = { task: 'plans', plan: 'plans', appointment: 'appointments', document: 'documents', medication: 'medical', dose: 'medical' };
  const d: string = s.domain;
  const tab = s.type === 'profile' ? null : byType[s.type] ?? (d === 'wellbeing_notes' ? 'wellbeing' : d === 'overview' ? null : d);
  return tab ? `${base}?tab=${tab}` : base;
}

export { kindOf };
