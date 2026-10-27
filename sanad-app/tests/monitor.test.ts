// Phase 4: notification preferences and quiet hours, background monitoring, standing permissions,
// controlled adaptation and the administrative forecast.
import { describe, expect, it } from 'vitest';
import { createSeed } from '../shared/seed';
import { apply, notify, sweep, upgrade, viewFor } from '../shared/engine';
import { cleanPrefs, quietUntil } from '../shared/notify';
import { forecast } from '../shared/forecast';
import { renderMsg } from '../shared/messages';
import { dayKey, doseSlots, slotTime } from '../shared/records';
import type { Action, NotifyPrefs, State } from '../shared/types';

const NOW = Date.UTC(2026, 9, 27, 14, 0, 0);
const H = 3_600_000;
const run = (s: State, by: string, a: Action, at = NOW) => apply(s, by, a, at).state;
const quiet: NotifyPrefs = { tz: 'Asia/Dubai', quiet: true, quietFrom: '22:00', quietTo: '07:00', urgentThrough: true, muted: [] };
const inbox = (s: State, u: string) => s.notifications.filter((n) => n.userId === u);

describe('notification preferences and quiet hours', () => {
  it('holds routine notifications during quiet hours and lets urgent ones through', () => {
    const s = createSeed(NOW);
    s.users.find((u) => u.id === 'u-mariam')!.prefs = quiet;
    const night = Date.UTC(2026, 9, 27, 19, 30); // 23:30 in Dubai
    notify(s, ['u-mariam'], null, { k: 'm_saved' }, 'update', night);
    const routine = inbox(s, 'u-mariam')[0];
    expect(routine.heldUntil).toBe(Date.UTC(2026, 9, 28, 3, 0)); // 07:00 Dubai
    notify(s, ['u-mariam'], null, { k: 'm_saved' }, 'escalation', night);
    expect(inbox(s, 'u-mariam')[0].heldUntil).toBeUndefined();
    expect(inbox(s, 'u-mariam')[0].urgent).toBe(true);
    s.users.find((u) => u.id === 'u-mariam')!.prefs = { ...quiet, urgentThrough: false };
    notify(s, ['u-mariam'], null, { k: 'm_saved' }, 'escalation', night);
    expect(inbox(s, 'u-mariam')[0].heldUntil).toBeTruthy();
    // Outside quiet hours nothing is held.
    expect(quietUntil(quiet, Date.UTC(2026, 9, 27, 8))).toBeNull();
  });

  it('muting skips routine groups but never escalations or assignments', () => {
    const s = createSeed(NOW);
    s.users.find((u) => u.id === 'u-aisha')!.prefs = { ...quiet, quiet: false, muted: ['reminders', 'monitoring'] };
    const before = inbox(s, 'u-aisha').length;
    notify(s, ['u-aisha'], null, { k: 'm_saved' }, 'update', NOW, undefined, { group: 'reminders' });
    notify(s, ['u-aisha'], null, { k: 'm_saved' }, 'update', NOW, undefined, { group: 'monitoring' });
    expect(inbox(s, 'u-aisha').length).toBe(before);
    notify(s, ['u-aisha'], null, { k: 'm_saved' }, 'escalation', NOW);
    notify(s, ['u-aisha'], null, { k: 'm_saved' }, 'assigned', NOW);
    expect(inbox(s, 'u-aisha').length).toBe(before + 2);
  });

  it('validates settings and keeps them private', () => {
    expect(cleanPrefs({ ...quiet, tz: 'Mars/Olympus' })).toBeNull();
    expect(cleanPrefs({ ...quiet, quietTo: '22:00' })).toBeNull();
    expect(cleanPrefs({ ...quiet, quietFrom: '25:00' })).toBeNull();
    expect(cleanPrefs({ ...quiet, muted: ['reminders', 'escalations' as never] })!.muted).toEqual(['reminders']);
    let s = createSeed(NOW);
    expect(() => run(s, 'u-mariam', { type: 'update_notify_prefs', prefs: { ...quiet, tz: 'nowhere' } })).toThrow();
    s = run(s, 'u-mariam', { type: 'update_notify_prefs', prefs: quiet });
    expect(viewFor(s, 'u-mariam', NOW).users.find((u) => u.id === 'u-mariam')!.prefs).toEqual(quiet);
    expect(viewFor(s, 'u-aisha', NOW).users.find((u) => u.id === 'u-mariam')!.prefs).toBeUndefined();
  });
});

