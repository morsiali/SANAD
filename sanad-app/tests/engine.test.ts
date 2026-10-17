import { describe, expect, it } from 'vitest';
import { createSeed } from '../shared/seed';
import { apply, viewFor, sweep } from '../shared/engine';
import { decideRouting, computeLoads, inferPriority, hasKeyword, normalize } from '../shared/routing';
import { ask, nextActions, recommendFor, rankPlaybooks } from '../shared/intelligence';
import { metrics } from '../shared/analytics';
import { EngineError, type State } from '../shared/types';

const NOW = Date.UTC(2026, 9, 17, 8, 0, 0);
const fresh = () => createSeed(NOW);
const route = (s: State, title: string, description = '', recipientId = 'r-fatima') =>
  decideRouting({ title, description, recipientId }, { users: s.users, rules: s.rules, settings: s.settings, loads: computeLoads(s.users, s.challenges) });

describe('keyword matching', () => {
  it('matches plurals and phrases', () => {
    expect(hasKeyword(normalize('She needs refills'), 'refill')).toBe(true);
    expect(hasKeyword(normalize('chest   pains since morning'), 'chest pain')).toBe(true);
    expect(hasKeyword(normalize('painting the room'), 'chest pain')).toBe(false);
  });
});

describe('priority inference', () => {
  it('detects safety signals', () => {
    expect(inferPriority('He fell and cannot get up').priority).toBe('urgent');
    expect(inferPriority('Ran out of insulin').priority).toBe('high');
    expect(inferPriority('Question about the bill, no rush').priority).toBe('low');
    expect(inferPriority('Update the address').priority).toBe('medium');
  });
});

describe('routing', () => {
  it('sends medication supply to the pharmacy', () => {
    const d = route(fresh(), 'Insulin pens running low', 'need a refill');
    expect(d.role).toBe('pharmacy');
    expect(d.assigneeId).toBe('u-omar');
    expect(d.confidence).toBeGreaterThan(0.5);
  });
  it('sends clinical concerns to the doctor who already knows the patient', () => {
    const d = route(fresh(), 'Blood pressure is very high', 'dizzy this evening', 'r-khadija');
    expect(d.role).toBe('doctor');
    expect(d.assigneeId).toBe('u-layla');
    expect(d.reasons.join(' ')).toMatch(/continuous/);
  });
  it('sends transport problems to transport', () => {
    expect(route(fresh(), 'The driver never came for pickup').role).toBe('transport');
  });
  it('floors falls at high priority', () => {
    const d = route(fresh(), 'Mum slipped in the kitchen', 'she is fine');
    expect(d.role).toBe('caregiver');
    expect(['high', 'urgent']).toContain(d.priority);
  });
  it('never under-rates an emergency even if the reporter picks low', () => {
    const s = fresh();
    const d = decideRouting({ title: 'Chest pain after lunch', description: '', recipientId: 'r-fatima', priority: 'low' }, { users: s.users, rules: s.rules, settings: s.settings, loads: {} });
    expect(d.priority).toBe('urgent');
  });
  it('sends unknown problems to coordinator triage', () => {
    const d = route(fresh(), 'Something odd happened', 'not sure what to do');
    expect(d.role).toBe('coordinator');
    expect(d.ruleId).toBeNull();
  });
  it('skips unavailable people and balances load', () => {
    let s = fresh();
    s = apply(s, 'u-omar', { type: 'set_availability', userId: 'u-omar', available: false }, NOW).state;
    const d = route(s, 'Need a prescription refill');
    expect(d.assigneeId).toBeNull();
    expect(d.reasons.join(' ')).toMatch(/team queue/);
  });
});

