import { useMemo, useState } from 'react';
import type { CarePlan, CareTask, Domain, Priority, Recurrence, TaskInput, User } from '../../shared/types';
import { PRIORITIES } from '../../shared/types';
import { DOMAIN_LABEL, hasAuthority } from '../../shared/access';
import { RECURRENCE_LABEL, TASK_STATUS_LABEL, isOpenTask, isOverdue, waitingOn } from '../../shared/plans';
import { useSession } from '../lib/store';
import { isAr, t, tc, tm } from '../lib/i18n';
import { dateTime, timeAgo } from '../lib/format';
import { Avatar, Empty, Field, Icon, Modal, PriorityPill } from './ui';

// ---------------------------------------------------------------- shared helpers

/** Care-team members (and the organisation's coordinators) who could be given work for this person. */
export function teamFor(view: ReturnType<typeof useSession>['view'], recipientId: string): User[] {
  const r = view.recipients.find((x) => x.id === recipientId);
  return view.users.filter((u) => u.role !== 'admin' && (u.recipients.includes(recipientId) || (u.role === 'coordinator' && !!r?.orgId && u.orgId === r.orgId)));
}

/** Sections the viewer can file work under for this person. */
export function domainOptions(view: ReturnType<typeof useSession>['view'], recipientId: string): Domain[] {
  return (view.access[recipientId] ?? []).filter((d) => d !== 'team');
}

