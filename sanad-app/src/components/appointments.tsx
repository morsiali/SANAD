import { AskButton } from './assistant';
import { useState } from 'react';
import type { Appointment, AppointmentInput, AppointmentKind, Domain } from '../../shared/types';
import { DOMAIN_LABEL, hasAuthority } from '../../shared/access';
import { APPOINTMENT_DOMAIN, APPOINTMENT_KIND_LABEL, PREP_TEMPLATES, isOpenTask } from '../../shared/plans';
import { useSession } from '../lib/store';
import { locale, t, tc, tm } from '../lib/i18n';
import { dateTime } from '../lib/format';
import { Avatar, Empty, Field, Icon, Modal } from './ui';
import { TaskRow, domainOptions, fromLocal, teamFor, toLocal } from './tasks';

const STATUS_TXT: Record<Appointment['status'], string> = { scheduled: 'Scheduled', completed: 'Attended', cancelled: 'Cancelled', missed: 'Missed' };

export const timeRange = (a: Pick<Appointment, 'startAt' | 'endAt'>) =>
  `${dateTime(a.startAt)} – ${new Date(a.endAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`;

/** A standard calendar file the person can add to their own calendar app. Nothing is sent anywhere. */
function downloadIcs(a: Appointment, personName: string) {
  const stamp = (at: number) => new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SANAD//Care calendar//EN',
    'BEGIN:VEVENT',
    `UID:${a.id}@sanad`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(a.startAt)}`,
    `DTEND:${stamp(a.endAt)}`,
    `SUMMARY:${esc(`${a.title} — ${personName}`)}`,
    `LOCATION:${esc(a.location)}`,
    `DESCRIPTION:${esc(a.withWhom)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${a.title.replace(/[^\w\- ]+/g, '').trim() || 'appointment'}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function AppointmentCard({ a, showPerson = false }: { a: Appointment; showPerson?: boolean }) {
  const { view, me, act, now } = useSession();
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState<null | 'completed' | 'missed' | 'cancelled'>(null);
  const [outcome, setOutcome] = useState('');
  const person = view.recipients.find((r) => r.id === a.recipientId);
  const prep = view.tasks.filter((x) => x.appointmentId === a.id);
  const manage = a.createdBy === me.id || a.attendeeIds.includes(me.id) || !!hasAuthority(view, me.id, a.recipientId, now) || (me.role === 'coordinator' && person?.orgId === me.orgId);
  const past = a.startAt <= now;
  return (
    <li className={`appt appt-${a.status}`}>
      <div className="appt-when" aria-hidden="true">
        <strong>{new Date(a.startAt).toLocaleDateString(locale(), { day: 'numeric' })}</strong>
        <small>{new Date(a.startAt).toLocaleDateString(locale(), { month: 'short' })}</small>
      </div>
      <div className="appt-body">
        <div className="appt-head">
          <strong>{tc(a.title)}</strong>
          <span className={`status-pill appt-s-${a.status}`}>{t(STATUS_TXT[a.status])}</span>
          <span className="chip chip-static">{t(APPOINTMENT_KIND_LABEL[a.kind])}</span>
          {showPerson && person && <span className="chip chip-static">{tc(person.name)}</span>}
        </div>
        <p className="small">
          <Icon name="clock" size={13} /> {timeRange(a)}
          {a.location && (
            <>
              {' · '}
              {tc(a.location)}
            </>
          )}
          {a.withWhom && <> · {tc(a.withWhom)}</>}
        </p>
        {a.attendeeIds.length > 0 && (
          <p className="small attendees">
            {a.attendeeIds.map((id) => {
              const u = view.users.find((x) => x.id === id);
              return (
                <span key={id} className="attendee">
                  <Avatar user={u} size={20} /> {tc(u?.name ?? '')}
                </span>
              );
            })}
          </p>
        )}
        {a.outcome && <p className="small muted">{t('Outcome: {text}', { text: tc(a.outcome) })}</p>}
        {prep.length > 0 && (
          <details className="prep" open={a.status === 'scheduled'}>
            <summary>{t('Preparation ({done} of {total} done)', { done: prep.filter((x) => x.status === 'completed').length, total: prep.length })}</summary>
            <ul className="tasks">
              {prep.map((x) => (
                <TaskRow key={x.id} task={x} />
              ))}
            </ul>
          </details>
        )}
        <div className="row gap-s wrap">
          {a.status === 'scheduled' && a.endAt >= now && (
            <AskButton className="btn btn-light btn-sm" label={t('Prepare a brief')} question={t('Prepare a brief for {title}', { title: tc(a.title) })} intent="appointment_brief" recipientId={a.recipientId} targetId={a.id} />
          )}
          {a.status === 'scheduled' && (
            <button type="button" className="btn btn-ghost btn-sm" title={t('Downloads a calendar file for your own calendar app')} onClick={() => downloadIcs(a, tc(person?.name ?? ''))}>
              <Icon name="calendar" size={14} /> {t('Add to my calendar')}
            </button>
          )}
          {manage && a.status === 'scheduled' && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                <Icon name="edit" size={14} /> {t('Change or reschedule')}
              </button>
              {past && (
                <>
                  <button type="button" className="btn btn-light btn-sm" onClick={() => setClosing('completed')}>
                    {t('Attended')}
                  </button>
                  <button type="button" className="btn btn-light btn-sm" onClick={() => setClosing('missed')}>
                    {t('Missed')}
                  </button>
                </>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClosing('cancelled')}>
                {t('Cancel appointment')}
              </button>
            </>
          )}
          {a.status === 'missed' && manage && (
            <button type="button" className="btn btn-dark btn-sm" onClick={() => setEditing(true)}>
              {t('Book a new time')}
            </button>
          )}
        </div>
        {closing && (
          <form
            className="row gap-s wrap"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await act({ type: 'appointment_status', appointmentId: a.id, status: closing, outcome });
              if (r.ok) setClosing(null);
            }}
          >
            <input className="grow" aria-label={t(closing === 'completed' ? 'Outcome (optional)' : 'Note (optional)')} placeholder={t(closing === 'completed' ? 'Outcome (optional)' : 'Note (optional)')} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            <button type="submit" className="btn btn-dark btn-sm">
              {t(closing === 'completed' ? 'Mark attended' : closing === 'missed' ? 'Mark missed' : 'Cancel appointment')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClosing(null)}>
              {t('Back')}
            </button>
          </form>
        )}
      </div>
      {editing && <AppointmentModal recipientId={a.recipientId} appt={a} rebook={a.status === 'missed'} onClose={() => setEditing(false)} />}
    </li>
  );
}

