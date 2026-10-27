// The command engine: every change to SANAD goes through apply(), on the server and in the browser.
import {
  EngineError,
  ROLE_LABEL,
  isHousehold,
  type Action,
  type Domain,
  type Recipient,
  type Msg,
  type Challenge,
  type Notification,
  type Priority,
  type Role,
  type Stage,
  type State,
  type User,
  type View,
} from './types';
import { computeLoads, decideRouting, isActive, selectAssignee } from './routing';
import { en, msg } from './messages';
import { cleanProfile, type ProfileInput } from './care';
import { audit, dispatch, expireCare, linkMember, syncLinks, unlinkMember, type CareCtx } from './care-engine';
import { canSeeTask, sweepPlans } from './plans-engine';
import { AUTHORITY_DOMAINS, DOMAINS, ROLE_DOMAINS, canManageTeam, canWrite, domainsFor, isLive, isMinor, isOrgStaff } from './access';

export const fail = (k: string, p?: Record<string, string | number | Msg>, status = 400) => {
  const m = msg(k, p);
  return new EngineError(m, status, en(m));
};

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function nextId(state: State, prefix: string): string {
  state.seq += 1;
  return `${prefix}${state.seq.toString(36)}`;
}

export function getUser(state: State, id: string): User {
  const u = state.users.find((x) => x.id === id);
  if (!u) throw fail('e_person', undefined, 404);
  return u;
}

export function getChallenge(state: State, id: string): Challenge {
  const c = state.challenges.find((x) => x.id === id);
  if (!c) throw fail('e_challenge', undefined, 404);
  return c;
}

export function userName(state: Pick<State, 'users'>, id: string | null | undefined): string {
  if (!id) return 'Unassigned';
  if (id === 'system') return 'SANAD';
  return state.users.find((u) => u.id === id)?.name ?? 'Someone';
}

export const isCoordinator = (u: User) => u.role === 'coordinator';

export function isFamilyOf(u: User, c: Challenge): boolean {
  return isHousehold(u.role) && u.recipients.includes(c.recipientId);
}

/** Coordinators see every problem in their own organisation (pass recipients to apply the organisation check). */
export function canSee(u: User, c: Challenge, recipients?: Pick<Recipient, 'id' | 'orgId'>[]): boolean {
  if (isCoordinator(u)) {
    const org = recipients?.find((r) => r.id === c.recipientId)?.orgId;
    if (!recipients || !org || !u.orgId || org === u.orgId) return true;
  }
  if (c.reporterId === u.id || c.assigneeId === u.id || c.watchers.includes(u.id)) return true;
  if (u.recipients.includes(c.recipientId)) return true;
  if (!isHousehold(u.role) && !isOrgStaff(u) && c.role === u.role) return true;
  return false;
}

export function canWork(u: User, c: Challenge): boolean {
  return c.assigneeId === u.id || isCoordinator(u);
}

export function canVerify(u: User, c: Challenge): boolean {
  return c.reporterId === u.id || isFamilyOf(u, c) || isCoordinator(u);
}

export function dueFrom(from: number, priority: Priority, state: Pick<State, 'settings'>): number {
  return from + state.settings.sla[priority] * 60_000;
}

function log(state: State, c: Challenge, actorId: string, type: string, m: Msg, now: number) {
  c.history.push({ id: nextId(state, 'h'), at: now, actorId, type, text: en(m), m });
  c.updatedAt = now;
}

export function notify(
  state: State,
  userIds: (string | null | undefined)[],
  c: Challenge | null,
  m: Msg,
  kind: Notification['kind'],
  now: number,
  exclude?: string,
) {
  const seen = new Set<string>();
  for (const id of userIds) {
    if (!id || id === exclude || seen.has(id)) continue;
    if (!state.users.some((u) => u.id === id)) continue;
    seen.add(id);
    state.notifications.unshift({ id: nextId(state, 'n'), userId: id, challengeId: c?.id ?? null, text: en(m), m, at: now, read: false, kind });
  }
  if (state.notifications.length > 600) state.notifications.length = 600;
}

export const coordinators = (state: State) => state.users.filter(isCoordinator).map((u) => u.id);
const familyOf = (state: State, c: Challenge) => state.users.filter((u) => isFamilyOf(u, c)).map((u) => u.id);
const stakeholders = (state: State, c: Challenge) => [c.reporterId, c.assigneeId, ...c.watchers, ...familyOf(state, c)];

export function requireText(v: string | undefined, label: string, min = 3): string {
  const t = (v ?? '').trim();
  if (t.length < min) throw fail('e_min', { label: `@${label}`, min });
  return t;
}

function assignTo(state: State, c: Challenge, role: Role, actorId: string, why: Msg, now: number, exclude: string[] = []) {
  const loads = computeLoads(state.users, state.challenges);
  const pick = selectAssignee(state.users, loads, role, c.recipientId, `${c.title} ${c.description}`, state.settings, exclude, state.recipients.find((r) => r.id === c.recipientId)?.orgId);
  c.role = role;
  c.assigneeId = pick.user?.id ?? null;
  c.stage = role === 'coordinator' && c.stage === 'reported' ? 'reported' : 'routed';
  const recipient = state.recipients.find((r) => r.id === c.recipientId)?.name ?? '';
  if (pick.user) {
    log(state, c, actorId, 'routed', msg('h_routed', { why, name: pick.user.name, role }), now);
    notify(state, [pick.user.id], c, msg('n_new', { priority: c.priority, recipient, title: c.title }), 'assigned', now, actorId);
  } else {
    log(state, c, actorId, 'queued', msg('h_queued', { why, role }), now);
    notify(state, coordinators(state), c, msg('n_none_available', { role, ref: c.ref }), 'escalation', now, actorId);
  }
  return pick;
}

