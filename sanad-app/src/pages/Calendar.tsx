import { Fragment, useState } from 'react';
import { conflictsFor, isOpenTask } from '../../shared/plans';
import { useSession } from '../lib/store';
import { locale, t, tc } from '../lib/i18n';
import { myPeople } from '../lib/people';
import { Empty, Icon } from '../components/ui';
import { AppointmentCard } from '../components/appointments';
import { TaskRow } from '../components/tasks';

const DAY = 86_400_000;

/** Two-week agenda of appointments, due tasks and cover, for everyone this person can see. */
export function Calendar() {
  const { view, now } = useSession();
  const people = myPeople(view);
  const [offset, setOffset] = useState(0);
  const [who, setWho] = useState('');
  const [showTasks, setShowTasks] = useState(true);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() + offset * 14);
  const from = start.getTime();
  const to = from + 14 * DAY;
  const inView = (rid: string) => (!who || rid === who) && people.some((p) => p.id === rid);
  const appts = view.appointments.filter((a) => inView(a.recipientId) && a.startAt >= from && a.startAt < to && a.status !== 'cancelled');
  const tasks = showTasks ? view.tasks.filter((x) => inView(x.recipientId) && x.kind !== 'prep' && x.kind !== 'handover' && isOpenTask(x) && x.status !== 'draft' && x.dueAt && x.dueAt >= from && x.dueAt < to) : [];
  const days = Array.from({ length: 14 }, (_, i) => from + i * DAY);
  // Clashes: someone attending this appointment already has another commitment at the same time.
  const clashes = (a: (typeof appts)[number]) =>
    a.attendeeIds
      .map((id) => ({ id, c: conflictsFor(view, id, a.startAt, a.endAt, [a.id]) }))
      .filter((x) => x.c.length)
      .map((x) => tc(view.users.find((u) => u.id === x.id)?.name ?? ''));
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">{t('Calendar')}</h1>
          <p className="muted">{t('Appointments, due tasks and cover for the people you can see. Only sections you have access to are shown.')}</p>
        </div>
      </header>
      <div className="row gap-s wrap cal-tools">
        <button type="button" className="btn btn-light btn-sm" onClick={() => setOffset(offset - 1)} aria-label={t('Previous two weeks')}>
          <Icon name="back" size={14} />
        </button>
        <strong>
          {new Date(from).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} – {new Date(to - DAY).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })}
        </strong>
        <button type="button" className="btn btn-light btn-sm" onClick={() => setOffset(offset + 1)} aria-label={t('Next two weeks')}>
          <Icon name="arrow" size={14} />
        </button>
        {offset !== 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOffset(0)}>
            {t('This week')}
          </button>
        )}
        {people.length > 1 && (
          <select aria-label={t('Person')} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">{t('Everyone')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {tc(p.name)}
              </option>
            ))}
          </select>
        )}
        <label className="check">
          <input type="checkbox" checked={showTasks} onChange={(e) => setShowTasks(e.target.checked)} /> {t('Show due tasks')}
        </label>
      </div>
      {appts.length + tasks.length === 0 ? (
        <Empty icon="calendar" title="Nothing in these two weeks" />
      ) : (
        <ol className="cal-days">
          {days.map((d) => {
            const dayAppts = appts.filter((a) => a.startAt >= d && a.startAt < d + DAY).sort((a, b) => a.startAt - b.startAt);
            const dayTasks = tasks.filter((x) => x.dueAt! >= d && x.dueAt! < d + DAY).sort((a, b) => a.dueAt! - b.dueAt!);
            if (!dayAppts.length && !dayTasks.length) return null;
            const isToday = now >= d && now < d + DAY;
            return (
              <li key={d} className={`cal-day ${isToday ? 'cal-today' : ''}`}>
                <h2 className="cal-date">
                  {new Date(d).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })} {isToday && <span className="chip chip-static">{t('Today')}</span>}
                </h2>
                {dayAppts.length > 0 && (
                  <ul className="appts">
                    {dayAppts.map((a) => {
                      const c = clashes(a);
                      return (
                        <Fragment key={a.id}>
                          {c.length > 0 && (
                            <li className="alert alert-warn small">
                              <Icon name="flag" size={13} /> {t('Clash: {names} also has another commitment at this time', { names: c.join(', ') })}
                            </li>
                          )}
                          <AppointmentCard a={a} showPerson={people.length > 1} />
                        </Fragment>
                      );
                    })}
                  </ul>
                )}
                {dayTasks.length > 0 && (
                  <ul className="tasks">
                    {dayTasks.map((x) => (
                      <TaskRow key={x.id} task={x} showPerson={people.length > 1} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