describe('background monitoring', () => {
  it('flags unlogged doses without calling them missed, tells only people who can see medicines, once', () => {
    const s = createSeed(NOW);
    const a = s.alerts.find((x) => x.kind === 'dose_unlogged' && x.recipientId === 'r-khadija' && !x.resolvedAt)!;
    expect(a).toBeTruthy();
    const text = renderMsg(a.m, 'en');
    expect(text).toMatch(/nothing logged/);
    expect(text).toMatch(/does not mean they were missed or taken/);
    expect(a.notified.sort()).toEqual(['u-aisha', 'u-khadija']);
    expect(viewFor(s, 'u-faisal', NOW).alerts.some((x) => x.kind === 'dose_unlogged')).toBe(false);
    expect(viewFor(s, 'u-grace', NOW).alerts).toHaveLength(0);
    expect(viewFor(s, 'u-sara', NOW).alerts.some((x) => x.kind === 'dose_unlogged')).toBe(false);
    const count = s.notifications.length;
    sweep(s, NOW + 60_000);
    sweep(s, NOW + 120_000);
    expect(s.notifications.length).toBe(count);
  });

  it('closes the alert by itself when the doses are logged', () => {
    let s = createSeed(NOW);
    const today = dayKey(NOW);
    for (const m of s.medications.filter((x) => x.recipientId === 'r-khadija' && x.active))
      for (const slot of doseSlots(m, s.doseLogs, today).filter((x) => !x.log && slotTime(x.slot) <= NOW))
        s = run(s, 'u-khadija', { type: 'log_dose', medicationId: m.id, slot: slot.slot, status: 'unknown', note: '' });
    expect(s.alerts.some((x) => x.kind === 'dose_unlogged' && x.recipientId === 'r-khadija' && !x.resolvedAt)).toBe(false);
  });

  it('warns when cover starts within a day and nobody has offered; offering clears it', () => {
    let s = createSeed(NOW);
    s = run(s, 'u-aisha', { type: 'request_cover', recipientId: 'r-fatima', from: NOW + 10 * H, to: NOW + 14 * H, reason: 'Clinic visit', domain: 'overview' });
    const a = s.alerts.find((x) => x.kind === 'cover_unfilled' && !x.resolvedAt)!;
    expect(a).toBeTruthy();
    expect(a.notified).toEqual(expect.arrayContaining(['u-mariam', 'u-sara']));
    expect(inbox(s, 'u-sara')[0].urgent).toBe(true);
    s = run(s, 'u-mariam', { type: 'offer_cover', taskId: a.targetId!, allowConflict: true });
    expect(s.alerts.find((x) => x.id === a.id)!.resolvedAt).toBeTruthy();
  });

  it('reminds only the approvers when a request is about to expire', () => {
    const s = createSeed(NOW);
    const pending = s.approvals.find((x) => x.status === 'pending')!;
    sweep(s, pending.expiresAt - 6 * H);
    const a = s.alerts.find((x) => x.kind === 'approval_expiring' && x.targetId === pending.id)!;
    expect(a.notified).toEqual(pending.approverIds);
    const outsider = s.users.find((u) => !pending.approverIds.includes(u.id) && u.id !== pending.requestedBy && viewFor(s, u.id, NOW).access[pending.recipientId])!;
    expect(viewFor(s, outsider.id, pending.expiresAt - 6 * H).alerts.some((x) => x.id === a.id)).toBe(false);
  });
});

