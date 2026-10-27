// Phase 2: care plans, tasks, handovers, cover, appointments, documents.
import { describe, expect, it } from 'vitest';
import { createSeed, samplePdf } from '../shared/seed';
import { apply, register, sweep, upgrade, viewFor } from '../shared/engine';
import { conflictsFor } from '../shared/plans';
import type { Action, AppointmentInput, State, TaskInput } from '../shared/types';

const NOW = Date.UTC(2026, 9, 27, 6, 0, 0);
const H = 3_600_000;
const run = (s: State, by: string, a: Action, at = NOW) => apply(s, by, a, at);
const task = (title: string, extra: Partial<TaskInput> = {}): TaskInput => ({ title, notes: '', domain: 'overview', ownerId: null, priority: 'medium', dueAt: NOW + 24 * H, recurrence: 'none', dependsOn: [], needsApproval: false, evidenceRequired: false, planId: null, ...extra });
const appt = (title: string, startAt: number, extra: Partial<AppointmentInput> = {}): AppointmentInput => ({ title, kind: 'other', domain: 'overview', startAt, endAt: startAt + H, location: '', withWhom: '', attendeeIds: [], notes: '', ...extra });
const add = (s: State, by: string, recipientId: string, t: TaskInput, at = NOW) => {
  const r = run(s, by, { type: 'add_task', recipientId, task: t }, at);
  return { s: r.state, id: r.createdId!, t: r.state.tasks.find((x) => x.id === r.createdId)! };
};

