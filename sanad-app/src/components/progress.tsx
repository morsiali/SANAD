// Progress charts built only from recorded values the viewer may see. No combined "condition score",
// no causal claims, neutral wording ("higher" / "lower", never "worse"), and a table for every chart.
import { AskButton } from './assistant';
import { useMemo, useState } from 'react';
import type { CareRecord, RecordSource } from '../../shared/types';
import { kindOf, SOURCE_LABEL } from '../../shared/records';
import { isOpenTask } from '../../shared/plans';
import { measureSeries, seriesGaps } from '../../shared/progress';
import { useSession } from '../lib/store';
import { locale, t, tc } from '../lib/i18n';
import { dateTime } from '../lib/format';
import { Empty, Icon } from './ui';

const C1 = '#476ADB';
const C2 = '#1F9E8F';
const DAY = 86_400_000;

interface Series {
  key: string;
  label: string;
  unit: string;
  kind: string;
  domain: CareRecord['domain'];
  points: CareRecord[];
}

const fmtDate = (at: number) => new Date(at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const num = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 });
const unitTxt = (u: string) => (u ? t(u) : '');

const gaps = seriesGaps;

function Marker({ source, x, y }: { source: RecordSource; x: number; y: number }) {
  // Shape shows who recorded the value, so the source is never told by colour alone.
  if (source === 'self') return <path d={`M${x} ${y - 6}L${x + 6} ${y + 5}H${x - 6}Z`} className="pt" />;
  if (source === 'caregiver') return <rect x={x - 5} y={y - 5} width={10} height={10} rx={1.5} className="pt" />;
  return <circle cx={x} cy={y} r={5.5} className="pt" />;
}

