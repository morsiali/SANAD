// The routing brain: classify a problem, infer urgency, pick the right person.
import type { Category, Challenge, Msg, Priority, Recipient, Role, RoutingDecision, Rule, Settings, User } from './types';
import { en, msg } from './messages';
import { careProfile, isVulnerable } from './care';

const STOP = new Set(
  'a an the and or but if of to in on at for with by from is are was were be been being it its this that these those i me my we our you your he she her his him they them their there here as so not no do does did have has had can could should would will just very really also about into over after before again then than too up down out off more most some any all each other such only own same both few once while what which who whom when where why how am please need needs help get got fix fixed solve handle handles best way doing من في علي الي عن مع هذا هذه ذلك تلك تي ذي كيف ماذا ما هل او و لا لم لن ان قد كان كانت يا انا نحن هو هي هم عندي لدي اريد يجب ممكن نحتاج احتاج'.split(
    ' ',
  ),
);

const AR_PREFIX = /^(?:وال|بال|فال|كال|لل|ال)(?=\S{3,})/;

/** Lowercase, strip punctuation, and fold Arabic spelling variants so "الأدوية" and "ادويه" meet. */
export function normalize(text: string): string {
  const folded = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/[^a-z0-9\u0600-\u06ff\s-]/g, ' ')
    .replace(/[،؛؟]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${folded
    .split(' ')
    .map((w) => (/[\u0600-\u06ff]/.test(w) ? w.replace(AR_PREFIX, '') : w))
    .join(' ')} `;
}

/** Light stemmer — good enough to make "refills", "refilled" and "refill" meet. */
export function stem(word: string): string {
  if (word.length <= 4 || /[\u0600-\u06ff]/.test(word)) return word;
  for (const suf of ['ings', 'ing', 'edly', 'ed', 'ies', 'es', 's', 'ly']) {
    if (word.endsWith(suf) && word.length - suf.length >= 3) {
      const base = word.slice(0, -suf.length);
      return suf === 'ies' ? `${base}y` : base;
    }
  }
  return word;
}

export function tokens(text: string): string[] {
  return normalize(text)
    .trim()
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

/** Does a keyword (single word or phrase) occur in the normalized text? Prefix match per word. */
export function hasKeyword(normText: string, keyword: string): boolean {
  const kw = normalize(keyword).trim();
  if (!kw) return false;
  const parts = kw.split(' ').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(^|\\s)${parts.join('\\S*\\s')}`, 'i');
  return pattern.test(normText);
}

export const PRIORITY_WEIGHT: Record<Priority, number> = { low: 1, medium: 2, high: 3, urgent: 4 };

const URGENT_SIGNALS = [
  'chest pain', 'cant breathe', 'cannot breathe', 'not breathing', 'short of breath', 'unconscious', 'unresponsive',
  'cant wake', 'bleeding heavily', 'stroke', 'seizure', 'emergency', 'cant get up', 'cannot get up', 'fainted', 'collapsed',
  'الم في الصدر', 'الم الصدر', 'الم صدر', 'لا يستطيع التنفس', 'لا تستطيع التنفس', 'ضيق تنفس', 'ضيق في التنفس', 'فاقد الوعي', 'فقد الوعي', 'نزيف',
  'ولا تستطيع النهوض', 'ولا يستطيع النهوض', 'ولا يستطيع التنفس', 'ولا تستطيع التنفس', 'جلطه', 'سكته', 'تشنج', 'طوارئ', 'طارئ', 'لا يستطيع النهوض', 'لا تستطيع النهوض', 'اغماء', 'اغمي',
];
const HIGH_SIGNALS = [
  'fell', 'fall', 'fallen', 'missed', 'ran out', 'run out', 'out of', 'no ride', 'today', 'tonight', 'this morning',
  'fever', 'dizzy', 'severe', 'swollen', 'swelling', 'infection', 'stranded', 'not show', 'no show', 'didnt come', 'did not come', 'pain',
  'سقط', 'سقطت', 'وقع', 'وقعت', 'نسي', 'نسيت', 'فاتته', 'فاتتها', 'فاتت', 'نفد', 'نفدت', 'اليوم', 'الليله', 'هذا الصباح', 'حمي', 'حراره', 'دوخه',
  'دوار', 'شديد', 'شديده', 'تورم', 'التهاب', 'عالق', 'لم يحضر', 'لم ياتي', 'لم ياتِ', 'الم',
];
const LOW_SIGNALS = ['when possible', 'no rush', 'next month', 'sometime', 'whenever', 'question about', 'curious', 'غير مستعجل', 'لاحقا', 'الشهر القادم', 'عندما يكون ممكنا', 'استفسار'];