export interface ApplyResult {
  state: State;
  /** Id of a created entity, when relevant. */
  createdId?: string;
  message: string;
  m: Msg;
}

/** Pure: returns a new state. Throws EngineError when the action is not allowed. */
export function apply(prev: State, actorId: string, action: Action, now = Date.now(), ctx: CareCtx = {}): ApplyResult {
  const state = clone(prev);
  const me = getUser(state, actorId);
  let m: Msg = msg('m_saved');
  let createdId: string | undefined;
  const noChange = (): ApplyResult => ({ state: prev, message: 'No change', m: msg('m_no_change') });

  const workOn = (id: string, check: (c: Challenge) => boolean, deny: string) => {
    const c = getChallenge(state, id);
    if (!canSee(me, c, state.recipients)) throw fail('e_access', undefined, 403);
    if (!check(c)) throw fail(deny, undefined, 403);
    return c;
  };

  switch (action.type) {
    case 'create_challenge': {
      const title = requireText(action.title, 'lbl_title', 4);
      const description = (action.description ?? '').trim();
      const recipient = state.recipients.find((r) => r.id === action.recipientId);
      if (!recipient) throw fail('e_who');
      if (isHousehold(me.role) && !me.recipients.includes(recipient.id)) throw fail('e_family_only', undefined, 403);
      if (me.role === 'admin') throw fail('e_admin_report', undefined, 403);
      const decision = decideRouting(
        { title, description, recipientId: recipient.id, priority: action.priority, category: action.category },
        { users: state.users, rules: state.rules, settings: state.settings, loads: computeLoads(state.users, state.challenges), recipients: state.recipients },
      );
      const n = state.challenges.reduce((m, c) => Math.max(m, Number(c.ref.split('-')[1]) || 0), 1000) + 1;
      const c: Challenge = {
        id: nextId(state, 'c'),
        ref: `SAN-${n}`,
        title,
        description,
        category: decision.category,
        priority: decision.priority,
        stage: 'reported',
        recipientId: recipient.id,
        reporterId: me.id,
        role: decision.role,
        assigneeId: decision.assigneeId,
        createdAt: now,
        updatedAt: now,
        slaFrom: now,
        dueAt: dueFrom(now, decision.priority, state),
        escalated: false,
        routing: decision,
        checklist: [],
        playbookId: null,
        comments: [],
        history: [],
        watchers: [],
        reopenCount: 0,
      };
      log(state, c, me.id, 'reported', msg('h_reported', { name: me.name }), now);
      const triage = decision.ruleId === null && decision.role === 'coordinator';
      if (!triage) c.stage = 'routed';
      const who = decision.assigneeId ? userName(state, decision.assigneeId) : '';
      log(
        state,
        c,
        'system',
        triage ? 'triage' : 'routed',
        decision.assigneeId
          ? msg(triage ? 'h_triage' : 'h_autorouted', { who, pct: Math.round(decision.confidence * 100) })
          : msg('h_queued', { why: msg('h_autorouted_short'), role: decision.role }),
        now,
      );
      state.challenges.unshift(c);
      if (decision.assigneeId) {
        notify(state, [decision.assigneeId], c, msg('n_new', { priority: c.priority, recipient: recipient.name, title }), 'assigned', now, me.id);
      } else {
        notify(state, coordinators(state), c, msg('n_none_available', { role: decision.role, ref: c.ref }), 'escalation', now, me.id);
      }
      if (c.priority === 'urgent') {
        notify(state, [...coordinators(state), ...familyOf(state, c)], c, msg('n_urgent', { title, recipient: recipient.name }), 'escalation', now, me.id);
      }
      createdId = c.id;
      m = decision.assigneeId ? msg('m_routed', { ref: c.ref, who }) : msg('m_routed_queue', { ref: c.ref, role: decision.role });
      break;
    }

    case 'claim': {
      const c = workOn(action.id, (x) => isActive(x) && (x.role === me.role || isCoordinator(me)) && x.assigneeId !== me.id, 'e_claim_team');
      if (c.assigneeId && !isCoordinator(me) && c.stage !== 'routed') throw fail('e_teammate', undefined, 409);
      const prevOwner = c.assigneeId;
      c.assigneeId = me.id;
      c.role = me.role;
      c.stage = 'accepted';
      log(state, c, me.id, 'claimed', msg('h_claimed', { name: me.name }), now);
      notify(state, [prevOwner, c.reporterId], c, msg('n_took', { name: me.name, ref: c.ref }), 'update', now, me.id);
      m = msg('m_own', { ref: c.ref });
      break;
    }

    case 'accept': {
      const c = workOn(action.id, (x) => x.assigneeId === me.id || isCoordinator(me), 'e_accept_owner');
      if (c.stage !== 'routed' && c.stage !== 'reported') throw fail('e_already', { stage: c.stage }, 409);
      if (!c.assigneeId) c.assigneeId = me.id;
      c.stage = 'accepted';
      log(state, c, me.id, 'accepted', msg('h_accepted', { name: me.name }), now);
      notify(state, [c.reporterId, ...familyOf(state, c)], c, msg('n_accepted', { name: userName(state, c.assigneeId), ref: c.ref, title: c.title }), 'update', now, me.id);
      m = msg('m_accepted', { ref: c.ref });
      break;
    }

    case 'start': {
      const c = workOn(action.id, (x) => canWork(me, x), 'e_start_owner');
      if (!['routed', 'accepted', 'reported'].includes(c.stage)) throw fail('e_cannot_start', { stage: c.stage }, 409);
      if (!c.assigneeId) c.assigneeId = me.id;
      c.stage = 'in_progress';
      log(state, c, me.id, 'started', msg('h_started', { name: me.name }), now);
      notify(state, [c.reporterId], c, msg('n_started', { ref: c.ref }), 'update', now, me.id);
      m = msg('m_started', { ref: c.ref });
      break;
    }

    case 'move': {
      const c = workOn(action.id, (x) => canWork(me, x) || (x.role === me.role && !x.assigneeId), 'e_move_owner');
      const target: Stage = action.stage;
      if (target === c.stage) return noChange();
      if (target === 'resolved') throw fail('e_need_resolution');
      if (target === 'verified') throw fail('e_family_confirms');
      if (target === 'reported' || target === 'routed') {
        if (!isCoordinator(me)) throw fail('e_use_handoff');
        c.stage = target;
        log(state, c, me.id, 'moved', msg('h_moved_back', { name: me.name, stage: target }), now);
        m = msg('m_moved', { stage: target });
        break;
      }
      if (!isActive(c)) throw fail('e_reopen_first');
      if (!c.assigneeId || (c.assigneeId !== me.id && !isCoordinator(me))) c.assigneeId = me.id;
      const from = c.stage;
      c.stage = target;
      log(state, c, me.id, target === 'accepted' && from === 'in_progress' ? 'paused' : target, msg('h_moved', { name: me.name, stage: target }), now);
      notify(state, [c.reporterId], c, msg('n_now', { ref: c.ref, stage: target }), 'update', now, me.id);
      m = msg('m_moved', { stage: target });
      break;
    }

    case 'toggle_check': {
      const c = workOn(action.id, (x) => canWork(me, x), 'e_check_owner');
      const item = c.checklist.find((i) => i.id === action.itemId);
      if (!item) throw fail('e_check_missing', undefined, 404);
      item.done = !item.done;
      item.doneBy = item.done ? me.id : undefined;
      item.doneAt = item.done ? now : undefined;
      if (item.done && (c.stage === 'accepted' || c.stage === 'routed')) {
        c.stage = 'in_progress';
        log(state, c, me.id, 'started', msg('h_started', { name: me.name }), now);
      }
      c.updatedAt = now;
      const left = c.checklist.filter((i) => !i.done).length;
      m = msg(left === 0 && c.checklist.length ? 'm_all_steps' : item.done ? 'm_step_done' : 'm_step_reopened');
      break;
    }

    case 'add_check': {
      const c = workOn(action.id, (x) => canWork(me, x), 'e_check_edit');
      const text = requireText(action.text, 'lbl_step', 2);
      c.checklist.push({ id: nextId(state, 'k'), text, done: false });
      c.updatedAt = now;
      m = msg('m_step_added');
      break;
    }

    case 'apply_playbook': {
      const c = workOn(action.id, (x) => canWork(me, x) && isActive(x), 'e_pb_owner');
      const pb = state.playbooks.find((p) => p.id === action.playbookId);
      if (!pb) throw fail('e_pb_missing', undefined, 404);
      const existing = new Set(c.checklist.map((i) => i.text.toLowerCase()));
      for (const step of pb.steps) if (!existing.has(step.toLowerCase())) c.checklist.push({ id: nextId(state, 'k'), text: step, done: false });
      c.playbookId = pb.id;
      pb.uses += 1;
      if (!c.assigneeId) c.assigneeId = me.id;
      if (c.stage === 'routed' || c.stage === 'accepted' || c.stage === 'reported') c.stage = 'in_progress';
      log(state, c, me.id, 'playbook', msg('h_playbook', { name: me.name, pb: pb.title, n: pb.steps.length, min: pb.minutes }), now);
      notify(state, [c.reporterId], c, msg('n_playbook', { ref: c.ref, pb: pb.title }), 'update', now, me.id);
      m = msg('m_pb_applied', { n: pb.steps.length });
      break;
    }

    case 'comment': {
      const c = workOn(action.id, () => true, '');
      const text = requireText(action.text, 'lbl_comment', 1);
      c.comments.push({ id: nextId(state, 'm'), authorId: me.id, text, at: now });
      c.updatedAt = now;
      notify(state, [...stakeholders(state, c), ...(c.escalated ? coordinators(state) : [])], c, msg('n_comment', { name: me.name, ref: c.ref, text: text.slice(0, 90) }), 'comment', now, me.id);
      m = msg('m_comment');
      break;
    }

    case 'handoff': {
      const c = workOn(action.id, (x) => canWork(me, x) || x.role === me.role, 'e_handoff_team');
      if (!isActive(c)) throw fail('e_handoff_resolved');
      const reason = requireText(action.reason, 'lbl_handoff');
      if (action.role === c.role && action.role !== 'coordinator') {
        const pick = assignTo(state, c, action.role, me.id, msg('why_within', { role: action.role, reason }), now, [c.assigneeId ?? '']);
        m = pick.user ? msg('m_reassigned_to', { name: pick.user.name }) : msg('m_sent_queue');
      } else {
        const pick = assignTo(state, c, action.role, me.id, msg('why_handoff', { name: me.name, reason }), now);
        if (action.role === 'coordinator') c.stage = 'reported';
        m = pick.user ? msg('m_handed', { name: pick.user.name }) : msg('m_sent_role_queue', { role: action.role });
      }
      notify(state, [c.reporterId], c, msg('n_moved_role', { ref: c.ref, role: c.role, reason }), 'update', now, me.id);
      break;
    }

    case 'reassign': {
      const c = getChallenge(state, action.id);
      const target = getUser(state, action.assigneeId);
      const allowed = isCoordinator(me) || (c.assigneeId === me.id && target.role === me.role);
      if (!allowed) throw fail('e_reassign', undefined, 403);
      if (target.role === 'family' && !isFamilyOf(target, c)) throw fail('e_family_link');
      const reason = requireText(action.reason, 'lbl_reason');
      const prevOwner = c.assigneeId;
      c.assigneeId = target.id;
      c.role = target.role;
      if (isActive(c)) c.stage = 'routed';
      log(state, c, me.id, 'reassigned', msg('h_reassigned', { name: me.name, target: target.name, reason }), now);
      notify(state, [target.id], c, msg('n_assigned_you', { name: me.name, ref: c.ref, title: c.title }), 'assigned', now, me.id);
      notify(state, [prevOwner], c, msg('n_reassigned', { ref: c.ref, name: target.name }), 'update', now, me.id);
      m = msg('m_assigned', { name: target.name });
      break;
    }

    case 'set_priority': {
      const c = workOn(action.id, (x) => canWork(me, x), 'e_priority');
      if (c.priority === action.priority) return noChange();
      const old = c.priority;
      c.priority = action.priority;
      c.dueAt = dueFrom(c.slaFrom, c.priority, state);
      if (c.escalated && c.escalationReason === 'SLA breached' && c.dueAt > now) {
        c.escalated = false;
        c.escalationReason = undefined;
      }
      log(state, c, me.id, 'priority', msg('h_priority', { name: me.name, old, new: c.priority }), now);
      m = msg('m_priority', { priority: c.priority });
      break;
    }

    case 'escalate': {
      const c = workOn(action.id, (x) => isActive(x), 'e_escalate_open');
      const reason = requireText(action.reason, 'lbl_escalation');
      c.escalated = true;
      c.escalationReason = reason;
      log(state, c, me.id, 'escalated', msg('h_escalated', { name: me.name, reason }), now);
      notify(state, [...coordinators(state), c.assigneeId], c, msg('n_escalated', { ref: c.ref, reason }), 'escalation', now, me.id);
      m = msg('m_escalated');
      break;
    }

    case 'clear_escalation': {
      const c = workOn(action.id, () => isCoordinator(me), 'e_clear_esc');
      c.escalated = false;
      c.escalationReason = undefined;
      if (c.dueAt < now) {
        c.slaFrom = now;
        c.dueAt = dueFrom(now, c.priority, state);
      }
      log(state, c, me.id, 'deescalated', msg('h_deescalated', { name: me.name }), now);
      notify(state, [c.assigneeId], c, msg('n_esc_cleared', { ref: c.ref }), 'update', now, me.id);
      m = msg('m_esc_cleared');
      break;
    }

    case 'resolve': {
      const c = workOn(action.id, (x) => canWork(me, x), 'e_resolve_owner');
      if (!isActive(c)) throw fail('e_already_resolved', undefined, 409);
      const resolution = requireText(action.resolution, 'lbl_resolution', 5);
      c.stage = 'resolved';
      c.resolution = resolution;
      c.resolvedAt = now;
      if (!c.assigneeId) c.assigneeId = me.id;
      log(state, c, me.id, 'resolved', msg('h_resolved', { name: me.name, text: resolution }), now);
      notify(state, [...stakeholders(state, c), ...(c.escalated ? coordinators(state) : [])], c, msg('n_resolved', { ref: c.ref, title: c.title }), 'resolved', now, me.id);
      m = msg('m_resolved', { ref: c.ref });
      break;
    }

    case 'verify': {
      const c = workOn(action.id, (x) => canVerify(me, x), 'e_verify_who');
      if (c.stage !== 'resolved') throw fail('e_verify_stage', undefined, 409);
      const rating = Math.max(1, Math.min(5, Math.round(action.rating || 5)));
      c.stage = 'verified';
      c.verifiedAt = now;
      c.rating = rating;
      c.escalated = false;
      const pb = c.playbookId ? state.playbooks.find((p) => p.id === c.playbookId) : null;
      if (pb && rating >= 3) pb.successes += 1;
      log(state, c, me.id, 'verified', msg('h_verified', { name: me.name, rating }), now);
      notify(state, [c.assigneeId], c, msg('n_confirmed', { name: me.name, ref: c.ref, rating }), 'update', now, me.id);
      m = msg('m_closed', { ref: c.ref });
      break;
    }

    case 'reopen': {
      const c = workOn(action.id, (x) => canVerify(me, x) || canWork(me, x), 'e_reopen_who');
      if (isActive(c)) throw fail('e_still_open', undefined, 409);
      const reason = requireText(action.reason, 'lbl_reason');
      c.stage = c.assigneeId ? 'in_progress' : 'routed';
      c.reopenCount += 1;
      c.slaFrom = now;
      c.dueAt = dueFrom(now, c.priority, state);
      c.resolution = undefined;
      c.resolvedAt = undefined;
      c.verifiedAt = undefined;
      c.rating = undefined;
      log(state, c, me.id, 'reopened', msg('h_reopened', { name: me.name, reason }), now);
      notify(state, [c.assigneeId], c, msg('n_reopened', { ref: c.ref, reason }), 'update', now, me.id);
      m = msg('m_reopened', { ref: c.ref });
      break;
    }

    case 'watch': {
      const c = workOn(action.id, () => true, '');
      c.watchers = c.watchers.filter((w) => w !== me.id);
      if (action.on) c.watchers.push(me.id);
      m = msg(action.on ? 'm_follow' : 'm_unfollow');
      break;
    }

    case 'mark_read': {
      for (const n of state.notifications) {
        if (n.userId === me.id && (action.notificationId === 'all' || n.id === action.notificationId)) n.read = true;
      }
      m = msg(action.notificationId === 'all' ? 'm_caught_up' : 'm_read');
      break;
    }

    case 'set_availability': {
      const target = getUser(state, action.userId);
      if (target.id !== me.id && !isCoordinator(me)) throw fail('e_own_availability', undefined, 403);
      target.available = action.available;
      let moved = 0;
      if (!action.available) {
        // Rebalance: work this person has not started yet goes to an available teammate.
        for (const c of state.challenges) {
          if (c.assigneeId === target.id && (c.stage === 'routed' || c.stage === 'reported')) {
            const pick = assignTo(state, c, c.role, 'system', msg('why_away', { name: target.name }), now, [target.id]);
            if (pick.user) moved += 1;
          }
        }
      } else {
        moved = pickUpQueue(state, now);
      }
      const base = target.id === me.id ? msg(action.available ? 'm_you_available' : 'm_you_away') : msg(action.available ? 'm_they_available' : 'm_they_away', { name: target.name });
      m = moved ? msg('m_rebalanced', { base, n: moved }) : base;
      break;
    }

    case 'update_profile': {
      me.name = requireText(action.name, 'lbl_name_you', 2);
      me.title = (action.title ?? '').trim();
      me.skills = action.skills.map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 12);
      me.initials = initialsOf(me.name);
      m = msg('m_profile');
      break;
    }

    case 'add_user': {
      if (!isCoordinator(me)) throw fail('e_add_team', undefined, 403);
      const email = requireText(action.email, 'lbl_email', 5).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('e_email');
      if (state.users.some((u) => u.email.toLowerCase() === email)) throw fail('e_email_taken', undefined, 409);
      const name = requireText(action.name, 'lbl_name', 2);
      const u: User = {
        id: nextId(state, 'u'),
        name,
        role: action.role,
        title: action.title.trim() || ROLE_LABEL[action.role],
        org: action.org.trim(),
        email,
        initials: initialsOf(name),
        color: PALETTE[state.users.length % PALETTE.length],
        available: true,
        skills: action.skills.map((s) => s.trim().toLowerCase()).filter(Boolean),
        recipients: [],
        orgId: isOrgStaff({ role: action.role }) ? me.orgId ?? null : null,
      };
      state.users.push(u);
      const notes: Msg[] = [];
      for (const rid of action.recipients.filter((r) => state.recipients.some((x) => x.id === r && (!x.orgId || x.orgId === me.orgId)))) {
        const note = linkMember(state, me, u, rid, now);
        if (note) notes.push(note);
      }
      syncLinks(state, now);
      notify(state, [u.id], null, msg('n_welcome', { first: name.split(' ')[0], name: me.name, role: u.role }), 'system', now);
      pickUpQueue(state, now);
      createdId = u.id;
      m = notes.length ? msg('m_added_with', { name, note: notes[0] }) : msg('m_added', { name });
      break;
    }

    case 'update_user': {
      if (!isCoordinator(me)) throw fail('e_add_team', undefined, 403);
      const target = getUser(state, action.userId);
      target.title = action.title.trim() || ROLE_LABEL[target.role];
      target.org = action.org.trim();
      target.skills = action.skills.map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 12);
      const wanted = action.recipients.filter((r) => state.recipients.some((x) => x.id === r && (!x.orgId || x.orgId === me.orgId)));
      const notes: Msg[] = [];
      for (const rid of wanted) {
        const note = linkMember(state, me, target, rid, now);
        if (note) notes.push(note);
      }
      for (const rid of target.recipients.filter((r) => !wanted.includes(r))) {
        const r = state.recipients.find((x) => x.id === rid);
        if (!r?.orgId || r.orgId === me.orgId) unlinkMember(state, me, target.id, rid, now);
      }
      syncLinks(state, now);
      notify(state, [target.id], null, msg('n_profile_updated', { name: me.name }), 'system', now, me.id);
      m = notes.length ? msg('m_user_updated_with', { name: target.name, note: notes[0] }) : msg('m_user_updated', { name: target.name });
      break;
    }

    case 'add_recipient': {
      if (!isCoordinator(me)) throw fail('e_add_recipient', undefined, 403);
      const name = requireText(action.name, 'lbl_name', 2);
      const age = Math.round(Number(action.age));
      if (!Number.isFinite(age) || age < 1 || age > 120) throw fail('e_age');
      const id = nextId(state, 'r');
      const note = action.note.trim();
      state.recipients.push({ id, name, age, area: action.area.trim(), note, ...cleanProfile(action, age, note), orgId: me.orgId ?? undefined, accessVersion: 1, updatedAt: now });
      audit(state, me.id, id, 'overview', 'profile_created', msg('au_profile_created', { actor: me.name, name }), now, id);
      for (const fid of action.familyIds) {
        const f = state.users.find((u) => u.id === fid && isHousehold(u.role));
        if (f) linkMember(state, me, f, id, now);
      }
      syncLinks(state, now);
      createdId = id;
      m = msg('m_added', { name });
      break;
    }

    case 'update_recipient': {
      const r = state.recipients.find((x) => x.id === action.recipientId);
      if (!r) throw fail('e_who');
      if (!canWrite(state, me.id, r.id, 'overview', now)) throw fail('e_edit_recipient', undefined, 403);
      const age = Math.round(Number(action.age));
      if (!Number.isFinite(age) || age < 1 || age > 120) throw fail('e_age');
      r.age = age;
      r.area = (action.area ?? '').trim();
      r.note = (action.note ?? '').trim();
      Object.assign(r, cleanProfile({ support: action.support, living: action.living, needs: action.needs ?? [] }, age, r.note));
      const others = state.users.filter((u) => u.id !== me.id && (u.recipients.includes(r.id) || u.role === 'coordinator')).map((u) => u.id);
      notify(state, others, null, msg('n_recipient_updated', { name: me.name, recipient: r.name }), 'update', now);
      m = msg('m_recipient_updated', { name: r.name });
      break;
    }

    case 'upsert_rule': {
      if (!isCoordinator(me)) throw fail('e_rules', undefined, 403);
      const r = action.rule;
      const name = requireText(r.name, 'lbl_rule_name', 2);
      const keywords = r.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
      if (!keywords.length) throw fail('e_keyword');
      if (r.id) {
        const existing = state.rules.find((x) => x.id === r.id);
        if (!existing) throw fail('e_rule_missing', undefined, 404);
        Object.assign(existing, { name, keywords, category: r.category, role: r.role, enabled: r.enabled, priorityFloor: r.priorityFloor });
        createdId = existing.id;
        m = msg('m_rule_updated');
      } else {
        const id = nextId(state, 'rule');
        state.rules.push({ id, name, keywords, category: r.category, role: r.role, enabled: r.enabled, priorityFloor: r.priorityFloor });
        createdId = id;
        m = msg('m_rule_created');
      }
      break;
    }

    case 'delete_rule': {
      if (!isCoordinator(me)) throw fail('e_rules', undefined, 403);
      const before = state.rules.length;
      state.rules = state.rules.filter((r) => r.id !== action.id);
      if (state.rules.length === before) throw fail('e_rule_missing', undefined, 404);
      m = msg('m_rule_deleted');
      break;
    }

    case 'upsert_playbook': {
      const p = action.playbook;
      const title = requireText(p.title, 'lbl_title', 3);
      const steps = p.steps.map((s) => s.trim()).filter(Boolean);
      if (!steps.length) throw fail('e_step_needed');
      const minutes = Math.max(1, Math.round(Number(p.minutes) || 0));
      const effort = ([1, 2, 3].includes(p.effort) ? p.effort : 2) as 1 | 2 | 3;
      const tags = p.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (p.id) {
        const existing = state.playbooks.find((x) => x.id === p.id);
        if (!existing) throw fail('e_pb_missing', undefined, 404);
        if (existing.authorId !== me.id && !isCoordinator(me)) throw fail('e_pb_edit', undefined, 403);
        Object.assign(existing, { title, steps, minutes, effort, tags, category: p.category, summary: p.summary.trim(), updatedAt: now });
        createdId = existing.id;
        m = msg('m_pb_updated');
      } else {
        const id = nextId(state, 'pb');
        state.playbooks.push({ id, title, steps, minutes, effort, tags, category: p.category, summary: p.summary.trim(), uses: 0, successes: 0, authorId: me.id, updatedAt: now });
        createdId = id;
        m = msg('m_pb_published');
      }
      break;
    }

    case 'delete_playbook': {
      const pb = state.playbooks.find((p) => p.id === action.id);
      if (!pb) throw fail('e_pb_missing', undefined, 404);
      if (pb.authorId !== me.id && !isCoordinator(me)) throw fail('e_pb_delete', undefined, 403);
      state.playbooks = state.playbooks.filter((p) => p.id !== action.id);
      for (const c of state.challenges) if (c.playbookId === action.id) c.playbookId = null;
      m = msg('m_pb_deleted');
      break;
    }

    case 'update_settings': {
      if (!isCoordinator(me)) throw fail('e_settings', undefined, 403);
      const s = action.settings;
      for (const p of ['low', 'medium', 'high', 'urgent'] as Priority[]) {
        const v = Math.round(Number(s.sla[p]));
        if (!Number.isFinite(v) || v < 5) throw fail('e_sla_min');
        state.settings.sla[p] = v;
      }
      state.settings.autoEscalate = !!s.autoEscalate;
      state.settings.balanceLoad = !!s.balanceLoad;
      state.settings.preferContinuity = !!s.preferContinuity;
      for (const c of state.challenges) if (isActive(c)) c.dueAt = dueFrom(c.slaFrom, c.priority, state);
      m = msg('m_settings');
      break;
    }

    default: {
      const res = dispatch(state, me, action, now, ctx);
      if (!res) throw fail('e_unknown', { type: (action as { type: string }).type });
      m = res.m;
      createdId = res.createdId;
    }
  }

  syncLinks(state, now);
  state.version += 1;
  sweep(state, now);
  return { state, createdId, message: en(m), m };
}

