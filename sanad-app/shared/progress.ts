// Measured values over time, built only from records the viewer may see. Shared by the progress charts
// and the assistant so both describe exactly the same numbers. Describes, never interprets.
import type { CareRecord, Domain } from './types';
import { kindOf } from './records';

const DAY = 86_400_000;

export interface MeasureSeries {
  key: string;
  kind: string;
  /** Record title for measurements (e.g. "Blood glucose (fasting)"), otherwise the kind's label. */
  title: string;
  unit: string;
  domain: Domain;
  points: CareRecord[];
}

export const DOMAIN_ORDER: Domain[] = ['medical', 'wellbeing', 'academic', 'social', 'activity', 'rehab'];

export function measureSeries(records: CareRecord[], recipientId: string, from: number, to: number): MeasureSeries[] {
  const map = new Map<string, MeasureSeries>();
  for (const r of records) {
    if (r.recipientId !== recipientId || r.archived || r.value === null || r.value === undefined || r.observedAt < from || r.observedAt > to) continue;
    const def = kindOf(r.kind);
    if (!def?.measure) continue;
    const key = r.kind === 'measurement' ? `${r.kind}|${r.title}|${r.unit}` : `${r.kind}|${r.unit}`;
    if (!map.has(key)) map.set(key, { key, kind: r.kind, title: r.kind === 'measurement' ? r.title : def.label, unit: r.unit ?? '', domain: r.domain, points: [] });
    map.get(key)!.points.push(r);
  }
  for (const s of map.values()) s.points.sort((a, b) => a.observedAt - b.observedAt);
  return [...map.values()].sort((a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain) || a.title.localeCompare(b.title));
}

/** Gaps much longer than the usual interval between readings (at least 7 days, or 3× the median interval). */
export function seriesGaps(points: Pick<CareRecord, 'observedAt'>[], until: number): { from: number; to: number }[] {
  if (points.length < 2) return [];
  const steps = points.slice(1).map((p, i) => p.observedAt - points[i].observedAt).sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)];
  const limit = Math.max(7 * DAY, 3 * median);
  const out: { from: number; to: number }[] = [];
  points.slice(1).forEach((p, i) => {
    if (p.observedAt - points[i].observedAt > limit) out.push({ from: points[i].observedAt, to: p.observedAt });
  });
  const last = points[points.length - 1].observedAt;
  if (until - last > limit) out.push({ from: last, to: until });
  return out;
}

/** First, latest, lowest and highest recorded value, and the direction from first to latest in neutral words. */
export function describeSeries(s: MeasureSeries) {
  const vals = s.points.map((p) => p.value ?? 0);
  const first = s.points[0];
  const last = s.points[s.points.length - 1];
  const diff = (last.value ?? 0) - (first.value ?? 0);
  return {
    first,
    last,
    min: Math.min(...vals),
    max: Math.max(...vals),
    diff,
    direction: (Math.abs(diff) < 0.05 ? 'same' : diff > 0 ? 'higher' : 'lower') as 'same' | 'higher' | 'lower',
  };
}
