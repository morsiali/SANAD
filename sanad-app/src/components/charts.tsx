import { useState } from 'react';
import { locale, t } from '../lib/i18n';

const C1 = '#476ADB';
const C2 = '#1F9E8F';

export function DailyChart({ data: raw }: { data: { day: string; label: string; opened: number; resolved: number }[] }) {
  const data = raw.map((d) => ({ ...d, label: new Date(`${d.day}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) }));
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(2, ...data.map((d) => Math.max(d.opened, d.resolved)));
  const ticks = [0, Math.ceil(max / 2), max];
  const W = 640;
  const H = 200;
  const pad = { l: 28, r: 8, t: 10, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / data.length;
  const bw = Math.max(4, Math.min(14, slot / 2 - 3));
  const y = (v: number) => pad.t + ih - (v / max) * ih;

  return (
    <figure className="chart">
      <div className="chart-head">
        <div className="legend">
          <span><i style={{ background: C1 }} /> Reported</span>
          <span><i style={{ background: C2 }} /> Solved</span>
        </div>
        <button type="button" className="link small" onClick={() => setTable((t) => !t)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <table className="data-table">
          <thead>
            <tr><th>Day</th><th>Reported</th><th>Solved</th></tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}><td>{d.label}</td><td>{d.opened}</td><td>{d.resolved}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-box">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Challenges reported and solved per day')}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
                <text x={pad.l - 6} y={y(t) + 4} className="axis" textAnchor="end">{t}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = pad.l + slot * i + slot / 2;
              return (
                <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill={hover === i ? 'rgba(71,106,219,.06)' : 'transparent'} />
                  {d.opened > 0 && <rect x={cx - bw - 1} y={y(d.opened)} width={bw} height={ih + pad.t - y(d.opened)} rx={3} fill={C1} />}
                  {d.resolved > 0 && <rect x={cx + 1} y={y(d.resolved)} width={bw} height={ih + pad.t - y(d.resolved)} rx={3} fill={C2} />}
                  {(i % 2 === data.length % 2 || data.length < 10) && (
                    <text x={cx} y={H - 8} className="axis" textAnchor="middle">{d.label}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="tip" style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%` }}>
              <strong>{data[hover].label}</strong>
              <span><i style={{ background: C1 }} />{t('Reported')} {data[hover].opened}</span>
              <span><i style={{ background: C2 }} />{t('Solved')} {data[hover].resolved}</span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

export function HBars({ rows, unit = '', label }: { rows: { key: string; label: string; value: number | null; note?: string }[]; unit?: string; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="hbars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${r.value ?? '—'}${unit}${r.note ? ` · ${r.note}` : ''}`}>
          <span className="hb-label">{r.label}</span>
          <span className="hb-track">
            <span style={{ width: `${((r.value ?? 0) / max) * 100}%` }} />
          </span>
          <span className="hb-val">
            {r.value === null ? '—' : `${r.value}${unit}`}
            {r.note && <small>{r.note}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}