describe('standing permissions', () => {
  it('only the person or a verified guardian can give one, within limits', () => {
    const s = createSeed(NOW);
    expect(() => run(s, 'u-aisha', { type: 'grant_standing', recipientId: 'r-fatima', kind: 'refill_task', ownerId: 'u-aisha', days: 30 })).toThrow(/verified guardian/);
    expect(() => run(s, 'u-mariam', { type: 'grant_standing', recipientId: 'r-fatima', kind: 'refill_task', ownerId: 'u-aisha', days: 400 })).toThrow();
    expect(() => run(s, 'u-mariam', { type: 'grant_standing', recipientId: 'r-fatima', kind: 'change_dose' as never, ownerId: null, days: 30 })).toThrow();
    // The owner of refill tasks must be able to see medicines.
    expect(() => run(s, 'u-mariam', { type: 'grant_standing', recipientId: 'r-fatima', kind: 'refill_task', ownerId: 'u-sara', days: 30 })).toThrow();
  });

  it('acts with the giver’s permissions, once, and records it', () => {
    let s = createSeed(NOW);
    s = run(s, 'u-mariam', { type: 'grant_standing', recipientId: 'r-fatima', kind: 'refill_task', ownerId: 'u-aisha', days: 30 });
    const insulin = s.medications.find((m) => m.recipientId === 'r-fatima' && /insulin/i.test(m.name))!;
    s = run(s, 'u-aisha', { type: 'update_supply', medicationId: insulin.id, onHand: 2 });
    const a = s.alerts.find((x) => x.kind === 'refill_due' && x.targetId === insulin.id && !x.resolvedAt)!;
    expect(a.auto?.ok).toBe(true);
    const t = s.tasks.find((x) => x.id === a.auto!.createdId)!;
    expect(t.createdBy).toBe('u-mariam');
    expect(t.ownerId).toBe('u-aisha');
    expect(t.domain).toBe('medical');
    expect(t.events.some((e) => e.m.k === 'ev_task_auto')).toBe(true);
    expect(s.audit.some((e) => e.type === 'auto_action' && e.targetId === t.id)).toBe(true);
    const n = s.tasks.length;
    sweep(s, NOW + H);
    expect(s.tasks.length).toBe(n);
  });

  it('reports a failure instead of hiding it, and creates nothing', () => {
    let s = createSeed(NOW);
    s = run(s, 'u-mariam', { type: 'grant_standing', recipientId: 'r-fatima', kind: 'refill_task', ownerId: 'u-aisha', days: 30 });
    // Aisha loses access to medicines after the permission was given.
    const m = s.memberships.find((x) => x.userId === 'u-aisha' && x.recipientId === 'r-fatima')!;
    s = run(s, 'u-mariam', { type: 'set_access', membershipId: m.id, domains: m.domains.filter((d) => d !== 'medical') });
    const insulin = s.medications.find((x) => x.recipientId === 'r-fatima' && /insulin/i.test(x.name))!;
    const tasks = s.tasks.length;
    s = run(s, 'u-mariam', { type: 'update_supply', medicationId: insulin.id, onHand: 2 });
    const a = s.alerts.find((x) => x.kind === 'refill_due' && x.targetId === insulin.id && !x.resolvedAt)!;
    expect(a.auto?.ok).toBe(false);
    expect(s.tasks.length).toBe(tasks);
    expect(inbox(s, 'u-mariam').some((x) => x.m?.k === 'n_auto_failed')).toBe(true);
  });

  it('can be withdrawn by the person or guardian, not by others, and is hidden from people outside the team section', () => {
    let s = createSeed(NOW);
    const p = s.standing.find((x) => x.recipientId === 'r-fatima' && !x.revokedAt)!;
    expect(() => run(s, 'u-aisha', { type: 'revoke_standing', permissionId: p.id })).toThrow();
    s = run(s, 'u-mariam', { type: 'revoke_standing', permissionId: p.id });
    expect(s.standing.find((x) => x.id === p.id)!.revokedAt).toBeTruthy();
    expect(viewFor(s, 'u-aisha', NOW).standing.some((x) => x.id === p.id)).toBe(false);
  });

  it('the seeded follow-up permission created a task when an appointment had no outcome', () => {
    const s = createSeed(NOW);
    const a = s.alerts.find((x) => x.kind === 'appt_no_outcome' && x.recipientId === 'r-fatima')!;
    expect(a.auto?.ok).toBe(true);
    expect(s.tasks.find((t) => t.id === a.auto!.createdId)!.title).toMatch(/^Record what happened/);
  });
});