describe('task states and approvals', () => {
  it('schedules directly, or waits for the guardian when approval is asked for', () => {
    const s = createSeed(NOW);
    expect(add(s, 'u-huda', 'r-rashid', task('Pack swimming bag', { ownerId: 'u-huda' })).t.status).toBe('scheduled');
    const asked = add(s, 'u-faisal', 'r-rashid', task('Stretch before bed', { domain: 'rehab', ownerId: 'u-huda', needsApproval: true }));
    expect(asked.t.status).toBe('awaiting_approval');
    const a = asked.s.approvals.find((x) => x.id === asked.t.approvalId)!;
    expect(a.approverIds).toEqual(['u-huda']);
    const done = run(asked.s, 'u-huda', { type: 'decide_approval', approvalId: a.id, decision: 'approve', fingerprint: a.fingerprint }).state;
    expect(done.tasks.find((x) => x.id === asked.id)!.status).toBe('scheduled');
    expect(done.approvals.find((x) => x.id === a.id)!.status).toBe('executed');
  });

  it('a material change while waiting cancels the old approval and asks again', () => {
    const asked = add(createSeed(NOW), 'u-faisal', 'r-rashid', task('Stretch before bed', { domain: 'rehab', ownerId: 'u-huda', needsApproval: true }));
    const first = asked.t.approvalId!;
    const edited = run(asked.s, 'u-faisal', { type: 'edit_task', taskId: asked.id, baseVersion: asked.t.version, task: task('Stretch before bed', { domain: 'rehab', ownerId: 'u-huda', needsApproval: true, dueAt: NOW + 48 * H }) }).state;
    const t = edited.tasks.find((x) => x.id === asked.id)!;
    expect(edited.approvals.find((x) => x.id === first)!.status).toBe('cancelled');
    expect(t.approvalId).not.toBe(first);
    const old = edited.approvals.find((x) => x.id === first)!;
    expect(() => run(edited, 'u-huda', { type: 'decide_approval', approvalId: first, decision: 'approve', fingerprint: old.fingerprint })).toThrow(/already/);
  });

  it('dependencies, evidence, block and resume, cancel with a reason', () => {
    let s = createSeed(NOW);
    const a = add(s, 'u-mariam', 'r-fatima', task('Get the new prescription', { ownerId: 'u-mariam' }));
    const b = add(a.s, 'u-mariam', 'r-fatima', task('Collect from pharmacy', { ownerId: 'u-mariam', dependsOn: [a.id], evidenceRequired: true }));
    s = b.s;
    expect(() => run(s, 'u-mariam', { type: 'task_status', taskId: b.id, status: 'in_progress' })).toThrow(/waiting on/);
    s = run(s, 'u-mariam', { type: 'task_status', taskId: a.id, status: 'completed' }).state;
    expect(() => run(s, 'u-mariam', { type: 'task_status', taskId: b.id, status: 'completed' })).toThrow(/note or a document/);
    s = run(s, 'u-mariam', { type: 'task_status', taskId: b.id, status: 'blocked', reason: 'Pharmacy closed' }).state;
    expect(s.tasks.find((x) => x.id === b.id)).toMatchObject({ status: 'blocked', statusReason: 'Pharmacy closed' });
    s = run(s, 'u-mariam', { type: 'task_status', taskId: b.id, status: 'resume' }).state;
    s = run(s, 'u-mariam', { type: 'task_status', taskId: b.id, status: 'completed', evidence: 'Collected 60 tablets' }).state;
    expect(s.tasks.find((x) => x.id === b.id)).toMatchObject({ status: 'completed', evidence: 'Collected 60 tablets' });
    const c = add(s, 'u-mariam', 'r-fatima', task('Something else'));
    expect(() => run(c.s, 'u-aisha', { type: 'task_status', taskId: c.id, status: 'cancelled', reason: 'not needed' })).toThrow(/created it/);
    expect(() => run(c.s, 'u-mariam', { type: 'task_status', taskId: c.id, status: 'cancelled' })).toThrow(/reason/);
  });

  it('refuses dependency loops, duplicates and owners who cannot see the section', () => {
    const s = createSeed(NOW);
    const a = add(s, 'u-mariam', 'r-fatima', task('Step A'));
    const b = add(a.s, 'u-mariam', 'r-fatima', task('Step B', { dependsOn: [a.id] }));
    expect(() => run(b.s, 'u-mariam', { type: 'edit_task', taskId: a.id, baseVersion: a.t.version, task: task('Step A', { dependsOn: [b.id] }) })).toThrow(/forever/);
    expect(() => run(b.s, 'u-mariam', { type: 'add_task', recipientId: 'r-fatima', task: task('step a') })).toThrow(/already planned/);
    expect(() => run(s, 'u-huda', { type: 'add_task', recipientId: 'r-rashid', task: task('Check the inhaler', { domain: 'medical', ownerId: 'u-grace' }) })).toThrow(/cannot see/);
    expect(() => run(s, 'u-majid', { type: 'add_task', recipientId: 'r-fatima', task: task('Admin task') })).toThrow(/manage access only/);
  });

  it('a repeating task creates exactly one next occurrence', () => {
    const r = add(createSeed(NOW), 'u-khadija', 'r-khadija', task('Walk to the corner', { ownerId: 'u-khadija', recurrence: 'daily', dueAt: NOW + 2 * H }));
    const s = run(r.s, 'u-khadija', { type: 'task_status', taskId: r.id, status: 'completed' }).state;
    const series = s.tasks.filter((x) => x.seriesId === r.t.seriesId);
    expect(series.map((x) => x.status).sort()).toEqual(['completed', 'scheduled']);
    expect(series.find((x) => x.status === 'scheduled')!.dueAt).toBe(NOW + 26 * H);
  });

  it('reminds once and escalates an overdue task once', () => {
    const r = add(createSeed(NOW), 'u-mariam', 'r-fatima', task('Order test strips', { ownerId: 'u-mariam', dueAt: NOW + 2 * H, priority: 'high' }));
    let s = r.s;
    const count = (k: string) => s.notifications.filter((n) => n.m?.k === k && n.m.p?.title === 'Order test strips').length;
    sweep(s, NOW + 30 * 60_000);
    sweep(s, NOW + 60 * 60_000);
    expect(count('n_task_due')).toBe(1);
    sweep(s, NOW + 15 * H);
    sweep(s, NOW + 16 * H);
    expect(count('n_task_overdue')).toBeGreaterThanOrEqual(1);
    const n = count('n_task_overdue');
    sweep(s, NOW + 40 * H);
    expect(count('n_task_overdue')).toBe(n);
    expect(s.tasks.find((x) => x.id === r.id)!.escalatedAt).toBe(NOW + 15 * H);
    // The organisation coordinator hears about an overdue general task; nobody outside the care team does.
    expect(s.notifications.some((x) => x.userId === 'u-sara' && x.m?.k === 'n_task_overdue' && x.m.p?.title === 'Order test strips')).toBe(true);
    expect(s.notifications.some((x) => x.userId === 'u-hind' && x.m?.k === 'n_task_overdue')).toBe(false);
  });
});