describe('workflow lifecycle', () => {
  it('runs report → route → accept → playbook → resolve → verify', () => {
    let s = fresh();
    const created = apply(s, 'u-mariam', { type: 'create_challenge', title: 'Ran out of inhaler', description: 'Need a refill today', recipientId: 'r-fatima', priority: 'auto' }, NOW);
    s = created.state;
    const id = created.createdId!;
    let c = s.challenges.find((x) => x.id === id)!;
    expect(c.stage).toBe('routed');
    expect(c.assigneeId).toBe('u-omar');
    expect(s.notifications.some((n) => n.userId === 'u-omar' && n.challengeId === id)).toBe(true);

    s = apply(s, 'u-omar', { type: 'accept', id }, NOW + 1000).state;
    const pb = recommendFor(viewFor(s, 'u-omar'), s.challenges.find((x) => x.id === id)!)[0];
    expect(pb.playbook.id).toBe('pb-refill');
    s = apply(s, 'u-omar', { type: 'apply_playbook', id, playbookId: pb.playbook.id }, NOW + 2000).state;
    c = s.challenges.find((x) => x.id === id)!;
    expect(c.stage).toBe('in_progress');
    expect(c.checklist.length).toBe(5);
    for (const item of c.checklist) s = apply(s, 'u-omar', { type: 'toggle_check', id, itemId: item.id }, NOW + 3000).state;
    expect(nextActions(viewFor(s, 'u-omar'), NOW + 3000).find((a) => a.challenge.id === id)?.kind).toBe('resolve');

    expect(() => apply(s, 'u-mariam', { type: 'resolve', id, resolution: 'done done' }, NOW)).toThrow(EngineError);
    s = apply(s, 'u-omar', { type: 'resolve', id, resolution: 'Delivered a new inhaler' }, NOW + 4000).state;
    const uses = s.playbooks.find((p) => p.id === 'pb-refill')!;
    const before = uses.successes;
    s = apply(s, 'u-mariam', { type: 'verify', id, rating: 5 }, NOW + 5000).state;
    c = s.challenges.find((x) => x.id === id)!;
    expect(c.stage).toBe('verified');
    expect(s.playbooks.find((p) => p.id === 'pb-refill')!.successes).toBe(before + 1);

    s = apply(s, 'u-mariam', { type: 'reopen', id, reason: 'Wrong strength delivered' }, NOW + 6000).state;
    c = s.challenges.find((x) => x.id === id)!;
    expect(c.stage).toBe('in_progress');
    expect(c.reopenCount).toBe(1);
  });

  it('hands off to another team with a reason', () => {
    let s = fresh();
    const r = apply(s, 'u-mariam', { type: 'create_challenge', title: 'Need a prescription refill', description: '', recipientId: 'r-fatima' }, NOW);
    s = apply(r.state, 'u-omar', { type: 'handoff', id: r.createdId!, role: 'doctor', reason: 'Prescription expired, needs renewal' }, NOW).state;
    const c = s.challenges.find((x) => x.id === r.createdId)!;
    expect(c.role).toBe('doctor');
    expect(['u-kareem', 'u-layla']).toContain(c.assigneeId);
    expect(c.history.at(-1)!.text).toMatch(/handed off/);
  });

  it('rebalances unstarted work when someone goes away', () => {
    let s = fresh();
    const r = apply(s, 'u-sara', { type: 'create_challenge', title: 'Help with wound dressing', description: 'daily care visit', recipientId: 'r-fatima' }, NOW);
    s = r.state;
    expect(s.challenges.find((x) => x.id === r.createdId)!.assigneeId).toBe('u-aisha');
    s = apply(s, 'u-aisha', { type: 'set_availability', userId: 'u-aisha', available: false }, NOW).state;
    expect(s.challenges.find((x) => x.id === r.createdId)!.assigneeId).toBe('u-joseph');
  });

  it('escalates automatically when the SLA is breached', () => {
    let s = fresh();
    const r = apply(s, 'u-mariam', { type: 'create_challenge', title: 'Need a refill', description: '', recipientId: 'r-fatima', priority: 'high' }, NOW);
    s = r.state;
    const changed = sweep(s, NOW + 5 * 3.6e6);
    expect(changed).toBe(true);
    const c = s.challenges.find((x) => x.id === r.createdId)!;
    expect(c.escalated).toBe(true);
    expect(s.notifications.some((n) => n.userId === 'u-sara' && n.kind === 'escalation' && n.challengeId === c.id)).toBe(true);
  });
});

describe('permissions & visibility', () => {
  it('family only sees their own people', () => {
    const v = viewFor(fresh(), 'u-khalid');
    expect(v.challenges.length).toBeGreaterThan(0);
    expect(v.challenges.every((c) => c.recipientId === 'r-hamad')).toBe(true);
    expect(v.notifications.every((n) => n.userId === 'u-khalid')).toBe(true);
  });
  it('coordinator sees everything', () => {
    const s = fresh();
    expect(viewFor(s, 'u-sara').challenges.length).toBe(s.challenges.length);
  });
  it('blocks non-coordinators from changing rules', () => {
    expect(() => apply(fresh(), 'u-aisha', { type: 'delete_rule', id: 'rule-clinical' })).toThrow(/coordinator/);
  });
  it('validates new users', () => {
    const s = fresh();
    expect(() => apply(s, 'u-sara', { type: 'add_user', name: 'X Y', role: 'caregiver', title: '', org: '', email: 'aisha@sanad.ae', skills: [], recipients: [] })).toThrow(/already/);
    const r = apply(s, 'u-sara', { type: 'add_user', name: 'New Carer', role: 'caregiver', title: '', org: 'Rahma', email: 'new@sanad.ae', skills: ['meals'], recipients: [] });
    expect(r.state.users.find((u) => u.id === r.createdId)!.initials).toBe('NC');
  });
});

describe('seed world', () => {
  it('contains work in every live stage plus history', () => {
    const s = fresh();
    const stages = new Set(s.challenges.map((c) => c.stage));
    for (const st of ['reported', 'routed', 'accepted', 'in_progress', 'resolved', 'verified']) expect(stages.has(st as never)).toBe(true);
    const m = metrics(s.challenges, NOW);
    expect(m.open).toBeGreaterThan(4);
    expect(m.slaCompliance).not.toBeNull();
  });
});

describe('intelligence', () => {
  const v = () => viewFor(fresh(), 'u-sara');
  it('answers routing questions', () => {
    const a = ask(v(), 'Who handles a broken wheelchair?', NOW);
    expect(a.preview?.role).toBe('social');
  });
  it('recommends playbooks', () => {
    const a = ask(v(), 'How do I fix a missed medication dose?', NOW);
    expect(a.cards[0]).toEqual({ kind: 'playbook', id: 'pb-missed-dose' });
  });
  it('summarises a person', () => {
    expect(ask(v(), 'How is Fatima doing?', NOW).text).toMatch(/Fatima has \d+ open/);
  });
  it('looks up a reference', () => {
    const s = v();
    const ref = s.challenges[0].ref;
    expect(ask(s, `status of ${ref}`, NOW).cards[0]).toEqual({ kind: 'challenge', id: s.challenges[0].id });
  });
  it('ranks faster proven playbooks first', () => {
    expect(rankPlaybooks(fresh().playbooks, 'driver late for pickup to the appointment')[0].playbook.id).toBe('pb-ride-noshow');
  });
});
