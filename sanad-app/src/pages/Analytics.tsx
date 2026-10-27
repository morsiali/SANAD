import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { STAGES, STAGE_LABEL, isHousehold } from '../../shared/types';
import { metrics } from '../../shared/analytics';
import { isActive } from '../../shared/routing';
import { LIVING_LABEL, SUPPORT_LABEL, SUPPORT_LEVELS, inCareGroup } from '../../shared/care';
import { useSession } from '../lib/store';
import { isAr, t } from '../lib/i18n';
import { DailyChart, HBars } from '../components/charts';

export function Analytics() {
  const { view, me, now } = useSession();
  const [days, setDays] = useState(14);
  const scoped = useMemo(
    () => (me.role === 'coordinator' ? view.challenges : isHousehold(me.role) ? view.challenges.filter((c) => me.recipients.includes(c.recipientId)) : view.challenges.filter((c) => c.assigneeId === me.id || c.reporterId === me.id || c.role === me.role)),
    [view, me],
  );
  const m = useMemo(() => metrics(scoped, now, days), [scoped, now, days]);
  const byCare = useMemo(() => {
    const groups = [...SUPPORT_LEVELS.map((s) => ({ key: `support:${s}`, label: SUPPORT_LABEL[s] })), { key: 'living:alone', label: LIVING_LABEL.alone }];
    const people = view.recipients.filter((r) => scoped.some((c) => c.recipientId === r.id) || me.role === 'coordinator' || me.recipients.includes(r.id));
    return groups.map((g) => {
      const inGroup = scoped.filter((c) => inCareGroup(view.recipients.find((r) => r.id === c.recipientId), g.key));
      return { ...g, count: inGroup.length, open: inGroup.filter((c) => isActive(c)).length, people: people.filter((r) => inCareGroup(r, g.key)).length };
    });
  }, [scoped, view.recipients, me]);
  const scopeLabel = me.role === 'coordinator' ? 'the whole care network' : isHousehold(me.role) ? 'your family' : 'you and your team';

  const kpis = [
    { label: 'Solved within response time', value: m.slaCompliance === null ? '—' : `${m.slaCompliance}%` },
    { label: 'Median time to solve', value: m.medianHours === null ? '—' : t('{n} h', { n: m.medianHours }) },
    { label: 'Average family rating', value: m.avgRating === null ? '—' : `${m.avgRating} / 5` },
    { label: 'Routed automatically', value: m.autoRouted === null ? '—' : `${m.autoRouted}%` },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">Insights</h1>
          <p className="muted">{t('How quickly problems are being solved for {scope}.', { scope: t(scopeLabel) })}</p>
        </div>
        <div className="seg" role="group" aria-label="Time range">
          {[7, 14, 30].map((d) => (
            <button key={d} type="button" className={days === d ? 'on' : ''} onClick={() => setDays(d)} aria-pressed={days === d}>
              {t('{n} days', { n: d })}
            </button>
          ))}
        </div>
      </header>

      <section className="tiles">
        {kpis.map((k) => (
          <div key={k.label} className="tile tile-static">
            <span className="tile-value">{k.value}</span>
            <span className="tile-label">{k.label}</span>
          </div>
        ))}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>{t('Reported vs solved, last {n} days', { n: days })}</h2>
        </header>
        <DailyChart data={m.daily} />
      </section>

      <div className="cols cols-even">
        <section className="panel">
          <header className="panel-head">
            <h2>Median hours to solve, by team</h2>
          </header>
          <HBars label="Median hours to solve by team" unit={isAr() ? ' س' : ' h'} rows={m.byRole.map((r) => ({ key: r.key, label: t(r.label), value: r.medianHours, note: t('{solved} solved · {open} open', { solved: r.resolved, open: r.open }) }))} />
        </section>
        <section className="panel">
          <header className="panel-head">
            <h2>What problems come up</h2>
          </header>
          <HBars label="Challenges by category" rows={m.byCategory.map((c) => ({ key: c.key, label: t(c.label), value: c.count }))} />
        </section>
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>Challenges by care group</h2>
          <Link to="/app/team?tab=people" className="link">
            See people by group
          </Link>
        </header>
        <HBars
          label="Challenges by care group"
          rows={byCare.map((g) => ({ key: g.key, label: t(g.label), value: g.count, note: t('{people} people · {open} open', { people: g.people, open: g.open }) }))}
        />
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Where work sits right now</h2>
          <Link to="/app/challenges" className="link">
            Open the board
          </Link>
        </header>
        <div className="funnel">
          {STAGES.map((s) => (
            <Link key={s} to={`/app/challenges?stage=${s}&scope=all`} className="funnel-cell">
              <b>{m.byStage[s]}</b>
              <small>{STAGE_LABEL[s]}</small>
            </Link>
          ))}
        </div>
        <p className="muted small">
          {t('{open} open · {overdue} overdue · {esc} escalated · {solved} solved in the last 7 days', { open: m.open, overdue: m.overdue, esc: m.escalated, solved: m.resolved7 })}
        </p>
      </section>
    </div>
  );
}