describe('controlled adaptation', () => {
  it('suggests a new time for a task that keeps being done late; only someone who manages it can decide', () => {
    let s = createSeed(NOW);
    const p = s.proposals.find((x) => x.status === 'open' && x.recipientId === 'r-khadija')!;
    expect(p).toBeTruthy();
    expect(p.fromTime).toBe('08:00');
    expect(p.toTime).toBe('11:30');
    expect(p.evidence.length).toBeGreaterThanOrEqual(3);
    expect(() => run(s, 'u-aisha', { type: 'decide_proposal', proposalId: p.id, decision: 'accept' })).toThrow();
    const before = s.tasks.find((t) => t.id === p.taskId)!;
    s = run(s, 'u-faisal', { type: 'decide_proposal', proposalId: p.id, decision: 'accept' });
    const after = s.tasks.find((t) => t.id === p.taskId)!;
    expect(new Date(after.dueAt!).getHours()).toBe(11);
    expect(new Date(after.dueAt!).getMinutes()).toBe(30);
    // Only the time changed.
    expect([after.title, after.recurrence, after.ownerId, after.domain]).toEqual([before.title, before.recurrence, before.ownerId, before.domain]);
    expect(s.proposals.find((x) => x.id === p.id)!.status).toBe('accepted');
    expect(() => run(s, 'u-faisal', { type: 'decide_proposal', proposalId: p.id, decision: 'accept' })).toThrow(/already/);
  });

  it('a dismissed suggestion is not repeated for 14 days', () => {
    let s = createSeed(NOW);
    const p = s.proposals.find((x) => x.status === 'open')!;
    s = run(s, 'u-khadija', { type: 'decide_proposal', proposalId: p.id, decision: 'dismiss' });
    sweep(s, NOW + 2 * 24 * H);
    expect(s.proposals.filter((x) => x.seriesId === p.seriesId && x.status === 'open')).toHaveLength(0);
  });
});

describe('administrative forecast', () => {
  it('shows supplies only to people who can see medicines, with the rule used', () => {
    const s = createSeed(NOW);
    const mariam = forecast(viewFor(s, 'u-mariam', NOW), NOW, 14);
    const refill = mariam.find((x) => x.kind === 'refill')!;
    expect(refill).toBeTruthy();
    expect(renderMsg(refill.rule, 'en')).toMatch(/units on hand/);
    expect(forecast(viewFor(s, 'u-sara', NOW), NOW, 14).some((x) => x.kind === 'refill')).toBe(false);
    expect(forecast(viewFor(s, 'u-grace', NOW), NOW, 30).some((x) => x.recipientId === 'r-fatima')).toBe(false);
  });

  it('flags busy days for one person', () => {
    let s = createSeed(NOW);
    for (let i = 0; i < 5; i++) s = run(s, 'u-mariam', { type: 'add_task', recipientId: 'r-fatima', task: { title: `Errand ${i + 1}`, notes: '', domain: 'overview', ownerId: 'u-mariam', priority: 'low', dueAt: NOW + 24 * H + i * H, recurrence: 'none', dependsOn: [], needsApproval: false, evidenceRequired: false, planId: null } });
    expect(forecast(viewFor(s, 'u-mariam', NOW), NOW, 7).some((x) => x.kind === 'busy' && x.userId === 'u-mariam')).toBe(true);
  });
});

describe('saved data', () => {
  it('upgrades to schema 4 without changing anything else', () => {
    const s = createSeed(NOW) as State & Record<string, unknown>;
    const old = { ...s, schema: 3 } as State;
    delete (old as Partial<State>).alerts;
    delete (old as Partial<State>).standing;
    delete (old as Partial<State>).proposals;
    const up = upgrade(JSON.parse(JSON.stringify(old)));
    expect(up.schema).toBe(4);
    expect(up.alerts).toEqual([]);
    expect(up.tasks.length).toBe(s.tasks.length);
  });
});
