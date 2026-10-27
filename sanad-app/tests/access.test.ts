// Phase 1: access control, consent, approvals, records and medicines.
import { describe, expect, it } from 'vitest';
import { createSeed } from '../shared/seed';
import { apply, register, upgrade, viewFor } from '../shared/engine';
import { ask } from '../shared/intelligence';
import { domainsFor } from '../shared/access';
import { dayKey, doseSlots, refillForecast } from '../shared/records';
import { renderMsg } from '../shared/messages';
import type { Action, State } from '../shared/types';

const NOW = Date.UTC(2026, 9, 27, 6, 0, 0);
const H = 3_600_000;
const seed = () => createSeed(NOW);
const run = (s: State, by: string, a: Action, at = NOW) => apply(s, by, a, at);
const PSYCH_NOTE = 'Practised the coping cards for transitions';

describe('roles and domains', () => {
  it('gives each role only its domains for Rashid', () => {
    const s = seed();
    expect(domainsFor(s, 'u-grace', 'r-rashid', NOW)).toEqual(['overview', 'academic', 'social']);
    expect(domainsFor(s, 'u-salma', 'r-rashid', NOW)).toEqual(['overview', 'wellbeing', 'wellbeing_notes', 'social']);
    expect(domainsFor(s, 'u-faisal', 'r-rashid', NOW)).toEqual(['overview', 'activity', 'rehab']);
    // The guardian sees everything except private therapy notes.
    expect(domainsFor(s, 'u-huda', 'r-rashid', NOW)).not.toContain('wellbeing_notes');
    // Coordinators and admins: overview and team in their own organisation, nothing clinical.
    expect(domainsFor(s, 'u-sara', 'r-rashid', NOW)).toEqual(['overview', 'team']);
    expect(domainsFor(s, 'u-majid', 'r-fatima', NOW)).toEqual(['overview', 'team']);
    // Not on the team, no access at all.
    expect(domainsFor(s, 'u-grace', 'r-fatima', NOW)).toEqual([]);
  });
});

describe('Scenario 7: an educator cannot reach private psychological notes', () => {
  it('not through the view (UI and API state), export, search or the assistant', () => {
    const s = seed();
    const v = viewFor(s, 'u-grace', NOW);
    const json = JSON.stringify(v);
    expect(json).not.toContain(PSYCH_NOTE);
    expect(v.records.some((r) => r.domain === 'wellbeing' || r.domain === 'wellbeing_notes' || r.domain === 'medical')).toBe(false);
    expect(v.records.some((r) => r.domain === 'academic')).toBe(true);
    expect(v.medications).toEqual([]);
    expect(v.audit.every((e) => e.domain === 'overview' || e.domain === 'academic' || e.domain === 'social')).toBe(true);
    const answer = ask(v, 'what happened in the therapy session with Rashid', NOW);
    expect(JSON.stringify(answer)).not.toContain(PSYCH_NOTE);
    // The psychologist does see it.
    expect(JSON.stringify(viewFor(s, 'u-salma', NOW))).toContain(PSYCH_NOTE);
    // And the guardian does not, unless it is shared with her.
    expect(JSON.stringify(viewFor(s, 'u-huda', NOW))).not.toContain(PSYCH_NOTE);
  });

  it('cannot write or verify outside their domains', () => {
    const s = seed();
    expect(() => run(s, 'u-grace', { type: 'add_record', recipientId: 'r-rashid', domain: 'wellbeing', kind: 'behaviour', title: 'Quiet today', body: '' })).toThrow(/access|change/);
    expect(() => run(s, 'u-grace', { type: 'add_record', recipientId: 'r-rashid', domain: 'wellbeing_notes', kind: 'progress_note', title: 'Note', body: '' })).toThrow();
    const ok = run(s, 'u-grace', { type: 'add_record', recipientId: 'r-rashid', domain: 'academic', kind: 'teacher_note', title: 'Great focus in maths', body: '' });
    expect(ok.state.records.find((r) => r.id === ok.createdId)?.source).toBe('professional');
  });
});

