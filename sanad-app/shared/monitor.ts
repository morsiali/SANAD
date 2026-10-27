// Background monitoring, standing permissions and controlled adaptation. Runs inside the periodic sweep
// on the server (and in the browser demo), using the same rules and permissions as everything else.
//
// - Each rule is simple and stated in plain words on the alert ("why").
// - An alert notifies once, stays open while the condition holds, and closes by itself when it clears.
// - Nothing is assumed: a dose with nothing logged is "not logged", never "missed" or "taken".
// - SANAD acts on its own only under a standing permission given by the person or their verified guardian,
//   only for the listed low-risk actions, and always with that person's own permissions. Failures are reported.
// - Adaptation only proposes a new time for recurring work; a person with the right to change the task decides.
import type { Action, Appointment, CareTask, Domain, Medication, MonitorAlert, Msg, Proposal, Recipient, StandingKind, State, User } from './types';
import { authorityHolders, domainsFor, hasAuthority, isLive, membershipFor } from './access';
import { dayKey, doseSlots, refillForecast, slotTime } from './records';
import { isOpenTask } from './plans';
import { coordinators, fail, nextId, notify } from './engine';
import { audit, type CareResult } from './care-engine';
import { applyPlans, canManage, canSeeTask } from './plans-engine';
import { msg } from './messages';

const H = 3_600_000;
const DAY = 24 * H;

export const UNLOGGED_AFTER_HOURS = 2;
export const OUTCOME_AFTER_HOURS = 12;
export const COVER_WARN_HOURS = 24;
export const APPROVAL_WARN_HOURS = 12;
export const STANDING_MAX_DAYS = 365;
export const ADAPT_LOOKBACK_DAYS = 28;
export const ADAPT_MIN_LATE = 3;
export const ADAPT_SNOOZE_DAYS = 14;

/** Actions SANAD may take on its own when allowed. Everything else always needs a person. */
export const STANDING_KINDS: StandingKind[] = ['refill_task', 'outcome_task'];

interface Finding {
  key: string;
  kind: MonitorAlert['kind'];
  r: Recipient;
  domain: Domain;
  m: Msg;
  why: Msg;
  link: string;
  targetId?: string;
  notifyIds: string[];
  urgent?: boolean;
  audience?: string[];
  standing?: { kind: StandingKind; build: (ownerId: string | null) => Action | null };
}

const can = (state: State, userId: string, rid: string, d: Domain, now: number) => domainsFor(state, userId, rid, now).includes(d);
const household = (state: State, r: Recipient, d: Domain, now: number) =>
  state.users.filter((u) => ['self', 'family', 'caregiver'].includes(u.role) && membershipFor(state, u.id, r.id, now) && can(state, u.id, r.id, d, now)).map((u) => u.id);
const hhmm = (at: number) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const minuteOfDay = (at: number) => {
  const d = new Date(at);
  return d.getHours() * 60 + d.getMinutes();
};