const toLocal = (at: number | null | undefined) => {
  if (!at) return '';
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocal = (v: string) => (v ? new Date(v).getTime() : null);
export { toLocal };

export function TaskStatusPill({ task, now }: { task: CareTask; now: number }) {
  const overdue = isOverdue(task, now);
  return (
    <span className={`status-pill task-${task.status} ${overdue ? 'task-overdue' : ''}`}>
      {t(TASK_STATUS_LABEL[task.status])}
      {overdue && ` · ${t('Overdue')}`}
    </span>
  );
}

export function useTaskPermissions(task: CareTask) {
  const { view, me, now } = useSession();
  const r = view.recipients.find((x) => x.id === task.recipientId);
  const authority = !!hasAuthority(view, me.id, task.recipientId, now);
  const isOwner = task.ownerId === me.id || (!task.ownerId && me.role !== 'admin' && task.kind !== 'coverage');
  const manage = task.createdBy === me.id || task.ownerId === me.id || authority || (me.role === 'coordinator' && !!r && r.orgId === me.orgId);
  return { isOwner, manage, authority };
}

function taskTitle(task: CareTask, view: ReturnType<typeof useSession>['view']) {
  if (task.kind === 'handover') return t('Handover from {name}', { name: tc(view.users.find((u) => u.id === task.handover?.fromId)?.name ?? '') });
  if (task.kind === 'coverage') return t('Cover needed');
  return tc(task.title);
}

// ---------------------------------------------------------------- task row and detail

export function TaskRow({ task, showPerson = false }: { task: CareTask; showPerson?: boolean }) {
  const { view, now } = useSession();
  const [open, setOpen] = useState(false);
  const owner = view.users.find((u) => u.id === task.ownerId);
  const waits = waitingOn(view, task);
  const person = view.recipients.find((r) => r.id === task.recipientId);
  return (
    <li className={`task-row ${task.escalatedAt && isOpenTask(task) ? 'task-esc' : ''}`}>
      <button type="button" className="task-main" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="task-title">
          {task.kind === 'prep' && <Icon name="check" size={13} />} {taskTitle(task, view)}
        </span>
        <span className="task-meta">
          <TaskStatusPill task={task} now={now} />
          {task.priority !== 'medium' && <PriorityPill p={task.priority} />}
          {showPerson && person && <span className="chip chip-static">{tc(person.name)}</span>}
          {task.dueAt && <small>{t(task.kind === 'coverage' ? 'From {when}' : 'Due {when}', { when: dateTime(task.kind === 'coverage' ? task.coverFrom! : task.dueAt) })}</small>}
          {task.recurrence !== 'none' && (
            <small>
              <Icon name="refresh" size={12} /> {t(RECURRENCE_LABEL[task.recurrence])}
            </small>
          )}
          {waits.length > 0 && isOpenTask(task) && <small className="muted">{t('Waiting on “{title}”', { title: tc(waits[0].title) })}</small>}
          {task.escalatedAt && isOpenTask(task) && <span className="status-pill status-rejected">{t('Escalated')}</span>}
        </span>
      </button>
      <span className="task-owner">
        {owner ? (
          <>
            <Avatar user={owner} size={24} /> <small>{tc(owner.name)}</small>
          </>
        ) : (
          <small className="muted">{t(task.kind === 'coverage' ? 'Nobody yet' : 'Unassigned')}</small>
        )}
      </span>
      {open && <TaskDetail task={task} onClose={() => setOpen(false)} />}
    </li>
  );
}

function TaskDetail({ task, onClose }: { task: CareTask; onClose: () => void }) {
  const { view, me, act, now } = useSession();
  const { isOwner, manage } = useTaskPermissions(task);
  const [comment, setComment] = useState('');
  const [mode, setMode] = useState<null | 'complete' | 'blocked' | 'failed' | 'cancelled' | 'edit'>(null);
  const [text, setText] = useState('');
  const [docId, setDocId] = useState('');
  const [conflict, setConflict] = useState('');
  const live = view.tasks.find((x) => x.id === task.id) ?? task;
  const waits = waitingOn(view, live);
  const docs = view.documents.filter((d) => d.recipientId === live.recipientId && !d.archived);
  const plan = view.plans.find((p) => p.id === live.planId);
  const owner = view.users.find((u) => u.id === live.ownerId);
  const deps = live.dependsOn.map((id) => view.tasks.find((x) => x.id === id)).filter(Boolean) as CareTask[];
  const evidenceDoc = view.documents.find((d) => d.id === live.evidenceDocId);
  const doStatus = async (status: 'in_progress' | 'completed' | 'blocked' | 'cancelled' | 'failed' | 'resume', extra: { reason?: string; evidence?: string; evidenceDocId?: string } = {}) => {
    const r = await act({ type: 'task_status', taskId: live.id, status, ...extra });
    if (r.ok) {
      setMode(null);
      setText('');
    }
  };
  if (mode === 'edit') return <TaskModal recipientId={live.recipientId} task={live} onClose={onClose} />;
  return (
    <Modal
      wide
      title={taskTitle(live, view)}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('Close')}
        </button>
      }
    >
      <div className="row gap-s wrap">
        <TaskStatusPill task={live} now={now} />
        <PriorityPill p={live.priority} />
        <span className="chip chip-static">{t(DOMAIN_LABEL[live.domain])}</span>
        {live.recurrence !== 'none' && <span className="chip chip-static">{t(RECURRENCE_LABEL[live.recurrence])}</span>}
        {live.needsApproval && <span className="chip chip-static">{t('Needs guardian approval')}</span>}
      </div>
      <dl className="facts">
        <dt>{t('Owner')}</dt>
        <dd>{owner ? tc(owner.name) : t('Unassigned')}</dd>
        {live.kind === 'coverage' ? (
          <>
            <dt>{t('Time to cover')}</dt>
            <dd>
              {dateTime(live.coverFrom!)} – {dateTime(live.coverTo!)}
            </dd>
          </>
        ) : (
          <>
            <dt>{t('Due')}</dt>
            <dd>{live.dueAt ? dateTime(live.dueAt) : t('No due date')}</dd>
          </>
        )}
        {plan && (
          <>
            <dt>{t('Care plan')}</dt>
            <dd>{tc(plan.title)}</dd>
          </>
        )}
        {deps.length > 0 && (
          <>
            <dt>{t('Depends on')}</dt>
            <dd>
              {deps.map((d) => (
                <span key={d.id} className="block">
                  {tc(d.title)} · {t(TASK_STATUS_LABEL[d.status])}
                </span>
              ))}
            </dd>
          </>
        )}
        {live.statusReason && (
          <>
            <dt>{t('Reason')}</dt>
            <dd>{tc(live.statusReason)}</dd>
          </>
        )}
        {(live.evidence || evidenceDoc) && (
          <>
            <dt>{t('Completion evidence')}</dt>
            <dd>
              {live.evidence && tc(live.evidence)} {evidenceDoc && <span className="chip chip-static">{tc(evidenceDoc.title)}</span>}
            </dd>
          </>
        )}
      </dl>
      {live.notes && <p className="rec-body">{tc(live.notes)}</p>}

      {live.handover && (
        <section className="handover">
          <h3>{t('Handed over')}</h3>
          <p className="muted small">{t('Only items you are both allowed to see are included.')}</p>
          {live.handover.items.length ? (
            <ul>
              {live.handover.items.map((i) => (
                <li key={`${i.type}-${i.id}`}>
                  <span className="chip chip-static">{t(HANDOVER_TYPE[i.type])}</span> {tc(i.title)} · <span className="muted">{t(handoverState(i.state))}</span> <small className="muted">{dateTime(i.at)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small">{t('Nothing new in this period.')}</p>
          )}
        </section>
      )}

      {/* Actions — only what this person is allowed to do in the current state. */}
      {mode === null && (
        <div className="row gap-s wrap task-actions">
          {live.kind === 'coverage' && !live.ownerId && live.status === 'scheduled' && me.role !== 'admin' && (
            <button
              type="button"
              className="btn btn-dark btn-sm"
              onClick={async () => {
                const r = await act({ type: 'offer_cover', taskId: live.id }, { ownConflict: true });
                if (!r.ok && r.m?.k === 'e_conflict') setConflict(tm(r.m));
              }}
            >
              {t('I can cover this')}
            </button>
          )}
          {live.status === 'draft' && manage && (
            <button type="button" className="btn btn-dark btn-sm" onClick={() => act({ type: 'submit_task', taskId: live.id })}>
              {t('Submit')}
            </button>
          )}
          {live.status === 'scheduled' && isOwner && live.kind !== 'handover' && (
            <button type="button" className="btn btn-light btn-sm" disabled={waits.length > 0} onClick={() => doStatus('in_progress')}>
              <Icon name="play" size={14} /> {t('Start')}
            </button>
          )}
          {(live.status === 'scheduled' || live.status === 'in_progress') && (isOwner || manage) && (live.kind !== 'coverage' || live.ownerId === me.id) && (
            <button type="button" className="btn btn-dark btn-sm" disabled={waits.length > 0} onClick={() => setMode('complete')}>
              <Icon name="check" size={14} /> {t(live.kind === 'handover' ? 'Acknowledge' : 'Complete')}
            </button>
          )}
          {(live.status === 'scheduled' || live.status === 'in_progress') && (isOwner || manage) && live.kind === 'task' && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('blocked')}>
                {t('Blocked')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('failed')}>
                {t('Could not be done')}
              </button>
            </>
          )}
          {live.status === 'blocked' && (isOwner || manage) && (
            <button type="button" className="btn btn-light btn-sm" onClick={() => doStatus('resume')}>
              {t('Unblock')}
            </button>
          )}
          {manage && live.kind === 'task' && ['draft', 'awaiting_approval', 'scheduled', 'blocked'].includes(live.status) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('edit')}>
              <Icon name="edit" size={14} /> {t('Edit')}
            </button>
          )}
          {manage && isOpenTask(live) && live.kind !== 'handover' && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('cancelled')}>
              {t('Cancel task')}
            </button>
          )}
          {waits.length > 0 && <small className="muted">{t('Waiting on “{title}”', { title: tc(waits[0].title) })}</small>}
        </div>
      )}
      {conflict && (
        <div className="notice small" role="alert">
          <span>{conflict}</span>
          <button
            type="button"
            className="btn btn-dark btn-sm"
            onClick={async () => {
              const r = await act({ type: 'offer_cover', taskId: live.id, allowConflict: true });
              if (r.ok) setConflict('');
            }}
          >
            {t('Keep both')}
          </button>
        </div>
      )}
      {mode && (
        <form
          className="form task-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'complete') doStatus('completed', { evidence: text, evidenceDocId: docId || undefined });
            else doStatus(mode, { reason: text });
          }}
        >
          <Field label={t(mode === 'complete' ? (live.evidenceRequired ? 'Evidence it was done (required)' : 'Note (optional)') : 'Reason')}>
            <textarea id="task-text" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {mode === 'complete' && docs.length > 0 && (
            <Field label={t('Attach a document (optional)')}>
              <select value={docId} onChange={(e) => setDocId(e.target.value)}>
                <option value="">{t('None')}</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {tc(d.title)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="row gap-s">
            <button type="submit" className="btn btn-dark btn-sm" disabled={mode !== 'complete' ? text.trim().length < 3 : live.evidenceRequired && text.trim().length < 3 && !docId}>
              {t(mode === 'complete' ? (live.kind === 'handover' ? 'Acknowledge' : 'Mark completed') : mode === 'blocked' ? 'Mark blocked' : mode === 'failed' ? 'Mark as not done' : 'Cancel task')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>
              {t('Back')}
            </button>
          </div>
        </form>
      )}

      <section className="task-timeline">
        <h3>{t('History and comments')}</h3>
        <ol className="audit">
          {[...live.events.map((e) => ({ at: e.at, who: e.by, text: tm(e.m), c: false })), ...live.comments.map((c) => ({ at: c.at, who: c.authorId, text: tc(c.text), c: true }))]
            .sort((a, b) => a.at - b.at)
            .map((e, i) => (
              <li key={i} className={e.c ? 'is-comment' : ''}>
                <span>
                  <strong>{e.who === 'system' ? 'SANAD' : tc(view.users.find((u) => u.id === e.who)?.name ?? '')}</strong> {e.c ? <q>{e.text}</q> : e.text}
                </span>
                <small className="muted">{timeAgo(e.at, now)}</small>
              </li>
            ))}
        </ol>
        <form
          className="row gap-s"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act({ type: 'task_comment', taskId: live.id, text: comment });
            if (r.ok) setComment('');
          }}
        >
          <input className="grow" aria-label={t('Add a comment')} placeholder={t('Add a comment')} value={comment} onChange={(e) => setComment(e.target.value)} />
          <button type="submit" className="btn btn-light btn-sm" disabled={!comment.trim()}>
            {t('Post')}
          </button>
        </form>
      </section>
    </Modal>
  );
}

