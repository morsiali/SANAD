// Numbers for dashboards and the analytics page — all computed from challenges, nothing stored.
import { CATEGORY_LABEL, ROLES, ROLE_LABEL, STAGES, type Category, type Challenge, type Role, type Stage } from './types';
import { isActive } from './routing';

export interface Metrics {
  open: number;
  overdue: number;
  escalated: number;
  resolved7: number;
  slaCompliance: number | null; // % of resolved within SLA
  medianHours: number | null;
  avgRating: number | null;
  autoRouted: number | null; // % routed without triage
  byStage: Record<Stage, number>;
  byCategory: { key: Category; label: string; count: number }[];
  byRole: { key: Role; label: string; open: number; medianHours: number | null; resolved: number }[];
  daily: { day: string; label: string; opened: number; resolved: number }[];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

export function metrics(challenges: Challenge[], now = Date.now(), days = 14): Metrics {
  const active = challenges.filter(isActive);
  const done = challenges.filter((c) => c.resolvedAt);
  const hours = (c: Challenge) => ((c.resolvedAt ?? now) - c.slaFrom) / 3.6e6;
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const c of challenges) byStage[c.stage] += 1;
  const catCounts = new Map<Category, number>();
  for (const c of challenges) catCounts.set(c.category, (catCounts.get(c.category) ?? 0) + 1);
  const byCategory = [...catCounts.entries()].map(([key, count]) => ({ key, label: CATEGORY_LABEL[key], count })).sort((a, b) => b.count - a.count);
  const byRole = ROLES.map((r) => {
    const mine = challenges.filter((c) => c.role === r);
    const res = mine.filter((c) => c.resolvedAt);
    return { key: r, label: ROLE_LABEL[r], open: mine.filter(isActive).length, resolved: res.length, medianHours: round1(median(res.map(hours))) };
  }).filter((r) => r.open + r.resolved > 0);

  const daily: Metrics['daily'] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const from = start.getTime() - i * 864e5;
    const to = from + 864e5;
    const d = new Date(from);
    daily.push({
      day: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      opened: challenges.filter((c) => c.createdAt >= from && c.createdAt < to).length,
      resolved: challenges.filter((c) => c.resolvedAt && c.resolvedAt >= from && c.resolvedAt < to).length,
    });
  }
  const rated = challenges.filter((c) => c.rating);
  return {
    open: active.length,
    overdue: active.filter((c) => c.dueAt < now).length,
    escalated: active.filter((c) => c.escalated).length,
    resolved7: done.filter((c) => (c.resolvedAt ?? 0) > now - 7 * 864e5).length,
    slaCompliance: done.length ? Math.round((done.filter((c) => (c.resolvedAt ?? 0) <= c.dueAt).length / done.length) * 100) : null,
    medianHours: round1(median(done.map(hours))),
    avgRating: rated.length ? Math.round((rated.reduce((s, c) => s + (c.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
    autoRouted: challenges.length ? Math.round((challenges.filter((c) => c.routing.ruleId).length / challenges.length) * 100) : null,
    byStage,
    byCategory,
    byRole,
    daily,
  };
}