function findings(state: State, now: number): Finding[] {
  const out: Finding[] = [];
  const today = dayKey(now);
  for (const r of state.recipients) {
    const base = `/app/people/${r.id}`;
    const meds = state.medications.filter((m) => m.recipientId === r.id && m.active);

    // Doses with nothing logged two hours after their time (today only).
    let unlogged = 0;
    for (const m of meds) for (const s of doseSlots(m, state.doseLogs, today)) if (!s.log && slotTime(s.slot) <= now - UNLOGGED_AFTER_HOURS * H) unlogged += 1;
    if (unlogged)
      out.push({ key: `dose:${r.id}:${today}`, kind: 'dose_unlogged', r, domain: 'medical', m: msg('al_dose', { recipient: r.name, n: unlogged }), why: msg('why_al_dose', { hours: UNLOGGED_AFTER_HOURS }), link: `${base}?tab=medical`, notifyIds: household(state, r, 'medical', now) });

    // Supply running low by the transparent refill rule.
    for (const m of meds) {
      const f = refillForecast(m, now);
      if (!f.due) continue;
      out.push({
        key: `refill:${m.id}:${m.supplyUpdatedAt ?? m.updatedAt}`,
        kind: 'refill_due',
        r,
        domain: 'medical',
        m: msg('al_refill', { med: m.name, recipient: r.name, n: f.daysLeft ?? 0 }),
        why: msg('why_al_refill', { onHand: m.onHand ?? 0, per: m.perDose ?? 0, times: m.times.length }),
        link: `${base}?tab=medical`,
        targetId: m.id,
        notifyIds: household(state, r, 'medical', now),
        urgent: (f.daysLeft ?? 99) <= 2,
        standing: { kind: 'refill_task', build: (ownerId) => refillTask(r, m, ownerId, f.daysLeft ?? 0, now) },
      });
    }

    // Cover needed within a day and nobody has offered.
    for (const t of state.tasks) {
      if (t.recipientId !== r.id || t.kind !== 'coverage' || t.ownerId || t.status !== 'scheduled' || !t.coverFrom || !t.coverTo) continue;
      if (t.coverTo <= now || t.coverFrom - now > COVER_WARN_HOURS * H) continue;
      const coords = t.domain === 'overview' ? coordinators(state).filter((id) => state.users.find((u) => u.id === id)?.orgId === r.orgId) : [];
      const who = [t.createdBy, ...authorityHolders(state, r.id, now).map((x) => x.userId), ...coords].filter((id) => canSeeTask(state, id, t, now));
      out.push({ key: `cover:${t.id}`, kind: 'cover_unfilled', r, domain: t.domain, m: msg('al_cover', { recipient: r.name, at: t.coverFrom }), why: msg('why_al_cover', { hours: COVER_WARN_HOURS }), link: `${base}?tab=plans`, targetId: t.id, notifyIds: who, urgent: true });
    }

    // Appointments that ended without anyone recording what happened.
    for (const a of state.appointments) {
      if (a.recipientId !== r.id || a.status !== 'scheduled' || a.endAt > now - OUTCOME_AFTER_HOURS * H) continue;
      const who = [a.createdBy, ...a.attendeeIds].filter((id) => can(state, id, r.id, a.domain, now));
      out.push({
        key: `outcome:${a.id}`,
        kind: 'appt_no_outcome',
        r,
        domain: a.domain,
        m: msg('al_outcome', { title: a.title, recipient: r.name, at: a.startAt }),
        why: msg('why_al_outcome', { hours: OUTCOME_AFTER_HOURS }),
        link: `${base}?tab=appointments`,
        targetId: a.id,
        notifyIds: who,
        standing: { kind: 'outcome_task', build: () => outcomeTask(r, a, now) },
      });
    }

    // Requests that will expire without a decision.
    for (const ap of state.approvals) {
      if (ap.recipientId !== r.id || ap.status !== 'pending' || ap.expiresAt <= now || ap.expiresAt - now > APPROVAL_WARN_HOURS * H) continue;
      out.push({ key: `appr:${ap.id}`, kind: 'approval_expiring', r, domain: 'overview', m: msg('al_approval', { recipient: r.name, at: ap.expiresAt }), why: msg('why_al_approval', { hours: APPROVAL_WARN_HOURS }), link: '/app/approvals', targetId: ap.id, notifyIds: ap.approverIds, audience: [...ap.approverIds, ap.requestedBy] });
    }
  }
  return out;
}

function refillTask(r: Recipient, m: Medication, ownerId: string | null, daysLeft: number, now: number): Action | null {
  if (!ownerId) return null;
  return {
    type: 'add_task',
    recipientId: r.id,
    task: { title: `Arrange a refill: ${m.name}`, notes: `About ${daysLeft} days of supply left by the recorded schedule. Created by SANAD under a standing permission.`, domain: 'medical', ownerId, priority: daysLeft <= 3 ? 'high' : 'medium', dueAt: now + 12 * H, recurrence: 'none', dependsOn: [], needsApproval: false, evidenceRequired: false, planId: null },
  };
}