const HANDOVER_TYPE: Record<string, string> = { task: 'Task', record: 'Record', dose: 'Dose', problem: 'Problem', appointment: 'Appointment' };
function handoverState(s: string): string {
  return TASK_STATUS_LABEL[s as keyof typeof TASK_STATUS_LABEL] ?? ({ taken: 'Taken', missed: 'Missed', skipped: 'Skipped on purpose', unknown: 'Not known' } as Record<string, string>)[s] ?? s;
}

// ---------------------------------------------------------------- create / edit

export function TaskModal({ recipientId, task, planId, onClose }: { recipientId: string; task?: CareTask; planId?: string; onClose: () => void }) {
  const { view, me, act, now } = useSession();
  const domains = domainOptions(view, recipientId);
  const team = teamFor(view, recipientId);
  const plans = view.plans.filter((p) => p.recipientId === recipientId && p.status === 'active');
  const openTasks = view.tasks.filter((x) => x.recipientId === recipientId && isOpenTask(x) && x.id !== task?.id && x.kind === 'task');
  const authority = !!hasAuthority(view, me.id, recipientId, now);
  const [f, setF] = useState({
    title: task?.title ?? '',
    notes: task?.notes ?? '',
    domain: (task?.domain ?? (plans.find((p) => p.id === planId)?.domain || (domains.includes('overview') ? 'overview' : domains[0]))) as Domain,
    ownerId: task?.ownerId ?? me.id,
    priority: (task?.priority ?? 'medium') as Priority,
    due: toLocal(task?.dueAt ?? null),
    recurrence: (task?.recurrence ?? 'none') as Recurrence,
    dependsOn: task?.dependsOn ?? ([] as string[]),
    needsApproval: task?.needsApproval ?? false,
    evidenceRequired: task?.evidenceRequired ?? false,
    planId: task?.planId ?? planId ?? '',
  });
  const [busy, setBusy] = useState(false);
  const input = (): TaskInput => ({ title: f.title, notes: f.notes, domain: f.domain, ownerId: f.ownerId || null, priority: f.priority, dueAt: fromLocal(f.due), recurrence: f.recurrence, dependsOn: f.dependsOn, needsApproval: f.needsApproval, evidenceRequired: f.evidenceRequired, planId: f.planId || null });
  const save = async (draft: boolean) => {
    setBusy(true);
    const r = task ? await act({ type: 'edit_task', taskId: task.id, baseVersion: task.version, task: input() }) : await act({ type: 'add_task', recipientId, task: input(), draft });
    setBusy(false);
    if (r.ok) onClose();
  };
  return (
    <Modal
      wide
      title={task ? t('Edit task') : t('New task')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          {!task && (
            <button type="button" className="btn btn-light" disabled={busy || f.title.trim().length < 3} onClick={() => save(true)}>
              {t('Save as draft')}
            </button>
          )}
          <button type="button" className="btn btn-dark" disabled={busy || f.title.trim().length < 3 || (f.recurrence !== 'none' && !f.due)} onClick={() => save(false)}>
            {task ? t('Save changes') : f.needsApproval && !authority ? t('Send for approval') : t('Schedule task')}
          </button>
        </>
      }
    >
      <Field label={t('What needs doing?')}>
        <input id="task-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label={t('Details')}>
        <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <div className="grid-2">
        <Field label={t('Owner')} hint={t('Only people who can see this section can be given the task.')}>
          <select id="task-owner" value={f.ownerId ?? ''} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>
            <option value="">{t('Unassigned')}</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {tc(u.name)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Section')} hint={t('Who can see the task depends on this.')}>
          <select id="task-domain" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value as Domain })}>
            {domains.map((d) => (
              <option key={d} value={d}>
                {t(DOMAIN_LABEL[d])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Due')}>
          <input id="task-due" type="datetime-local" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
        </Field>
        <Field label={t('Repeats')}>
          <select id="task-repeat" value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value as Recurrence })}>
            {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (
              <option key={r} value={r}>
                {t(RECURRENCE_LABEL[r])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Priority')}>
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(p[0].toUpperCase() + p.slice(1))}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Care plan')}>
          <select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            <option value="">{t('Not part of a plan')}</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {tc(p.title)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {openTasks.length > 0 && (
        <fieldset className="checks">
          <legend>{t('Can only start after')}</legend>
          {openTasks.map((x) => (
            <label key={x.id} className="check">
              <input type="checkbox" checked={f.dependsOn.includes(x.id)} onChange={(e) => setF({ ...f, dependsOn: e.target.checked ? [...f.dependsOn, x.id] : f.dependsOn.filter((y) => y !== x.id) })} /> {tc(x.title)}
            </label>
          ))}
        </fieldset>
      )}
      <label className="check">
        <input type="checkbox" checked={f.evidenceRequired} onChange={(e) => setF({ ...f, evidenceRequired: e.target.checked })} /> {t('Ask for a note or document when it is completed')}
      </label>
      {!authority && (
        <label className="check">
          <input id="task-approval" type="checkbox" checked={f.needsApproval} onChange={(e) => setF({ ...f, needsApproval: e.target.checked })} />{' '}
          <span>
            {t('Ask the person or their guardian to approve it first')}
            <small className="muted block">{t('Use this when the task asks something of the family or changes their routine.')}</small>
          </span>
        </label>
      )}
    </Modal>
  );
}

export function PlanModal({ recipientId, plan, onClose }: { recipientId: string; plan?: CarePlan; onClose: () => void }) {
  const { view, act } = useSession();
  const domains = domainOptions(view, recipientId);
  const [f, setF] = useState({ title: plan?.title ?? '', goal: plan?.goal ?? '', domain: plan?.domain ?? (domains.includes('overview') ? 'overview' : domains[0]), status: plan?.status ?? 'active' });
  return (
    <Modal
      title={plan ? t('Edit care plan') : t('New care plan')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-dark"
            disabled={f.title.trim().length < 3}
            onClick={async () => {
              const r = plan ? await act({ type: 'update_plan', planId: plan.id, title: f.title, goal: f.goal, status: f.status as CarePlan['status'] }) : await act({ type: 'add_plan', recipientId, title: f.title, goal: f.goal, domain: f.domain as Domain });
              if (r.ok) onClose();
            }}
          >
            {plan ? t('Save changes') : t('Create plan')}
          </button>
        </>
      }
    >
      <Field label={t('Plan name')}>
        <input id="plan-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label={t('Goal')} hint={t('In the person’s own terms where possible.')}>
        <textarea id="plan-goal" rows={3} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} />
      </Field>
      {!plan ? (
        <Field label={t('Section')} hint={t('Who can see the plan depends on this.')}>
          <select value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value as Domain })}>
            {domains.map((d) => (
              <option key={d} value={d}>
                {t(DOMAIN_LABEL[d])}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label={t('Status')}>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as CarePlan['status'] })}>
            <option value="active">{t('Active')}</option>
            <option value="completed">{t('Completed')}</option>
            <option value="archived">{t('Archived')}</option>
          </select>
        </Field>
      )}
    </Modal>
  );
}

