import { describe, expect, it } from 'vitest';
import { createSeed } from '../shared/seed';
import { apply, viewFor } from '../shared/engine';
import { computeLoads, decideRouting, normalize } from '../shared/routing';
import { ask } from '../shared/intelligence';
import { AR_TABLE, EN_TABLE, renderMsg } from '../shared/messages';
import { UI_AR } from '../src/lib/ar-ui';

const NOW = Date.UTC(2026, 9, 17, 8, 0, 0);
const route = (title: string) => {
  const s = createSeed(NOW);
  return decideRouting({ title, description: '', recipientId: 'r-fatima' }, { users: s.users, rules: s.rules, settings: s.settings, loads: computeLoads(s.users, s.challenges) });
};
const LATIN = /[A-Za-z]{3,}/;

describe('Arabic text handling', () => {
  it('folds spelling variants and the definite article', () => {
    expect(normalize('الأدوية')).toBe(normalize('ادويه'));
    expect(normalize('مستوى السكر')).toBe(' مستوي سكر ');
  });
});

describe('Arabic routing', () => {
  it.each([
    ['نفدت أقلام الإنسولين لأمي', 'pharmacy'],
    ['السائق لم يحضر لموعد غسيل الكلى', 'transport'],
    ['الكرسي المتحرك معطل', 'social'],
    ['مستوى السكر مرتفع ودوخة', 'doctor'],
    ['نسيت أمي جرعة الصباح', 'caregiver'],
    ['نريد تأجيل موعد العيادة', 'doctor'],
  ])('%s → %s', (title, role) => {
    expect(route(title).role).toBe(role);
  });
  it('treats an Arabic emergency as urgent', () => {
    expect(route('سقطت أمي في الحمام ولا تستطيع النهوض').priority).toBe('urgent');
  });
});

describe('message catalogue', () => {
  it('has an Arabic version of every engine message', () => {
    const missing = Object.keys(EN_TABLE).filter((k) => !AR_TABLE[k]);
    expect(missing).toEqual([]);
  });
  it('renders a full workflow history with no English left in Arabic', () => {
    let s = createSeed(NOW);
    const r = apply(s, 'u-mariam', { type: 'create_challenge', title: 'Need a refill', description: '', recipientId: 'r-fatima' }, NOW);
    s = r.state;
    s = apply(s, 'u-omar', { type: 'accept', id: r.createdId! }, NOW).state;
    s = apply(s, 'u-omar', { type: 'apply_playbook', id: r.createdId!, playbookId: 'pb-refill' }, NOW).state;
    s = apply(s, 'u-omar', { type: 'handoff', id: r.createdId!, role: 'doctor', reason: 'تجديد الوصفة' }, NOW).state;
    const c = s.challenges.find((x) => x.id === r.createdId)!;
    for (const h of c.history) {
      const text = renderMsg(h.m!, 'ar').replace(/SAN-\d+/g, '');
      expect(text, h.text).not.toMatch(LATIN);
    }
    for (const w of c.routing.why) expect(renderMsg(w, 'ar')).not.toMatch(LATIN);
  });
  it('answers Arabic questions', () => {
    const v = viewFor(createSeed(NOW), 'u-sara');
    expect(ask(v, 'كيف أتعامل مع جرعة دواء فائتة؟', NOW).cards[0]).toEqual({ kind: 'playbook', id: 'pb-missed-dose' });
    expect(ask(v, 'من يتولى كرسيًا متحركًا معطلًا؟', NOW).preview?.role).toBe('social');
    expect(renderMsg(ask(v, 'كيف حال فاطمة؟', NOW).says[0], 'ar')).toMatch(/^لدى فاطمة/);
  });
  it('translates every templated interface string it defines', () => {
    for (const [en, ar] of Object.entries(UI_AR)) {
      const vars = en.match(/\{\w+\}/g) ?? [];
      for (const v of vars) if (!['{n}'].includes(v) || en.includes(' {n} ')) expect(ar.includes(v) || /\{n\}/.test(en), `${en} → ${ar}`).toBe(true);
    }
  });
});