function outcomeTask(r: Recipient, a: Appointment, now: number): Action {
  return {
    type: 'add_task',
    recipientId: r.id,
    task: { title: `Record what happened: ${a.title}`, notes: 'The appointment ended without a recorded outcome. Created by SANAD under a standing permission.', domain: a.domain, ownerId: a.createdBy, priority: 'medium', dueAt: now + DAY, recurrence: 'none', dependsOn: [], needsApproval: false, evidenceRequired: false, planId: null },
  };
}

/** Runs one standing permission for a new finding. Acts as the person who gave it; reports failure instead of hiding it. */
function runStanding(state: State, f: Finding, alert: MonitorAlert, now: number) {
  if (!f.standing) return;
  const p = state.standing.find((x) => x.recipientId === f.r.id && x.kind === f.standing!.kind && !x.revokedAt && x.expiresAt > now);
  if (!p) return;
  const giver = state.users.find((u) => u.id === p.grantedBy);
  const action = f.standing.build(p.ownerId);
  if (!giver || !action) return;
  try {
    if (!hasAuthority(state, giver.id, f.r.id, now)) throw fail('e_standing_authority', undefined, 403);
    const res = applyPlans(state, giver, action, now) as CareResult;
    const t = state.tasks.find((x) => x.id === res.createdId);
    t?.events.push({ at: now, by: 'system', m: msg('ev_task_auto', { name: giver.name }) });
    p.uses += 1;
    alert.auto = { permissionId: p.id, ok: true, createdId: res.createdId, m: msg('al_auto_done', { title: t?.title ?? '' }) };
    audit(state, 'system', f.r.id, f.domain, 'auto_action', msg('au_auto', { title: t?.title ?? '', name: giver.name }), now, res.createdId);
  } catch (e) {
    const reason: Msg = (e as { m?: Msg }).m ?? msg('e_generic');
    alert.auto = { permissionId: p.id, ok: false, m: msg('al_auto_failed', { reason }) };
    audit(state, 'system', f.r.id, f.domain, 'auto_failed', msg('au_auto_failed', { name: giver.name }), now, p.id);
    notify(state, [giver.id], null, msg('n_auto_failed', { recipient: f.r.name, reason }), 'system', now, undefined, { link: f.link });
  }
}