function HandoverModal({ recipientId, onClose }: { recipientId: string; onClose: () => void }) {
  const { view, me, act } = useSession();
  const team = teamFor(view, recipientId).filter((u) => u.id !== me.id && u.recipients.includes(recipientId));
  const [f, setF] = useState({ to: team[0]?.id ?? '', hours: '24', note: '' });
  return (
    <Modal
      title={t('Hand over care')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-dark"
            disabled={!f.to}
            onClick={async () => {
              const r = await act({ type: 'create_handover', recipientId, toUserId: f.to, note: f.note, hours: Number(f.hours) });
              if (r.ok) onClose();
            }}
          >
            {t('Send handover')}
          </button>
        </>
      }
    >
      <p className="small">{t('SANAD gathers completed and pending tasks, new records, doses, upcoming appointments and open problems — only items you and the receiver are both allowed to see.')}</p>
      <div className="grid-2">
        <Field label={t('Hand over to')}>
          <select id="handover-to" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {tc(u.name)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Covering the last')}>
          <select value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })}>
            {[12, 24, 48].map((h) => (
              <option key={h} value={h}>
                {t('{n} hours', { n: h })}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t('Your note')}>
        <textarea id="handover-note" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </Modal>
  );
}

function CoverModal({ recipientId, onClose }: { recipientId: string; onClose: () => void }) {
  const { view, act, now } = useSession();
  const domains = domainOptions(view, recipientId);
  const [f, setF] = useState({ from: toLocal(now + 24 * 3_600_000), to: toLocal(now + 30 * 3_600_000), reason: '', domain: (domains.includes('overview') ? 'overview' : domains[0]) as Domain });
  return (
    <Modal
      title={t('Request cover')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-dark"
            disabled={f.reason.trim().length < 3}
            onClick={async () => {
              const r = await act({ type: 'request_cover', recipientId, from: fromLocal(f.from) ?? 0, to: fromLocal(f.to) ?? 0, reason: f.reason, domain: f.domain });
              if (r.ok) onClose();
            }}
          >
            {t('Send request')}
          </button>
        </>
      }
    >
      <p className="small">{t('Caregivers and family on the care team are told, and anyone free can offer to cover. SANAD checks their other commitments first.')}</p>
      <div className="grid-2">
        <Field label={t('From')}>
          <input id="cover-from" type="datetime-local" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </Field>
        <Field label={t('To')}>
          <input id="cover-to" type="datetime-local" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </Field>
      </div>
      <Field label={t('What needs covering?')}>
        <textarea id="cover-reason" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
      <Field label={t('Section')} hint={t('Only people who can see this section are asked.')}>
        <select value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value as Domain })}>
          {domains.map((d) => (
            <option key={d} value={d}>
              {t(DOMAIN_LABEL[d])}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- panel for a profile

export function PlansPanel({ recipientId }: { recipientId: string }) {
  const { view, me, now } = useSession();
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [modal, setModal] = useState<null | 'task' | 'plan' | 'handover' | 'cover' | { plan: CarePlan } | { addTo: string }>(null);
  const plans = view.plans.filter((p) => p.recipientId === recipientId && p.status !== 'archived');
  const tasks = useMemo(
    () =>
      view.tasks
        .filter((x) => x.recipientId === recipientId && x.kind !== 'prep')
        .filter((x) => (filter === 'open' ? isOpenTask(x) : filter === 'done' ? !isOpenTask(x) : true))
        .sort((a, b) => Number(isOpenTask(b)) - Number(isOpenTask(a)) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)),
    [view.tasks, recipientId, filter],
  );
  const canAdd = me.role !== 'admin' && domainOptions(view, recipientId).length > 0;
  const onTeam = view.memberships.some((m) => m.userId === me.id && m.recipientId === recipientId && m.status === 'active');
  const group = (planId: string | null) => tasks.filter((x) => x.planId === planId);
  const progress = (p: CarePlan) => {
    const all = view.tasks.filter((x) => x.planId === p.id && x.status !== 'cancelled');
    const done = all.filter((x) => x.status === 'completed').length;
    return { done, total: all.length };
  };
  return (
    <>
      <section className="panel" aria-labelledby="plans-h">
        <header className="panel-head">
          <h2 id="plans-h">{t('Plans & tasks')}</h2>
          <div className="row gap-s wrap">
            {canAdd && (
              <>
                <button type="button" className="btn btn-dark btn-sm" onClick={() => setModal('task')}>
                  <Icon name="plus" size={14} /> {t('New task')}
                </button>
                <button type="button" className="btn btn-light btn-sm" onClick={() => setModal('plan')}>
                  {t('New care plan')}
                </button>
                {onTeam && (
                  <>
                    <button type="button" className="btn btn-light btn-sm" onClick={() => setModal('handover')}>
                      {t('Hand over')}
                    </button>
                    <button type="button" className="btn btn-light btn-sm" onClick={() => setModal('cover')}>
                      {t('Request cover')}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </header>
        <div className="seg" role="group" aria-label={t('Show tasks')}>
          {(['open', 'done', 'all'] as const).map((k) => (
            <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {t(k === 'open' ? 'Open' : k === 'done' ? 'Finished' : 'All')}
            </button>
          ))}
        </div>
        <p className="muted small flow-hint">{t('Draft → Awaiting approval → Scheduled → In progress → Completed. Blocked, cancelled and “could not be done” are recorded with a reason.')}</p>
        {plans.map((p) => {
          const pr = progress(p);
          const items = group(p.id);
          return (
            <div key={p.id} className="plan">
              <div className="plan-head">
                <div>
                  <h3>{tc(p.title)}</h3>
                  {p.goal && <p className="small muted">{tc(p.goal)}</p>}
                </div>
                <div className="plan-meta">
                  <span className="chip chip-static">{t(DOMAIN_LABEL[p.domain])}</span>
                  <span className="plan-progress" aria-label={t('{done} of {total} tasks completed', { done: pr.done, total: pr.total })}>
                    <span className="meter">
                      <span style={{ width: `${pr.total ? (pr.done / pr.total) * 100 : 0}%` }} />
                    </span>
                    <small>{t('{done} of {total} done', { done: pr.done, total: pr.total })}</small>
                  </span>
                  {canAdd && (
                    <button type="button" className="link small" onClick={() => setModal({ addTo: p.id })}>
                      {t('Add task')}
                    </button>
                  )}
                  {(p.createdBy === me.id || hasAuthority(view, me.id, recipientId, now)) && (
                    <button type="button" className="link small" onClick={() => setModal({ plan: p })}>
                      {t('Edit')}
                    </button>
                  )}
                </div>
              </div>
              {items.length ? (
                <ul className="tasks">
                  {items.map((x) => (
                    <TaskRow key={x.id} task={x} />
                  ))}
                </ul>
              ) : (
                <p className="muted small">{t('No tasks to show here.')}</p>
              )}
            </div>
          );
        })}
        <div className="plan">
          <h3>{t(plans.length ? 'Other tasks' : 'Tasks')}</h3>
          {group(null).length ? (
            <ul className="tasks">
              {group(null).map((x) => (
                <TaskRow key={x.id} task={x} />
              ))}
            </ul>
          ) : (
            <Empty icon="check" title="Nothing to show" text="Tasks you can see for this person will appear here." />
          )}
        </div>
      </section>
      {modal === 'task' && <TaskModal recipientId={recipientId} onClose={() => setModal(null)} />}
      {modal === 'plan' && <PlanModal recipientId={recipientId} onClose={() => setModal(null)} />}
      {modal === 'handover' && <HandoverModal recipientId={recipientId} onClose={() => setModal(null)} />}
      {modal === 'cover' && <CoverModal recipientId={recipientId} onClose={() => setModal(null)} />}
      {modal && typeof modal === 'object' && 'plan' in modal && <PlanModal recipientId={recipientId} plan={modal.plan} onClose={() => setModal(null)} />}
      {modal && typeof modal === 'object' && 'addTo' in modal && <TaskModal recipientId={recipientId} planId={modal.addTo} onClose={() => setModal(null)} />}
    </>
  );
}

export const listJoin = (xs: string[]) => xs.join(isAr() ? '، ' : ', ');
