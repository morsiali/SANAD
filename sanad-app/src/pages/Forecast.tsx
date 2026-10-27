import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { forecast, type ForecastItem } from '../../shared/forecast';
import { useSession } from '../lib/store';
import { locale, t, tc, tm } from '../lib/i18n';
import { myPeople } from '../lib/people';
import { Empty, Icon } from '../components/ui';

const ICON: Record<ForecastItem['kind'], string> = { refill: 'pill', cover: 'users', busy: 'clock', unowned: 'flag', approval: 'shield', prep: 'calendar', standing: 'key' };

/** What is coming up, from simple visible rules. Schedules and supplies only — never anyone's health. */
export function ForecastPage() {
  const { view, now } = useSession();
  const [days, setDays] = useState(14);
  const [who, setWho] = useState('');
  const [why, setWhy] = useState<string | null>(null);
  const people = myPeople(view);
  const items = useMemo(() => forecast(view, now, days).filter((x) => !who || x.recipientId === who), [view, now, days, who]);
  const groups = new Map<string, ForecastItem[]>();
  for (const x of items) {
    const k = new Date(x.at).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">{t('Coming up')}</h1>
          <p className="muted">{t('Refills, cover, busy days, unfinished preparation and decisions due — worked out from schedules and recorded supplies. This is not a prediction about anyone’s health.')}</p>
        </div>
      </header>
      <div className="row gap-s wrap filters">
        <div className="seg" role="group" aria-label={t('Time range')}>
          {[7, 14, 30].map((d) => (
            <button key={d} type="button" className={days === d ? 'on' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>
              {t('{n} days', { n: d })}
            </button>
          ))}
        </div>
        {people.length > 1 && (
          <select aria-label={t('Person')} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">{t('Everyone I can see')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {tc(p.name)}
              </option>
            ))}
          </select>
        )}
      </div>
      {items.length ? (
        [...groups.entries()].map(([day, list]) => (
          <section key={day} className="panel">
            <h2 className="sub-h">{day}</h2>
            <ul className="mon-list">
              {list.map((x) => (
                <li key={x.key} className={`mon ${x.tone === 'warn' ? 'mon-warn' : ''}`}>
                  <span className="mon-ico" aria-hidden="true">
                    <Icon name={ICON[x.kind]} size={16} />
                  </span>
                  <div className="mon-main">
                    <Link to={x.link}>{tm(x.m)}</Link>
                    <button type="button" className="link small" aria-expanded={why === x.key} onClick={() => setWhy(why === x.key ? null : x.key)}>
                      {t('How is this worked out?')}
                    </button>
                    {why === x.key && <p className="small muted assist-why">{tm(x.rule)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <Empty icon="check" title="Nothing coming up" text="No refills, cover gaps, busy days or decisions are due in this period for the people you can see." />
      )}
    </div>
  );
}