describe('organisation isolation', () => {
  it('keeps each organisation’s people, problems and records apart', () => {
    const s = seed();
    const hind = viewFor(s, 'u-hind', NOW);
    expect(hind.recipients.map((r) => r.id)).toEqual(['r-maitha']);
    expect(hind.challenges).toEqual([]);
    expect(hind.records).toEqual([]);
    expect(hind.memberships).toEqual([]);
    expect(hind.audit.filter((e) => e.recipientId)).toEqual([]);
    const sara = viewFor(s, 'u-sara', NOW);
    expect(sara.recipients.some((r) => r.id === 'r-maitha')).toBe(false);
    expect(() => run(s, 'u-hind', { type: 'invite_member', recipientId: 'r-fatima', email: 'x@y.ae', role: 'doctor', relationship: '', domains: ['overview'], accessDays: null })).toThrow(/care team/);
    expect(() => run(s, 'u-hind', { type: 'escalate', id: s.challenges[0].id, reason: 'test' })).toThrow();
  });
});

describe('consent and revocation', () => {
  it('a verified guardian grants and revokes access, recorded in the consent log, effective immediately', () => {
    let s = seed();
    const grace = s.memberships.find((m) => m.userId === 'u-grace' && m.recipientId === 'r-rashid')!;
    s = run(s, 'u-huda', { type: 'set_access', membershipId: grace.id, domains: ['overview', 'academic', 'social', 'activity'] }).state;
    expect(domainsFor(s, 'u-grace', 'r-rashid', NOW)).toContain('activity');
    expect(s.consents.at(-1)).toMatchObject({ subjectId: 'u-grace', change: 'grant', domains: ['activity'], basis: 'guardian', givenBy: 'u-huda' });
    s = run(s, 'u-huda', { type: 'revoke_member', membershipId: grace.id, reason: 'Changed school' }).state;
    expect(domainsFor(s, 'u-grace', 'r-rashid', NOW)).toEqual([]);
    expect(viewFor(s, 'u-grace', NOW).records).toEqual([]);
    expect(s.consents.at(-1)).toMatchObject({ change: 'revoke', subjectId: 'u-grace' });
    expect(s.users.find((u) => u.id === 'u-grace')!.recipients).toEqual([]);
  });

  it('a family member without verified authority cannot share sensitive information', () => {
    const reg = register(seed(), { role: 'family', name: 'Reem Saleh', email: 'reem@example.ae', recipient: { name: 'Salem Saleh', age: 81, area: 'Jumeirah', claimsAuthority: true } }, NOW);
    const invite: Action = { type: 'invite_member', recipientId: reg.recipientId!, email: 'doc@example.ae', role: 'doctor', relationship: 'GP', domains: ['overview', 'medical'], accessDays: null };
    expect(() => run(reg.state, reg.userId, invite)).toThrow(/care team/);
    // The coordinator checks the evidence; then the guardian can.
    const mem = reg.state.memberships.find((m) => m.userId === reg.userId)!;
    expect(() => run(reg.state, 'u-aisha', { type: 'verify_authority', membershipId: mem.id, evidence: 'Power of attorney seen' })).toThrow(/coordinator or admin/);
    const verified = run(reg.state, 'u-sara', { type: 'verify_authority', membershipId: mem.id, evidence: 'Power of attorney seen (synthetic)' }).state;
    const ok = run(verified, reg.userId, invite);
    expect(ok.state.invites.find((i) => i.id === ok.createdId)).toMatchObject({ email: 'doc@example.ae', status: 'pending' });
  });

  it('a coordinator must record consent evidence when nobody holds authority', () => {
    const s = seed();
    const joseph = s.memberships.find((m) => m.userId === 'u-joseph' && m.recipientId === 'r-hamad')!;
    const add: Action = { type: 'set_access', membershipId: joseph.id, domains: [...joseph.domains, 'social'] };
    expect(() => run(s, 'u-sara', add)).toThrow(/consent was given/);
    const ok = run(s, 'u-sara', { ...add, evidence: 'Hamad agreed by phone, 27 Oct (synthetic)' } as Action).state;
    expect(ok.consents.at(-1)).toMatchObject({ basis: 'recorded', givenBy: 'u-sara', evidence: 'Hamad agreed by phone, 27 Oct (synthetic)' });
  });

  it('people under 18 cannot sign up for themselves', () => {
    expect(() => register(seed(), { role: 'self', name: 'Young Person', email: 'yp@example.ae', recipient: { name: '', age: 15, area: '' } }, NOW)).toThrow(/under 18/);
  });
});

