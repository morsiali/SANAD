// SANAD Intelligence: solution recommendations, next-best actions and the "just ask" assistant.
// Deterministic and local — no data leaves the platform. Understands English and Arabic questions.
import { CATEGORY_LABEL, type Challenge, type Msg, type Playbook, type RoutingDecision, type User, type View } from './types';
import { decideRouting, isActive, normalize, tokens, PRIORITY_WEIGHT } from './routing';
import { canVerify, canWork, userName } from './engine';
import { en, msg } from './messages';
import { contentAr } from './ar-content';
import { CATEGORY_AR } from './messages';

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.sqrt(A.size * B.size);
}

const ar = (s: string) => contentAr[s] ?? '';

export interface PlaybookMatch {
  playbook: Playbook;
  score: number;
  relevance: number;
  successRate: number;
  reasons: string[];
  why: Msg[];
}

/** Text a playbook is matched on — English plus its Arabic translation, so Arabic questions find it too. */
export function playbookText(p: Playbook): string {
  return [p.title, p.summary, p.tags.join(' '), CATEGORY_LABEL[p.category], ar(p.title), ar(p.summary), p.tags.map(ar).join(' '), CATEGORY_AR[p.category]].join(' ');
}

const challengeText = (c: Pick<Challenge, 'title' | 'description'>) => `${c.title} ${c.description} ${ar(c.title)} ${ar(c.description)}`;

