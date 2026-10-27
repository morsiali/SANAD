// Care plans, tasks, handovers, cover requests, appointments and documents.
// Every rule is enforced here, so it holds on the server and in the browser alike.
import type { Action, Appointment, AppointmentInput, CareDocument, CareTask, Domain, HandoverItem, Msg, Recipient, State, TaskInput, User } from './types';
import { PRIORITIES } from './types';
import { authorityHolders, domainsFor, hasAuthority, isOrgStaff, membershipFor } from './access';
import { DOC_MAX_INLINE, DOC_TYPES, ESCALATE_AFTER_HOURS, REMIND_BEFORE_HOURS, base64ToBytes, conflictsFor, isOpenTask, nextOccurrence, sniffMatches, waitingOn } from './plans';
import { canSee, coordinators, fail, nextId, notify, requireText } from './engine';
import { audit, requestApproval, type CareCtx, type CareResult } from './care-engine';
import { msg } from './messages';
import { slotTime } from './records';

const H = 3_600_000;
const DAY = 24 * H;

const recipientOf = (state: State, id: string): Recipient => {
  const r = state.recipients.find((x) => x.id === id);
  if (!r) throw fail('e_who', undefined, 404);
  return r;
};
const can = (state: State, userId: string, recipientId: string, d: Domain, now: number) => domainsFor(state, userId, recipientId, now).includes(d);
const nameOf = (state: State, id: string) => state.users.find((u) => u.id === id)?.name ?? 'Someone';

/** People who work in a person's care: on the care team, or a coordinator of their organisation. Admins manage access only. */
function mayCreate(state: State, me: User, r: Recipient, d: Domain, now: number) {
  if (me.role === 'admin') throw fail('e_admin_care', undefined, 403);
  if (!can(state, me.id, r.id, d, now)) throw fail('e_no_access', { domain: d }, 403);
  if (!membershipFor(state, me.id, r.id, now) && !(isOrgStaff(me) && me.orgId === r.orgId)) throw fail('e_no_access', { domain: d }, 403);
}

function checkOwner(state: State, ownerId: string | null, r: Recipient, d: Domain, now: number) {
  if (!ownerId) return;
  const u = state.users.find((x) => x.id === ownerId);
  if (!u || u.role === 'admin' || !can(state, ownerId, r.id, d, now)) throw fail('e_owner_access', { name: u?.name ?? '?' }, 400);
}

function getTask(state: State, me: User, id: string, now: number): CareTask {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || !canSeeTask(state, me.id, t, now)) throw fail('e_task', undefined, 404);
  return t;
}

export function canSeeTask(state: State, userId: string, t: CareTask, now = Date.now()): boolean {
  if (t.kind === 'handover') return t.ownerId === userId || t.createdBy === userId;
  return can(state, userId, t.recipientId, t.domain, now);
}

const canManage = (state: State, me: User, t: { createdBy: string; recipientId: string; ownerId?: string | null }, now: number) => {
  if (t.createdBy === me.id || t.ownerId === me.id || hasAuthority(state, me.id, t.recipientId, now)) return true;
  const r = state.recipients.find((x) => x.id === t.recipientId);
  return me.role === 'coordinator' && !!r && r.orgId === me.orgId;
};

function event(state: State, t: CareTask, by: string, m: Msg, now: number) {
  t.events.push({ at: now, by, m });
  t.updatedAt = now;
  t.version += 1;
}

/** Notify the people involved in a task, never someone who cannot see it. */
function tell(state: State, t: CareTask, ids: (string | null | undefined)[], m: Msg, now: number, exclude?: string) {
  notify(state, ids.filter((id) => !!id && canSeeTask(state, id, t, now)), null, m, 'update', now, exclude);
}