/** Queued work (no assignee) gets picked up when someone in that role is available. */
function pickUpQueue(state: State, now: number): number {
  let moved = 0;
  for (const c of state.challenges) {
    if (!c.assigneeId && isActive(c)) {
      const pick = assignTo(state, c, c.role, 'system', msg('why_queue'), now);
      if (pick.user) moved += 1;
    }
  }
  return moved;
}

/** Time-based rules: SLA breaches escalate automatically. Mutates; returns true when something changed. */
export function sweep(state: State, now = Date.now()): boolean {
  let changed = expireCare(state, now);
  if (sweepPlans(state, now)) changed = true;
  if (state.settings.autoEscalate) {
    for (const c of state.challenges) {
      if (isActive(c) && !c.escalated && c.dueAt < now) {
        c.escalated = true;
        c.escalationReason = 'SLA breached';
        log(state, c, 'system', 'escalated', msg('h_sla'), now);
        notify(state, [...coordinators(state), c.assigneeId], c, msg('n_sla', { ref: c.ref, title: c.title }), 'escalation', now);
        changed = true;
      }
    }
  }
  if (changed) state.version += 1;
  return changed;
}

/**
 * Everything a user receives is built here, field by field — never by copying the whole state —
 * so information they may not see never leaves the server (or reaches the screen in browser mode).
 */