export function rankPlaybooks(playbooks: Playbook[], text: string, category?: Challenge['category'], minRelevance = 0.18): PlaybookMatch[] {
  const q = tokens(text);
  const out: PlaybookMatch[] = [];
  for (const p of playbooks) {
    let relevance = overlap(q, tokens(playbookText(p)));
    if (category && p.category === category) relevance += 0.35;
    if (relevance < minRelevance) continue;
    const successRate = (p.successes + 1) / (p.uses + 2);
    const speed = 1 / (1 + p.minutes / 60);
    const effortFactor = p.effort === 1 ? 1 : p.effort === 2 ? 0.82 : 0.64;
    const score = relevance * relevance * (0.6 + 0.4 * successRate) * (0.7 + 0.3 * speed) * effortFactor;
    const why: Msg[] = [];
    if (category && p.category === category) why.push(msg('p_built', { category }));
    if (p.uses >= 2) why.push(msg('p_worked', { pct: Math.round((p.successes / Math.max(1, p.uses)) * 100), n: p.uses }));
    why.push(msg('p_effort', { min: p.minutes, effort: String(p.effort) }));
    out.push({ playbook: p, score, relevance, successRate, reasons: why.map(en), why });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function recommendFor(view: Pick<View, 'playbooks'>, c: Challenge): PlaybookMatch[] {
  const ranked = rankPlaybooks(view.playbooks, challengeText(c), c.category);
  const applied = ranked.findIndex((m) => m.playbook.id === c.playbookId);
  if (applied > 0) ranked.unshift(...ranked.splice(applied, 1));
  return ranked.slice(0, 4);
}

export function similarResolved(view: Pick<View, 'challenges'>, c: Challenge, limit = 3): { challenge: Challenge; similarity: number }[] {
  const q = tokens(challengeText(c));
  return view.challenges
    .filter((x) => x.id !== c.id && !isActive(x) && x.resolution)
    .map((x) => ({ challenge: x, similarity: overlap(q, tokens(challengeText(x))) + (x.category === c.category ? 0.2 : 0) }))
    .filter((x) => x.similarity >= 0.25)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export type NextActionKind = 'accept' | 'start' | 'resolve' | 'verify' | 'claim' | 'triage' | 'review' | 'continue';

export interface NextAction {
  challenge: Challenge;
  kind: NextActionKind;
  label: string;
  why: string;
  labelM: Msg;
  whyM: Msg;
  urgency: number;
}

export function durationMsg(mins: number): Msg {
  const m = Math.round(Math.abs(mins));
  if (m < 60) return msg('d_min', { n: m });
  const h = m / 60;
  if (h < 48) return msg('d_h', { n: Math.round(h * 10) / 10 >= 10 ? Math.round(h) : Math.round(h * 10) / 10 });
  return msg('d_days', { n: Math.round(h / 24) });
}

export const fmtDuration = (mins: number) => en(durationMsg(mins));

export function nextActions(view: View, now = Date.now()): NextAction[] {
  const me = view.users.find((u) => u.id === view.me);
  if (!me) return [];
  const out: NextAction[] = [];
  const push = (challenge: Challenge, kind: NextActionKind, labelK: string, whyM: Msg, urgency: number) => {
    const labelM = msg(labelK);
    out.push({ challenge, kind, label: en(labelM), why: en(whyM), labelM, whyM, urgency });
  };
  for (const c of view.challenges) {
    const minsLeft = (c.dueAt - now) / 60_000;
    const base = PRIORITY_WEIGHT[c.priority] * 10 + (c.escalated ? 50 : 0) + (minsLeft < 0 ? 40 : Math.max(0, 30 - minsLeft / 20));
    const when = minsLeft < 0 ? msg('w_overdue', { d: durationMsg(-minsLeft) }) : msg('w_due', { d: durationMsg(minsLeft) });
    if (c.stage === 'resolved' && canVerify(me, c) && c.assigneeId !== me.id) {
      push(c, 'verify', 'a_confirm', msg('w_marked', { name: userName(view, c.assigneeId) }), 25);
      continue;
    }
    if (!isActive(c)) continue;
    if (c.assigneeId === me.id) {
      if (c.stage === 'reported') push(c, 'triage', 'a_route', msg('w_triage', { when }), base + 5);
      else if (c.stage === 'routed') push(c, 'accept', 'a_accept', msg('w_new', { when }), base + 4);
      else if (c.stage === 'accepted') push(c, 'start', 'a_start', msg('w_accepted', { when }), base + 2);
      else {
        const left = c.checklist.filter((i) => !i.done).length;
        if (c.checklist.length && left === 0) push(c, 'resolve', 'a_resolve', msg('w_all_done'), base + 6);
        else push(c, 'continue', 'a_continue', c.checklist.length ? msg('w_left', { n: left, when }) : when, base);
      }
    } else if (!c.assigneeId && c.role === me.role) {
      push(c, 'claim', 'a_claim', msg('w_queue', { when }), base + 3);
    } else if (me.role === 'coordinator' && c.escalated) {
      push(c, 'review', 'a_review', c.escalationReason === 'SLA breached' ? msg('sla_breached') : { k: 'raw', p: { t: c.escalationReason ?? '' } }, base);
    }
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

export type AnswerCard = { kind: 'challenge'; id: string } | { kind: 'playbook'; id: string } | { kind: 'user'; id: string };

export interface Answer {
  text: string;
  /** The answer as translatable sentences. */
  says: Msg[];
  cards: AnswerCard[];
  preview?: RoutingDecision;
  previewText?: string;
  suggestions: Msg[];
}

export const STARTERS: Msg[] = ['q_focus', 'q_overdue', 'q_wheelchair', 'q_missed_dose', 'q_fatima', 'q_team'].map((k) => msg(k));

// Intent patterns in English and Arabic (matched against normalized text).
const I = {
  route: /\b(who (handles|should handle|is responsible for|takes care of|deals with|fixes)|who do i (contact|call|ask) (about|for)|where (does|should) (this|it|a|an)|route)\b(.*)|(من (يتولى|يتولي|المسوول عن|المسؤول عن|يعالج|يحل|اتصل به بخصوص)|لمن (يذهب|اتوجه|اوجه))(.*)/,
  how: /\b(how (do|to|can|should)|fix|solve|best way|playbook|steps? (for|to)|what can i do)\b|(كيف (احل|اتعامل|اصلح|يمكن|نحل|اعالج|اتصرف)|طريقه|خطوات|دليل|ماذا افعل)/,
  overdue: /\b(overdue|late|breach|sla|behind)\b|(متاخر|تاخر|تجاوز)/,
  escalated: /\b(escalat)|(تصعيد|مصعد)/,
  urgent: /\b(urgent|critical|emergenc)|(عاجل|طار|حرج)/,
  next: /\b(next|focus|my queue|my day|priorit|to do|todo|what should i)\b|(اركز|تالي|اولوي|قايمتي|مهامي|ابدا)/,
  team: /\b(available|team|busy|workload|load|who is on|who's on|whos on)\b|(متاح|فريق|عبء|مشغول)/,
  summary: /\b(summary|overview|status|today|how (is|are)|doing)\b|(ملخص|نظره عامه|حال|وضع|اليوم)/,
  personAsk: /\b(how (is|are)|doing)\b|(حال|وضع|اخبار)/,
};

export function ask(view: View, raw: string, now = Date.now()): Answer {
  const q = raw.trim();
  const n = normalize(q);
  const active = view.challenges.filter(isActive);
  const me = view.users.find((u) => u.id === view.me) as User;
  const names = (full: string) => [full, full.split(' ')[0], ar(full), ar(full).split(' ')[0]].filter(Boolean).map((x) => normalize(x).trim());
  const recipient = view.recipients.find((r) => names(r.name).some((x) => x && n.includes(` ${x} `)));
  const scoped = recipient ? view.challenges.filter((c) => c.recipientId === recipient.id) : view.challenges;
  const scopedActive = scoped.filter(isActive);
  const list = (cs: Challenge[]) => cs.slice(0, 8).map((c) => ({ kind: 'challenge' as const, id: c.id }));
  const answer = (says: Msg[], cards: AnswerCard[], suggestions: string[], extra: Partial<Answer> = {}): Answer => ({
    text: says.map(en).join(' '),
    says,
    cards,
    suggestions: suggestions.map((k) => msg(k)),
    ...extra,
  });

  if (!q) return answer([msg('x_empty')], [], ['q_focus', 'q_overdue', 'q_wheelchair']);

  const refMatch = q.match(/san-?\s?(\d{3,5})/i);
  if (refMatch) {
    const ref = `SAN-${refMatch[1]}`;
    const c = view.challenges.find((x) => x.ref === ref);
    if (!c) return answer([msg('x_ref_missing', { ref })], [], ['q_focus']);
    const says: Msg[] = [msg('x_ref', { ref: c.ref, title: c.title, stage: c.stage, who: c.assigneeId ? userName(view, c.assigneeId) : msg('team_queue'), role: c.role })];
    if (c.checklist.length) says.push(msg('x_ref_steps', { done: c.checklist.filter((i) => i.done).length, total: c.checklist.length }));
    if (isActive(c)) says.push(c.dueAt < now ? msg('x_ref_overdue', { d: durationMsg((now - c.dueAt) / 60000) }) : msg('x_ref_due', { d: durationMsg((c.dueAt - now) / 60000) }));
    if (c.escalated) says.push(msg('x_ref_esc'));
    return answer(says, [{ kind: 'challenge', id: c.id }], ['q_focus']);
  }

  const routeAsk = n.match(I.route);
  if (routeAsk) {
    const tail = (routeAsk[7] ?? routeAsk[11] ?? '').replace(/^\s*(a|an|the)\s+/, '').trim();
    const subject = tail.length > 2 ? tail : q;
    const preview = decideRouting(
      { title: subject, description: '', recipientId: recipient?.id ?? view.recipients[0]?.id ?? '' },
      { users: view.users, rules: view.rules, settings: view.settings, loads: view.loads, recipients: view.recipients },
    );
    const who: string | Msg = preview.assigneeId ? userName(view, preview.assigneeId) : msg('x_route_queue', { role: preview.role });
    return answer([msg('x_route', { role: preview.role, who, priority: preview.priority })], preview.assigneeId ? [{ kind: 'user', id: preview.assigneeId }] : [], ['q_how_fix', 'q_team'], {
      preview,
      previewText: subject,
    });
  }

  if (recipient && I.personAsk.test(n)) return personSummary();

  if (I.how.test(n)) {
    const matches = rankPlaybooks(view.playbooks, q).slice(0, 4);
    if (matches.length) {
      const best = matches[0].playbook;
      const says = [msg('x_best', { pb: best.title, n: best.steps.length, min: best.minutes })];
      if (matches.length > 1) says.push(msg('x_more', { n: matches.length - 1 }));
      return answer(says, matches.map((m) => ({ kind: 'playbook', id: m.playbook.id })), ['q_who_handles', 'q_focus']);
    }
    return answer([msg('x_no_pb')], [], ['q_focus', 'q_overdue', 'q_wheelchair']);
  }

  if (I.overdue.test(n)) {
    const due = scopedActive.filter((c) => c.dueAt < now).sort((a, b) => a.dueAt - b.dueAt);
    return answer([due.length ? msg('x_overdue', { n: due.length }) : msg('x_none_overdue')], list(due), ['q_escalated']);
  }

  if (I.escalated.test(n)) {
    const esc = scopedActive.filter((c) => c.escalated);
    return answer([esc.length ? msg('x_esc', { n: esc.length }) : msg('x_none_esc')], list(esc), ['q_overdue']);
  }

  if (I.urgent.test(n)) {
    const urg = scopedActive.filter((c) => c.priority === 'urgent' || c.priority === 'high').sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
    return answer([urg.length ? msg('x_urgent', { n: urg.length }) : msg('x_none_urgent')], list(urg), ['q_focus']);
  }

  if (I.next.test(n)) {
    const acts = nextActions(view, now).slice(0, 6);
    return answer(
      [acts.length ? msg('x_next', { title: acts[0].challenge.title, action: acts[0].labelM, why: acts[0].whyM }) : msg('x_clear')],
      acts.map((a) => ({ kind: 'challenge', id: a.challenge.id })),
      ['q_overdue', 'q_team'],
    );
  }

  if (I.team.test(n)) {
    const staff = view.users.filter((u) => u.role !== 'family').sort((a, b) => (view.loads[a.id] ?? 0) - (view.loads[b.id] ?? 0));
    const avail = staff.filter((u) => u.available);
    return answer(
      [msg('x_team', { a: avail.length, n: staff.length, name: avail[0]?.name ?? msg('x_nobody') })],
      staff.slice(0, 8).map((u) => ({ kind: 'user', id: u.id })),
      ['q_missed_ride'],
    );
  }

  if (recipient || I.summary.test(n)) return personSummary();

  function personSummary(): Answer {
    const resolved7 = scoped.filter((c) => c.resolvedAt && now - c.resolvedAt < 7 * 864e5).length;
    const urgent = scopedActive.filter((c) => c.priority === 'urgent' || c.priority === 'high').length;
    const says = recipient
      ? [msg('x_person', { name: recipient.name.split(' ')[0], n: scopedActive.length, urgent: urgent ? msg('x_person_urgent', { n: urgent }) : '', resolved: resolved7 })]
      : [msg('x_summary', { open: active.length, overdue: active.filter((c) => c.dueAt < now).length, esc: active.filter((c) => c.escalated).length, resolved: resolved7 })];
    return answer(says, list([...scopedActive].sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority])), ['q_focus', 'q_overdue']);
  }

  // Fallback: search everything visible, then show where a new problem like this would go.
  const qt = tokens(q);
  const hits = view.challenges
    .map((c) => ({ c, s: overlap(qt, tokens(`${challengeText(c)} ${c.ref}`)) }))
    .filter((x) => x.s > 0.15)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  const pbs = rankPlaybooks(view.playbooks, q).slice(0, 2);
  const preview = decideRouting(
    { title: q, description: '', recipientId: view.recipients[0]?.id ?? '' },
    { users: view.users, rules: view.rules, settings: view.settings, loads: view.loads, recipients: view.recipients },
  );
  const cards: AnswerCard[] = [...hits.map((h) => ({ kind: 'challenge' as const, id: h.c.id })), ...pbs.map((p) => ({ kind: 'playbook' as const, id: p.playbook.id }))];
  return answer(
    [
      cards.length
        ? msg('x_found', { c: hits.length, p: pbs.length, role: preview.role })
        : msg('x_nothing', { role: preview.role, who: preview.assigneeId ? msg('x_who_suffix', { name: userName(view, preview.assigneeId) }) : '' }),
    ],
    cards,
    me?.role === 'coordinator' ? ['q_escalated', 'q_team'] : ['q_focus', 'q_overdue', 'q_wheelchair'],
    { preview, previewText: q },
  );
}

export { canWork };
