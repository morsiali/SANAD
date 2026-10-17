import { describe, expect, it } from 'vitest';
import { createSeed } from '../shared/seed';
import { apply, register, viewFor } from '../shared/engine';

const NOW = Date.UTC(2026, 9, 17, 8, 0, 0);

describe('self sign-up', () => {
  it('creates a family member together with the person they care for', () => {
    const r = register(createSeed(NOW), { role: 'family', name: 'Reem Saleh', email: 'reem@example.ae', recipient: { name: 'Salem Saleh', age: 81, area: 'Jumeirah' } }, NOW);
    const u = r.state.users.find((x) => x.id === r.userId)!;
    expect(u.role).toBe('family');
    expect(u.recipients).toEqual([r.recipientId]);
    expect(r.state.recipients.find((x) => x.id === r.recipientId)?.name).toBe('Salem Saleh');
    // the coordinator hears about the new family
    expect(r.state.notifications.some((n) => n.userId === 'u-sara' && n.m?.k === 'n_signup_family')).toBe(true);
  });

  it('lets the new family member report straight away, and routes it', () => {
    const r = register(createSeed(NOW), { role: 'family', name: 'Reem Saleh', email: 'reem@example.ae', recipient: { name: 'Salem Saleh', age: 81, area: 'Jumeirah' } }, NOW);
    const out = apply(r.state, r.userId, { type: 'create_challenge', title: 'Need a ride to the clinic', description: '', recipientId: r.recipientId! }, NOW);
    const c = out.state.challenges.find((x) => x.id === out.createdId)!;
    expect(c.role).toBe('transport');
    expect(viewFor(out.state, r.userId).challenges.map((x) => x.id)).toEqual([c.id]);
  });

  it('only shows a family member their own people', () => {
    const r = register(createSeed(NOW), { role: 'family', name: 'Reem Saleh', email: 'reem@example.ae', recipient: { name: 'Salem Saleh', age: 81, area: 'Jumeirah' } }, NOW);
    expect(viewFor(r.state, r.userId).challenges).toEqual([]);
  });

  it('adds staff with their skills', () => {
    const r = register(createSeed(NOW), { role: 'caregiver', name: 'Hessa Ali', email: 'hessa@example.ae', title: 'Nurse', org: 'Rahma', skills: ['Wound ', 'insulin'] }, NOW);
    const u = r.state.users.find((x) => x.id === r.userId)!;
    expect(u.skills).toEqual(['wound', 'insulin']);
    expect(u.available).toBe(true);
  });

  it('refuses coordinator sign-up, duplicate emails and missing details', () => {
    const s = createSeed(NOW);
    expect(() => register(s, { role: 'coordinator', name: 'X Y', email: 'x@y.ae' })).toThrow(/coordinator/);
    expect(() => register(s, { role: 'doctor', name: 'X Y', email: 'kareem@sanad.ae' })).toThrow(/already/);
    expect(() => register(s, { role: 'doctor', name: 'X Y', email: 'not-an-email' })).toThrow(/valid email/);
    expect(() => register(s, { role: 'family', name: 'X Y', email: 'x@y.ae' })).toThrow(/person you care for/);
    expect(() => register(s, { role: 'family', name: 'X Y', email: 'x@y.ae', recipient: { name: 'Mum', age: 0, area: '' } })).toThrow(/age/);
  });

  it('lets the coordinator link new staff to the people they support', () => {
    let s = register(createSeed(NOW), { role: 'caregiver', name: 'Hessa Ali', email: 'hessa@example.ae' }, NOW).state;
    const id = s.users.at(-1)!.id;
    s = apply(s, 'u-sara', { type: 'update_user', userId: id, title: 'Nurse', org: 'Rahma', skills: ['wound'], recipients: ['r-fatima'] }, NOW).state;
    expect(s.users.find((u) => u.id === id)!.recipients).toEqual(['r-fatima']);
    expect(() => apply(s, 'u-aisha', { type: 'update_user', userId: id, title: '', org: '', skills: [], recipients: [] })).toThrow(/coordinator/);
  });
});