describe('approvals', () => {
  const request = () => {
    const s = seed();
    const res = run(s, 'u-sara', { type: 'invite_member', recipientId: 'r-fatima', email: 'gp@clinic.ae', role: 'doctor', relationship: 'Second opinion', domains: ['overview', 'medical'], accessDays: 30 });
    const a = res.state.approvals.find((x) => x.id === res.createdId)!;
    return { s: res.state, a };
  };

  it('nothing happens until the authority holder approves', () => {
    const { s, a } = request();
    expect(a).toMatchObject({ status: 'pending', approverIds: ['u-mariam'], requestedBy: 'u-sara' });
    expect(s.invites.some((i) => i.email === 'gp@clinic.ae')).toBe(false);
    expect(s.notifications.some((n) => n.userId === 'u-mariam' && n.m?.k === 'n_approval_needed')).toBe(true);
  });

  it('binds to the exact action, runs once, and records who approved', () => {
    const { s, a } = request();
    expect(() => run(s, 'u-mariam', { type: 'decide_approval', approvalId: a.id, decision: 'approve', fingerprint: 'tampered' })).toThrow(/does not match/);
    expect(() => run(s, 'u-aisha', { type: 'decide_approval', approvalId: a.id, decision: 'approve', fingerprint: a.fingerprint })).toThrow(/someone else/);
    const done = run(s, 'u-mariam', { type: 'decide_approval', approvalId: a.id, decision: 'approve', fingerprint: a.fingerprint }).state;
    expect(done.approvals.find((x) => x.id === a.id)).toMatchObject({ status: 'executed', decidedBy: 'u-mariam' });
    expect(done.invites.filter((i) => i.email === 'gp@clinic.ae')).toHaveLength(1);
    expect(done.consents.at(-1)).toMatchObject({ basis: 'guardian', givenBy: 'u-mariam' });
    // Single use: a second approval of the same request is refused, so the invitation is never duplicated.
    expect(() => run(done, 'u-mariam', { type: 'decide_approval', approvalId: a.id, decision: 'approve', fingerprint: a.fingerprint })).toThrow(/already/);
  });

  it('can be declined or expire', () => {
    const { s, a } = request();
    const declined = run(s, 'u-mariam', { type: 'decide_approval', approvalId: a.id, decision: 'reject', fingerprint: a.fingerprint }).state;
    expect(declined.approvals.find((x) => x.id === a.id)!.status).toBe('rejected');
    expect(declined.invites.some((i) => i.email === 'gp@clinic.ae')).toBe(false);
    const late = run(s, 'u-mariam', { type: 'decide_approval', approvalId: a.id, decision: 'approve', fingerprint: a.fingerprint }, NOW + 73 * H).state;
    expect(late.approvals.find((x) => x.id === a.id)!.status).toBe('expired');
    expect(late.invites.some((i) => i.email === 'gp@clinic.ae')).toBe(false);
  });

  it('does not run if what it depends on changed after the request (stale)', () => {
    let s = seed();
    const aisha = s.memberships.find((m) => m.userId === 'u-aisha' && m.recipientId === 'r-fatima')!;
    const req = run(s, 'u-sara', { type: 'set_access', membershipId: aisha.id, domains: [...aisha.domains, 'social'] });
    s = req.state;
    const a = s.approvals.find((x) => x.id === req.createdId)!;
    s = run(s, 'u-mariam', { type: 'set_access', membershipId: aisha.id, domains: ['overview', 'medical'] }).state;
    const after = run(s, 'u-mariam', { type: 'decide_approval', approvalId: a.id, decision: 'approve', fingerprint: a.fingerprint }).state;
    expect(after.approvals.find((x) => x.id === a.id)).toMatchObject({ status: 'failed' });
    expect(domainsFor(after, 'u-aisha', 'r-fatima', NOW)).toEqual(['overview', 'medical']);
  });

  it('only the requester can cancel', () => {
    const { s, a } = request();
    expect(() => run(s, 'u-mariam', { type: 'cancel_approval', approvalId: a.id })).toThrow(/someone else/);
    expect(run(s, 'u-sara', { type: 'cancel_approval', approvalId: a.id }).state.approvals.find((x) => x.id === a.id)!.status).toBe('cancelled');
  });
});

