// Care categories for the people SANAD looks after.
// Each person has three stored dimensions (support level, living situation, care needs)
// plus an age group worked out from their age. When a stored value is missing
// (older saved data, or a family member who skipped it) it is suggested from the care note.
import type { Recipient } from './types';

export type SupportLevel = 'independent' | 'assisted' | 'high';
export type Living = 'alone' | 'family' | 'carer';
export type CareNeed = 'chronic' | 'mobility' | 'recovery' | 'memory' | 'renal' | 'sensory';
export type AgeGroup = 'under65' | '65to74' | '75to84' | '85plus';

export const SUPPORT_LEVELS: SupportLevel[] = ['high', 'assisted', 'independent'];
export const LIVINGS: Living[] = ['alone', 'family', 'carer'];
export const CARE_NEEDS: CareNeed[] = ['chronic', 'mobility', 'recovery', 'memory', 'renal', 'sensory'];
export const AGE_GROUPS: AgeGroup[] = ['under65', '65to74', '75to84', '85plus'];

export const SUPPORT_LABEL: Record<SupportLevel, string> = {
  high: 'High support',
  assisted: 'Some support',
  independent: 'Mostly independent',
};
export const SUPPORT_HINT: Record<SupportLevel, string> = {
  high: 'Daily hands-on care or complex medical needs',
  assisted: 'Regular help with some daily tasks or health checks',
  independent: 'Manages day to day; needs help now and then',
};
export const LIVING_LABEL: Record<Living, string> = {
  alone: 'Lives alone',
  family: 'Lives with family',
  carer: 'Live-in carer',
};
export const NEED_LABEL: Record<CareNeed, string> = {
  chronic: 'Long-term condition',
  mobility: 'Mobility & falls risk',
  recovery: 'Recovering after surgery or illness',
  memory: 'Memory & cognition',
  renal: 'Kidney care & dialysis',
  sensory: 'Hearing or sight loss',
};
export const NEED_ICON: Record<CareNeed, string> = {
  chronic: 'heart',
  mobility: 'walk',
  recovery: 'refresh',
  memory: 'brain',
  renal: 'drop',
  sensory: 'eye',
};
export const AGE_LABEL: Record<AgeGroup, string> = {
  under65: 'Under 65',
  '65to74': 'Aged 65–74',
  '75to84': 'Aged 75–84',
  '85plus': 'Aged 85 and over',
};

/** Light normaliser so English and Arabic notes match the keyword lists below. */
function fold(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
}

const NEED_WORDS: Record<CareNeed, string[]> = {
  chronic: ['diabetes', 'diabetic', 'blood pressure', 'hypertension', 'heart', 'copd', 'asthma', 'arthritis', 'سكري', 'السكر', 'ضغط الدم', 'القلب', 'ربو', 'روماتيزم'],
  mobility: ['walker', 'wheelchair', 'cane', 'mobility', 'falls', 'fall risk', 'bedbound', 'bed bound', 'مشايه', 'كرسي متحرك', 'عكاز', 'الحركه', 'سقوط', 'طريح'],
  recovery: ['surgery', 'operation', 'recovering', 'rehab', 'discharged', 'fracture', 'physio', 'جراحه', 'عمليه', 'يتعافي', 'تتعافي', 'تعافي', 'تاهيل', 'كسر'],
  memory: ['dementia', 'alzheimer', 'memory', 'forgetful', 'confusion', 'cognitive', 'خرف', 'الزهايمر', 'ذاكره', 'نسيان'],
  renal: ['dialysis', 'kidney', 'renal', 'غسيل الكلي', 'الكلي', 'غسيل كلوي'],
  sensory: ['hearing', 'deaf', 'blind', 'sight', 'vision', 'eyesight', 'السمع', 'سماعه', 'النظر', 'البصر', 'كفيف'],
};
const LIVING_WORDS: Record<Living, string[]> = {
  alone: ['lives alone', 'living alone', 'on her own', 'on his own', 'by herself', 'by himself', 'يعيش وحده', 'تعيش وحدها', 'بمفرده', 'بمفردها', 'وحيد', 'وحيده'],
  carer: ['live in', 'live-in', 'maid', 'housemaid', 'nanny', 'مقيمه', 'عامله منزليه', 'خادمه'],
  family: ['lives with', 'living with', 'with her daughter', 'with his daughter', 'with her son', 'with his son', 'with family', 'يعيش مع', 'تعيش مع', 'مع ابنته', 'مع ابنها', 'مع عائلته', 'مع عائلتها'],
};

