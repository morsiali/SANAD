import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CATEGORY_LABEL, PRIORITIES, ROLE_LABEL, type Challenge, type Priority } from '../../shared/types';
import { isActive } from '../../shared/routing';
import { canSee, canVerify, canWork, userName } from '../../shared/engine';
import { recommendFor, similarResolved } from '../../shared/intelligence';
import { useSession } from '../lib/store';
import { t, tc, tm, tn } from '../lib/i18n';
import { dateTime, recipientName, timeAgo } from '../lib/format';
import { useActions, type RunKind } from '../components/actions';
import { Avatar, Empty, Icon, Meter, PriorityPill, RoleTag, SlaBadge, Sparkle, StagePill, Stepper } from '../components/ui';

export function ChallengeDetail() {
  const { id } = useParams();
  const { view, me } = useSession();
  const c = view.challenges.find((x) => x.id === id);
  if (!c || !canSee(me, c)) {
    return (
      <div className="page">
        <Empty icon="search" title="Challenge not found" text="It may have been handed to a team you are not part of." action={<Link to="/app/challenges" className="btn btn-dark btn-sm">Back to challenges</Link>} />
      </div>
    );
  }
  return <Detail c={c} />;
}

function Detail({ c }: { c: Challenge }) {
  const { view, me, act, now } = useSession();
  const { run } = useActions();
  const [comment, setComment] = useState('');
  const [step, setStep] = useState('');
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const works = canWork(me, c);
  const active = isActive(c);
  const recs = useMemo(() => (active ? recommendFor(view, c) : []), [view, c, active]);
  const similar = useMemo(() => similarResolved(view, c), [view, c]);
  const assignee = view.users.find((u) => u.id === c.assigneeId);
  const reporter = view.users.find((u) => u.id === c.reporterId);
  const recipient = view.recipients.find((r) => r.id === c.recipientId);
  const done = c.checklist.filter((i) => i.done).length;
  const watching = c.watchers.includes(me.id);
  const appliedPb = view.playbooks.find((p) => p.id === c.playbookId);

  const buttons: { kind: RunKind; label: string; primary?: boolean; icon?: string }[] = [];
  if (active) {
    if (works && (c.stage === 'routed' || (c.stage === 'reported' && c.assigneeId === me.id && me.role !== 'coordinator'))) buttons.push({ kind: 'accept', label: 'Accept', primary: true });
    if (c.stage === 'reported' && me.role === 'coordinator') buttons.push({ kind: 'triage', label: 'Route to a team', primary: true, icon: 'route' });
    if (!c.assigneeId && c.role === me.role) buttons.push({ kind: 'claim', label: 'Claim', primary: true });
    if (c.assigneeId && c.assigneeId !== me.id && c.role === me.role && c.stage === 'routed' && me.role !== 'coordinator') buttons.push({ kind: 'claim', label: 'Take over' });
    if (works && c.stage === 'accepted') buttons.push({ kind: 'start', label: 'Start work', primary: true, icon: 'play' });
    if (works && (c.stage === 'in_progress' || c.stage === 'accepted')) buttons.push({ kind: 'resolve', label: 'Resolve', primary: c.stage === 'in_progress', icon: 'check' });
    if ((works || c.role === me.role) && c.stage !== 'reported') buttons.push({ kind: 'handoff', label: 'Hand off', icon: 'handoff' });
    if (me.role === 'coordinator' || (c.assigneeId === me.id && view.users.some((u) => u.role === me.role && u.id !== me.id))) buttons.push({ kind: 'reassign', label: 'Reassign', icon: 'users' });
    if (!c.escalated) buttons.push({ kind: 'escalate', label: 'Escalate', icon: 'flag' });
  } else {
    if (c.stage === 'resolved' && canVerify(me, c)) buttons.push({ kind: 'verify', label: 'Confirm fix', primary: true, icon: 'check' });
    if (canVerify(me, c) || works) buttons.push({ kind: 'reopen', label: 'Reopen', icon: 'refresh' });
  }

  const postComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    const r = await act({ type: 'comment', id: c.id, text: comment }, { quiet: true });
    if (r.ok) setComment('');
  };
  const addStep = async (e: FormEvent) => {
    e.preventDefault();
    if (!step.trim()) return;
    const r = await act({ type: 'add_check', id: c.id, text: step }, { quiet: true });
    if (r.ok) setStep('');
  };

  const thread = [
    ...c.comments.map((x) => ({ at: x.at, key: x.id, who: x.authorId, text: x.text, kind: 'comment' as const })),
    ...c.history.map((h) => ({ at: h.at, key: h.id, who: h.actorId, text: h.m ? tm(h.m) : h.text, kind: 'event' as const })),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="page">
      <Link to="/app/challenges" className="back">
        <Icon name="back" size={16} /> Challenges
      </Link>

      <header className={`detail-head ${c.escalated && active ? 'detail-esc' : ''}`}>
        <div className="detail-tags">
          <span className="ref">{c.ref}</span>
          <PriorityPill p={c.priority} />
          <StagePill s={c.stage} />
          <span className="pill pill-soft">{CATEGORY_LABEL[c.category]}</span>
          {c.escalated && active && (
            <span className="pill pill-esc">
              <Icon name="flag" size={12} /> Escalated · {c.escalationReason}
            </span>
          )}
          {c.reopenCount > 0 && <span className="pill pill-soft">{t('Reopened {n}×', { n: c.reopenCount })}</span>}
        </div>
        <h1 className="display-s">{c.title}</h1>
        <p className="muted">
          {t('For {recipient} · reported by {reporter} {ago}', { recipient: tc(recipient?.name), reporter: tc(reporter?.name ?? t('Someone')), ago: timeAgo(c.createdAt, now) })} · <SlaBadge c={c} />
        </p>
        <Stepper stage={c.stage} />
        <div className="detail-actions">
          {buttons.map((b) => (
            <button key={b.kind + b.label} type="button" className={`btn ${b.primary ? 'btn-dark' : 'btn-light'}`} onClick={() => run(b.kind, c)}>
              {b.icon && <Icon name={b.icon} size={16} />}
              {b.label}
            </button>
          ))}
          {c.escalated && active && me.role === 'coordinator' && (
            <button type="button" className="btn btn-light" onClick={() => act({ type: 'clear_escalation', id: c.id })}>
              Clear escalation
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => act({ type: 'watch', id: c.id, on: !watching })} aria-pressed={watching}>
            <Icon name="eye" size={16} /> {watching ? 'Following' : 'Follow'}
          </button>
        </div>
      </header>

      <div className="cols detail-cols">
        <div className="stack">
          <section className="panel">
            <h2 className="h2">What’s happening</h2>
            <p className="prose">{c.description || <span className="muted">No extra details were given.</span>}</p>
            {c.resolution && (
              <blockquote className="resolution">
                <strong>
                  {t('Resolution')} {c.resolvedAt ? `· ${dateTime(c.resolvedAt)}` : ''}
                </strong>
                {c.resolution}
                {c.rating && <span className="stars" aria-label={t('Rated {n} of 5', { n: c.rating })}>{'★'.repeat(c.rating)}{'☆'.repeat(5 - c.rating)}</span>}
              </blockquote>
            )}
          </section>

          {(active || c.checklist.length > 0) && (
            <section className="panel">
              <header className="panel-head">
                <h2>
                  {t('Steps')} {c.checklist.length > 0 && <small className="muted">{t('{done} of {total} done', { done, total: c.checklist.length })}</small>}
                </h2>
                {appliedPb && <span className="pill pill-soft">{t('From “{pb}”', { pb: tc(appliedPb.title) })}</span>}
              </header>
              {c.checklist.length > 0 && (
                <>
                  <div className="progress" aria-hidden="true">
                    <span style={{ width: `${(done / c.checklist.length) * 100}%` }} />
                  </div>
                  <ul className="checklist">
                    {c.checklist.map((i) => {
                      const checked = pending[i.id] ?? i.done;
                      return (
                      <li key={i.id}>
                        <label className={checked ? 'done' : ''}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!works || !active}
                            onChange={async () => {
                              setPending((p) => ({ ...p, [i.id]: !checked }));
                              await act({ type: 'toggle_check', id: c.id, itemId: i.id }, { quiet: true });
                              setPending((p) => {
                                const n = { ...p };
                                delete n[i.id];
                                return n;
                              });
                            }}
                          />
                          <span>{i.text}</span>
                          {i.done && i.doneBy && <small>{userName(view, i.doneBy)}</small>}
                        </label>
                      </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {c.checklist.length > 0 && done === c.checklist.length && works && active && (
                <div className="ready">
                  <Sparkle size={16} /> All steps are done.
                  <button type="button" className="btn btn-dark btn-sm" onClick={() => run('resolve', c)}>
                    Resolve now
                  </button>
                </div>
              )}
              {works && active && (
                <form className="inline-form" onSubmit={addStep}>
                  <input value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step" aria-label="New step" />
                  <button type="submit" className="btn btn-light btn-sm" disabled={!step.trim()}>
                    Add
                  </button>
                </form>
              )}
              {!c.checklist.length && !works && <p className="muted small">The owner hasn’t planned steps yet.</p>}
            </section>
          )}

          {active && (
            <section className="panel panel-intel">
              <header className="panel-head">
                <h2>
                  <Sparkle size={18} /> Suggested solutions
                </h2>
              </header>
              {recs.length ? (
                <ul className="recs">
                  {recs.map((r, i) => (
                    <li key={r.playbook.id} className="rec">
                      <div>
                        <span className="rec-title">
                          {r.playbook.title}
                          {i === 0 && <span className="pill pill-fast">{c.playbookId === r.playbook.id ? 'In use' : 'Best fit'}</span>}
                        </span>
                        <small>{r.why.map((w) => tm(w)).join(' · ')}</small>
                        <details>
                          <summary>{t('See {n} steps', { n: r.playbook.steps.length })}</summary>
                          <ol>
                            {r.playbook.steps.map((s) => (
                              <li key={s}>{s}</li>
                            ))}
                          </ol>
                        </details>
                      </div>
                      {works ? (
                        c.playbookId === r.playbook.id ? (
                          <span className="pill pill-ok">Applied</span>
                        ) : (
                          <button type="button" className="btn btn-dark btn-sm" onClick={() => act({ type: 'apply_playbook', id: c.id, playbookId: r.playbook.id })}>
                            Apply
                          </button>
                        )
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">
                  No playbook matches yet. <Link to="/app/playbooks?new=1">Write one</Link> once this is solved so the next person is faster.
                </p>
              )}
              {similar.length > 0 && (
                <>
                  <h3 className="h3">How similar problems were solved</h3>
                  <ul className="similar">
                    {similar.map(({ challenge: s }) => (
                      <li key={s.id}>
                        <Link to={`/app/challenges/${s.id}`}>
                          <strong>{s.title}</strong>
                        </Link>
                        <p>{s.resolution}</p>
                        <small>
                          {userName(view, s.assigneeId)} · {s.rating ? t('rated {n}/5', { n: s.rating }) : t('awaiting confirmation')}
                        </small>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="panel">
            <h2 className="h2">Conversation & history</h2>
            <ul className="thread">
              {thread.map((t) =>
                t.kind === 'comment' ? (
                  <li key={t.key} className={`msg ${t.who === me.id ? 'msg-me' : ''}`}>
                    <Avatar user={view.users.find((u) => u.id === t.who)} size={30} />
                    <div>
                      <span className="msg-head">
                        <strong>{userName(view, t.who)}</strong> <small>{timeAgo(t.at, now)}</small>
                      </span>
                      <p>{t.text}</p>
                    </div>
                  </li>
                ) : (
                  <li key={t.key} className="evt">
                    <span className="evt-dot">{t.who === 'system' ? <Sparkle size={12} /> : <i />}</span>
                    <span>
                      {t.text} <small>{dateTime(t.at)}</small>
                    </span>
                  </li>
                ),
              )}
            </ul>
            <form className="composer" onSubmit={postComment}>
              <textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Write an update — everyone involved is notified"
                aria-label="Comment"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment(e as unknown as FormEvent);
                }}
              />
              <button type="submit" className="btn btn-dark" disabled={!comment.trim()}>
                Post
              </button>
            </form>
          </section>
        </div>

        <aside className="stack">
          <section className="panel">
            <h2 className="h2">Who’s responsible</h2>
            <div className="owner">
              <Avatar user={assignee} size={44} />
              <span>
                <strong>{assignee?.name ?? t('{role} team queue', { role: t(ROLE_LABEL[c.role]) })}</strong>
                <small>{assignee ? `${assignee.title} · ${assignee.org}` : 'First available person will pick it up'}</small>
                <RoleTag role={c.role} />
              </span>
            </div>
            <dl className="facts">
              <dt>Reported by</dt>
              <dd>{reporter?.name}</dd>
              <dt>For</dt>
              <dd>
                <Link to={`/app/challenges?person=${c.recipientId}`}>{recipientName(view, c.recipientId)}</Link>
                {recipient && <small> · {recipient.area}</small>}
              </dd>
              <dt>Respond by</dt>
              <dd>{dateTime(c.dueAt)}</dd>
              <dt>Priority</dt>
              <dd>
                {works && active ? (
                  <select value={c.priority} onChange={(e) => act({ type: 'set_priority', id: c.id, priority: e.target.value as Priority })} aria-label="Change priority">
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p[0].toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <PriorityPill p={c.priority} />
                )}
              </dd>
              {c.watchers.length > 0 && (
                <>
                  <dt>Following</dt>
                  <dd className="ava-stack">
                    {c.watchers.map((w) => (
                      <Avatar key={w} user={view.users.find((u) => u.id === w)} size={24} />
                    ))}
                  </dd>
                </>
              )}
            </dl>
          </section>

          <section className="panel panel-tint">
            <h2 className="h2">
              <Sparkle size={16} /> Why it came here
            </h2>
            <div className="conf">
              <span>Routing confidence</span>
              <b>{Math.round(c.routing.confidence * 100)}%</b>
            </div>
            <Meter value={c.routing.confidence} label="Routing confidence" />
            <ul className="reasons">
              {(c.routing.why ?? []).map((r, i) => (
                <li key={i}>{tm(r)}</li>
              ))}
            </ul>
            {c.routing.role !== c.role && <p className="muted small">{t('Since then it moved to {role} — see the history.', { role: t(ROLE_LABEL[c.role]) })}</p>}
            <Link to="/app/routing" className="link small">
              How routing works
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