export function AppointmentModal({ recipientId, appt, rebook, onClose }: { recipientId: string; appt?: Appointment; rebook?: boolean; onClose: () => void }) {
  const { view, me, act, now } = useSession();
  const domains = domainOptions(view, recipientId);
  const team = teamFor(view, recipientId);
  const start0 = appt && !rebook ? appt.startAt : now + 2 * 86_400_000;
  const [f, setF] = useState({
    title: appt?.title ?? '',
    kind: (appt?.kind ?? 'medical') as AppointmentKind,
    domain: (appt?.domain ?? (domains.includes('medical') ? 'medical' : domains[0])) as Domain,
    start: toLocal(start0),
    minutes: appt ? String(Math.round((appt.endAt - appt.startAt) / 60_000)) : '45',
    location: appt?.location ?? '',
    withWhom: appt?.withWhom ?? '',
    attendeeIds: appt?.attendeeIds ?? [me.id].filter((id) => team.some((u) => u.id === id)),
    notes: appt?.notes ?? '',
  });
  const [prep, setPrep] = useState<string[]>(appt ? [] : PREP_TEMPLATES.medical);
  const [newStep, setNewStep] = useState('');
  const [conflict, setConflict] = useState('');
  const [busy, setBusy] = useState(false);
  const input = (): AppointmentInput => {
    const startAt = fromLocal(f.start) ?? 0;
    return { title: f.title, kind: f.kind, domain: f.domain, startAt, endAt: startAt + Number(f.minutes) * 60_000, location: f.location, withWhom: f.withWhom, attendeeIds: f.attendeeIds, notes: f.notes };
  };
  const save = async (allowConflict = false) => {
    setBusy(true);
    const r =
      appt && !rebook
        ? await act({ type: 'edit_appointment', appointmentId: appt.id, baseVersion: appt.version, appt: input(), allowConflict }, { ownConflict: true })
        : await act({ type: 'add_appointment', recipientId, appt: input(), prep, allowConflict }, { ownConflict: true });
    setBusy(false);
    if (r.ok) onClose();
    else if (r.m?.k === 'e_conflict') setConflict(tm(r.m));
  };
  const setKind = (kind: AppointmentKind) => {
    const d = APPOINTMENT_DOMAIN[kind];
    setF({ ...f, kind, domain: domains.includes(d) ? d : f.domain });
    if (!appt) setPrep(PREP_TEMPLATES[kind]);
  };
  return (
    <Modal
      wide
      title={rebook ? t('Book a new time') : appt ? t('Change appointment') : t('New appointment')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-dark" disabled={busy || f.title.trim().length < 3 || !f.start} onClick={() => save(false)}>
            {appt && !rebook ? t('Save changes') : t('Add appointment')}
          </button>
        </>
      }
    >
      {conflict && (
        <div className="notice small" role="alert">
          <Icon name="flag" size={16} />
          <span>
            {conflict}{' '}
            <button type="button" className="btn btn-dark btn-sm" onClick={() => save(true)}>
              {t('Keep both')}
            </button>
          </span>
        </div>
      )}
      <div className="grid-2">
        <Field label={t('What is it?')}>
          <input id="appt-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={t('Type')}>
          <select id="appt-kind" value={f.kind} onChange={(e) => setKind(e.target.value as AppointmentKind)}>
            {(Object.keys(APPOINTMENT_KIND_LABEL) as AppointmentKind[]).map((k) => (
              <option key={k} value={k}>
                {t(APPOINTMENT_KIND_LABEL[k])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Starts')}>
          <input id="appt-start" type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        </Field>
        <Field label={t('Length')}>
          <select id="appt-length" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })}>
            {[15, 30, 45, 60, 90, 120, 240].map((m) => (
              <option key={m} value={m}>
                {t('{n} min', { n: m })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Where')}>
          <input id="appt-where" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
        <Field label={t('With')}>
          <input id="appt-with" value={f.withWhom} onChange={(e) => setF({ ...f, withWhom: e.target.value })} />
        </Field>
      </div>
      <Field label={t('Section')} hint={t('Who can see this appointment depends on this.')}>
        <select id="appt-domain" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value as Domain })}>
          {domains.map((d) => (
            <option key={d} value={d}>
              {t(DOMAIN_LABEL[d])}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="checks">
        <legend>{t('Who is going')}</legend>
        {team.map((u) => (
          <label key={u.id} className="check">
            <input type="checkbox" checked={f.attendeeIds.includes(u.id)} onChange={(e) => setF({ ...f, attendeeIds: e.target.checked ? [...f.attendeeIds, u.id] : f.attendeeIds.filter((x) => x !== u.id) })} /> {tc(u.name)}
          </label>
        ))}
      </fieldset>
      {!appt || rebook ? (
        <fieldset className="checks prep-edit">
          <legend>{t('Preparation checklist')}</legend>
          {prep.map((p, i) => (
            <span key={i} className="prep-item">
              {t(p)}
              <button type="button" className="link small" aria-label={t('Remove {item}', { item: t(p) })} onClick={() => setPrep(prep.filter((_, j) => j !== i))}>
                {t('Remove')}
              </button>
            </span>
          ))}
          <span className="row gap-s">
            <input aria-label={t('Add a preparation step')} placeholder={t('Add a preparation step')} value={newStep} onChange={(e) => setNewStep(e.target.value)} />
            <button
              type="button"
              className="btn btn-light btn-sm"
              disabled={newStep.trim().length < 3}
              onClick={() => {
                setPrep([...prep, newStep.trim()]);
                setNewStep('');
              }}
            >
              {t('Add')}
            </button>
          </span>
        </fieldset>
      ) : null}
      <Field label={t('Notes')}>
        <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

export function AppointmentsPanel({ recipientId }: { recipientId: string }) {
  const { view, me, now } = useSession();
  const [adding, setAdding] = useState(false);
  const mine = view.appointments.filter((a) => a.recipientId === recipientId);
  const upcoming = mine.filter((a) => a.status === 'scheduled' && a.endAt >= now).sort((a, b) => a.startAt - b.startAt);
  const needsUpdate = mine.filter((a) => a.status === 'scheduled' && a.endAt < now);
  const past = mine.filter((a) => a.status !== 'scheduled').sort((a, b) => b.startAt - a.startAt);
  const canAdd = me.role !== 'admin' && domainOptions(view, recipientId).length > 0;
  const openPrep = view.tasks.filter((x) => x.recipientId === recipientId && x.kind === 'prep' && isOpenTask(x)).length;
  return (
    <section className="panel" aria-labelledby="appts-h">
      <header className="panel-head">
        <h2 id="appts-h">{t('Appointments')}</h2>
        {canAdd && (
          <button type="button" className="btn btn-dark btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> {t('New appointment')}
          </button>
        )}
      </header>
      <p className="muted small">{t('You only see appointments in sections you can see. {n} preparation steps still open.', { n: openPrep })}</p>
      {needsUpdate.length > 0 && (
        <>
          <h3 className="sub-h">{t('Did these happen?')}</h3>
          <ul className="appts">
            {needsUpdate.map((a) => (
              <AppointmentCard key={a.id} a={a} />
            ))}
          </ul>
        </>
      )}
      <h3 className="sub-h">{t('Upcoming')}</h3>
      {upcoming.length ? (
        <ul className="appts">
          {upcoming.map((a) => (
            <AppointmentCard key={a.id} a={a} />
          ))}
        </ul>
      ) : (
        <Empty icon="calendar" title="Nothing booked" text="Upcoming appointments you can see will appear here." />
      )}
      {past.length > 0 && (
        <details>
          <summary className="sub-h">{t('Past and cancelled ({n})', { n: past.length })}</summary>
          <ul className="appts">
            {past.map((a) => (
              <AppointmentCard key={a.id} a={a} />
            ))}
          </ul>
        </details>
      )}
      {adding && <AppointmentModal recipientId={recipientId} onClose={() => setAdding(false)} />}
    </section>
  );
}