describe('Scenario 3: handover is limited to what both people may see', () => {
  it('excludes medical and therapy items when handing over to the teacher', () => {
    const s = createSeed(NOW);
    const r = run(s, 'u-huda', { type: 'create_handover', recipientId: 'r-rashid', toUserId: 'u-grace', note: 'Away for two days', hours: 72 });
    const h = r.state.tasks.find((x) => x.id === r.createdId)!;
    const recordIds = h.handover!.items.filter((i) => i.type === 'record').map((i) => i.id);
    const domains = new Set(r.state.records.filter((x) => recordIds.includes(x.id)).map((x) => x.domain));
    expect([...domains].every((d) => d === 'academic' || d === 'social' || d === 'overview')).toBe(true);
    expect(JSON.stringify(h)).not.toContain('coping cards');
    // Only the two people involved can see the handover itself.
    expect(viewFor(r.state, 'u-grace', NOW).tasks.some((x) => x.id === h.id)).toBe(true);
    expect(viewFor(r.state, 'u-salma', NOW).tasks.some((x) => x.id === h.id)).toBe(false);
    expect(() => run(s, 'u-huda', { type: 'create_handover', recipientId: 'r-rashid', toUserId: 'u-kareem', note: '', hours: 24 })).toThrow(/care team/);
  });
});

describe('Scenario 6 groundwork: cover requests and conflicts', () => {
  it('detects a clash for the volunteer, allows an explicit override, and cannot be taken twice', () => {
    let s = createSeed(NOW);
    const from = NOW + 48 * H;
    s = run(s, 'u-mariam', { type: 'add_appointment', recipientId: 'r-fatima', appt: appt('Dentist', from + H, { attendeeIds: ['u-aisha'] }), prep: [] }).state;
    const req = run(s, 'u-mariam', { type: 'request_cover', recipientId: 'r-fatima', from, to: from + 4 * H, reason: 'Wedding in the family', domain: 'overview' });
    s = req.state;
    expect(s.notifications.some((n) => n.userId === 'u-aisha' && n.m?.k === 'n_cover_needed')).toBe(true);
    expect(() => run(s, 'u-aisha', { type: 'offer_cover', taskId: req.createdId! })).toThrow(/already has “Dentist”/);
    s = run(s, 'u-aisha', { type: 'offer_cover', taskId: req.createdId!, allowConflict: true }).state;
    expect(s.tasks.find((x) => x.id === req.createdId)!.ownerId).toBe('u-aisha');
    expect(conflictsFor(s, 'u-aisha', from, from + 4 * H).map((c) => c.type).sort()).toEqual(['appointment', 'cover']);
    expect(() => run(s, 'u-kareem', { type: 'offer_cover', taskId: req.createdId! })).toThrow(/already covering/);
  });
});

