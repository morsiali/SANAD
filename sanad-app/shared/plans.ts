// Shared rules and helpers for care plans, tasks and appointments (used by the engine and the screens).
import type { Appointment, AppointmentKind, CareTask, Domain, Priority, Recurrence, State, TaskStatus } from './types';

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  draft: 'Draft',
  awaiting_approval: 'Awaiting approval',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
  failed: 'Could not be done',
};

/** The main path; blocked, cancelled and failed sit outside it. */
export const TASK_FLOW: TaskStatus[] = ['draft', 'awaiting_approval', 'scheduled', 'in_progress', 'completed'];
export const OPEN_STATUSES: TaskStatus[] = ['draft', 'awaiting_approval', 'scheduled', 'in_progress', 'blocked'];
export const isOpenTask = (t: Pick<CareTask, 'status'>) => OPEN_STATUSES.includes(t.status);

export const RECURRENCE_LABEL: Record<Recurrence, string> = { none: 'Does not repeat', daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };
const DAY = 86_400_000;
export function nextOccurrence(at: number, r: Recurrence): number {
  if (r === 'daily') return at + DAY;
  if (r === 'weekly') return at + 7 * DAY;
  if (r === 'monthly') {
    const d = new Date(at);
    d.setMonth(d.getMonth() + 1);
    return d.getTime();
  }
  return at;
}

/** Escalation rule: an open task this many hours past its due time is escalated once. */
export const ESCALATE_AFTER_HOURS: Record<Priority, number> = { urgent: 2, high: 12, medium: 48, low: 96 };
/** One reminder per task occurrence, this many hours before it is due. */
export const REMIND_BEFORE_HOURS = 3;

export const APPOINTMENT_KIND_LABEL: Record<AppointmentKind, string> = {
  medical: 'Medical',
  therapy: 'Therapy',
  physio: 'Physiotherapy',
  school: 'School',
  activity: 'Activity',
  other: 'Other',
};
/** Where an appointment's details live by default (who can see it). */
export const APPOINTMENT_DOMAIN: Record<AppointmentKind, Domain> = {
  medical: 'medical',
  therapy: 'wellbeing',
  physio: 'rehab',
  school: 'academic',
  activity: 'activity',
  other: 'overview',
};

/** Suggested preparation steps; people edit the list before saving. */
export const PREP_TEMPLATES: Record<AppointmentKind, string[]> = {
  medical: ['Write down questions and changes since the last visit', 'Bring the current medicine list', 'Bring the insurance card and Emirates ID', 'Arrange transport'],
  therapy: ['Note anything that went well or was hard this week', 'Arrange transport'],
  physio: ['Log this week’s exercises and any pain', 'Wear comfortable clothes', 'Arrange transport'],
  school: ['Review the education plan and recent reports', 'Write down questions for the teacher'],
  activity: ['Pack kit and water', 'Check any recorded activity restrictions'],
  other: ['Arrange transport'],
};

export interface Conflict {
  type: 'appointment' | 'cover';
  id: string;
  title: string;
  recipientId: string;
  from: number;
  to: number;
}

const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;

/** Commitments that overlap a time window for one person: appointments they attend and cover they agreed to. */
export function conflictsFor(state: Pick<State, 'appointments' | 'tasks'>, userId: string, from: number, to: number, exclude: string[] = []): Conflict[] {
  const out: Conflict[] = [];
  for (const a of state.appointments) {
    if (exclude.includes(a.id) || a.status !== 'scheduled' || !a.attendeeIds.includes(userId)) continue;
    if (overlaps(from, to, a.startAt, a.endAt)) out.push({ type: 'appointment', id: a.id, title: a.title, recipientId: a.recipientId, from: a.startAt, to: a.endAt });
  }
  for (const t of state.tasks) {
    if (exclude.includes(t.id) || t.kind !== 'coverage' || t.ownerId !== userId || !isOpenTask(t) || !t.coverFrom || !t.coverTo) continue;
    if (overlaps(from, to, t.coverFrom, t.coverTo)) out.push({ type: 'cover', id: t.id, title: t.title, recipientId: t.recipientId, from: t.coverFrom, to: t.coverTo });
  }
  return out;
}

/** Tasks this one is waiting on (dependencies that are not completed yet). */
export const waitingOn = (state: Pick<State, 'tasks'>, t: CareTask) => t.dependsOn.map((id) => state.tasks.find((x) => x.id === id)).filter((x): x is CareTask => !!x && x.status !== 'completed' && x.status !== 'cancelled');

export const isOverdue = (t: CareTask, now: number) => isOpenTask(t) && t.status !== 'draft' && !!t.dueAt && t.dueAt < now;

export const apptEnded = (a: Appointment, now: number) => a.endAt < now;

/** Files SANAD accepts, checked by content as well as by name. */
export const DOC_TYPES: Record<string, string> = { 'application/pdf': 'PDF', 'image/png': 'PNG image', 'image/jpeg': 'JPEG image', 'image/webp': 'WebP image', 'text/plain': 'Text file' };
export const DOC_MAX_INLINE = 400_000; // bytes, browser demo
export const DOC_MAX_SERVER = 5_000_000; // bytes, server

/** Checks the first bytes match the declared type (a renamed file is refused). */
export function sniffMatches(mime: string, bytes: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (mime === 'application/pdf') return starts(0x25, 0x50, 0x44, 0x46);
  if (mime === 'image/png') return starts(0x89, 0x50, 0x4e, 0x47);
  if (mime === 'image/jpeg') return starts(0xff, 0xd8, 0xff);
  if (mime === 'image/webp') return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45;
  if (mime === 'text/plain') {
    for (let i = 0; i < Math.min(bytes.length, 2048); i++) if (bytes[i] === 0) return false;
    return true;
  }
  return false;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
