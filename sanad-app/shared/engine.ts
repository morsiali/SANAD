// The command engine: every change to SANAD goes through apply(), on the server and in the browser.
import {
  EngineError,
  ROLE_LABEL,
  type Action,
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

const fail = (k: string, p?: Record<string, string | number>, status = 400) => {
  const m = msg(k, p);
  return new EngineError(m, status, en(m));
};

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function nextId(state: State, prefix: string): string {
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
  return u.role === 'family' && u.recipients.includes(c.recipientId);
}

export function canSee(u: User, c: Challenge): boolean {
  if (isCoordinator(u)) return true;
  if (c.reporterId === u.id || c.assigneeId === u.id || c.watchers.includes(u.id)) return true;
  if (u.recipients.includes(c.recipientId)) return true;
  if (u.role !== 'family' && c.role === u.role) return true;
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

function notify(
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

const coordinators = (state: State) => state.users.filter(isCoordinator).map((u) => u.id);
const familyOf = (state: State, c: Challenge) => state.users.filter((u) => isFamilyOf(u, c)).map((u) => u.id);
const stakeholders = (state: State, c: Challenge) => [c.reporterId, c.assigneeId, ...c.watchers, ...familyOf(state, c)];

function requireText(v: string | undefined, label: string, min = 3): string {
  const t = (v ?? '').trim();
  if (t.length < min) throw fail('e_min', { label: `@${label}`, min });
  return t;
}

function assignTo(state: State, c: Challenge, role: Role, actorId: string, why: Msg, now: number, exclude: string[] = []) {
  const loads = computeLoads(state.users, state.challenges);
  const pick = selectAssignee(state.users, loads, role, c.recipientId, `${c.title} ${c.description}`, state.settings, exclude);
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
export function apply(prev: State, actorId: string, action: Action, now = Date.now()): ApplyResult {
  const state = clone(prev);
  const me = getUser(state, actorId);
  let m: Msg = msg('m_saved');
  let createdId: string | undefined;
  const noChange = (): ApplyResult => ({ state: prev, message: 'No change', m: msg('m_no_change') });

  const workOn = (id: string, check: (c: Challenge) => boolean, deny: string) => {
    const c = getChallenge(state, id);
    if (!canSee(me, c)) throw fail('e_access', undefined, 403);
    if (!check(c)) throw fail(deny, undefined, 403);
    return c;
  };

  switch (action.type) {
    case 'create_challenge': {
      const title = requireText(action.title, 'lbl_title', 4);
      const description = (action.description ?? '').trim();
      const recipient = state.recipients.find((r) => r.id === action.recipientId);
      if (!recipient) throw fail('e_who');
      if (me.role === 'family' && !me.recipients.includes(recipient.id)) throw fail('e_family_only', undefined, 403);
      const decision = decideRouting(
        { title, description, recipientId: recipient.id, priority: action.priority, category: action.category },
        { users: state.users, rules: state.rules, settings: state.settings, loads: computeLoads(state.users, state.challenges) },
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
        recipients: action.recipients.filter((r) => state.recipients.some((x) => x.id === r)),
      };
      state.users.push(u);
      notify(state, [u.id], null, msg('n_welcome', { first: name.split(' ')[0], name: me.name, role: u.role }), 'system', now);
      pickUpQueue(state, now);
      createdId = u.id;
      m = msg('m_added', { name });
      break;
    }

    case 'update_user': {
      if (!isCoordinator(me)) throw fail('e_add_team', undefined, 403);
      const target = getUser(state, action.userId);
      target.title = action.title.trim() || ROLE_LABEL[target.role];
      target.org = action.org.trim();
      target.skills = action.skills.map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 12);
      target.recipients = action.recipients.filter((r) => state.recipients.some((x) => x.id === r));
      notify(state, [target.id], null, msg('n_profile_updated', { name: me.name }), 'system', now, me.id);
      m = msg('m_user_updated', { name: target.name });
      break;
    }

    case 'add_recipient': {
      if (!isCoordinator(me)) throw fail('e_add_recipient', undefined, 403);
      const name = requireText(action.name, 'lbl_name', 2);
      const age = Math.round(Number(action.age));
      if (!Number.isFinite(age) || age < 1 || age > 120) throw fail('e_age');
      const id = nextId(state, 'r');
      state.recipients.push({ id, name, age, area: action.area.trim(), note: action.note.trim() });
      for (const fid of action.familyIds) {
        const f = state.users.find((u) => u.id === fid);
        if (f && !f.recipients.includes(id)) f.recipients.push(id);
      }
      createdId = id;
      m = msg('m_added', { name });
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
      const t = (action as { type: string }).type;
      throw fail('e_unknown', { type: t });
    }
  }

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
  let changed = false;
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

export function viewFor(state: State, userId: string): View {
  const me = getUser(state, userId);
  return {
    ...state,
    me: userId,
    challenges: state.challenges.filter((c) => canSee(me, c)),
    notifications: state.notifications.filter((n) => n.userId === userId),
    loads: computeLoads(state.users, state.challenges),
  };
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
export const SELF_SIGNUP_ROLES: Role[] = ['family', 'caregiver', 'doctor', 'transport', 'pharmacy', 'social'];

export interface RegisterInput {
  role: Role;
  name: string;
  email: string;
  title?: string;
  org?: string;
  skills?: string[];
  /** Family only: the person they care for. */
  recipient?: { name: string; age: number; area: string; note?: string };
}

export interface RegisterResult {
  state: State;
  userId: string;
  recipientId?: string;
  m: Msg;
}

/** Creates an account for a new person. Pure: returns a new state, throws EngineError on invalid input. */
export function register(prev: State, input: RegisterInput, now = Date.now()): RegisterResult {
  const state = clone(prev);
  if (!SELF_SIGNUP_ROLES.includes(input.role)) throw fail('e_signup_role', undefined, 403);
  const name = requireText(input.name, 'lbl_name', 2);
  const email = requireText(input.email, 'lbl_email', 5).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('e_email');
  if (state.users.some((u) => u.email.toLowerCase() === email)) throw fail('e_email_taken', undefined, 409);

  let recipientId: string | undefined;
  if (input.role === 'family') {
    const r = input.recipient;
    const rName = requireText(r?.name, 'lbl_recipient', 2);
    const age = Math.round(Number(r?.age));
    if (!Number.isFinite(age) || age < 1 || age > 120) throw fail('e_age');
    recipientId = nextId(state, 'r');
    state.recipients.push({ id: recipientId, name: rName, age, area: (r?.area ?? '').trim(), note: (r?.note ?? '').trim() });
  }

  const user: User = {
    id: nextId(state, 'u'),
    name,
    role: input.role,
    title: (input.title ?? '').trim() || ROLE_LABEL[input.role],
    org: (input.org ?? '').trim() || (input.role === 'family' ? 'Family' : ''),
    email,
    initials: initialsOf(name),
    color: PALETTE[state.users.length % PALETTE.length],
    available: true,
    skills: (input.skills ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 12),
    recipients: recipientId ? [recipientId] : [],
  };
  state.users.push(user);
  notify(state, [user.id], null, msg('n_signup_welcome', { first: name.split(' ')[0], role: user.role }), 'system', now);
  notify(state, coordinators(state), null, msg(recipientId ? 'n_signup_family' : 'n_signup_staff', { name, role: user.role, recipient: input.recipient?.name ?? '' }), 'system', now);
  if (user.role !== 'family') pickUpQueue(state, now);
  state.version += 1;
  return { state, userId: user.id, recipientId, m: msg('m_signed_up', { first: name.split(' ')[0] }) };
}