function LineChart({ s, from: rangeFrom, to }: { s: Series; from: number; to: number }) {
  const [hover, setHover] = useState<number | null>(null);
  // Start the time axis at the first value (at least a week back), so a recent series is not squeezed to one edge.
  const from = Math.max(rangeFrom, Math.min(s.points[0].observedAt - DAY, to - 7 * DAY));
  const W = 640;
  const H = 210;
  const pad = { l: 44, r: 14, t: 14, b: 28 };
  const def = kindOf(s.kind)?.measure;
  const vals = s.points.map((p) => p.value ?? 0);
  // Use the scale's own range when it is short (mood 1–5, pain 0–10, %); otherwise fit the recorded values.
  const fixed = def?.min !== undefined && def?.max !== undefined && def.max - def.min <= 100;
  let lo = fixed ? def!.min! : Math.min(...vals);
  let hi = fixed ? def!.max! : Math.max(...vals);
  if (!fixed) {
    const span = Math.max(1, hi - lo);
    lo = Math.floor(lo - span * 0.15);
    hi = Math.ceil(hi + span * 0.15);
  }
  if (hi === lo) hi = lo + 1;
  const x = (at: number) => pad.l + ((at - from) / Math.max(1, to - from)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ticks = [lo, (lo + hi) / 2, hi];
  const gs = gaps(s.points, to);
  const inGap = (a: number, b: number) => gs.some((g) => g.from === a && g.to === b);
  const segs: string[] = [];
  s.points.forEach((p, i) => {
    const cmd = i === 0 || inGap(s.points[i - 1].observedAt, p.observedAt) ? 'M' : 'L';
    segs.push(`${cmd}${x(p.observedAt).toFixed(1)} ${y(p.value ?? 0).toFixed(1)}`);
  });
  const dashed = gs.filter((g) => s.points.some((p) => p.observedAt === g.to)).map((g) => {
    const a = s.points.find((p) => p.observedAt === g.from)!;
    const b = s.points.find((p) => p.observedAt === g.to)!;
    return `M${x(a.observedAt)} ${y(a.value ?? 0)}L${x(b.observedAt)} ${y(b.value ?? 0)}`;
  });
  const hp = hover !== null ? s.points[hover] : null;
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('{label} over time, {n} recorded values', { label: s.label, n: s.points.length })} className="progress-svg">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 8} y={y(v) + 4} className="axis" textAnchor="end">
              {num(v)}
            </text>
          </g>
        ))}
        {gs.map((g, i) => (
          <rect key={i} x={x(g.from)} y={pad.t} width={Math.max(2, x(g.to) - x(g.from))} height={H - pad.t - pad.b} className="gap-band" />
        ))}
        <path d={segs.join(' ')} className="line" style={{ stroke: C1 }} />
        {dashed.map((d, i) => (
          <path key={i} d={d} className="line line-gap" style={{ stroke: C1 }} />
        ))}
        {s.points.map((p, i) => (
          <g
            key={p.id}
            tabIndex={0}
            role="button"
            aria-label={`${fmtDate(p.observedAt)}: ${num(p.value ?? 0)} ${unitTxt(s.unit)} · ${t(SOURCE_LABEL[p.source])}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className="pt-g"
            style={{ color: C1 }}
          >
            <circle cx={x(p.observedAt)} cy={y(p.value ?? 0)} r={14} className="hit" />
            <Marker source={p.source} x={x(p.observedAt)} y={y(p.value ?? 0)} />
          </g>
        ))}
        <text x={pad.l} y={H - 6} className="axis">
          {fmtDate(from)}
        </text>
        <text x={W - pad.r} y={H - 6} className="axis" textAnchor="end">
          {fmtDate(to)}
        </text>
      </svg>
      {hp && (
        <div className="tip" style={{ left: `${(x(hp.observedAt) / W) * 100}%` }}>
          <strong>
            {num(hp.value ?? 0)} {unitTxt(s.unit)}
          </strong>
          <span>{dateTime(hp.observedAt)}</span>
          <span>{t(SOURCE_LABEL[hp.source])}</span>
        </div>
      )}
    </div>
  );
}

function SeriesCard({ s, from, to }: { s: Series; from: number; to: number }) {
  const [table, setTable] = useState(false);
  const { view } = useSession();
  const def = kindOf(s.kind);
  const first = s.points[0];
  const last = s.points[s.points.length - 1];
  const diff = (last.value ?? 0) - (first.value ?? 0);
  const gs = gaps(s.points, to);
  const sources = [...new Set(s.points.map((p) => p.source))];
  const summary =
    s.points.length === 1
      ? t('One value recorded in this period: {v} on {date}.', { v: `${num(last.value ?? 0)} ${unitTxt(s.unit)}`, date: fmtDate(last.observedAt) })
      : t('{n} values recorded. The first in this period was {a} ({d1}); the latest is {b} ({d2}) — {change}.', {
          n: s.points.length,
          a: `${num(first.value ?? 0)} ${unitTxt(s.unit)}`,
          d1: fmtDate(first.observedAt),
          b: `${num(last.value ?? 0)} ${unitTxt(s.unit)}`,
          d2: fmtDate(last.observedAt),
          change: Math.abs(diff) < 0.05 ? t('the same') : t(diff > 0 ? '{v} higher' : '{v} lower', { v: `${num(Math.abs(diff))} ${unitTxt(s.unit)}` }),
        });
  return (
    <figure className="panel progress-card">
      <figcaption className="panel-head">
        <h3>
          {s.label} {s.unit && <small className="muted">({unitTxt(s.unit)})</small>}
        </h3>
        <button type="button" className="link small" aria-pressed={table} onClick={() => setTable(!table)}>
          {t(table ? 'Show chart' : 'Show table')}
        </button>
      </figcaption>
      <p className="small">{summary}</p>
      {gs.length > 0 && (
        <p className="small missing">
          <Icon name="flag" size={13} /> {t('No values recorded from {a} to {b}.', { a: fmtDate(gs[0].from), b: fmtDate(gs[0].to) })}
          {gs.length > 1 && ` ${t('{n} gaps in total.', { n: gs.length })}`}
        </p>
      )}
      {table ? (
        <div className="table-wrap">
          <table className="consent-table">
            <caption className="sr-only">{s.label}</caption>
            <thead>
              <tr>
                <th scope="col">{t('When')}</th>
                <th scope="col">{t('Value')}</th>
                <th scope="col">{t('Recorded by')}</th>
                <th scope="col">{t('Source')}</th>
              </tr>
            </thead>
            <tbody>
              {s.points.map((p) => (
                <tr key={p.id}>
                  <td>{dateTime(p.observedAt)}</td>
                  <td dir="ltr">
                    {num(p.value ?? 0)} {unitTxt(s.unit)}
                  </td>
                  <td>{tc(view.users.find((u) => u.id === p.authorId)?.name ?? '')}</td>
                  <td>{t(SOURCE_LABEL[p.source])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <LineChart s={s} from={from} to={to} />
      )}
      <div className="legend small" aria-label={t('How values were recorded')}>
        {sources.map((src) => (
          <span key={src} className="legend-item">
            <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true" className="progress-svg" style={{ color: C1, overflow: 'visible' }}>
              <Marker source={src} x={0} y={0} />
            </svg>
            {t(SOURCE_LABEL[src])}
          </span>
        ))}
      </div>
      <p className="small muted">
        {def && <>{t(def.measure?.label ?? def.label)} — {t(def.hint)} </>}
        {s.domain === 'medical' ? t('These are recorded readings. What they mean for this person is for their doctor to judge.') : t('Recorded values, not an assessment. A change over time does not show what caused it.')}
      </p>
    </figure>
  );
}

/** Tasks due each week and how many of those were completed — care-plan follow-through, not a score of the person. */
function TaskWeeks({ recipientId, from, to }: { recipientId: string; from: number; to: number }) {
  const { view } = useSession();
  const [table, setTable] = useState(false);
  const weeks = useMemo(() => {
    const out: { start: number; due: number; done: number }[] = [];
    const span = Math.min(12, Math.ceil((to - from) / (7 * DAY)));
    for (let i = span - 1; i >= 0; i--) {
      const start = to - (i + 1) * 7 * DAY;
      const end = start + 7 * DAY;
      const due = view.tasks.filter((x) => x.recipientId === recipientId && x.kind !== 'handover' && x.status !== 'draft' && x.status !== 'cancelled' && x.dueAt && x.dueAt >= start && x.dueAt < end);
      out.push({ start, due: due.length, done: due.filter((x) => x.status === 'completed').length });
    }
    return out;
  }, [view.tasks, recipientId, from, to]);
  const totalDue = weeks.reduce((n, w) => n + w.due, 0);
  if (!totalDue) return null;
  const totalDone = weeks.reduce((n, w) => n + w.done, 0);
  const max = Math.max(1, ...weeks.map((w) => w.due));
  const W = 640;
  const H = 180;
  const pad = { l: 30, r: 10, t: 12, b: 26 };
  const slot = (W - pad.l - pad.r) / weeks.length;
  const bw = Math.min(16, slot / 3);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const open = view.tasks.filter((x) => x.recipientId === recipientId && isOpenTask(x) && x.dueAt && x.dueAt < Date.now()).length;
  return (
    <figure className="panel progress-card">
      <figcaption className="panel-head">
        <h3>{t('Care-plan tasks: due and completed per week')}</h3>
        <button type="button" className="link small" aria-pressed={table} onClick={() => setTable(!table)}>
          {t(table ? 'Show chart' : 'Show table')}
        </button>
      </figcaption>
      <p className="small">
        {t('{done} of {due} tasks that were due in this period are completed.', { done: totalDone, due: totalDue })} {open > 0 && t('{n} are past their due time and still open.', { n: open })}
      </p>
      {table ? (
        <table className="consent-table">
          <thead>
            <tr>
              <th scope="col">{t('Week starting')}</th>
              <th scope="col">{t('Due')}</th>
              <th scope="col">{t('Completed')}</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.start}>
                <td>{fmtDate(w.start)}</td>
                <td>{w.due}</td>
                <td>{w.done}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-box">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Tasks due and completed per week')} className="progress-svg">
            {[0, max].map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
                <text x={pad.l - 6} y={y(v) + 4} className="axis" textAnchor="end">
                  {v}
                </text>
              </g>
            ))}
            {weeks.map((w, i) => {
              const cx = pad.l + slot * i + slot / 2;
              return (
                <g key={w.start}>
                  <title>{`${fmtDate(w.start)}: ${t('Due')} ${w.due}, ${t('Completed')} ${w.done}`}</title>
                  <rect x={cx - bw - 1} y={y(w.due)} width={bw} height={Math.max(0, y(0) - y(w.due))} rx={3} fill={C1} />
                  <rect x={cx + 1} y={y(w.done)} width={bw} height={Math.max(0, y(0) - y(w.done))} rx={3} fill={C2} />
                  {i % Math.ceil(weeks.length / 6) === 0 && (
                    <text x={cx} y={H - 6} className="axis" textAnchor="middle">
                      {fmtDate(w.start)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
      <div className="legend small">
        <span className="legend-item">
          <i style={{ background: C1 }} /> {t('Due')}
        </span>
        <span className="legend-item">
          <i style={{ background: C2 }} /> {t('Completed')}
        </span>
      </div>
    </figure>
  );
}

export function ProgressPanel({ recipientId }: { recipientId: string }) {
  const { view, act, now } = useSession();
  const [days, setDays] = useState<number>(90);
  const from = days ? now - days * DAY : Math.min(now - 7 * DAY, ...view.records.filter((r) => r.recipientId === recipientId).map((r) => r.observedAt));
  const series = useMemo<Series[]>(
    () => measureSeries(view.records, recipientId, from, now).map((m) => ({ key: m.key, label: m.kind === 'measurement' ? tc(m.title) : t(m.title), unit: m.unit, kind: m.kind, domain: m.domain, points: m.points })),
    [view.records, recipientId, from, now],
  );
  const milestones = view.records
    .filter((r) => r.recipientId === recipientId && !r.archived && ['milestone', 'achievement', 'assessment'].includes(r.kind) && r.observedAt >= from)
    .sort((a, b) => b.observedAt - a.observedAt);
  const exportCsv = async () => {
    const rows = [['series', 'unit', 'when', 'value', 'source', 'recorded_by']];
    for (const s of series) for (const p of s.points) rows.push([s.label, s.unit, new Date(p.observedAt).toISOString(), String(p.value), p.source, view.users.find((u) => u.id === p.authorId)?.name ?? '']);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `progress-${recipientId}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    await act({ type: 'note_export', recipientId, what: 'progress' }, { quiet: true });
  };
  return (
    <>
      <section className="panel" aria-labelledby="prog-h">
        <header className="panel-head">
          <h2 id="prog-h">{t('Progress')}</h2>
          <div className="row gap-s wrap">
            <div className="seg" role="group" aria-label={t('Time range')}>
              {[30, 90, 365, 0].map((d) => (
                <button key={d} type="button" className={days === d ? 'on' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>
                  {d ? t('{n} days', { n: d }) : t('All time')}
                </button>
              ))}
            </div>
            {series.length > 0 && (
              <AskButton label={t('Explain these changes')} question={t('Explain the recorded changes for {name}, last {n} days', { name: tc(view.recipients.find((x) => x.id === recipientId)?.name ?? ''), n: days || 365 })} intent="progress" recipientId={recipientId} />
            )}
            {series.length > 0 && (
              <button type="button" className="btn btn-light btn-sm" onClick={exportCsv}>
                <Icon name="download" size={14} /> {t('Download CSV')}
              </button>
            )}
          </div>
        </header>
        <p className="muted small">{t('Each chart shows one measure, as recorded, with who recorded it. Measures are never combined into one score, and only sections you can see are included.')}</p>
      </section>
      {series.length ? (
        <div className="progress-grid">
          {series.map((s) => (
            <SeriesCard key={s.key} s={s} from={from} to={now} />
          ))}
        </div>
      ) : (
        <Empty icon="chart" title="No recorded values in this period" text="Measurements, check-ins, pain scores, attendance and activity minutes appear here once they are recorded." />
      )}
      <TaskWeeks recipientId={recipientId} from={from} to={now} />
      {milestones.length > 0 && (
        <section className="panel" aria-labelledby="ms-h">
          <header className="panel-head">
            <h3 id="ms-h">{t('Milestones and achievements')}</h3>
          </header>
          <ol className="audit">
            {milestones.map((m) => (
              <li key={m.id}>
                <span>
                  <strong>{tc(m.title)}</strong> · {t(kindOf(m.kind)?.label ?? m.kind)}
                </span>
                <small className="muted">
                  {fmtDate(m.observedAt)} · {tc(view.users.find((u) => u.id === m.authorId)?.name ?? '')}
                </small>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