export function inferPriority(text: string): { priority: Priority; signal: string | null } {
  const t = normalize(text);
  for (const s of URGENT_SIGNALS) if (hasKeyword(t, s)) return { priority: 'urgent', signal: s };
  for (const s of HIGH_SIGNALS) if (hasKeyword(t, s)) return { priority: 'high', signal: s };
  for (const s of LOW_SIGNALS) if (hasKeyword(t, s)) return { priority: 'low', signal: s };
  return { priority: 'medium', signal: null };
}

export function maxPriority(a: Priority, b: Priority | null | undefined): Priority {
  if (!b) return a;
  return PRIORITY_WEIGHT[b] > PRIORITY_WEIGHT[a] ? b : a;
}

export interface RuleMatch {
  rule: Rule;
  score: number;
  hits: string[];
}

export function matchRules(rules: Rule[], title: string, description: string): RuleMatch[] {
  const nt = normalize(title);
  const nd = normalize(description);
  const out: RuleMatch[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    let score = 0;
    const hits: string[] = [];
    for (const kw of rule.keywords) {
      const base = kw.trim().includes(' ') ? 2 : 1;
      const inTitle = hasKeyword(nt, kw);
      const inDesc = hasKeyword(nd, kw);
      if (inTitle || inDesc) {
        score += base * (inTitle ? 1.5 : 1);
        hits.push(kw.trim());
      }
    }
    if (score > 0) out.push({ rule, score, hits });
  }
  return out.sort((a, b) => b.score - a.score || a.rule.name.localeCompare(b.rule.name));
}

const TEAM_ONLY: Role[] = ['family', 'self', 'psychologist', 'physio', 'educator'];

export interface AssigneePick {
  user: User | null;
  reasons: string[];
  why: Msg[];
  ranked: { user: User; score: number }[];
}

export function selectAssignee(
  users: User[],
  loads: Record<string, number>,
  role: Role,
  recipientId: string,
  text: string,
  settings: Pick<Settings, 'balanceLoad' | 'preferContinuity'>,
  exclude: string[] = [],
  orgId?: string,
): AssigneePick {
  const norm = normalize(text);
  let pool = users.filter((u) => u.role === role && !exclude.includes(u.id));
  // Therapists, teachers and family only receive problems about people whose care team they are on.
  if (TEAM_ONLY.includes(role)) pool = pool.filter((u) => u.recipients.includes(recipientId));
  // Coordinators only handle people in their own organisation.
  if ((role === 'coordinator' || role === 'admin') && orgId) pool = pool.filter((u) => !u.orgId || u.orgId === orgId);
  const available = pool.filter((u) => u.available);
  if (available.length === 0) {
    const m = msg(pool.length === 0 ? 'r_none_setup' : 'r_none_available', { role });
    return { user: null, reasons: [en(m)], why: [m], ranked: [] };
  }
  const ranked = available
    .map((u) => {
      let score = settings.balanceLoad ? loads[u.id] ?? 0 : 0;
      if (settings.preferContinuity && u.recipients.includes(recipientId)) score -= 2.5;
      const skillHits = u.skills.filter((s) => hasKeyword(norm, s));
      score -= skillHits.length * 1.5;
      return { user: u, score, skillHits };
    })
    .sort((a, b) => a.score - b.score || a.user.name.localeCompare(b.user.name));
  const best = ranked[0];
  const why: Msg[] = [];
  if (best.skillHits.length) why.push(msg('r_skill', { skills: best.skillHits.join(', ') }));
  if (settings.preferContinuity && best.user.recipients.includes(recipientId)) why.push(msg('r_continuity'));
  if (settings.balanceLoad) why.push(msg(available.length > 1 ? 'r_load_team' : 'r_load_only', { n: loads[best.user.id] ?? 0 }));
  return { user: best.user, reasons: why.map(en), why, ranked: ranked.map(({ user, score }) => ({ user, score })) };
}