export function viewFor(state: State, userId: string, now = Date.now()): View {
  const me = getUser(state, userId);
  const access: Record<string, Domain[]> = {};
  for (const r of state.recipients) {
    const d = domainsFor(state, userId, r.id, now);
    if (d.length) access[r.id] = d;
  }
  const can = (rid: string, d: Domain) => !!access[rid]?.includes(d);
  const challenges = state.challenges.filter((c) => canSee(me, c, state.recipients));
  const named = new Set(challenges.map((c) => c.recipientId));
  const recipients: Recipient[] = [];
  for (const r of state.recipients) {
    if (access[r.id]) recipients.push(r);
    // Not on their team, but a problem about them reached this user: share the name and area only.
    else if (named.has(r.id)) recipients.push({ id: r.id, name: r.name, age: r.age, area: r.area, note: '', limited: true });
  }
  const visible = new Set(recipients.filter((r) => !r.limited).map((r) => r.id));
  const manages = (rid: string) => canManageTeam(state, userId, rid, now);
  return {
    version: state.version,
    schema: state.schema,
    seq: state.seq,
    me: userId,
    users: state.users.map((u) => ({ ...u, recipients: u.recipients.filter((r) => visible.has(r)) })),
    recipients,
    challenges,
    rules: state.rules,
    playbooks: state.playbooks,
    notifications: state.notifications.filter((n) => n.userId === userId),
    settings: state.settings,
    orgs: state.orgs,
    loads: computeLoads(state.users, state.challenges),
    access,
    memberships: state.memberships
      .filter((m) => m.userId === userId || can(m.recipientId, 'team'))
      .map((m) => (can(m.recipientId, 'team') ? m : { ...m, authorityEvidence: undefined })),
    invites: state.invites.filter((i) => (i.status === 'pending' && i.email === me.email.toLowerCase()) || manages(i.recipientId)),
    consents: state.consents.filter((c) => can(c.recipientId, 'team')),
    approvals: state.approvals.filter((a) => a.requestedBy === userId || a.approverIds.includes(userId) || manages(a.recipientId)),
    audit: state.audit.filter((e) => (e.recipientId ? can(e.recipientId, e.domain) && (e.domain !== 'team' || can(e.recipientId, 'team')) : e.actorId === userId)),
    records: state.records.filter((r) => can(r.recipientId, r.domain)),
    medications: state.medications.filter((x) => can(x.recipientId, 'medical')),
    doseLogs: state.doseLogs.filter((x) => can(x.recipientId, 'medical')),
    plans: state.plans.filter((p) => can(p.recipientId, p.domain)),
    tasks: state.tasks.filter((t) => canSeeTask(state, userId, t, now)),
    appointments: state.appointments.filter((a) => can(a.recipientId, a.domain)),
    // File contents stored on the server are never part of the view; they are fetched one by one, with a fresh permission check.
    documents: state.documents.filter((d) => can(d.recipientId, d.domain)).map((d) => ({ ...d, fileKey: undefined })),
  };
}