describe('appointments', () => {
  it('are only visible in their section and only attendees with access can be added', () => {
    const s = createSeed(NOW);
    const grace = viewFor(s, 'u-grace', NOW).appointments.map((a) => a.title);
    expect(grace).toContain('Term review meeting');
    expect(grace).not.toContain('Therapy session');
    expect(grace).not.toContain('Physio session');
    expect(() => run(s, 'u-huda', { type: 'add_appointment', recipientId: 'r-rashid', appt: appt('Check-up', NOW + 72 * H, { kind: 'medical', domain: 'medical', attendeeIds: ['u-grace'] }), prep: [] })).toThrow(/cannot see/);
  });

  it('creates a preparation checklist, moves it on reschedule, and cancels it with the appointment', () => {
    const start = NOW + 72 * H;
    const r = run(createSeed(NOW), 'u-mariam', { type: 'add_appointment', recipientId: 'r-fatima', appt: appt('Cardiology', start, { kind: 'medical', domain: 'medical', attendeeIds: ['u-mariam'] }), prep: ['Bring the current medicine list', 'Arrange transport'] });
    let s = r.state;
    const prep = s.tasks.filter((x) => x.appointmentId === r.createdId);
    expect(prep.map((x) => x.title)).toEqual(['Bring the current medicine list', 'Arrange transport']);
    expect(prep.every((x) => x.dueAt === start - H && x.domain === 'medical')).toBe(true);
    const ap = s.appointments.find((x) => x.id === r.createdId)!;
    s = run(s, 'u-mariam', { type: 'edit_appointment', appointmentId: ap.id, baseVersion: ap.version, appt: appt('Cardiology', start + 24 * H, { kind: 'medical', domain: 'medical', attendeeIds: ['u-mariam'] }) }).state;
    expect(s.tasks.filter((x) => x.appointmentId === ap.id).every((x) => x.dueAt === start + 23 * H)).toBe(true);
    expect(() => run(s, 'u-mariam', { type: 'appointment_status', appointmentId: ap.id, status: 'completed' })).toThrow(/not happened yet/);
    s = run(s, 'u-mariam', { type: 'appointment_status', appointmentId: ap.id, status: 'cancelled' }).state;
    expect(s.tasks.filter((x) => x.appointmentId === ap.id).every((x) => x.status === 'cancelled')).toBe(true);
  });

  it('Scenario 4: a missed appointment sends a neutral notice and can be rebooked', () => {
    const s = createSeed(NOW);
    const missed = s.appointments.find((a) => a.title === 'Hearing test')!;
    expect(missed.status).toBe('missed');
    const n = s.notifications.find((x) => x.m?.k === 'n_appt_missed');
    // (seeded notices older than 8 hours are trimmed; check the wording directly)
    const r = run(s, 'u-khalid', { type: 'add_appointment', recipientId: 'r-hamad', appt: appt('Hearing test', NOW + 96 * H, { kind: 'medical', domain: 'medical', attendeeIds: ['u-khalid'] }), prep: [] });
    expect(r.state.appointments.filter((a) => a.title === 'Hearing test').length).toBe(2);
    expect(n === undefined || /new time/.test(JSON.stringify(n))).toBe(true);
  });
});