/** Proposes a new time for recurring tasks that keep being done late. Never changes what is done or how often. */
function adapt(state: State, now: number): boolean {
  let changed = false;
  // Close proposals whose task is no longer open.
  for (const p of state.proposals) {
    if (p.status !== 'open') continue;
    const t = state.tasks.find((x) => x.id === p.taskId);
    if (!t || !isOpenTask(t)) {
      p.status = 'expired';
      changed = true;
    }
  }
  for (const t of state.tasks) {
    if (t.kind !== 'task' || t.recurrence === 'none' || t.recurrence === 'monthly' || t.status !== 'scheduled' || !t.dueAt) continue;
    const series = state.tasks
      .filter((x) => x.seriesId === t.seriesId && x.id !== t.id && x.dueAt && x.dueAt >= now - ADAPT_LOOKBACK_DAYS * DAY && (x.status === 'completed' || x.status === 'failed'))
      .sort((a, b) => (b.dueAt ?? 0) - (a.dueAt ?? 0))
      .slice(0, 5);
    const late = series.filter((x) => x.status === 'failed' || !!x.escalatedAt || ((x.completedAt ?? 0) - (x.dueAt ?? 0) > 2 * H));
    if (late.length < ADAPT_MIN_LATE) continue;
    const done = late.filter((x) => x.completedAt).map((x) => minuteOfDay(x.completedAt!)).sort((a, b) => a - b);
    if (done.length < ADAPT_MIN_LATE) continue;
    const median = done[Math.floor(done.length / 2)];
    const rounded = Math.round(median / 30) * 30;
    if (Math.abs(rounded - minuteOfDay(t.dueAt)) < 120) continue;
    const toTime = `${String(Math.floor(rounded / 60) % 24).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
    const recent = state.proposals.some((p) => p.seriesId === t.seriesId && (p.status === 'open' || ((p.status === 'dismissed' || p.status === 'accepted') && (p.decidedAt ?? 0) > now - ADAPT_SNOOZE_DAYS * DAY)));
    if (recent) continue;
    const r = state.recipients.find((x) => x.id === t.recipientId);
    if (!r) continue;
    const p: Proposal = {
      id: nextId(state, 'q'),
      key: `resched:${t.seriesId}:${toTime}`,
      kind: 'reschedule',
      recipientId: r.id,
      domain: t.domain,
      seriesId: t.seriesId,
      taskId: t.id,
      evidence: late.map((x) => x.id),
      fromTime: hhmm(t.dueAt),
      toTime,
      why: msg('why_proposal', { n: late.length, m: series.length, time: toTime }),
      status: 'open',
      createdAt: now,
    };
    state.proposals.push(p);
    const who = [t.createdBy, t.ownerId].filter((id): id is string => !!id && canSeeTask(state, id, t, now));
    notify(state, who, null, msg('n_proposal', { title: t.title, recipient: r.name, from: p.fromTime, to: p.toTime }), 'update', now, undefined, { group: 'monitoring', link: `/app/people/${r.id}?tab=plans` });
    audit(state, 'system', r.id, t.domain, 'proposal', msg('au_proposal', { title: t.title, from: p.fromTime, to: p.toTime }), now, p.id);
    changed = true;
  }
  return changed;
}

/** The background monitor. Returns true when anything changed. */
export function monitor(state: State, now: number): boolean {
  let changed = false;
  const found = findings(state, now);
  const live = new Set(found.map((f) => f.key));
  for (const a of state.alerts) {
    if (!a.resolvedAt && !live.has(a.key)) {
      a.resolvedAt = now;
      changed = true;
    }
  }
  for (const f of found) {
    const existing = state.alerts.find((a) => a.key === f.key && !a.resolvedAt);
    if (existing) {
      // Keep the wording current (e.g. the count of unlogged doses) without notifying again.
      if (JSON.stringify(existing.m) !== JSON.stringify(f.m)) {
        existing.m = f.m;
        existing.lastAt = now;
        changed = true;
      }
      continue;
    }
    if (state.alerts.some((a) => a.key === f.key)) continue; // resolved before with the same key: don't reopen
    const alert: MonitorAlert = { id: nextId(state, 'w'), key: f.key, kind: f.kind, recipientId: f.r.id, domain: f.domain, m: f.m, why: f.why, targetId: f.targetId, link: f.link, firstAt: now, lastAt: now, notified: [...new Set(f.notifyIds)], ...(f.audience ? { audience: f.audience } : {}) };
    state.alerts.push(alert);
    notify(state, alert.notified, null, f.m, f.urgent ? 'escalation' : 'update', now, undefined, { group: 'monitoring', urgent: !!f.urgent, link: f.link });
    runStanding(state, f, alert, now);
    changed = true;
  }
  if (adapt(state, now)) changed = true;
  // Keep the history bounded.
  if (state.alerts.length > 400) state.alerts = state.alerts.filter((a) => !a.resolvedAt || a.resolvedAt > now - 30 * DAY).slice(-400);
  return changed;
}

// ---------------------------------------------------------------- actions

export function applyMonitor(state: State, me: User, action: Action, now: number): CareResult | null {
  switch (action.type) {
    case 'grant_standing': {
      const r = state.recipients.find((x) => x.id === action.recipientId);
      if (!r) throw fail('e_who', undefined, 404);
      // Only the person or their verified guardian can let SANAD act on its own.
      if (!hasAuthority(state, me.id, r.id, now)) throw fail('e_standing_authority', undefined, 403);
      if (!STANDING_KINDS.includes(action.kind)) throw fail('e_standing_kind');
      const days = Math.round(Number(action.days));
      if (!Number.isFinite(days) || days < 1 || days > STANDING_MAX_DAYS) throw fail('e_standing_days', { max: STANDING_MAX_DAYS });
      let ownerId: string | null = null;
      if (action.kind === 'refill_task') {
        const u = state.users.find((x) => x.id === action.ownerId);
        if (!u || u.role === 'admin' || !membershipFor(state, u.id, r.id, now) || !can(state, u.id, r.id, 'medical', now)) throw fail('e_owner_access', { name: u?.name ?? '?' });
        ownerId = u.id;
      }
      for (const p of state.standing) if (p.recipientId === r.id && p.kind === action.kind && !p.revokedAt) Object.assign(p, { revokedAt: now, revokedBy: me.id });
      const p = { id: nextId(state, 'p'), recipientId: r.id, kind: action.kind, grantedBy: me.id, ownerId, createdAt: now, expiresAt: now + days * DAY, uses: 0 };
      state.standing.push(p);
      audit(state, me.id, r.id, 'team', 'standing_granted', msg('au_standing', { actor: me.name, what: `@sp_${action.kind}`, days }), now, p.id);
      return { m: msg('m_standing_granted'), createdId: p.id };
    }
    case 'revoke_standing': {
      const p = state.standing.find((x) => x.id === action.permissionId && !x.revokedAt);
      if (!p) throw fail('e_standing', undefined, 404);
      if (p.grantedBy !== me.id && !hasAuthority(state, me.id, p.recipientId, now)) throw fail('e_standing_authority', undefined, 403);
      p.revokedAt = now;
      p.revokedBy = me.id;
      audit(state, me.id, p.recipientId, 'team', 'standing_revoked', msg('au_standing_revoked', { actor: me.name, what: `@sp_${p.kind}` }), now, p.id);
      return { m: msg('m_standing_revoked') };
    }
    case 'decide_proposal': {
      const p = state.proposals.find((x) => x.id === action.proposalId);
      const t = p ? state.tasks.find((x) => x.id === p.taskId) : undefined;
      if (!p || !t || !canSeeTask(state, me.id, t, now)) throw fail('e_proposal', undefined, 404);
      if (p.status !== 'open') throw fail('e_proposal_closed', { status: p.status }, 409);
      if (!canManage(state, me, t, now)) throw fail('e_task_manage', undefined, 403);
      if (action.decision === 'accept') {
        if (!isOpenTask(t) || !t.dueAt) throw fail('e_proposal_closed', { status: 'expired' }, 409);
        const d = new Date(t.dueAt);
        d.setHours(Number(p.toTime.slice(0, 2)), Number(p.toTime.slice(3, 5)), 0, 0);
        let due = d.getTime();
        if (due < now) due += DAY;
        // The change runs as a normal edit by this person, with all of its checks.
        applyPlans(state, me, { type: 'edit_task', taskId: t.id, baseVersion: t.version, task: { title: t.title, notes: t.notes, domain: t.domain, ownerId: t.ownerId, priority: t.priority, dueAt: due, recurrence: t.recurrence, dependsOn: t.dependsOn, needsApproval: t.needsApproval, evidenceRequired: t.evidenceRequired, planId: t.planId } }, now);
        p.status = 'accepted';
      } else p.status = 'dismissed';
      p.decidedBy = me.id;
      p.decidedAt = now;
      audit(state, me.id, p.recipientId, p.domain, 'proposal_decided', msg(p.status === 'accepted' ? 'au_proposal_accepted' : 'au_proposal_dismissed', { actor: me.name, title: t.title, to: p.toTime }), now, p.id);
      return { m: msg(p.status === 'accepted' ? 'm_proposal_accepted' : 'm_proposal_dismissed', { title: t.title, to: p.toTime }) };
    }
    case 'update_notify_prefs':
      return null; // handled in the main engine (it touches the user record)
    default:
      return null;
  }
}

export const visibleAlert = (a: MonitorAlert, userId: string, canDomain: (rid: string, d: Domain) => boolean) => canDomain(a.recipientId, a.domain) && (!a.audience || a.audience.includes(userId));
export { isLive };