/** Upgrades saved data from before care teams and records existed. Adds, never removes. */
export function upgrade(state: State, now = Date.now()): State {
  if ((state.schema ?? 1) >= 3) return state;
  const s = state as State & Partial<State>;
  // Schema 3: plans, tasks, appointments and documents.
  s.plans ??= [];
  s.tasks ??= [];
  s.appointments ??= [];
  s.documents ??= [];
  if ((state.schema ?? 1) >= 2) {
    s.schema = 3;
    return s;
  }
  s.orgs ??= [{ id: 'org-hub', name: 'SANAD Care Hub' }];
  s.memberships ??= [];
  s.invites ??= [];
  s.consents ??= [];
  s.approvals ??= [];
  s.audit ??= [];
  s.records ??= [];
  s.medications ??= [];
  s.doseLogs ??= [];
  const org = s.orgs[0].id;
  for (const r of s.recipients) {
    r.orgId ??= org;
    r.accessVersion ??= 1;
  }
  for (const u of s.users) {
    if (isOrgStaff(u)) u.orgId ??= org;
    for (const rid of u.recipients) {
      if (s.memberships.some((m) => m.userId === u.id && m.recipientId === rid)) continue;
      // Keep the access people already had through their existing care links.
      const domains = ROLE_DOMAINS[u.role].filter((d) => d !== 'wellbeing_notes');
      s.seq += 1;
      s.memberships.push({ id: `g${s.seq.toString(36)}`, recipientId: rid, userId: u.id, relationship: isHousehold(u.role) ? 'Family' : u.title, authority: 'none', authorityVerified: false, domains, status: 'active', grantedBy: 'system', createdAt: now });
      s.seq += 1;
      s.consents.push({ id: `k${s.seq.toString(36)}`, recipientId: rid, subjectId: u.id, change: 'grant', domains, basis: 'recorded', givenBy: 'system', evidence: 'Carried over from the care links that existed before permissions were added', at: now });
    }
  }
  s.schema = 3;
  return s;
}