function validateTask(state: State, me: User, r: Recipient, i: TaskInput, now: number, selfId?: string) {
  const title = requireText(i.title, 'lbl_title', 3).slice(0, 140);
  const domain = i.domain;
  mayCreate(state, me, r, domain, now);
  checkOwner(state, i.ownerId, r, domain, now);
  if (!PRIORITIES.includes(i.priority)) throw fail('e_task_priority');
  if (i.dueAt !== null && (!Number.isFinite(i.dueAt) || i.dueAt < now - 30 * DAY || i.dueAt > now + 730 * DAY)) throw fail('e_due');
  if (!['none', 'daily', 'weekly', 'monthly'].includes(i.recurrence)) throw fail('e_recurrence');
  if (i.recurrence !== 'none' && !i.dueAt) throw fail('e_recurrence_due');
  const deps = [...new Set(i.dependsOn ?? [])];
  for (const d of deps) {
    const dep = state.tasks.find((x) => x.id === d);
    if (!dep || dep.recipientId !== r.id || !canSeeTask(state, me.id, dep, now) || d === selfId) throw fail('e_dependency');
  }
  // A dependency that leads back to this task would deadlock both.
  if (selfId) {
    const seen = new Set<string>();
    const walk = (id: string): boolean => {
      if (id === selfId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return (state.tasks.find((x) => x.id === id)?.dependsOn ?? []).some(walk);
    };
    if (deps.some(walk)) throw fail('e_dependency_loop');
  }
  if (i.planId) {
    const p = state.plans.find((x) => x.id === i.planId);
    if (!p || p.recipientId !== r.id || !can(state, me.id, r.id, p.domain, now)) throw fail('e_plan', undefined, 404);
  }
  return { title, notes: (i.notes ?? '').trim().slice(0, 2000), deps };
}

function approversFor(state: State, me: User, r: Recipient, now: number) {
  if (hasAuthority(state, me.id, r.id, now)) return [];
  return authorityHolders(state, r.id, now).map((m) => m.userId).filter((id) => id !== me.id);
}

/** Draft → awaiting approval (when asked and someone holds authority) or straight to scheduled. */
function submit(state: State, me: User, t: CareTask, r: Recipient, now: number, ctx: CareCtx): Msg {
  const approvers = t.needsApproval && !ctx.approvedBy ? approversFor(state, me, r, now).filter((id) => can(state, id, r.id, t.domain, now)) : [];
  if (approvers.length) {
    t.status = 'awaiting_approval';
    event(state, t, me.id, msg('ev_task_submitted'), now);
    const a = requestApproval(state, me, r, { type: 'schedule_task', taskId: t.id, baseVersion: t.version }, approvers, msg('s_task', { title: t.title }), t.notes, now);
    t.approvalId = a.id;
    return msg('m_task_awaiting', { names: approvers.map((id) => nameOf(state, id)).join(', ') });
  }
  t.status = 'scheduled';
  event(state, t, me.id, msg('ev_task_scheduled'), now);
  if (t.ownerId && t.ownerId !== me.id) tell(state, t, [t.ownerId], msg('n_task_assigned', { name: me.name, title: t.title, recipient: r.name }), now);
  return msg('m_task_scheduled', { title: t.title });
}

function cancelPendingApproval(state: State, t: CareTask) {
  const a = t.approvalId ? state.approvals.find((x) => x.id === t.approvalId) : undefined;
  if (a && a.status === 'pending') a.status = 'cancelled';
}

const fmtTime = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function checkConflicts(state: State, people: string[], from: number, to: number, exclude: string[], allow: boolean | undefined) {
  if (allow) return;
  for (const id of people) {
    const c = conflictsFor(state, id, from, to, exclude);
    if (c.length) throw fail('e_conflict', { name: nameOf(state, id), title: c[0].title, when: fmtTime(c[0].from) }, 409);
  }
}

function validateAppt(state: State, me: User, r: Recipient, a: AppointmentInput, now: number) {
  const title = requireText(a.title, 'lbl_title', 3).slice(0, 140);
  mayCreate(state, me, r, a.domain, now);
  if (!Number.isFinite(a.startAt) || !Number.isFinite(a.endAt) || a.endAt <= a.startAt) throw fail('e_appt_time');
  if (a.endAt - a.startAt > 12 * H) throw fail('e_appt_long');
  if (a.startAt < now - 30 * DAY || a.startAt > now + 730 * DAY) throw fail('e_due');
  const attendees = [...new Set(a.attendeeIds ?? [])];
  for (const id of attendees) checkOwner(state, id, r, a.domain, now);
  return { title, attendees };
}

/** What an approval for a plan action depends on (null when the action is not a plan action). */
export function planVersion(state: State, action: Action): string | null {
  if (action.type !== 'schedule_task') return null;
  const t = state.tasks.find((x) => x.id === action.taskId);
  return t ? `${t.version}:${t.status}` : 'missing';
}

export function applyPlans(state: State, me: User, action: Action, now: number, ctx: CareCtx = {}): CareResult | null {
  switch (action.type) {
    // ------------------------------------------------------------ plans
    case 'add_plan': {
      const r = recipientOf(state, action.recipientId);
      mayCreate(state, me, r, action.domain, now);
      const title = requireText(action.title, 'lbl_title', 3).slice(0, 140);
      const p = { id: nextId(state, 'c'), recipientId: r.id, title, goal: (action.goal ?? '').trim().slice(0, 1000), domain: action.domain, createdBy: me.id, createdAt: now, updatedAt: now, status: 'active' as const };
      state.plans.push(p);
      audit(state, me.id, r.id, p.domain, 'plan_added', msg('au_plan', { actor: me.name, title }), now, p.id);
      return { m: msg('m_plan_added', { title }), createdId: p.id };
    }
    case 'update_plan': {
      const p = state.plans.find((x) => x.id === action.planId);
      if (!p || !can(state, me.id, p.recipientId, p.domain, now)) throw fail('e_plan', undefined, 404);
      if (!canManage(state, me, p, now)) throw fail('e_task_manage', undefined, 403);
      p.title = requireText(action.title, 'lbl_title', 3).slice(0, 140);
      p.goal = (action.goal ?? '').trim().slice(0, 1000);
      if (['active', 'completed', 'archived'].includes(action.status)) p.status = action.status;
      p.updatedAt = now;
      audit(state, me.id, p.recipientId, p.domain, 'plan_updated', msg('au_plan_updated', { actor: me.name, title: p.title }), now, p.id);
      return { m: msg('m_saved') };
    }

    // ------------------------------------------------------------ tasks
    case 'add_task': {
      const r = recipientOf(state, action.recipientId);
      const i = action.task;
      const { title, notes, deps } = validateTask(state, me, r, i, now);
      // The same open task for the same person and time would only produce duplicate reminders.
      const dup = state.tasks.find((t) => t.recipientId === r.id && isOpenTask(t) && t.title.toLowerCase() === title.toLowerCase() && (t.dueAt === i.dueAt || (!!t.dueAt && !!i.dueAt && Math.abs(t.dueAt - i.dueAt) < H)));
      if (dup) throw fail('e_duplicate_task', { title }, 409);
      if (i.parentId) {
        const parent = state.tasks.find((x) => x.id === i.parentId);
        if (!parent || parent.recipientId !== r.id || !canSeeTask(state, me.id, parent, now)) throw fail('e_task', undefined, 404);
      }
      const id = nextId(state, 't');
      const t: CareTask = {
        id,
        recipientId: r.id,
        planId: i.planId ?? null,
        parentId: i.parentId ?? null,
        appointmentId: null,
        kind: 'task',
        title,
        notes,
        domain: i.domain,
        ownerId: i.ownerId,
        status: 'draft',
        priority: i.priority,
        dueAt: i.dueAt,
        recurrence: i.recurrence,
        seriesId: id,
        dependsOn: deps,
        needsApproval: !!i.needsApproval,
        evidenceRequired: !!i.evidenceRequired,
        comments: [],
        events: [],
        createdBy: me.id,
        createdAt: now,
        updatedAt: now,
        version: 0,
      };
      state.tasks.push(t);
      event(state, t, me.id, msg('ev_task_created'), now);
      audit(state, me.id, r.id, t.domain, 'task_added', msg('au_task', { actor: me.name, title }), now, id);
      const m = action.draft ? msg('m_task_draft', { title }) : submit(state, me, t, r, now, ctx);
      return { m, createdId: id };
    }

    case 'edit_task': {
      const t = getTask(state, me, action.taskId, now);
      if (!canManage(state, me, t, now)) throw fail('e_task_manage', undefined, 403);
      if (!['draft', 'awaiting_approval', 'scheduled', 'blocked'].includes(t.status) || t.kind !== 'task') throw fail('e_task_locked', { status: t.status }, 409);
      if (action.baseVersion !== t.version) throw fail('e_stale', undefined, 409);
      const r = recipientOf(state, t.recipientId);
      const i = action.task;
      const { title, notes, deps } = validateTask(state, me, r, i, now, t.id);
      const before = JSON.stringify([t.title, t.notes, t.domain, t.ownerId, t.priority, t.dueAt, t.recurrence, t.dependsOn, t.needsApproval]);
      Object.assign(t, { title, notes, domain: i.domain, ownerId: i.ownerId, priority: i.priority, dueAt: i.dueAt, recurrence: i.recurrence, dependsOn: deps, needsApproval: !!i.needsApproval, evidenceRequired: !!i.evidenceRequired, planId: i.planId ?? t.planId, remindedAt: undefined, escalatedAt: undefined });
      const changed = before !== JSON.stringify([t.title, t.notes, t.domain, t.ownerId, t.priority, t.dueAt, t.recurrence, t.dependsOn, t.needsApproval]);
      if (!changed) return { m: msg('m_no_change') };
      event(state, t, me.id, msg('ev_task_edited'), now);
      audit(state, me.id, t.recipientId, t.domain, 'task_edited', msg('au_task_edited', { actor: me.name, title }), now, t.id);
      // Material change while waiting for approval: the old approval no longer applies.
      if (t.status === 'awaiting_approval') {
        cancelPendingApproval(state, t);
        return { m: submit(state, me, t, r, now, ctx) };
      }
      return { m: msg('m_saved') };
    }

    case 'submit_task': {
      const t = getTask(state, me, action.taskId, now);
      if (!canManage(state, me, t, now)) throw fail('e_task_manage', undefined, 403);
      if (t.status !== 'draft') throw fail('e_task_locked', { status: t.status }, 409);
      return { m: submit(state, me, t, recipientOf(state, t.recipientId), now, ctx) };
    }

    case 'schedule_task': {
      const t = state.tasks.find((x) => x.id === action.taskId);
      if (!t) throw fail('e_task', undefined, 404);
      // Runs from an approval, or directly by someone holding authority for the person.
      const by = ctx.approvedBy ?? (hasAuthority(state, me.id, t.recipientId, now) ? me.id : null);
      if (!by) throw fail('e_approval_not_yours', undefined, 403);
      if (t.status !== 'awaiting_approval' || action.baseVersion !== t.version) throw fail('e_approval_stale', undefined, 409);
      t.status = 'scheduled';
      // Scheduled directly by the guardian: the pending request is settled by that decision.
      const pending = !ctx.approvedBy && t.approvalId ? state.approvals.find((x) => x.id === t.approvalId && x.status === 'pending') : undefined;
      if (pending) Object.assign(pending, { status: 'executed', decidedBy: by, decidedAt: now });
      event(state, t, by, msg('ev_task_approved', { name: nameOf(state, by) }), now);
      tell(state, t, [t.ownerId, t.createdBy], msg('n_task_approved', { name: nameOf(state, by), title: t.title }), now, by);
      audit(state, by, t.recipientId, t.domain, 'task_approved', msg('au_task_approved', { actor: nameOf(state, by), title: t.title }), now, t.id);
      return { m: msg('m_task_scheduled', { title: t.title }) };
    }

    case 'task_status': {
      const t = getTask(state, me, action.taskId, now);
      const r = recipientOf(state, t.recipientId);
      const reason = (action.reason ?? '').trim().slice(0, 500);
      const isOwner = t.ownerId === me.id || (!t.ownerId && can(state, me.id, t.recipientId, t.domain, now) && me.role !== 'admin');
      const s = action.status;
      if (s === 'in_progress') {
        if (!isOwner) throw fail('e_task_owner', undefined, 403);
        if (t.status !== 'scheduled') throw fail('e_task_locked', { status: t.status }, 409);
        const waits = waitingOn(state, t);
        if (waits.length) throw fail('e_waiting_on', { title: waits[0].title }, 409);
        if (!t.ownerId) t.ownerId = me.id;
        t.status = 'in_progress';
        event(state, t, me.id, msg('ev_task_started'), now);
      } else if (s === 'completed') {
        if (!isOwner && !hasAuthority(state, me.id, t.recipientId, now)) throw fail('e_task_owner', undefined, 403);
        if (t.status !== 'scheduled' && t.status !== 'in_progress') throw fail('e_task_locked', { status: t.status }, 409);
        const waits = waitingOn(state, t);
        if (waits.length) throw fail('e_waiting_on', { title: waits[0].title }, 409);
        const evidence = (action.evidence ?? '').trim().slice(0, 1000);
        if (action.evidenceDocId) {
          const d = state.documents.find((x) => x.id === action.evidenceDocId);
          if (!d || d.recipientId !== t.recipientId || !can(state, me.id, d.recipientId, d.domain, now)) throw fail('e_document', undefined, 404);
          t.evidenceDocId = d.id;
        }
        if (t.evidenceRequired && evidence.length < 3 && !t.evidenceDocId) throw fail('e_evidence_needed');
        if (!t.ownerId) t.ownerId = me.id;
        t.evidence = evidence || undefined;
        t.status = 'completed';
        t.completedAt = now;
        event(state, t, me.id, msg('ev_task_completed'), now);
        // Recurring: create the next occurrence once (never two open occurrences of a series).
        if (t.recurrence !== 'none' && t.dueAt && !state.tasks.some((x) => x.seriesId === t.seriesId && x.id !== t.id && isOpenTask(x))) {
          let due = nextOccurrence(t.dueAt, t.recurrence);
          while (due < now - H) due = nextOccurrence(due, t.recurrence);
          const id = nextId(state, 't');
          state.tasks.push({ ...JSON.parse(JSON.stringify(t)), id, status: 'scheduled', dueAt: due, comments: [], events: [{ at: now, by: 'system', m: msg('ev_task_next') }], createdAt: now, updatedAt: now, completedAt: undefined, evidence: undefined, evidenceDocId: undefined, remindedAt: undefined, escalatedAt: undefined, version: 1, approvalId: undefined, statusReason: undefined });
        }
      } else if (s === 'blocked' || s === 'failed') {
        if (!isOwner && !canManage(state, me, t, now)) throw fail('e_task_owner', undefined, 403);
        if (t.status !== 'scheduled' && t.status !== 'in_progress') throw fail('e_task_locked', { status: t.status }, 409);
        if (reason.length < 3) throw fail('e_reason_needed');
        if (s === 'blocked') t.resumeStatus = t.status;
        t.status = s;
        t.statusReason = reason;
        event(state, t, me.id, msg(s === 'blocked' ? 'ev_task_blocked' : 'ev_task_failed', { reason }), now);
      } else if (s === 'resume') {
        if (t.status !== 'blocked') throw fail('e_task_locked', { status: t.status }, 409);
        if (!isOwner && !canManage(state, me, t, now)) throw fail('e_task_owner', undefined, 403);
        t.status = t.resumeStatus ?? 'scheduled';
        t.statusReason = undefined;
        event(state, t, me.id, msg('ev_task_resumed'), now);
      } else if (s === 'cancelled') {
        if (!canManage(state, me, t, now)) throw fail('e_task_manage', undefined, 403);
        if (!isOpenTask(t)) throw fail('e_task_locked', { status: t.status }, 409);
        if (reason.length < 3) throw fail('e_reason_needed');
        cancelPendingApproval(state, t);
        t.status = 'cancelled';
        t.statusReason = reason;
        event(state, t, me.id, msg('ev_task_cancelled', { reason }), now);
      } else throw fail('e_task_locked', { status: String(s) }, 400);
      tell(state, t, [t.ownerId, t.createdBy], msg('n_task_status', { name: me.name, title: t.title, status: t.status, recipient: r.name }), now, me.id);
      audit(state, me.id, t.recipientId, t.domain, 'task_status', msg('au_task_status', { actor: me.name, title: t.title, status: t.status }), now, t.id);
      return { m: msg('m_task_status', { title: t.title, status: t.status }) };
    }

    case 'task_comment': {
      const t = getTask(state, me, action.taskId, now);
      const text = requireText(action.text, 'lbl_comment', 1).slice(0, 2000);
      t.comments.push({ id: nextId(state, 'x'), authorId: me.id, text, at: now });
      t.updatedAt = now;
      tell(state, t, [t.ownerId, t.createdBy, ...t.comments.map((c) => c.authorId)], msg('n_task_comment', { name: me.name, title: t.title }), now, me.id);
      return { m: msg('m_commented') };
    }

    // ------------------------------------------------------------ handover
    case 'create_handover': {
      const r = recipientOf(state, action.recipientId);
      if (!membershipFor(state, me.id, r.id, now) && !(me.role === 'coordinator' && me.orgId === r.orgId)) throw fail('e_no_access', { domain: 'overview' }, 403);
      const to = state.users.find((u) => u.id === action.toUserId);
      if (!to || to.id === me.id || !membershipFor(state, to.id, r.id, now)) throw fail('e_handover_to');
      const hours = Math.min(72, Math.max(4, Math.round(Number(action.hours) || 24)));
      const since = now - hours * H;
      // Only what both people are allowed to see goes into a handover.
      const both = (d: Domain) => can(state, me.id, r.id, d, now) && can(state, to.id, r.id, d, now);
      const items: HandoverItem[] = [];
      for (const t of state.tasks) {
        if (t.recipientId !== r.id || t.kind === 'handover' || !both(t.domain)) continue;
        if (t.status === 'completed' && (t.completedAt ?? 0) >= since) items.push({ type: 'task', id: t.id, title: t.title, at: t.completedAt!, state: 'completed' });
        else if (isOpenTask(t) && t.status !== 'draft' && (!t.dueAt || t.dueAt < now + DAY)) items.push({ type: 'task', id: t.id, title: t.title, at: t.dueAt ?? t.updatedAt, state: t.status });
      }
      for (const x of state.records) if (x.recipientId === r.id && !x.archived && x.createdAt >= since && both(x.domain)) items.push({ type: 'record', id: x.id, title: x.title, at: x.observedAt, state: x.kind });
      if (both('medical')) {
        for (const l of state.doseLogs) {
          if (l.recipientId !== r.id || l.at < since) continue;
          const med = state.medications.find((m) => m.id === l.medicationId);
          items.push({ type: 'dose', id: l.id, title: med?.name ?? '', at: slotTime(l.slot), state: l.status });
        }
      }
      for (const a of state.appointments) if (a.recipientId === r.id && a.status === 'scheduled' && a.startAt >= now && a.startAt < now + 2 * DAY && both(a.domain)) items.push({ type: 'appointment', id: a.id, title: a.title, at: a.startAt, state: 'scheduled' });
      for (const c of state.challenges) if (c.recipientId === r.id && c.stage !== 'verified' && c.stage !== 'resolved' && canSee(me, c, state.recipients) && canSee(to, c, state.recipients)) items.push({ type: 'problem', id: c.id, title: c.title, at: c.updatedAt, state: c.stage });
      items.sort((a, b) => b.at - a.at);
      const id = nextId(state, 't');
      const t: CareTask = {
        id,
        recipientId: r.id,
        planId: null,
        parentId: null,
        appointmentId: null,
        kind: 'handover',
        title: `Handover from ${me.name}`,
        notes: (action.note ?? '').trim().slice(0, 2000),
        domain: 'overview',
        ownerId: to.id,
        status: 'scheduled',
        priority: 'medium',
        dueAt: now + 4 * H,
        recurrence: 'none',
        seriesId: id,
        dependsOn: [],
        needsApproval: false,
        evidenceRequired: false,
        comments: [],
        events: [{ at: now, by: me.id, m: msg('ev_handover', { hours }) }],
        createdBy: me.id,
        createdAt: now,
        updatedAt: now,
        version: 1,
        handover: { fromId: me.id, items: items.slice(0, 60) },
      };
      state.tasks.push(t);
      notify(state, [to.id], null, msg('n_handover', { name: me.name, recipient: r.name, n: t.handover!.items.length }), 'assigned', now);
      audit(state, me.id, r.id, 'overview', 'handover', msg('au_handover', { actor: me.name, name: to.name }), now, id);
      return { m: msg('m_handover', { name: to.name, n: t.handover!.items.length }), createdId: id };
    }

    // ------------------------------------------------------------ cover requests
    case 'request_cover': {
      const r = recipientOf(state, action.recipientId);
      mayCreate(state, me, r, action.domain, now);
      if (!Number.isFinite(action.from) || !Number.isFinite(action.to) || action.to <= action.from || action.to - action.from > 7 * DAY || action.to < now) throw fail('e_cover_time');
      const reason = requireText(action.reason, 'lbl_reason', 3).slice(0, 500);
      const id = nextId(state, 't');
      const t: CareTask = {
        id,
        recipientId: r.id,
        planId: null,
        parentId: null,
        appointmentId: null,
        kind: 'coverage',
        title: 'Cover needed',
        notes: reason,
        domain: action.domain,
        ownerId: null,
        status: 'scheduled',
        priority: action.from - now < DAY ? 'high' : 'medium',
        dueAt: action.from,
        recurrence: 'none',
        seriesId: id,
        dependsOn: [],
        needsApproval: false,
        evidenceRequired: false,
        comments: [],
        events: [{ at: now, by: me.id, m: msg('ev_cover_requested') }],
        createdBy: me.id,
        createdAt: now,
        updatedAt: now,
        version: 1,
        coverFrom: action.from,
        coverTo: action.to,
      };
      state.tasks.push(t);
      const helpers = state.users.filter((u) => u.id !== me.id && (u.role === 'caregiver' || u.role === 'family') && membershipFor(state, u.id, r.id, now)).map((u) => u.id);
      const coords = action.domain === 'overview' ? coordinators(state).filter((id) => state.users.find((u) => u.id === id)?.orgId === r.orgId) : [];
      tell(state, t, [...helpers, ...coords], msg('n_cover_needed', { name: me.name, recipient: r.name, when: fmtTime(action.from) }), now, me.id);
      audit(state, me.id, r.id, t.domain, 'cover_requested', msg('au_cover', { actor: me.name, when: fmtTime(action.from) }), now, id);
      return { m: msg('m_cover_requested'), createdId: id };
    }

    case 'offer_cover': {
      const t = getTask(state, me, action.taskId, now);
      if (t.kind !== 'coverage') throw fail('e_task', undefined, 404);
      if (t.ownerId) throw fail('e_cover_taken', { name: nameOf(state, t.ownerId) }, 409);
      if (me.role === 'admin' || !membershipFor(state, me.id, t.recipientId, now)) throw fail('e_no_access', { domain: t.domain }, 403);
      checkConflicts(state, [me.id], t.coverFrom!, t.coverTo!, [t.id], action.allowConflict);
      t.ownerId = me.id;
      event(state, t, me.id, msg('ev_cover_taken', { name: me.name }), now);
      const r = recipientOf(state, t.recipientId);
      tell(state, t, [t.createdBy, ...authorityHolders(state, r.id, now).map((m) => m.userId)], msg('n_cover_taken', { name: me.name, recipient: r.name, when: fmtTime(t.coverFrom!) }), now, me.id);
      audit(state, me.id, t.recipientId, t.domain, 'cover_taken', msg('au_cover_taken', { actor: me.name }), now, t.id);
      return { m: msg('m_cover_taken') };
    }

    // ------------------------------------------------------------ appointments
    case 'add_appointment': {
      const r = recipientOf(state, action.recipientId);
      const a = action.appt;
      const { title, attendees } = validateAppt(state, me, r, a, now);
      checkConflicts(state, attendees, a.startAt, a.endAt, [], action.allowConflict);
      const appt: Appointment = {
        id: nextId(state, 'v'),
        recipientId: r.id,
        title,
        kind: a.kind,
        domain: a.domain,
        startAt: a.startAt,
        endAt: a.endAt,
        location: (a.location ?? '').trim().slice(0, 200),
        withWhom: (a.withWhom ?? '').trim().slice(0, 140),
        attendeeIds: attendees,
        notes: (a.notes ?? '').trim().slice(0, 2000),
        status: 'scheduled',
        createdBy: me.id,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      state.appointments.push(appt);
      // Preparation checklist: one small task per step, due before the appointment.
      for (const step of (action.prep ?? []).map((x) => String(x).trim()).filter((x) => x.length >= 3).slice(0, 12)) {
        const id = nextId(state, 't');
        state.tasks.push({
          id,
          recipientId: r.id,
          planId: null,
          parentId: null,
          appointmentId: appt.id,
          kind: 'prep',
          title: step.slice(0, 140),
          notes: '',
          domain: appt.domain,
          ownerId: me.role === 'coordinator' ? null : me.id,
          status: 'scheduled',
          priority: 'medium',
          dueAt: appt.startAt - H,
          recurrence: 'none',
          seriesId: id,
          dependsOn: [],
          needsApproval: false,
          evidenceRequired: false,
          comments: [],
          events: [{ at: now, by: me.id, m: msg('ev_task_created') }],
          createdBy: me.id,
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
      }
      notify(state, attendees.filter((id) => id !== me.id), null, msg('n_appt_added', { name: me.name, title, recipient: r.name, when: fmtTime(appt.startAt) }), 'update', now);
      audit(state, me.id, r.id, appt.domain, 'appt_added', msg('au_appt', { actor: me.name, title, when: fmtTime(appt.startAt) }), now, appt.id);
      return { m: msg('m_appt_added', { title }), createdId: appt.id };
    }

    case 'edit_appointment': {
      const ap = state.appointments.find((x) => x.id === action.appointmentId);
      if (!ap || !can(state, me.id, ap.recipientId, ap.domain, now)) throw fail('e_appt', undefined, 404);
      if (!canManage(state, me, ap, now) && !ap.attendeeIds.includes(me.id)) throw fail('e_task_manage', undefined, 403);
      if (ap.status !== 'scheduled') throw fail('e_task_locked', { status: ap.status }, 409);
      if (action.baseVersion !== ap.version) throw fail('e_stale', undefined, 409);
      const r = recipientOf(state, ap.recipientId);
      const a = action.appt;
      const { title, attendees } = validateAppt(state, me, r, a, now);
      checkConflicts(state, attendees, a.startAt, a.endAt, [ap.id], action.allowConflict);
      const moved = ap.startAt !== a.startAt;
      Object.assign(ap, { title, kind: a.kind, domain: a.domain, startAt: a.startAt, endAt: a.endAt, location: (a.location ?? '').trim().slice(0, 200), withWhom: (a.withWhom ?? '').trim().slice(0, 140), attendeeIds: attendees, notes: (a.notes ?? '').trim().slice(0, 2000), updatedAt: now, version: ap.version + 1 });
      if (moved) for (const t of state.tasks) if (t.appointmentId === ap.id && isOpenTask(t)) t.dueAt = ap.startAt - H;
      notify(state, attendees.filter((id) => id !== me.id), null, msg('n_appt_changed', { name: me.name, title, when: fmtTime(ap.startAt) }), 'update', now);
      audit(state, me.id, ap.recipientId, ap.domain, 'appt_edited', msg('au_appt_edited', { actor: me.name, title, when: fmtTime(ap.startAt) }), now, ap.id);
      return { m: msg('m_saved') };
    }

    case 'appointment_status': {
      const ap = state.appointments.find((x) => x.id === action.appointmentId);
      if (!ap || !can(state, me.id, ap.recipientId, ap.domain, now)) throw fail('e_appt', undefined, 404);
      if (!canManage(state, me, ap, now) && !ap.attendeeIds.includes(me.id)) throw fail('e_task_manage', undefined, 403);
      if (ap.status !== 'scheduled') throw fail('e_task_locked', { status: ap.status }, 409);
      if (action.status !== 'cancelled' && ap.startAt > now) throw fail('e_appt_future');
      const r = recipientOf(state, ap.recipientId);
      ap.status = action.status;
      ap.outcome = (action.outcome ?? '').trim().slice(0, 1000) || undefined;
      ap.updatedAt = now;
      ap.version += 1;
      if (action.status === 'cancelled') for (const t of state.tasks) if (t.appointmentId === ap.id && isOpenTask(t)) Object.assign(t, { status: 'cancelled', statusReason: 'Appointment cancelled', updatedAt: now });
      // Missed: a neutral notice to the household. Rescheduling is offered; nothing clinical is changed.
      const who = [...ap.attendeeIds, ap.createdBy, ...authorityHolders(state, r.id, now).map((m) => m.userId)].filter((id) => can(state, id, r.id, ap.domain, now));
      notify(state, who.filter((id) => id !== me.id), null, msg(action.status === 'missed' ? 'n_appt_missed' : 'n_appt_status', { title: ap.title, recipient: r.name, status: ap.status }), 'update', now);
      audit(state, me.id, ap.recipientId, ap.domain, 'appt_status', msg('au_appt_status', { actor: me.name, title: ap.title, status: ap.status }), now, ap.id);
      return { m: msg(action.status === 'missed' ? 'm_appt_missed' : 'm_appt_status', { status: ap.status }) };
    }

    // ------------------------------------------------------------ documents
    case 'add_document': {
      const r = recipientOf(state, action.recipientId);
      mayCreate(state, me, r, action.domain, now);
      if (!DOC_TYPES[action.mime]) throw fail('e_doc_type');
      const title = requireText(action.title, 'lbl_title', 3).slice(0, 140);
      const fileName = String(action.fileName ?? 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
      let size = Number(action.size) || 0;
      let storage: CareDocument['storage'];
      if (action.fileKey) {
        if (!ctx.serverFile) throw fail('e_doc_type'); // only the server may attach a stored file
        storage = 'server';
      } else {
        const prefix = `data:${action.mime};base64,`;
        if (!action.dataUrl?.startsWith(prefix)) throw fail('e_doc_type');
        const bytes = base64ToBytes(action.dataUrl.slice(prefix.length));
        if (bytes.length > DOC_MAX_INLINE) throw fail('e_doc_size', { kb: Math.round(DOC_MAX_INLINE / 1000) });
        if (!sniffMatches(action.mime, bytes)) throw fail('e_doc_type');
        size = bytes.length;
        storage = 'inline';
      }
      const d: CareDocument = {
        id: nextId(state, 'f'),
        recipientId: r.id,
        domain: action.domain,
        title,
        description: (action.description ?? '').trim().slice(0, 1000),
        fileName,
        mime: action.mime,
        size,
        storage,
        dataUrl: storage === 'inline' ? action.dataUrl : undefined,
        fileKey: storage === 'server' ? action.fileKey : undefined,
        uploadedBy: me.id,
        uploadedAt: now,
        source: me.role === 'self' ? 'self' : ['doctor', 'psychologist', 'physio', 'educator'].includes(me.role) ? 'professional' : 'caregiver',
      };
      state.documents.push(d);
      audit(state, me.id, r.id, d.domain, 'doc_added', msg('au_doc', { actor: me.name, title }), now, d.id);
      return { m: msg('m_doc_added', { title }), createdId: d.id };
    }

    case 'archive_document': {
      const d = state.documents.find((x) => x.id === action.documentId && !x.archived);
      if (!d || !can(state, me.id, d.recipientId, d.domain, now)) throw fail('e_document', undefined, 404);
      if (d.uploadedBy !== me.id && !hasAuthority(state, me.id, d.recipientId, now)) throw fail('e_record_author', undefined, 403);
      const reason = requireText(action.reason, 'lbl_reason', 3);
      d.archived = true;
      audit(state, me.id, d.recipientId, d.domain, 'doc_archived', msg('au_doc_archived', { actor: me.name, title: d.title, reason }), now, d.id);
      return { m: msg('m_archived') };
    }

    case 'note_export': {
      // Downloads are built from the person's filtered view; this only records that one happened.
      const r = recipientOf(state, action.recipientId);
      if (!domainsFor(state, me.id, r.id, now).length) throw fail('e_no_access', { domain: 'overview' }, 403);
      audit(state, me.id, r.id, 'overview', 'export', msg('au_progress_export', { actor: me.name }), now);
      return { m: msg('m_exported') };
    }
  }
  return null;
}

/** Reminders (once per occurrence) and escalation of overdue tasks. Returns true when something changed. */
export function sweepPlans(state: State, now: number): boolean {
  let changed = false;
  for (const t of state.tasks) {
    if ((t.status !== 'scheduled' && t.status !== 'in_progress') || !t.dueAt || t.kind === 'handover') continue;
    const r = state.recipients.find((x) => x.id === t.recipientId);
    if (!r) continue;
    if (!t.remindedAt && t.ownerId && t.dueAt > now && t.dueAt - now <= REMIND_BEFORE_HOURS * H) {
      t.remindedAt = now;
      notify(state, [t.ownerId].filter((id) => canSeeTask(state, id, t, now)), null, msg('n_task_due', { title: t.title, recipient: r.name, when: fmtTime(t.dueAt) }), 'update', now);
      changed = true;
    }
    if (!t.escalatedAt && now > t.dueAt + ESCALATE_AFTER_HOURS[t.priority] * H) {
      t.escalatedAt = now;
      t.events.push({ at: now, by: 'system', m: msg('ev_task_escalated') });
      const coords = coordinators(state).filter((id) => state.users.find((u) => u.id === id)?.orgId === r.orgId);
      const who = [t.ownerId, t.createdBy, ...authorityHolders(state, r.id, now).map((m) => m.userId), ...coords].filter((id): id is string => !!id && canSeeTask(state, id, t, now));
      notify(state, who, null, msg('n_task_overdue', { title: t.title, recipient: r.name }), 'escalation', now);
      audit(state, 'system', r.id, t.domain, 'task_escalated', msg('au_task_escalated', { title: t.title }), now, t.id);
      changed = true;
    }
  }
  return changed;
}