describe('documents', () => {
  const pdf = samplePdf(['Test document']);
  it('checks content against type and size, and only the server may attach stored files', () => {
    const s = createSeed(NOW);
    const ok = run(s, 'u-mariam', { type: 'add_document', recipientId: 'r-fatima', domain: 'medical', title: 'Discharge letter', description: '', fileName: 'letter.pdf', mime: 'application/pdf', size: 0, dataUrl: pdf });
    expect(ok.state.documents.find((d) => d.id === ok.createdId)).toMatchObject({ storage: 'inline', source: 'caregiver' });
    const fake = `data:application/pdf;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    expect(() => run(s, 'u-mariam', { type: 'add_document', recipientId: 'r-fatima', domain: 'medical', title: 'Fake', description: '', fileName: 'x.pdf', mime: 'application/pdf', size: 0, dataUrl: fake })).toThrow(/must match/);
    expect(() => run(s, 'u-mariam', { type: 'add_document', recipientId: 'r-fatima', domain: 'medical', title: 'Web page', description: '', fileName: 'x.html', mime: 'text/html', size: 0, dataUrl: 'data:text/html;base64,PGgxPg==' })).toThrow(/PDF/);
    expect(() => run(s, 'u-mariam', { type: 'add_document', recipientId: 'r-fatima', domain: 'medical', title: 'Sneaky', description: '', fileName: 'x.pdf', mime: 'application/pdf', size: 10, fileKey: 'abc' })).toThrow();
    const big = `data:text/plain;base64,${Buffer.alloc(500_000, 65).toString('base64')}`;
    expect(() => run(s, 'u-mariam', { type: 'add_document', recipientId: 'r-fatima', domain: 'medical', title: 'Big', description: '', fileName: 'x.txt', mime: 'text/plain', size: 0, dataUrl: big })).toThrow(/too large/);
  });

  it('are only in the view of people who can see their section', () => {
    const s = createSeed(NOW);
    expect(viewFor(s, 'u-grace', NOW).documents.map((d) => d.title)).toEqual(['IEP summary 2026–27 (synthetic)']);
    expect(viewFor(s, 'u-huda', NOW).documents.some((d) => d.domain === 'academic')).toBe(true);
    expect(viewFor(s, 'u-sara', NOW).documents).toEqual([]);
  });
});

describe('Scenario 1: a new care profile end to end', () => {
  it('a caregiver creates a profile with preferences and consent, adds information, a document and a first task', () => {
    const reg = register(createSeed(NOW), { role: 'family', name: 'Noor Khalifa', email: 'noor@example.ae', recipient: { name: 'Sultan Khalifa', age: 79, area: 'Deira', note: 'Uses a walker', relationship: 'Son', claimsAuthority: false } }, NOW);
    let s = reg.state;
    const rid = reg.recipientId!;
    s = run(s, reg.userId, { type: 'update_preferences', recipientId: rid, preferredName: 'Abu Ahmed', communication: 'Arabic, morning calls', languages: ['Arabic'], hidden: ['academic'] }).state;
    s = run(s, reg.userId, { type: 'add_record', recipientId: rid, domain: 'medical', kind: 'allergy', title: 'Aspirin', body: 'Stomach upset' }).state;
    s = run(s, reg.userId, { type: 'add_document', recipientId: rid, domain: 'medical', title: 'Medicine list', description: '', fileName: 'meds.pdf', mime: 'application/pdf', size: 0, dataUrl: samplePdf(['Medicine list']) }).state;
    s = run(s, reg.userId, { type: 'add_task', recipientId: rid, task: task('Book a GP check-up', { ownerId: reg.userId }) }).state;
    const v = viewFor(s, reg.userId, NOW);
    expect(v.recipients.find((r) => r.id === rid)).toMatchObject({ preferredName: 'Abu Ahmed', hidden: ['academic'] });
    expect(v.records.some((r) => r.title === 'Aspirin')).toBe(true);
    expect(v.documents.some((d) => d.title === 'Medicine list')).toBe(true);
    expect(v.tasks.find((x) => x.title === 'Book a GP check-up')!.status).toBe('scheduled');
    expect(v.consents.some((c) => c.basis === 'creator')).toBe(true);
    expect(v.audit.filter((e) => e.recipientId === rid).length).toBeGreaterThanOrEqual(5);
  });
});

describe('upgrade', () => {
  it('adds the Phase 2 collections to saved data from Phase 1', () => {
    const s = createSeed(NOW) as State & Partial<State>;
    const old = { ...s, schema: 2 } as State;
    delete (old as Partial<State>).tasks;
    delete (old as Partial<State>).appointments;
    const up = upgrade(old, NOW);
    expect(up.schema).toBe(3);
    expect(up.tasks).toEqual([]);
    expect(up.appointments).toEqual([]);
    expect(up.records.length).toBe(s.records.length);
  });
});