export const PALETTE = ['#476ADB', '#1F9E8F', '#C9861A', '#7A5AC8', '#D2566B', '#3E8E3A', '#2B7BB9', '#9A6B3F'];

export function initialsOf(name: string): string {
  return name
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

// ---------------------------------------------------------------- self sign-up
/** Anyone can create an account in these roles. Professionals see nobody until a care team invites them. */
export const SELF_SIGNUP_ROLES: Role[] = ['self', 'family', 'caregiver', 'doctor', 'psychologist', 'physio', 'educator', 'transport', 'pharmacy', 'social'];

export interface RegisterInput {
  role: Role;
  name: string;
  email: string;
  title?: string;
  org?: string;
  skills?: string[];
  /** Family: the person they care for. Self: their own details (name comes from the account). */
  recipient?: { name: string; age: number; area: string; note?: string; relationship?: string; claimsAuthority?: boolean } & ProfileInput;
  /** Joining a care team through an invitation. */
  inviteCode?: string;
}

export interface RegisterResult {
  state: State;
  userId: string;
  recipientId?: string;
  m: Msg;
}

/** Creates an account for a new person. Pure: returns a new state, throws EngineError on invalid input. */
export function register(prev: State, input: RegisterInput, now = Date.now(), ctx: CareCtx = {}): RegisterResult {
  let state = upgrade(clone(prev), now);
  if (!SELF_SIGNUP_ROLES.includes(input.role)) throw fail('e_signup_role', undefined, 403);
  const name = requireText(input.name, 'lbl_name', 2);
  const email = requireText(input.email, 'lbl_email', 5).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('e_email');
  if (state.users.some((u) => u.email.toLowerCase() === email)) throw fail('e_email_taken', undefined, 409);
  const invite = input.inviteCode ? state.invites.find((i) => i.code === input.inviteCode!.trim()) : undefined;
  if (input.inviteCode && !invite) throw fail('e_invite_code', undefined, 404);
  if (invite && invite.role !== input.role) throw fail('e_invite_role_mismatch', { role: invite.role }, 403);

  const userId = nextId(state, 'u');
  let recipientId: string | undefined;
  // A new profile is only created when the person is not joining an existing one through an invitation.
  const createsProfile = !invite && (input.role === 'family' || input.role === 'self');
  if (createsProfile) {
    const r = input.recipient;
    const rName = input.role === 'self' ? name : requireText(r?.name, 'lbl_recipient', 2);
    const age = Math.round(Number(r?.age));
    if (!Number.isFinite(age) || age < 1 || age > 120) throw fail('e_age');
    if (input.role === 'self' && age < 18) throw fail('e_minor_self', undefined, 400);
    recipientId = nextId(state, 'r');
    const note = (r?.note ?? '').trim();
    state.recipients.push({ id: recipientId, name: rName, age, area: (r?.area ?? '').trim(), note, ...cleanProfile(r, age, note), orgId: state.orgs[0]?.id, accessVersion: 1, updatedAt: now });
    const self = input.role === 'self';
    const authority = self ? 'self' : r?.claimsAuthority ? 'guardian' : 'none';
    const domains: Domain[] = self ? AUTHORITY_DOMAINS : [...ROLE_DOMAINS.family, ...(isMinor({ age }) ? (['academic'] as Domain[]) : [])];
    state.seq += 1;
    state.memberships.push({
      id: `g${state.seq.toString(36)}`,
      recipientId,
      userId,
      relationship: self ? 'Self' : (r?.relationship ?? '').trim().slice(0, 60) || 'Family',
      authority,
      // Your own authority over your own profile is clear; a guardian claim waits for a coordinator to check evidence.
      authorityVerified: self,
      domains: DOMAINS.filter((d) => domains.includes(d)),
      status: 'active',
      grantedBy: userId,
      createdAt: now,
    });
    state.seq += 1;
    state.consents.push({ id: `k${state.seq.toString(36)}`, recipientId, subjectId: userId, change: 'grant', domains, basis: self ? 'self' : 'creator', givenBy: userId, at: now });
    audit(state, userId, recipientId, 'overview', 'profile_created', msg('au_profile_created', { actor: name, name: rName }), now, recipientId);
  }

  const user: User = {
    id: userId,
    name,
    role: input.role,
    title: (input.title ?? '').trim() || ROLE_LABEL[input.role],
    org: (input.org ?? '').trim() || (isHousehold(input.role) ? 'Family' : ''),
    email,
    initials: initialsOf(name),
    color: PALETTE[state.users.length % PALETTE.length],
    available: true,
    skills: (input.skills ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 12),
    recipients: [],
    orgId: null,
  };
  state.users.push(user);
  notify(state, [user.id], null, msg('n_signup_welcome', { first: name.split(' ')[0], role: user.role }), 'system', now);
  notify(state, coordinators(state), null, msg(recipientId ? 'n_signup_family' : 'n_signup_staff', { name, role: user.role, recipient: input.recipient?.name || name }), 'system', now);
  let m = msg('m_signed_up', { first: name.split(' ')[0] });
  if (invite) {
    const res = apply(state, user.id, { type: 'accept_invite', code: invite.code }, now, ctx);
    state = res.state;
    recipientId = invite.recipientId;
    m = res.m;
  }
  syncLinks(state, now);
  if (!isHousehold(user.role)) pickUpQueue(state, now);
  state.version += 1;
  return { state, userId: user.id, recipientId, m };
}