describe('invitations', () => {
  const invited = () => {
    const s = seed();
    const res = run(s, 'u-huda', { type: 'invite_member', recipientId: 'r-rashid', email: 'speech@therapy.ae', role: 'psychologist', relationship: 'Speech therapist', domains: ['overview', 'wellbeing'], accessDays: 90 });
    return { s: res.state, inv: res.state.invites.find((i) => i.id === res.createdId)! };
  };

  it('joins the care team with exactly the invited access, for a limited time', () => {
    const { s, inv } = invited();
    const reg = register(s, { role: 'psychologist', name: 'Lina Speech', email: 'speech@therapy.ae', inviteCode: inv.code }, NOW + H);
    expect(domainsFor(reg.state, reg.userId, 'r-rashid', NOW + H)).toEqual(['overview', 'wellbeing']);
    expect(reg.state.invites.find((i) => i.id === inv.id)!.status).toBe('accepted');
    // Time-limited: after 90 days access ends by itself.
    expect(domainsFor(reg.state, reg.userId, 'r-rashid', NOW + 91 * 24 * H)).toEqual([]);
  });

  it('refuses the wrong email or role, used or expired codes', () => {
    const { s, inv } = invited();
    expect(() => register(s, { role: 'psychologist', name: 'Someone Else', email: 'other@x.ae', inviteCode: inv.code }, NOW)).toThrow(/different email/);
    expect(() => register(s, { role: 'doctor', name: 'Lina Speech', email: 'speech@therapy.ae', inviteCode: inv.code }, NOW)).toThrow(/psychologist account/i);
    expect(() => register(s, { role: 'psychologist', name: 'Lina Speech', email: 'speech@therapy.ae', inviteCode: inv.code }, NOW + 8 * 24 * H)).toThrow(/expired/);
    expect(() => register(s, { role: 'psychologist', name: 'Lina Speech', email: 'speech@therapy.ae', inviteCode: 'nope' }, NOW)).toThrow(/not valid/);
    const reg = register(s, { role: 'psychologist', name: 'Lina Speech', email: 'speech@therapy.ae', inviteCode: inv.code }, NOW);
    expect(() => run(reg.state, reg.userId, { type: 'accept_invite', code: inv.code })).toThrow(/already been used/);
  });

  it('uses the secure code generator when one is provided', () => {
    const res = apply(seed(), 'u-huda', { type: 'invite_member', recipientId: 'r-rashid', email: 'a@b.ae', role: 'educator', relationship: '', domains: ['overview'], accessDays: null }, NOW, { rand: () => 'secure-random-code' });
    expect(res.state.invites.find((i) => i.id === res.createdId)!.code).toBe('secure-random-code');
  });
});

