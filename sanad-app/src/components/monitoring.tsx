// Phase 4 on screen: what SANAD is watching (alerts), suggested timing changes (proposals), standing
// permissions, and notification settings. Everything shown comes from the user's filtered view.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CareTask, MonitorAlert, NotifyPrefs, Proposal, StandingKind, View } from '../../shared/types';
import { ROLE_LABEL } from '../../shared/types';
import { hasAuthority, isLive } from '../../shared/access';
import { DEFAULT_PREFS } from '../../shared/notify';
import { STANDING_KINDS, STANDING_MAX_DAYS } from '../../shared/monitor';
import { useSession } from '../lib/store';
import { t, tc, tm } from '../lib/i18n';
import { dateTime, timeAgo } from '../lib/format';
import { Empty, Field, Icon } from './ui';

const ALERT_ICON: Record<MonitorAlert['kind'], string> = { dose_unlogged: 'pill', refill_due: 'pill', cover_unfilled: 'users', appt_no_outcome: 'calendar', approval_expiring: 'shield' };

export const openAlerts = (view: View, recipientId?: string) => view.alerts.filter((a) => !a.resolvedAt && (!recipientId || a.recipientId === recipientId)).sort((a, b) => b.firstAt - a.firstAt);
export const openProposals = (view: View, recipientId?: string) => view.proposals.filter((p) => p.status === 'open' && (!recipientId || p.recipientId === recipientId));

