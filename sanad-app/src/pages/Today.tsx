import { useState } from 'react';
import { Link } from 'react-router-dom';
import { isOrgStaff } from '../../shared/access';
import { isOpenTask, isOverdue } from '../../shared/plans';
import { DOSE_STATUS_LABEL, dayKey, doseSlots } from '../../shared/records';
import { useSession } from '../lib/store';
import { locale, t, tc, tm } from '../lib/i18n';
import { timeAgo } from '../lib/format';
import { myPeople } from '../lib/people';
import { Empty, Icon } from '../components/ui';
import { TaskModal, TaskRow } from '../components/tasks';
import { AppointmentCard, AppointmentModal } from '../components/appointments';
import { AlertsPanel, ProposalsPanel } from '../components/monitoring';

/** One place for what needs doing today, across everyone this person can see. */
export function Today() {
  const { view, me, now } = useSession();
  const people = myPeople(view);
  const [who, setWho] = useState(people[0]?.id ?? '');
  const [modal, setModal] = useState<null | 'task' | 'appt'>(null);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const eod = endOfDay.getTime();
  const startOfDay = eod - 86_400_000 + 1;
  const visible = new Set(people.map((p) => p.id));

  const myTasks = view.tasks.filter((x) => x.ownerId === me.id && isOpenTask(x) && x.status !== 'draft' && (!x.dueAt || x.dueAt <= eod)).sort((a, b) => (a.dueAt ?? eod) - (b.dueAt ?? eod));
  const appts = view.appointments.filter((a) => a.status === 'scheduled' && a.startAt >= startOfDay && a.startAt <= eod + 86_400_000).sort((a, b) => a.startAt - b.startAt);
  const toConfirm = view.appointments.filter((a) => a.status === 'scheduled' && a.endAt < now && visible.has(a.recipientId));
  const overdue = view.tasks.filter((x) => visible.has(x.recipientId) && isOverdue(x, now) && x.ownerId !== me.id && x.kind !== 'handover');
  const approvals = view.approvals.filter((a) => a.status === 'pending' && a.approverIds.includes(me.id) && a.expiresAt >= now);
  const myRequests = view.tasks.filter((x) => x.status === 'awaiting_approval' && x.createdBy === me.id);
  const invites = view.invites.filter((i) => i.status === 'pending' && i.email === me.email.toLowerCase() && i.expiresAt > now);
  const cover = view.tasks.filter((x) => x.kind === 'coverage' && !x.ownerId && isOpenTask(x) && x.createdBy !== me.id && (x.coverTo ?? 0) > now);
  const today = dayKey(now);
  const doses = people.flatMap((r) =>
    (view.access[r.id]?.includes('medical') ? view.medications.filter((m) => m.recipientId === r.id && m.active && m.reminders) : []).flatMap((m) => doseSlots(m, view.doseLogs, today).map((s) => ({ r, m, ...s }))),
  );
  const updates = view.audit.filter((e) => e.at > now - 86_400_000 && e.actorId !== me.id && e.recipientId).sort((a, b) => b.at - a.at).slice(0, 8);
  const canWork = me.role !== 'admin' && people.length > 0;

  return (
    <div className="page today">
      <header className="page-head">
        <div>
          <h1 className="display-s">{t('Today')}</h1>
          <p className="muted">{new Date(now).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </header>

      {canWork && (
        <section className="panel quick" aria-labelledby="quick-h">
          <h2 id="quick-h" className="sr-only">
            {t('Quick actions')}
          </h2>
          <div className="row gap-s wrap">
            {people.length > 1 && (
              <label className="row gap-s">
                <span className="small">{t('For')}</span>
                <select id="today-who" value={who} onChange={(e) => setWho(e.target.value)}>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {tc(p.name)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="btn btn-dark btn-sm" onClick={() => setModal('task')}>
              <Icon name="plus" size={14} /> {t('New task')}
            </button>
            <button type="button" className="btn btn-light btn-sm" onClick={() => setModal('appt')}>
              <Icon name="calendar" size={14} /> {t('New appointment')}
            </button>
            <Link to={`/app/report?person=${who}`} className="btn btn-light btn-sm">
              {t('Report a problem')}
            </Link>
            <Link to={`/app/people/${who}`} className="btn btn-ghost btn-sm">
              {t('Open profile')}
            </Link>
          </div>
        </section>
      )}

      <div className="cols cols-even">
        <div className="col-main">
          <section className="panel" aria-labelledby="t-tasks">
            <header className="panel-head">
              <h2 id="t-tasks">{t('My tasks')}</h2>
              <small className="muted">{myTasks.length}</small>
            </header>
            {myTasks.length ? (
              <ul className="tasks">
                {myTasks.map((x) => (
                  <TaskRow key={x.id} task={x} showPerson={people.length > 1} />
                ))}
              </ul>
            ) : (
              <Empty icon="check" title="Nothing due for you today" />
            )}
          </section>

          <section className="panel" aria-labelledby="t-appts">
            <header className="panel-head">
              <h2 id="t-appts">{t('Appointments today and tomorrow')}</h2>
              <Link to="/app/calendar" className="link small">
                {t('Calendar')}
              </Link>
            </header>
            {appts.length ? (
              <ul className="appts">
                {appts.map((a) => (
                  <AppointmentCard key={a.id} a={a} showPerson={people.length > 1} />
                ))}
              </ul>
            ) : (
              <Empty icon="calendar" title="No appointments today or tomorrow" />
            )}
          </section>

          {doses.length > 0 && (
            <section className="panel" aria-labelledby="t-doses">
              <header className="panel-head">
                <h2 id="t-doses">{t('Care activities: medicines today')}</h2>
              </header>
              <p className="muted small">{t('Not logged means nobody has recorded it yet — not that it was taken.')}</p>
              <ul className="dose-today-list">
                {doses.map((d) => (
                  <li key={`${d.m.id}-${d.slot}`}>
                    <span className="dose-time">{d.slot.slice(11)}</span>
                    <span>
                      {tc(d.m.name)} · {tc(d.r.name)}
                    </span>
                    <span className={`dose-status dose-${d.log?.status ?? 'none'}`}>{d.log ? t(DOSE_STATUS_LABEL[d.log.status]) : t('Not logged')}</span>
                    <Link to={`/app/people/${d.r.id}?tab=medical`} className="link small">
                      {t('Log')}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="col-side">
          {me.role !== 'admin' && <AlertsPanel />}
          {me.role !== 'admin' && <ProposalsPanel />}
          <section className="panel" aria-labelledby="t-approve">
            <header className="panel-head">
              <h2 id="t-approve">{t('Waiting for approval')}</h2>
            </header>
            {approvals.length + myRequests.length + invites.length ? (
              <ul className="today-list">
                {approvals.map((a) => (
                  <li key={a.id}>
                    <Link to="/app/approvals" className="link">
                      {tm(a.summary)}
                    </Link>
                    <small className="muted block">{t('Needs your decision')}</small>
                  </li>
                ))}
                {invites.map((i) => (
                  <li key={i.id}>
                    <Link to="/app/approvals" className="link">
                      {t('Invitation to join a care team')}
                    </Link>
                  </li>
                ))}
                {myRequests.map((x) => (
                  <li key={x.id}>
                    {tc(x.title)}
                    <small className="muted block">{t('You asked for approval')}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{t('Nothing is waiting for approval.')}</p>
            )}
          </section>

          <section className="panel" aria-labelledby="t-overdue">
            <header className="panel-head">
              <h2 id="t-overdue">{t('Overdue and needs an update')}</h2>
            </header>
            {overdue.length + toConfirm.length ? (
              <>
                <ul className="tasks">
                  {overdue.map((x) => (
                    <TaskRow key={x.id} task={x} showPerson />
                  ))}
                </ul>
                {toConfirm.length > 0 && (
                  <ul className="appts">
                    {toConfirm.map((a) => (
                      <AppointmentCard key={a.id} a={a} showPerson />
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="muted small">{t('Nothing overdue.')}</p>
            )}
          </section>

          {cover.length > 0 && !isOrgStaff(me) && (
            <section className="panel" aria-labelledby="t-cover">
              <header className="panel-head">
                <h2 id="t-cover">{t('Cover needed')}</h2>
              </header>
              <ul className="tasks">
                {cover.map((x) => (
                  <TaskRow key={x.id} task={x} showPerson />
                ))}
              </ul>
            </section>
          )}

          <section className="panel" aria-labelledby="t-updates">
            <header className="panel-head">
              <h2 id="t-updates">{t('Recent updates')}</h2>
            </header>
            {updates.length ? (
              <ol className="audit">
                {updates.map((e) => (
                  <li key={e.id}>
                    <span>{tm(e.m)}</span>
                    <small className="muted">
                      {tc(view.recipients.find((r) => r.id === e.recipientId)?.name ?? '')} · {timeAgo(e.at, now)}
                    </small>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted small">{t('No updates in the last 24 hours.')}</p>
            )}
          </section>
        </div>
      </div>
      {modal === 'task' && who && <TaskModal recipientId={who} onClose={() => setModal(null)} />}
      {modal === 'appt' && who && <AppointmentModal recipientId={who} onClose={() => setModal(null)} />}
    </div>
  );
}