describe('records', () => {
  it('only doctors enter diagnoses; professional entries are verified, others are not', () => {
    const s = seed();
    expect(() => run(s, 'u-mariam', { type: 'add_record', recipientId: 'r-fatima', domain: 'medical', kind: 'diagnosis', title: 'Neuropathy', body: '' })).toThrow(/doctor/);
    const doc = run(s, 'u-kareem', { type: 'add_record', recipientId: 'r-fatima', domain: 'medical', kind: 'diagnosis', title: 'Peripheral neuropathy', body: '' });
    expect(doc.state.records.find((r) => r.id === doc.createdId)).toMatchObject({ verification: 'verified', verifiedBy: 'u-kareem', source: 'professional' });
    const fam = run(s, 'u-mariam', { type: 'add_record', recipientId: 'r-fatima', domain: 'medical', kind: 'observation', title: 'Swollen ankles', body: 'Since this morning' });
    const rec = fam.state.records.find((r) => r.id === fam.createdId)!;
    expect(rec).toMatchObject({ verification: 'unverified', source: 'caregiver', authorId: 'u-mariam' });
    const verified = run(fam.state, 'u-kareem', { type: 'verify_record', recordId: rec.id }).state;
    expect(verified.records.find((r) => r.id === rec.id)!.verification).toBe('verified');
    expect(() => run(fam.state, 'u-aisha', { type: 'verify_record', recordId: rec.id })).toThrow(/doctor/);
  });

  it('keeps edit history, rejects stale edits and edits by others', () => {
    const s = seed();
    const add = run(s, 'u-mariam', { type: 'add_record', recipientId: 'r-fatima', domain: 'medical', kind: 'measurement', title: 'Blood glucose', body: '', value: 9.1, unit: 'mmol/L' });
    const id = add.createdId!;
    const edited = run(add.state, 'u-mariam', { type: 'edit_record', recordId: id, baseVersion: 1, title: 'Blood glucose (fasting)', body: '', value: 9.4, unit: 'mmol/L' }).state;
    const rec = edited.records.find((r) => r.id === id)!;
    expect(rec.version).toBe(2);
    expect(rec.history[0]).toMatchObject({ by: 'u-mariam', fields: ['title', 'value'], before: { title: 'Blood glucose', value: 9.1 } });
    expect(() => run(edited, 'u-mariam', { type: 'edit_record', recordId: id, baseVersion: 1, title: 'Old copy', body: '', value: 9, unit: 'mmol/L' })).toThrow(/while you were editing/);
    expect(() => run(edited, 'u-aisha', { type: 'edit_record', recordId: id, baseVersion: 2, title: 'Changed', body: '', value: 9, unit: 'mmol/L' })).toThrow(/wrote this record/);
    expect(() => run(s, 'u-mariam', { type: 'add_record', recipientId: 'r-fatima', domain: 'wellbeing', kind: 'checkin', title: 'Mood', body: '', value: 9 })).toThrow(/between 1 and 5/);
  });

  it('records every write in the audit log, visible only with the matching domain', () => {
    const s = seed();
    const before = s.audit.length;
    const after = run(s, 'u-salma', { type: 'add_record', recipientId: 'r-rashid', domain: 'wellbeing_notes', kind: 'progress_note', title: 'Session 7', body: 'Private' }).state;
    expect(after.audit.length).toBe(before + 1);
    expect(after.audit.at(-1)).toMatchObject({ actorId: 'u-salma', recipientId: 'r-rashid', domain: 'wellbeing_notes', type: 'record_added' });
    expect(viewFor(after, 'u-huda', NOW).audit.some((e) => e.domain === 'wellbeing_notes')).toBe(false);
    expect(viewFor(after, 'u-salma', NOW).audit.some((e) => e.domain === 'wellbeing_notes')).toBe(true);
  });
});