export interface RouteInput {
  title: string;
  description: string;
  recipientId: string;
  priority?: Priority | 'auto';
  category?: Category | 'auto';
}

export function decideRouting(
  input: RouteInput,
  ctx: { users: User[]; rules: Rule[]; settings: Settings; loads: Record<string, number>; recipients?: Recipient[] },
): RoutingDecision {
  const text = `${input.title}\n${input.description}`;
  const matches = matchRules(ctx.rules, input.title, input.description);
  const why: Msg[] = [];
  const add = (m: Msg) => why.push(m);
  let role: Role = 'coordinator';
  let category: Category = 'general';
  let ruleId: string | null = null;
  let confidence = 0;
  let floor: Priority | null = null;

  const forced = input.category && input.category !== 'auto' ? input.category : null;
  const usable = forced ? matches.filter((m) => m.rule.category === forced) : matches;

  if (usable.length) {
    const top = usable[0];
    const second = usable[1]?.score ?? 0;
    role = top.rule.role;
    category = top.rule.category;
    ruleId = top.rule.id;
    floor = top.rule.priorityFloor;
    confidence = Math.min(0.97, top.score / (top.score + second + 1) + 0.15 * Math.min(top.hits.length, 3) / 3);
    add(msg('r_matched', { rule: top.rule.name, hits: top.hits.slice(0, 4).map((h) => `“${h}”`).join(', ') }));
    if (usable[1]) add(msg('r_also', { rule: usable[1].rule.name }));
  } else if (forced) {
    category = forced;
    const rule = ctx.rules.find((r) => r.enabled && r.category === forced);
    if (rule) {
      role = rule.role;
      ruleId = rule.id;
      floor = rule.priorityFloor;
      confidence = 0.6;
      add(msg('r_chosen', { category: forced }));
    } else {
      add(msg('r_no_rule_cat', { category: forced }));
    }
  } else {
    add(msg('r_no_rule'));
  }

  const inferred = inferPriority(text);
  let priority: Priority;
  let inferredPriority = false;
  if (input.priority && input.priority !== 'auto') {
    priority = input.priority;
    // Never let a safety signal be under-rated.
    if (inferred.priority === 'urgent' && priority !== 'urgent') {
      priority = 'urgent';
      inferredPriority = true;
      add(msg('r_raised', { signal: inferred.signal ?? '' }));
    }
  } else {
    priority = inferred.priority;
    inferredPriority = true;
    if (inferred.signal) add(msg('r_priority', { priority, signal: inferred.signal }));
  }
  const floored = maxPriority(priority, floor);
  if (floored !== priority) {
    add(msg('r_floor', { priority: floored }));
    priority = floored;
  }

  // People who need high support, or who live alone, never wait at the lowest priority.
  const person = ctx.recipients?.find((r) => r.id === input.recipientId);
  if (person && priority === 'low') {
    const reason = isVulnerable(careProfile(person));
    if (reason) {
      priority = 'medium';
      add(msg(reason === 'high' ? 'r_care_high' : 'r_care_alone', { name: person.name }));
    }
  }

  const pick = selectAssignee(ctx.users, ctx.loads, role, input.recipientId, text, ctx.settings, [], person?.orgId);
  why.push(...pick.why);

  return {
    ruleId,
    category,
    role,
    assigneeId: pick.user?.id ?? null,
    confidence: Math.round(confidence * 100) / 100,
    reasons: why.map(en),
    why,
    priority,
    inferredPriority,
  };
}

export function isActive(c: Pick<Challenge, 'stage'>): boolean {
  return c.stage !== 'resolved' && c.stage !== 'verified';
}

export function computeLoads(users: User[], challenges: Challenge[]): Record<string, number> {
  const loads: Record<string, number> = {};
  for (const u of users) loads[u.id] = 0;
  for (const c of challenges) {
    if (c.assigneeId && isActive(c)) loads[c.assigneeId] = (loads[c.assigneeId] ?? 0) + PRIORITY_WEIGHT[c.priority];
  }
  return loads;
}
