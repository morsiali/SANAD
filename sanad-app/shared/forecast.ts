// Administrative forecast: what is coming up, worked out with simple, visible rules from the user's own view.
// It is about schedules and supplies — never a prediction about anyone's health.
import type { Msg, View } from './types';
import { refillForecast } from './records';
import { isOpenTask } from './plans';
import { msg } from './messages';

const H = 3_600_000;
const DAY = 24 * H;
export const BUSY_DAY = 5;

export interface ForecastItem {
  key: string;
  kind: 'refill' | 'cover' | 'busy' | 'unowned' | 'approval' | 'prep' | 'standing';
  at: number;
  recipientId?: string;
  userId?: string;
  m: Msg;
  rule: Msg;
  link: string;
  tone: 'warn' | 'info';
}

const dayStart = (at: number) => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function forecast(view: View, now: number, days = 14): ForecastItem[] {
  const until = now + days * DAY;
  const out: ForecastItem[] = [];
  const name = (rid: string) => view.recipients.find((r) => r.id === rid)?.name ?? '';
  const can = (rid: string, d: string) => !!view.access[rid]?.includes(d as never);

  for (const m of view.medications) {
    if (!can(m.recipientId, 'medical')) continue;
    const f = refillForecast(m, now);
    if (f.runsOutOn === null || f.runsOutOn > until) continue;
    out.push({
      key: `refill:${m.id}`,
      kind: 'refill',
      at: f.runsOutOn,
      recipientId: m.recipientId,
      m: msg('fc_refill', { med: m.name, recipient: name(m.recipientId), day: f.runsOutOn }),
      rule: msg('why_al_refill', { onHand: m.onHand ?? 0, per: m.perDose ?? 0, times: m.times.length }),
      link: `/app/people/${m.recipientId}?tab=medical`,
      tone: f.due ? 'warn' : 'info',
    });
  }

  const open = view.tasks.filter((t) => isOpenTask(t) && t.status !== 'draft');
  for (const t of open) {
    if (t.kind === 'coverage' && !t.ownerId && t.coverFrom && t.coverFrom < until && (t.coverTo ?? 0) > now)
      out.push({ key: `cover:${t.id}`, kind: 'cover', at: t.coverFrom, recipientId: t.recipientId, m: msg('fc_cover', { recipient: name(t.recipientId), at: t.coverFrom }), rule: msg('fc_rule_cover'), link: `/app/people/${t.recipientId}?tab=plans`, tone: t.coverFrom - now < 2 * DAY ? 'warn' : 'info' });
    else if (t.kind === 'task' && !t.ownerId && t.dueAt && t.dueAt < until)
      out.push({ key: `unowned:${t.id}`, kind: 'unowned', at: t.dueAt, recipientId: t.recipientId, m: msg('fc_unowned', { title: t.title, recipient: name(t.recipientId), at: t.dueAt }), rule: msg('fc_rule_unowned'), link: `/app/people/${t.recipientId}?tab=plans`, tone: 'warn' });
  }

  // Heavy days: one person owning many due items on the same day (next 7 days).
  const load = new Map<string, { userId: string; day: number; n: number }>();
  for (const t of open) {
    if (!t.ownerId || !t.dueAt || t.dueAt < now || t.dueAt > now + 7 * DAY) continue;
    const day = dayStart(t.dueAt);
    const k = `${t.ownerId}:${day}`;
    const e = load.get(k) ?? { userId: t.ownerId, day, n: 0 };
    e.n += 1;
    load.set(k, e);
  }
  for (const e of load.values()) {
    if (e.n < BUSY_DAY) continue;
    const u = view.users.find((x) => x.id === e.userId);
    out.push({ key: `busy:${e.userId}:${e.day}`, kind: 'busy', at: e.day, userId: e.userId, m: msg('fc_busy', { name: u?.name ?? '', n: e.n, day: e.day }), rule: msg('fc_rule_busy', { n: BUSY_DAY }), link: '/app/calendar', tone: 'info' });
  }

  for (const a of view.appointments) {
    if (a.status !== 'scheduled' || a.startAt < now || a.startAt > until) continue;
    const prep = view.tasks.filter((t) => t.appointmentId === a.id && isOpenTask(t)).length;
    if (prep) out.push({ key: `prep:${a.id}`, kind: 'prep', at: a.startAt, recipientId: a.recipientId, m: msg('fc_prep', { title: a.title, recipient: name(a.recipientId), n: prep, at: a.startAt }), rule: msg('fc_rule_prep'), link: `/app/people/${a.recipientId}?tab=appointments`, tone: a.startAt - now < 2 * DAY ? 'warn' : 'info' });
  }

  for (const ap of view.approvals) {
    if (ap.status !== 'pending' || ap.expiresAt < now || ap.expiresAt > until) continue;
    out.push({ key: `approval:${ap.id}`, kind: 'approval', at: ap.expiresAt, recipientId: ap.recipientId, m: msg('fc_approval', { recipient: name(ap.recipientId), at: ap.expiresAt }), rule: msg('fc_rule_approval'), link: '/app/approvals', tone: 'warn' });
  }

  for (const p of view.standing) {
    if (p.revokedAt || p.expiresAt < now || p.expiresAt > until) continue;
    out.push({ key: `standing:${p.id}`, kind: 'standing', at: p.expiresAt, recipientId: p.recipientId, m: msg('fc_standing', { what: `@sp_${p.kind}`, recipient: name(p.recipientId), at: p.expiresAt }), rule: msg('fc_rule_standing'), link: `/app/people/${p.recipientId}?tab=team`, tone: 'info' });
  }

  return out.sort((a, b) => a.at - b.at);
}