export function AlertsPanel({ recipientId }: { recipientId?: string }) {
  const { view, now } = useSession();
  const [why, setWhy] = useState<string | null>(null);
  const alerts = openAlerts(view, recipientId);
  const recent = view.alerts.filter((a) => a.resolvedAt && a.resolvedAt > now - 24 * 3_600_000 && (!recipientId || a.recipientId === recipientId));
  return (
    <section className="panel" aria-labelledby="mon-h">
      <header className="panel-head">
        <h2 id="mon-h">{t('SANAD is keeping an eye on')}</h2>
      </header>
      <p className="muted small">{t('Simple rules, checked every few minutes. Each item notifies once and clears by itself when it is dealt with.')}</p>
      {alerts.length ? (
        <ul className="mon-list">
          {alerts.map((a) => (
            <li key={a.id} className={`mon mon-${a.kind}`}>
              <span className="mon-ico" aria-hidden="true">
                <Icon name={ALERT_ICON[a.kind]} size={16} />
              </span>
              <div className="mon-main">
                <Link to={a.link}>{tm(a.m)}</Link>
                {a.auto && (
                  <p className={`small ${a.auto.ok ? 'ok-text' : 'form-error'}`}>
                    <Icon name={a.auto.ok ? 'check' : 'flag'} size={12} /> {tm(a.auto.m)}
                  </p>
                )}
                <div className="row gap-s wrap small muted">
                  <span>{t('Since {ago}', { ago: timeAgo(a.firstAt, now) })}</span>
                  <button type="button" className="link small" aria-expanded={why === a.id} onClick={() => setWhy(why === a.id ? null : a.id)}>
                    {t('Why am I seeing this?')}
                  </button>
                </div>
                {why === a.id && <p className="small muted assist-why">{tm(a.why)}</p>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="check" title="Nothing needs attention" text="SANAD will let the right people know if something comes up." />
      )}
      {recent.length > 0 && <p className="small muted">{t('Cleared in the last 24 hours: {n}', { n: recent.length })}</p>}
    </section>
  );
}

function canDecide(view: View, me: View['users'][number], t: CareTask, now: number) {
  if (t.createdBy === me.id || t.ownerId === me.id || hasAuthority(view, me.id, t.recipientId, now)) return true;
  const r = view.recipients.find((x) => x.id === t.recipientId);
  return me.role === 'coordinator' && !!r && r.orgId === me.orgId;
}

export function ProposalsPanel({ recipientId }: { recipientId?: string }) {
  const { view, me, now, act } = useSession();
  const items = openProposals(view, recipientId);
  if (!items.length) return null;
  return (
    <section className="panel proposals" aria-labelledby="prop-h">
      <header className="panel-head">
        <h2 id="prop-h">{t('Suggested changes')}</h2>
      </header>
      <p className="muted small">{t('SANAD only ever suggests a new time for recurring work. It never changes what is done or how often, and nothing changes until someone who manages the task agrees.')}</p>
      <ul className="mon-list">
        {items.map((p: Proposal) => {
          const task = view.tasks.find((x) => x.id === p.taskId);
          if (!task) return null;
          const mine = canDecide(view, me, task, now);
          const creator = view.users.find((u) => u.id === task.createdBy);
          return (
            <li key={p.id} className="mon">
              <span className="mon-ico" aria-hidden="true">
                <Icon name="clock" size={16} />
              </span>
              <div className="mon-main">
                <strong>{t('Move “{title}” from {from} to {to}?', { title: tc(task.title), from: p.fromTime, to: p.toTime })}</strong>
                <p className="small muted">{tm(p.why)}</p>
                {mine ? (
                  <div className="row gap-s wrap">
                    <button type="button" className="btn btn-dark btn-sm" onClick={() => act({ type: 'decide_proposal', proposalId: p.id, decision: 'accept' })}>
                      {t('Move to {to}', { to: p.toTime })}
                    </button>
                    <button type="button" className="btn btn-light btn-sm" onClick={() => act({ type: 'decide_proposal', proposalId: p.id, decision: 'dismiss' })}>
                      {t('Keep the current time')}
                    </button>
                  </div>
                ) : (
                  <p className="small muted">{t('{name} or the person’s guardian can decide this.', { name: tc(creator?.name ?? '') })}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const NEVER = ['Change, start or stop a medicine or a dose', 'Diagnose, or change a treatment or therapy plan', 'Give anyone access to records', 'Send anything outside SANAD', 'Mark a dose as taken or missed'];

export function StandingPanel({ recipientId }: { recipientId: string }) {
  const { view, me, now, act } = useSession();
  const authority = !!hasAuthority(view, me.id, recipientId, now);
  const active = view.standing.filter((p) => p.recipientId === recipientId && !p.revokedAt && p.expiresAt > now);
  const ended = view.standing.filter((p) => p.recipientId === recipientId && (p.revokedAt || p.expiresAt <= now)).slice(-3);
  const medicalPeople = view.users.filter((u) => {
    const m = view.memberships.find((x) => x.userId === u.id && x.recipientId === recipientId && isLive(x, now));
    return !!m && m.domains.includes('medical') && u.role !== 'admin';
  });
  const [form, setForm] = useState<{ kind: StandingKind; ownerId: string; days: number } | null>(null);
  return (
    <section className="panel" aria-labelledby="standing-h">
      <header className="panel-head">
        <h2 id="standing-h">{t('Standing permissions')}</h2>
      </header>
      <p className="muted small">{t('The person, or their verified guardian, can let SANAD do a few small things on its own. SANAD then acts with their permissions, records every step, and tells them if it could not.')}</p>
      <ul className="mon-list">
        {STANDING_KINDS.map((kind) => {
          const p = active.find((x) => x.kind === kind);
          const giver = p && view.users.find((u) => u.id === p.grantedBy);
          return (
            <li key={kind} className="mon">
              <span className="mon-ico" aria-hidden="true">
                <Icon name={p ? 'check' : 'shield'} size={16} />
              </span>
              <div className="mon-main">
                <strong>{tm({ k: `sp_title_${kind}` })}</strong>
                <p className="small muted">{tm({ k: `sp_desc_${kind}` })}</p>
                {p ? (
                  <p className="small">
                    {t('On — given by {name}, until {when}. Times used: {n}.', { name: tc(giver?.name ?? ''), when: dateTime(p.expiresAt), n: p.uses })}
                    {p.ownerId && <> {t('Tasks go to {name}.', { name: tc(view.users.find((u) => u.id === p.ownerId)?.name ?? '') })}</>}
                  </p>
                ) : (
                  <p className="small muted">{t('Off')}</p>
                )}
                {authority && (
                  <div className="row gap-s wrap">
                    {p ? (
                      <button type="button" className="btn btn-light btn-sm" onClick={() => act({ type: 'revoke_standing', permissionId: p.id })}>
                        {t('Turn off')}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-dark btn-sm" onClick={() => setForm({ kind, ownerId: medicalPeople[0]?.id ?? me.id, days: 90 })}>
                        {t('Turn on…')}
                      </button>
                    )}
                  </div>
                )}
                {form?.kind === kind && (
                  <div className="standing-form">
                    {kind === 'refill_task' && (
                      <Field label={t('Who gets the refill tasks')}>
                        <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
                          {medicalPeople.map((u) => (
                            <option key={u.id} value={u.id}>
                              {tc(u.name)} · {t(ROLE_LABEL[u.role])}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    <Field label={t('For how many days')} hint={t('Between 1 and {max} days. You can turn it off at any time.', { max: STANDING_MAX_DAYS })}>
                      <input type="number" min={1} max={STANDING_MAX_DAYS} value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} />
                    </Field>
                    <div className="row gap-s">
                      <button
                        type="button"
                        className="btn btn-dark btn-sm"
                        onClick={async () => {
                          const r = await act({ type: 'grant_standing', recipientId, kind, ownerId: kind === 'refill_task' ? form.ownerId : null, days: form.days });
                          if (r.ok) setForm(null);
                        }}
                      >
                        {t('Allow')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(null)}>
                        {t('Cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!authority && <p className="small muted">{t('Only the person or their verified guardian can change these.')}</p>}
      <details className="small">
        <summary>{t('What SANAD never does on its own')}</summary>
        <ul>
          {NEVER.map((x) => (
            <li key={x}>{t(x)}</li>
          ))}
        </ul>
      </details>
      {ended.length > 0 && <p className="small muted">{t('Earlier permissions that ended or were turned off: {n}', { n: ended.length })}</p>}
    </section>
  );
}

const TIME_ZONES = ['Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Muscat', 'Africa/Cairo', 'Asia/Amman', 'Asia/Kolkata', 'Asia/Manila', 'Europe/London', 'UTC'];

export function NotifySettings() {
  const { me, act } = useSession();
  const [p, setP] = useState<NotifyPrefs>(me.prefs ?? DEFAULT_PREFS);
  const toggle = (k: NotifyPrefs['muted'][number]) => setP({ ...p, muted: p.muted.includes(k) ? p.muted.filter((x) => x !== k) : [...p.muted, k] });
  return (
    <form
      className="panel form"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ type: 'update_notify_prefs', prefs: p });
      }}
    >
      <header className="panel-head">
        <h2>{t('Notifications')}</h2>
      </header>
      <label className="check">
        <input type="checkbox" checked={p.quiet} onChange={(e) => setP({ ...p, quiet: e.target.checked })} />
        <span>{t('Quiet hours: keep routine notifications silent')}</span>
      </label>
      <div className="row gap-s wrap">
        <Field label={t('From')}>
          <input type="time" value={p.quietFrom} disabled={!p.quiet} onChange={(e) => setP({ ...p, quietFrom: e.target.value })} />
        </Field>
        <Field label={t('Until')}>
          <input type="time" value={p.quietTo} disabled={!p.quiet} onChange={(e) => setP({ ...p, quietTo: e.target.value })} />
        </Field>
        <Field label={t('Time zone')}>
          <select data-raw value={p.tz} onChange={(e) => setP({ ...p, tz: e.target.value })}>
            {(TIME_ZONES.includes(p.tz) ? TIME_ZONES : [p.tz, ...TIME_ZONES]).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={p.urgentThrough} onChange={(e) => setP({ ...p, urgentThrough: e.target.checked })} />
        <span>{t('Let urgent items through during quiet hours (escalations, urgent problems, cover about to start)')}</span>
      </label>
      <fieldset className="plain">
        <legend className="field-label">{t('Routine updates I want')}</legend>
        {(
          [
            ['reminders', 'Task reminders'],
            ['updates', 'Updates on tasks and comments'],
            ['monitoring', 'What SANAD notices (unlogged doses, refills, appointments without an outcome)'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={!p.muted.includes(k)} onChange={() => toggle(k)} />
            <span>{t(label)}</span>
          </label>
        ))}
        <p className="small muted">{t('New assignments, escalations and requests for your approval always arrive.')}</p>
      </fieldset>
      <div className="channels">
        <p className="field-label">{t('Where notifications go')}</p>
        <ul className="small">
          <li>
            <Icon name="check" size={12} /> {t('In SANAD (inbox and bell): on')}
          </li>
          <li className="muted">
            <Icon name="close" size={12} /> {t('Email, SMS and WhatsApp: not available — no delivery service is connected to SANAD yet')}
          </li>
        </ul>
      </div>
      <button type="submit" className="btn btn-dark">
        {t('Save notification settings')}
      </button>
    </form>
  );
}

/** True when a notification should count as new now (not held for quiet hours). */
export const isDue = (n: { read: boolean; heldUntil?: number }, now: number) => !n.read && (!n.heldUntil || n.heldUntil <= now);
