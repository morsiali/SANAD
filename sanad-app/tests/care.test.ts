import { describe, expect, it } from 'vitest';
import { createSeed } from '../shared/seed';
import { apply, register } from '../shared/engine';
import { decideRouting, computeLoads } from '../shared/routing';
import { ageGroup, careProfile, cleanProfile, inCareGroup, inferLiving, inferNeeds, suggestSupport } from '../shared/care';
import { renderMsg } from '../shared/messages';

const NOW = Date.UTC(2026, 9, 18, 8, 0, 0);

describe('care categories', () => {
  it('reads needs and living situation from English and Arabic notes', () => {
    expect(inferNeeds('Type 2 diabetes, uses a walker.')).toEqual(['chronic', 'mobility']);
    expect(inferNeeds('Wheelchair user, dialysis three times a week')).toEqual(['mobility', 'renal']);
    expect(inferNeeds('Early dementia, hearing aid in the left ear')).toEqual(['memory', 'sensory']);
    expect(inferNeeds('مريضة سكري وتستخدم مشاية بعد عملية في الركبة')).toEqual(['chronic', 'mobility', 'recovery']);
    expect(inferNeeds('')).toEqual([]);
    expect(inferLiving('Recovering from knee surgery. Lives alone.')).toBe('alone');
    expect(inferLiving('تعيش وحدها في الشارقة')).toBe('alone');
    expect(inferLiving('Lives with her daughter Mariam')).toBe('family');
    expect(inferLiving('Has a live-in maid')).toBe('carer');
    expect(inferLiving('Enjoys gardening')).toBeNull();
  });

  it('suggests a support level and an age group', () => {
    expect(suggestSupport(['renal'], 70, 'family')).toBe('high');
    expect(suggestSupport(['memory'], 70, 'family')).toBe('high');
    expect(suggestSupport(['chronic', 'mobility'], 72, 'family')).toBe('assisted');
    expect(suggestSupport(['chronic', 'mobility'], 88, 'family')).toBe('high');
    expect(suggestSupport(['recovery'], 68, 'alone')).toBe('assisted');
    expect(suggestSupport([], 66, 'family')).toBe('independent');
    expect([ageGroup(60), ageGroup(65), ageGroup(80), ageGroup(85)]).toEqual(['under65', '65to74', '75to84', '85plus']);
  });

  it('falls back to suggestions for people saved before categories existed', () => {
    const p = careProfile({ age: 81, note: 'Wheelchair user, dialysis twice a week. Lives alone.' });
    expect(p).toMatchObject({ support: 'high', living: 'alone', needs: ['mobility', 'renal'], ageGroup: '75to84', suggested: true });
    expect(careProfile({ age: 70, note: '', support: 'independent', living: 'family', needs: [] }).suggested).toBe(false);
  });

  it('drops unknown values instead of storing them', () => {
    expect(cleanProfile({ support: 'extreme', living: 'moon', needs: ['renal', 'bogus'] }, 75, 'lives alone')).toEqual({ support: 'high', living: 'alone', needs: ['renal'] });
  });

  it('gives every seeded person a category and matches group filters', () => {
    const s = createSeed(NOW);
    const [fatima, hamad, khadija] = ['r-fatima', 'r-hamad', 'r-khadija'].map((id) => s.recipients.find((r) => r.id === id)!);
    expect(careProfile(hamad).support).toBe('high');
    expect(careProfile(khadija).living).toBe('alone');
    expect(inCareGroup(fatima, 'need:chronic')).toBe(true);
    expect(inCareGroup(fatima, 'support:high')).toBe(false);
    expect(inCareGroup(undefined, 'support:high')).toBe(false);
  });
});

describe('care categories in routing', () => {
  const route = (recipientId: string) => {
    const s = createSeed(NOW);
    return decideRouting(
      { title: 'Question about the pension form, no rush', description: '', recipientId },
      { users: s.users, rules: s.rules, settings: s.settings, loads: computeLoads(s.users, s.challenges), recipients: s.recipients },
    );
  };

  it('never leaves high-support or lone people at the lowest priority', () => {
    expect(route('r-fatima').priority).toBe('low');
    const hamad = route('r-hamad');
    expect(hamad.priority).toBe('medium');
    expect(hamad.why.some((m) => m.k === 'r_care_high')).toBe(true);
    const khadija = route('r-khadija');
    expect(khadija.priority).toBe('medium');
    expect(renderMsg(khadija.why.find((m) => m.k === 'r_care_alone')!, 'en')).toMatch(/Khadija Saeed lives alone/);
    expect(renderMsg(khadija.why.find((m) => m.k === 'r_care_alone')!, 'ar')).toMatch(/بمفرده/);
  });
});

describe('editing a care profile', () => {
  it('lets the coordinator and linked family edit, and nobody else', () => {
    const s = createSeed(NOW);
    const edit = { type: 'update_recipient' as const, recipientId: 'r-fatima', age: 73, area: 'Al Barsha, Dubai', note: 'Uses a walker.', support: 'high' as const, living: 'carer' as const, needs: ['mobility' as const] };
    const byFamily = apply(s, 'u-mariam', edit, NOW);
    expect(byFamily.state.recipients.find((r) => r.id === 'r-fatima')).toMatchObject({ age: 73, support: 'high', living: 'carer', needs: ['mobility'] });
    expect(byFamily.state.notifications.some((n) => n.userId === 'u-sara' && n.m?.k === 'n_recipient_updated')).toBe(true);
    expect(() => apply(s, 'u-khalid', edit, NOW)).toThrow(/coordinator or their family/);
    expect(() => apply(s, 'u-aisha', edit, NOW)).toThrow(/coordinator or their family/);
    expect(apply(s, 'u-sara', { ...edit, needs: [] }, NOW).state.recipients.find((r) => r.id === 'r-fatima')?.needs).toEqual([]);
    expect(() => apply(s, 'u-sara', { ...edit, age: 0 }, NOW)).toThrow(/age/i);
  });

  it('stores the category chosen at sign-up, or suggests one from the note', () => {
    const chosen = register(createSeed(NOW), { role: 'family', name: 'Reem Saleh', email: 'reem@example.ae', recipient: { name: 'Salem Saleh', age: 81, area: 'Jumeirah', support: 'independent', living: 'family', needs: [] } }, NOW);
    expect(chosen.state.recipients.find((r) => r.id === chosen.recipientId)).toMatchObject({ support: 'independent', living: 'family', needs: [] });
    const guessed = register(createSeed(NOW), { role: 'family', name: 'Reem Saleh', email: 'reem@example.ae', recipient: { name: 'Salem Saleh', age: 81, area: 'Jumeirah', note: 'Dialysis on Mondays, lives alone' } }, NOW);
    expect(guessed.state.recipients.find((r) => r.id === guessed.recipientId)).toMatchObject({ support: 'high', living: 'alone', needs: ['renal'] });
  });

  it('lets the coordinator add a person with a category', () => {
    const out = apply(createSeed(NOW), 'u-sara', { type: 'add_recipient', name: 'Moza Rashid', age: 90, area: 'Deira', note: '', familyIds: [], support: 'assisted', living: 'carer', needs: ['sensory'] }, NOW);
    expect(out.state.recipients.find((r) => r.id === out.createdId)).toMatchObject({ support: 'assisted', living: 'carer', needs: ['sensory'] });
  });
});