describe('medicines', () => {
  it('never treats an unlogged dose as taken, and a missed dose sends neutral advice only', () => {
    const s = seed();
    const met = s.medications.find((m) => m.recipientId === 'r-fatima' && m.name === 'Metformin')!;
    const day = dayKey(NOW + 2 * 24 * H);
    expect(doseSlots(met, s.doseLogs, day).every((x) => !x.log)).toBe(true);
    const slot = `${dayKey(NOW - 24 * H)} 20:00`;
    const res = run(s, 'u-aisha', { type: 'log_dose', medicationId: met.id, slot, status: 'missed', note: '' });
    const n = res.state.notifications.find((x) => x.m?.k === 'n_dose_missed' && x.userId === 'u-mariam')!;
    const text = renderMsg(n.m!, 'en');
    expect(text).toMatch(/prescriber|pharmacist/);
    expect(text).not.toMatch(/double|take (it|two)/i);
    expect(() => run(s, 'u-aisha', { type: 'log_dose', medicationId: met.id, slot: `${dayKey(NOW)} 13:00`, status: 'taken', note: '' })).toThrow(/scheduled dose times/);
    expect(() => run(s, 'u-grace', { type: 'log_dose', medicationId: met.id, slot, status: 'taken', note: '' })).toThrow();
  });

  it('works out refill reminders from the entered supply only', () => {
    const s = seed();
    const met = s.medications.find((m) => m.name === 'Metformin')!;
    const fc = refillForecast(met, NOW);
    // 30 tablets, 1 per dose, 2 doses a day, entered 200 h ago → 15 − 8.33 ≈ 6.6 days.
    expect(fc.daysLeft).toBeCloseTo(6.6, 1);
    expect(fc.due).toBe(true);
    expect(refillForecast({ ...met, onHand: null }, NOW)).toEqual({ daysLeft: null, runsOutOn: null, due: false });
  });

  it('a dose change by a non-doctor needs a doctor to verify again', () => {
    const s = seed();
    const met = s.medications.find((m) => m.name === 'Metformin')!;
    const input = { name: met.name, strength: met.strength, dose: '2 tablets', route: met.route, times: met.times, prescriber: met.prescriber, instructions: met.instructions, reminders: true, onHand: met.onHand, perDose: met.perDose, active: true };
    const res = run(s, 'u-mariam', { type: 'edit_medication', medicationId: met.id, baseVersion: met.version, med: input });
    expect(res.m.k).toBe('m_med_needs_check');
    expect(res.state.medications.find((m) => m.id === met.id)!.verification).toBe('unverified');
    expect(() => run(res.state, 'u-mariam', { type: 'verify_medication', medicationId: met.id })).toThrow(/doctor/);
    expect(run(res.state, 'u-kareem', { type: 'verify_medication', medicationId: met.id }).state.medications.find((m) => m.id === met.id)!.verification).toBe('verified');
  });
});

describe('upgrading saved data', () => {
  it('adds care teams from old links without removing anything', () => {
    const s = seed();
    const old = JSON.parse(JSON.stringify(s)) as Partial<State> & State;
    delete old.schema;
    for (const k of ['memberships', 'invites', 'consents', 'approvals', 'audit', 'records', 'medications', 'doseLogs', 'orgs'] as const) delete (old as Partial<State>)[k];
    for (const r of old.recipients) delete r.orgId;
    const up = upgrade(old, NOW);
    expect(up.schema).toBe(2);
    expect(up.challenges.length).toBe(s.challenges.length);
    expect(up.memberships.some((m) => m.userId === 'u-mariam' && m.recipientId === 'r-fatima')).toBe(true);
    expect(domainsFor(up, 'u-aisha', 'r-fatima', NOW)).toContain('medical');
    expect(up.consents.every((c) => c.basis === 'recorded')).toBe(true);
    expect(upgrade(up, NOW)).toBe(up);
  });
});