const has = (folded: string, words: string[]) => words.some((w) => folded.includes(fold(w).slice(0, -1)));

export function inferNeeds(note: string): CareNeed[] {
  const f = fold(note);
  return CARE_NEEDS.filter((n) => has(f, NEED_WORDS[n]));
}

export function inferLiving(note: string): Living | null {
  const f = fold(note);
  return (['alone', 'carer', 'family'] as Living[]).find((l) => has(f, LIVING_WORDS[l])) ?? null;
}

export function ageGroup(age: number): AgeGroup {
  if (age >= 85) return '85plus';
  if (age >= 75) return '75to84';
  if (age >= 65) return '65to74';
  return 'under65';
}

/** Suggest a support level from needs, age and living situation. Families and coordinators can override it. */
export function suggestSupport(needs: CareNeed[], age: number, living: Living): SupportLevel {
  if (needs.includes('renal') || needs.includes('memory')) return 'high';
  const score = needs.length + (age >= 85 ? 1 : 0) + (living === 'alone' && needs.length ? 1 : 0);
  if (score >= 3) return 'high';
  if (score >= 1) return 'assisted';
  return 'independent';
}

export interface CareProfile {
  support: SupportLevel;
  living: Living;
  needs: CareNeed[];
  ageGroup: AgeGroup;
  /** True when some part was suggested from the note rather than set by a person. */
  suggested: boolean;
}

export function careProfile(r: Pick<Recipient, 'age' | 'note'> & Partial<Pick<Recipient, 'support' | 'living' | 'needs'>>): CareProfile {
  const needs = r.needs ?? inferNeeds(r.note);
  const living = r.living ?? inferLiving(r.note) ?? 'family';
  const support = r.support ?? suggestSupport(needs, r.age, living);
  return { support, living, needs, ageGroup: ageGroup(r.age), suggested: !r.needs || !r.living || !r.support };
}

/** True when a problem about this person should never sit at the lowest priority. */
export function isVulnerable(p: CareProfile): 'high' | 'alone' | null {
  if (p.support === 'high') return 'high';
  if (p.living === 'alone') return 'alone';
  return null;
}

export interface ProfileInput {
  support?: string;
  living?: string;
  needs?: string[];
}

/** Keep only known values; anything missing falls back to a suggestion from the note. */
export function cleanProfile(input: ProfileInput | undefined, age: number, note: string): { support: SupportLevel; living: Living; needs: CareNeed[] } {
  const needs = Array.isArray(input?.needs) ? CARE_NEEDS.filter((n) => input!.needs!.includes(n)) : inferNeeds(note);
  const living = LIVINGS.includes(input?.living as Living) ? (input!.living as Living) : inferLiving(note) ?? 'family';
  const support = SUPPORT_LEVELS.includes(input?.support as SupportLevel) ? (input!.support as SupportLevel) : suggestSupport(needs, age, living);
  return { support, living, needs };
}

/** Matches "support:high", "living:alone" or "need:renal" against a person's care profile. */
export function inCareGroup(r: Recipient | undefined, group: string): boolean {
  if (!r) return false;
  const [kind, value] = group.split(':');
  const p = careProfile(r);
  if (kind === 'support') return p.support === value;
  if (kind === 'living') return p.living === value;
  if (kind === 'need') return p.needs.includes(value as CareNeed);
  return true;
}
