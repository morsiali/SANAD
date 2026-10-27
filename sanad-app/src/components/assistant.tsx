// The SANAD assistant on screen: a side panel available on every page (aware of the person and tab you are on)
// and the full "Ask SANAD" page. Both use the same conversation component.
//
// What the user sees for every answer: the sources it used (numbered, each opens where it lives), notes about
// what is uncertain or out of scope, and, for drafts, an editable preview with an exact list of the steps that
// will run. Nothing is changed until the user confirms; each step is then sent as a normal action and shown as
// done only when SANAD confirms it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Domain, Msg, Recurrence } from '../../shared/types';
import { ROLE_LABEL } from '../../shared/types';
import { DOMAIN_LABEL } from '../../shared/access';
import { RECURRENCE_LABEL } from '../../shared/plans';
import { SOURCE_LABEL } from '../../shared/records';
import { draftSteps, pageSuggestions, sourceLink, type AssistantAnswer, type BriefDraft, type DraftStep, type DraftTask, type HandoverDraft, type Intent, type PlanDraft, type ReviewDraft, type SourceRef, type Suggestion } from '../../shared/assistant';
import { STARTERS, type Answer } from '../../shared/intelligence';
import { userName } from '../../shared/engine';
import { useSession } from '../lib/store';
import { getLang, t, tc, tm } from '../lib/i18n';
import { dateTime } from '../lib/format';
import { Avatar, ChallengeRow, Field, Icon, PriorityPill, RoleTag, Sparkle } from './ui';
import { fromLocal, toLocal } from './tasks';

// ---------------------------------------------------------------- context

export interface AskOptions {
  question?: string;
  intent?: Intent;
  recipientId?: string | null;
  targetId?: string | null;
}

interface Turn {
  id: number;
  q: string;
  opts: AskOptions;
  a?: AssistantAnswer;
  error?: string;
}

interface AssistantCtx {
  open(opts?: AskOptions): void;
  close(): void;
  isOpen: boolean;
}

const Ctx = createContext<AssistantCtx>({ open: () => undefined, close: () => undefined, isOpen: false });
export const useAssistant = () => useContext(Ctx);

/** Person and profile tab of the page being viewed. */
export function usePageContext(): { recipientId: string | null; tab: string | null } {
  const loc = useLocation();
  const m = loc.pathname.match(/^\/app\/people\/([^/]+)/);
  const tab = new URLSearchParams(loc.search).get('tab');
  return { recipientId: m?.[1] ?? null, tab: m ? tab ?? 'overview' : null };
}

function useConversation() {
  const { backend, token, me, view } = useSession();
  const [turns, setTurns] = useState<Turn[]>([]);
  const counter = useRef(0);
  const ask = useCallback(
    async (question: string, opts: AskOptions = {}) => {
      const q = question.trim();
      if (!q || me.role === 'admin') return;
      const id = ++counter.current;
      setTurns((prev) => [...prev, { id, q, opts }]);
      try {
        const a = await backend.assistant(token, { question: q, intent: opts.intent, recipientId: opts.recipientId ?? null, targetId: opts.targetId ?? null }, getLang());
        setTurns((prev) => prev.map((x) => (x.id === id ? { ...x, a } : x)));
      } catch (e) {
        setTurns((prev) => prev.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
      }
    },
    [backend, token, me.role],
  );
  // A changed view (e.g. after confirming a draft) does not rewrite old answers; they say when they were made.
  void view;
  return { turns, ask, clear: () => setTurns([]) };
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const [isOpen, setOpen] = useState(false);
  const [pending, setPending] = useState<AskOptions | null>(null);
  const open = useCallback((opts?: AskOptions) => {
    setOpen(true);
    if (opts?.question) setPending(opts);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {me.role !== 'admin' && <AssistantPanel open={isOpen} onOpen={() => setOpen(true)} onClose={close} pending={pending} clearPending={() => setPending(null)} />}
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------- side panel

function AssistantPanel({ open, onOpen, onClose, pending, clearPending }: { open: boolean; onOpen: () => void; onClose: () => void; pending: AskOptions | null; clearPending: () => void }) {
  const page = usePageContext();
  const { view } = useSession();
  const conv = useConversation();
  const loc = useLocation();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (pending?.question) {
      conv.ask(pending.question, { recipientId: page.recipientId, ...pending });
      clearPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLInputElement>('.ask-input')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const person = page.recipientId ? view.recipients.find((r) => r.id === page.recipientId && !r.limited) : undefined;
  if (loc.pathname.startsWith('/app/intelligence')) return null;
  return (
    <>
      {!open && (
        <button type="button" className="assist-fab" onClick={onOpen} aria-label={t('Open the SANAD assistant')}>
          <Sparkle size={18} />
          <span>{t('Ask SANAD')}</span>
        </button>
      )}
      <aside ref={ref} className={`assist-panel ${open ? 'assist-open' : ''}`} aria-label={t('SANAD assistant')} aria-hidden={!open} hidden={!open}>
        <header className="assist-head">
          <Sparkle size={20} />
          <div>
            <strong>{t('SANAD assistant')}</strong>
            <small>{person ? t('About {name} · {tab}', { name: tc(person.name), tab: t(TAB_NAME[page.tab ?? 'overview'] ?? 'Overview') }) : t('Answers only from what you can see')}</small>
          </div>
          {conv.turns.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={conv.clear}>
              {t('Clear')}
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close the assistant')}>
            <Icon name="close" />
          </button>
        </header>
        <Conversation conv={conv} context={page} compact />
      </aside>
    </>
  );

}

const TAB_NAME: Record<string, string> = { ...DOMAIN_LABEL, overview: 'Overview', plans: 'Plans & tasks', appointments: 'Appointments', documents: 'Documents', progress: 'Progress', history: 'Activity history' };

// ---------------------------------------------------------------- conversation

export function Conversation({ conv, context, compact }: { conv: ReturnType<typeof useConversation>; context: { recipientId: string | null; tab: string | null }; compact?: boolean }) {
  const { view, now, me } = useSession();
  const [q, setQ] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => pageSuggestions(view, context, now), [view, context, now]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [conv.turns]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    conv.ask(q, { recipientId: context.recipientId });
    setQ('');
  };
  const run = (s: Suggestion) => conv.ask(tm(s.m), { intent: s.intent, recipientId: s.recipientId ?? context.recipientId, targetId: s.targetId });

  if (me.role === 'admin') return <p className="muted">{t('The assistant is not available for organisation admins.')}</p>;
  return (
    <div className={`assist-conv ${compact ? 'assist-compact' : ''}`}>
      <div className="assist-scroll" aria-live="polite">
        {conv.turns.length === 0 && (
          <div className="assist-start">
            {suggestions.length > 0 && (
              <>
                <p className="small muted">{t('Suggested for this page')}</p>
                <SuggestionList items={suggestions} onRun={run} />
              </>
            )}
            <p className="small muted">{t('Or ask about a problem')}</p>
            <div className={compact ? 'follow' : 'starters'}>
              {STARTERS.slice(0, compact ? 2 : 4).map((s) => (
                <button key={s.k} type="button" className={compact ? 'chip' : 'starter'} onClick={() => conv.ask(tm(s), { recipientId: context.recipientId })}>
                  {!compact && <Sparkle size={14} />} {tm(s)}
                </button>
              ))}
            </div>
            <p className="small muted assist-promise">
              <Icon name="shield" size={14} /> {t('The assistant reads only what you are allowed to see, shows its sources, and never changes anything until you confirm. It does not diagnose, prescribe or change doses.')}
            </p>
          </div>
        )}
        {conv.turns.map((turn) => (
          <div key={turn.id} className="turn">
            <p className="turn-q">{turn.q}</p>
            <div className="turn-a">
              <span className="turn-ava" aria-hidden="true">
                <Sparkle size={18} />
              </span>
              <div className="turn-body">
                {!turn.a && !turn.error && (
                  <p className="muted" role="status">
                    {t('Looking through the records you can see…')}
                  </p>
                )}
                {turn.error && (
                  <p className="form-error" role="alert">
                    {turn.error}
                  </p>
                )}
                {turn.a && <AnswerView a={turn.a} q={turn.q} onAsk={(text, o) => conv.ask(text, o)} onRun={run} />}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="ask-dock assist-dock" onSubmit={onSubmit}>
        <Sparkle size={18} />
        <input className="ask-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Ask about a person, a problem, or a SAN number')} aria-label={t('Ask SANAD')} />
        <button type="submit" className="btn btn-dark btn-sm" disabled={!q.trim()}>
          {t('Ask')}
        </button>
      </form>
    </div>
  );
}

function SuggestionList({ items, onRun }: { items: Suggestion[]; onRun: (s: Suggestion) => void }) {
  const [why, setWhy] = useState<number | null>(null);
  return (
    <ul className="assist-sugg">
      {items.map((s, i) => (
        <li key={i}>
          <button type="button" className="chip" onClick={() => onRun(s)}>
            <Sparkle size={13} /> {tm(s.m)}
          </button>
          <button type="button" className="link small" aria-expanded={why === i} onClick={() => setWhy(why === i ? null : i)}>
            {t('Why am I seeing this?')}
          </button>
          {why === i && <p className="small muted assist-why">{tm(s.why)}</p>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- one answer

const TYPE_LABEL: Record<SourceRef['type'], string> = {
  record: 'Record',
  medication: 'Medicine',
  dose: 'Dose log',
  task: 'Task',
  plan: 'Plan',
  appointment: 'Appointment',
  document: 'Document',
  problem: 'Problem',
  profile: 'Profile',
};

function Cites({ ids, sources }: { ids: string[]; sources: SourceRef[] }) {
  if (!ids.length) return null;
  const shown = ids.slice(0, 4);
  return (
    <span className="cites">
      {shown.map((id) => {
        const i = sources.findIndex((s) => s.id === id);
        const s = sources[i];
        if (!s) return null;
        return (
          <Link key={id} to={sourceLink(s)} className="cite" title={`${tc(s.title)} · ${t(TYPE_LABEL[s.type])}`} aria-label={t('Source {n}: {title}', { n: i + 1, title: tc(s.title) })}>
            {i + 1}
          </Link>
        );
      })}
      {ids.length > shown.length && <span className="cite cite-more">+{ids.length - shown.length}</span>}
    </span>
  );
}

function AnswerView({ a, q, onAsk, onRun }: { a: AssistantAnswer; q: string; onAsk: (text: string, o: AskOptions) => void; onRun: (s: Suggestion) => void }) {
  const { view } = useSession();
  if (a.legacy) return <LegacyAnswer a={a.legacy} q={q} onAsk={(text) => onAsk(text, {})} />;
  return (
    <div className={`answer ${a.refused ? 'answer-refused' : ''} ${a.emergency ? 'answer-emergency' : ''}`} data-intent={a.intent}>
      {a.emergency ? (
        <div className="assist-alert" role="alert">
          <Icon name="bolt" size={18} />
          <div>
            <strong>{tm(a.headline)}</strong>
            {a.notes.map((n, i) => (
              <p key={i} className="small">
                {tm(n)}
              </p>
            ))}
            <Link to="/app/report" className="btn btn-light btn-sm">
              {t('Report a problem to the care team')}
            </Link>
          </div>
        </div>
      ) : (
        <p className="answer-head">
          {a.refused && <Icon name="shield" size={16} />} {tm(a.headline)}
        </p>
      )}
      <p className="engine-tag small">
        {a.engine === 'model' ? <Sparkle size={12} /> : <Icon name="check" size={12} />} {t(a.engine === 'model' ? 'Overview by the AI model, checked against the sources' : 'Built by SANAD from your records')}
        {a.modelNote && a.engine !== 'model' && <> · {tm(a.modelNote)}</>}
      </p>
      {a.overview && (
        <div className="answer-overview">
          {a.overview.map((p, i) => (
            <p key={i}>
              {p.text} <Cites ids={p.cites} sources={a.sources} />
            </p>
          ))}
        </div>
      )}
      {a.blocks.map((b, i) => (
        <section key={i} className="answer-block">
          <h4>{tm(b.title)}</h4>
          {b.lines.length ? (
            <ul>
              {b.lines.map((l, j) => (
                <li key={j} className={l.tone ? `tone-${l.tone}` : undefined}>
                  <span>{tm(l.m)}</span> <Cites ids={l.cites} sources={a.sources} />
                </li>
              ))}
            </ul>
          ) : (
            b.empty && <p className="small muted">{tm(b.empty)}</p>
          )}
        </section>
      ))}
      {a.notes.length > 0 && !a.emergency && (
        <ul className="answer-notes">
          {a.notes.map((n, i) => (
            <li key={i}>
              <Icon name="flag" size={12} /> {tm(n)}
            </li>
          ))}
        </ul>
      )}
      {a.sources.length > 0 && (
        <details className="answer-sources">
          <summary>{t('Sources ({n})', { n: a.sources.length })}</summary>
          <ol>
            {a.sources.map((s) => (
              <li key={s.id}>
                <Link to={sourceLink(s)}>{tc(s.title)}</Link>{' '}
                <small className="muted">
                  {t(TYPE_LABEL[s.type])} · {t(DOMAIN_LABEL[s.domain])}
                  {s.at ? <> · {dateTime(s.at)}</> : null}
                  {s.source && <> · {t(SOURCE_LABEL[s.source])}</>}
                  {s.verified && <> · {t('Verified')}</>}
                  {s.by && <> · {tc(userName(view, s.by))}</>}
                </small>
              </li>
            ))}
          </ol>
        </details>
      )}
      {a.draft?.kind === 'plan' && <PlanDraftEditor d={a.draft} />}
      {a.draft?.kind === 'handover' && <HandoverDraftEditor d={a.draft} onAsk={onAsk} />}
      {a.draft?.kind === 'review' && <ReviewDraftEditor d={a.draft} />}
      {a.draft?.kind === 'brief' && <BriefSaver d={a.draft} a={a} />}
      {a.suggestions.length > 0 && <SuggestionList items={a.suggestions} onRun={onRun} />}
    </div>
  );
}

// ---------------------------------------------------------------- running confirmed steps

type StepState = { status: 'waiting' | 'running' | 'done' | 'failed'; message?: string };

function StepRunner({ steps, onFinished, confirmLabel, disabled }: { steps: DraftStep[]; onFinished?: (created: Record<string, string>) => void; confirmLabel: string; disabled?: boolean }) {
  const { act } = useSession();
  const [state, setState] = useState<Record<string, StepState>>({});
  const [busy, setBusy] = useState(false);
  const created = useRef<Record<string, string>>({});
  const allDone = steps.length > 0 && steps.every((s) => state[s.key]?.status === 'done');
  const started = Object.keys(state).length > 0;
  const run = async () => {
    setBusy(true);
    for (const s of steps) {
      if (state[s.key]?.status === 'done') continue; // never repeat a step SANAD already confirmed
      setState((p) => ({ ...p, [s.key]: { status: 'running' } }));
      const r = await act(s.build(created.current), { quiet: true });
      if (!r.ok) {
        setState((p) => ({ ...p, [s.key]: { status: 'failed', message: r.m ? tm(r.m) : t('SANAD could not complete this step.') } }));
        setBusy(false);
        return;
      }
      if (r.createdId) created.current[s.key] = r.createdId;
      setState((p) => ({ ...p, [s.key]: { status: 'done', message: r.message } }));
    }
    setBusy(false);
    onFinished?.(created.current);
  };
  return (
    <div className="step-runner">
      <p className="small strong">{t(started ? 'Progress' : 'When you confirm, SANAD will:')}</p>
      <ol className="assist-steps" aria-live="polite">
        {steps.map((s) => {
          const st = state[s.key]?.status ?? 'waiting';
          return (
            <li key={s.key} className={`astep astep-${st}`}>
              <span className="astep-ico" aria-hidden="true">
                {st === 'done' ? <Icon name="check" size={13} /> : st === 'failed' ? <Icon name="close" size={13} /> : st === 'running' ? <Sparkle size={13} className="spin" /> : '•'}
              </span>
              <span>
                {tm(s.label)}
                <small className="muted"> — {t(st === 'done' ? 'Done, confirmed by SANAD' : st === 'failed' ? 'Not done' : st === 'running' ? 'Sending…' : started ? 'Not started' : 'Not done yet')}</small>
                {st === 'failed' && state[s.key]?.message && <small className="form-error"> {state[s.key]!.message}</small>}
              </span>
            </li>
          );
        })}
      </ol>
      {allDone ? (
        <p className="small ok-text" role="status">
          <Icon name="check" size={14} /> {t('All steps were completed and confirmed by SANAD.')}
        </p>
      ) : (
        <button type="button" className="btn btn-dark btn-sm" disabled={busy || disabled || !steps.length} onClick={run}>
          {t(Object.values(state).some((x) => x.status === 'failed') ? 'Try the remaining steps again' : confirmLabel)}
        </button>
      )}
      {!started && <p className="small muted">{t('Nothing has been created or sent yet.')}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- draft editors

function PlanDraftEditor({ d }: { d: PlanDraft }) {
  const { view } = useSession();
  const [title, setTitle] = useState(tc(d.title));
  const [goal, setGoal] = useState(tc(d.goal));
  const [domain, setDomain] = useState<Domain>(d.domain);
  const [tasks, setTasks] = useState<DraftTask[]>(() => d.tasks.map((x) => ({ ...x, title: tc(x.title), notes: tc(x.notes) })));
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);
  const steps = useMemo(() => draftSteps(d, { plan: { title, goal, domain, tasks } }), [d, title, goal, domain, tasks]);
  const set = (key: string, patch: Partial<DraftTask>) => setTasks((ts) => ts.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const valid = title.trim().length >= 3 && tasks.filter((x) => x.include).every((x) => x.title.trim().length >= 3);
  return (
    <div className="draft-card" aria-label={t('Draft plan')}>
      <p className="draft-tag">
        <Icon name="edit" size={13} /> {t('Draft — review and edit before confirming')}
      </p>
      <fieldset disabled={locked} className="draft-fields">
        <Field label={t('Plan title')}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('Goal, in the person’s own terms')}>
          <textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} />
        </Field>
        <Field label={t('Section')} hint={t('Only people who can see this section will see the plan and its tasks.')}>
          <select value={domain} onChange={(e) => setDomain(e.target.value as Domain)}>
            {d.domainOptions.map((x) => (
              <option key={x} value={x}>
                {t(DOMAIN_LABEL[x])}
              </option>
            ))}
          </select>
        </Field>
        <ul className="draft-tasks">
          {tasks.map((x) => (
            <li key={x.key} className={x.include ? '' : 'draft-off'}>
              <label className="check">
                <input type="checkbox" checked={x.include} onChange={(e) => set(x.key, { include: e.target.checked })} />
                <span>{t('Include')}</span>
              </label>
              <div className="draft-task-fields">
                <input aria-label={t('Step title')} value={x.title} onChange={(e) => set(x.key, { title: e.target.value })} />
                <div className="draft-row">
                  <select aria-label={t('Owner')} value={x.ownerId ?? ''} onChange={(e) => set(x.key, { ownerId: e.target.value || null })}>
                    <option value="">{t('No owner yet')}</option>
                    {x.ownerOptions.map((id) => {
                      const u = view.users.find((v) => v.id === id);
                      return u ? (
                        <option key={id} value={id}>
                          {tc(u.name)} · {t(ROLE_LABEL[u.role])}
                        </option>
                      ) : null;
                    })}
                  </select>
                  <input aria-label={t('Starts')} type="datetime-local" value={toLocal(x.dueAt)} onChange={(e) => set(x.key, { dueAt: fromLocal(e.target.value) })} />
                  <select aria-label={t('Repeats')} value={x.recurrence} onChange={(e) => set(x.key, { recurrence: e.target.value as Recurrence })}>
                    {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (
                      <option key={r} value={r}>
                        {t(RECURRENCE_LABEL[r])}
                      </option>
                    ))}
                  </select>
                </div>
                <small className="muted">
                  {x.duplicateOf ? t('Already planned for this person, so it is left out unless you include it.') : tm(x.why)}
                </small>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setTasks((ts) => [...ts, { key: `n${ts.length + 1}`, title: '', notes: '', ownerId: null, ownerOptions: ts[0]?.ownerOptions ?? [], dueAt: null, recurrence: 'none', priority: 'medium', needsApproval: d.tasks[0]?.needsApproval ?? false, include: true, why: { k: 'why_owner_none', p: { domain } } as Msg }])}
        >
          <Icon name="plus" size={13} /> {t('Add a step')}
        </button>
      </fieldset>
      {d.approvers.length > 0 && <p className="small muted">{t('Each task will wait for approval by {names} before it is scheduled.', { names: d.approvers.map((id) => tc(userName(view, id))).join(', ') })}</p>}
      <StepRunner
        steps={steps}
        confirmLabel="Confirm and create"
        disabled={!valid}
        onFinished={() => {
          setLocked(true);
          setDone(true);
        }}
      />
      {!locked && Object.keys(steps).length > 0 && <p className="small muted">{t('Editing is closed once you confirm.')}</p>}
      {done && (
        <Link className="btn btn-light btn-sm" to={`/app/people/${d.recipientId}?tab=plans`}>
          {t('Open plans and tasks')}
        </Link>
      )}
    </div>
  );
}

function HandoverDraftEditor({ d, onAsk }: { d: HandoverDraft; onAsk: (text: string, o: AskOptions) => void }) {
  const { view } = useSession();
  const [to, setTo] = useState(d.toUserId ?? '');
  const [note, setNote] = useState(tm(d.note));
  const [done, setDone] = useState(false);
  const steps = useMemo(() => draftSteps(d, { handover: { toUserId: to, hours: d.hours, note } }), [d, to, note]);
  const r = view.recipients.find((x) => x.id === d.recipientId);
  return (
    <div className="draft-card" aria-label={t('Draft handover')}>
      <p className="draft-tag">
        <Icon name="handoff" size={13} /> {t('Draft — review and edit before confirming')}
      </p>
      <fieldset disabled={done} className="draft-fields">
        <Field label={t('Hand over to')}>
          <select
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              // Refresh the preview for the new receiver (what they may see can differ).
              const u = view.users.find((x) => x.id === e.target.value);
              if (u && r) onAsk(t('Prepare a handover for {name} to {to}, last {h} hours', { name: tc(r.name), to: tc(u.name), h: d.hours }), { intent: 'handover', recipientId: d.recipientId, targetId: u.id });
            }}
          >
            <option value="">{t('Choose a team member')}</option>
            {d.options.map((id) => {
              const u = view.users.find((x) => x.id === id);
              return u ? (
                <option key={id} value={id}>
                  {tc(u.name)} · {t(ROLE_LABEL[u.role])}
                </option>
              ) : null;
            })}
          </select>
        </Field>
        <Field label={t('Note for the receiver')}>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </fieldset>
      <StepRunner steps={steps} confirmLabel="Confirm and send the handover" disabled={!to} onFinished={() => setDone(true)} />
    </div>
  );
}

function ReviewDraftEditor({ d }: { d: ReviewDraft }) {
  const { view } = useSession();
  const [owner, setOwner] = useState(d.ownerId ?? '');
  const [title, setTitle] = useState(t('Professional review: {q}', { q: d.question.slice(0, 80) }));
  const [notes, setNotes] = useState(t('Question raised in SANAD: “{q}”', { q: d.question }));
  const [done, setDone] = useState(false);
  const steps = useMemo(() => draftSteps(d, { review: { ownerId: owner || null, title, notes } }), [d, owner, title, notes]);
  return (
    <div className="draft-card" aria-label={t('Ask for a professional review')}>
      <p className="draft-tag">
        <Icon name="stethoscope" size={13} /> {t('Ask a professional on the team to review this question')}
      </p>
      <fieldset disabled={done} className="draft-fields">
        <Field label={t('Who should review it')}>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t('No owner yet')}</option>
            {d.ownerOptions.map((id) => {
              const u = view.users.find((x) => x.id === id);
              return u ? (
                <option key={id} value={id}>
                  {tc(u.name)} · {t(ROLE_LABEL[u.role])}
                </option>
              ) : null;
            })}
          </select>
        </Field>
        <Field label={t('Title')}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('Details')}>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </fieldset>
      <StepRunner steps={steps} confirmLabel="Confirm and send the request" disabled={title.trim().length < 3} onFinished={() => setDone(true)} />
    </div>
  );
}

/** Plain-text brief in the current language, with numbered sources, for saving as a document. */
export function briefText(a: AssistantAnswer, title: string, people: (id: string) => string): string {
  const num = (id: string) => a.sources.findIndex((s) => s.id === id) + 1;
  const lines: string[] = [title, '', tm(a.headline), ''];
  for (const b of a.blocks) {
    lines.push(tm(b.title));
    if (!b.lines.length && b.empty) lines.push(`- ${tm(b.empty)}`);
    for (const l of b.lines) lines.push(`- ${tm(l.m)}${l.cites.length ? ` [${l.cites.map(num).filter(Boolean).join(', ')}]` : ''}`);
    lines.push('');
  }
  for (const n of a.notes) lines.push(`* ${tm(n)}`);
  lines.push('', t('Sources'));
  a.sources.forEach((s, i) => lines.push(`[${i + 1}] ${tc(s.title)} — ${t(TYPE_LABEL[s.type])}, ${s.at ? dateTime(s.at) : ''}${s.by ? `, ${tc(people(s.by))}` : ''}`));
  lines.push('', t('Prepared by the SANAD assistant from recorded information only. It is not medical advice.'));
  return lines.join('\n');
}

function BriefSaver({ d, a }: { d: BriefDraft; a: AssistantAnswer }) {
  const { view } = useSession();
  const [title, setTitle] = useState(tm(d.title));
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const text = useMemo(() => briefText(a, title, (id) => userName(view, id)), [a, title, view]);
  const steps = useMemo(() => draftSteps(d, { brief: { title, text } }), [d, title, text]);
  if (!(view.access[d.recipientId] ?? []).includes(d.domain)) return null;
  return (
    <div className="draft-card">
      {!open ? (
        <button type="button" className="btn btn-light btn-sm" onClick={() => setOpen(true)}>
          <Icon name="file" size={14} /> {t('Save this brief to Documents')}
        </button>
      ) : (
        <>
          <p className="draft-tag">
            <Icon name="file" size={13} /> {t('Saved as a text document marked “AI-generated summary”, visible to people who can see this section.')}
          </p>
          <fieldset disabled={done} className="draft-fields">
            <Field label={t('Title')}>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </fieldset>
          <details>
            <summary className="small">{t('Preview the text')}</summary>
            <pre className="brief-pre" dir="auto">
              {text}
            </pre>
          </details>
          <StepRunner steps={steps} confirmLabel="Confirm and save" disabled={title.trim().length < 3} onFinished={() => setDone(true)} />
          {done && (
            <Link className="btn btn-light btn-sm" to={`/app/people/${d.recipientId}?tab=documents`}>
              {t('Open documents')}
            </Link>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- general problem questions (routing and playbooks)

function LegacyAnswer({ a, q, onAsk }: { a: Answer; q: string; onAsk: (text: string) => void }) {
  const { view } = useSession();
  return (
    <div className="answer">
      <p>{a.says.map((m) => tm(m)).join(' ')}</p>
      {a.preview && (
        <div className="route-card">
          <span className="route-to">
            <RoleTag role={a.preview.role} />
            <Icon name="arrow" size={14} />
            <Avatar user={view.users.find((u) => u.id === a.preview!.assigneeId)} size={24} />
            <strong>{a.preview.assigneeId ? tc(userName(view, a.preview.assigneeId)) : t('{role} queue', { role: t(ROLE_LABEL[a.preview.role]) })}</strong>
            <PriorityPill p={a.preview.priority} />
          </span>
          <small>{tm(a.preview.why[0])}</small>
          <Link className="btn btn-dark btn-sm" to={`/app/report?title=${encodeURIComponent(a.previewText ?? q)}`}>
            {t('Report this')}
          </Link>
        </div>
      )}
      {a.cards.length > 0 && (
        <div className="answer-cards">
          {a.cards.map((card) => {
            if (card.kind === 'challenge') {
              const c = view.challenges.find((x) => x.id === card.id);
              return c ? <ChallengeRow key={card.id} c={c} view={view} /> : null;
            }
            if (card.kind === 'playbook') {
              const p = view.playbooks.find((x) => x.id === card.id);
              return p ? (
                <Link key={card.id} to={`/app/playbooks?open=${p.id}`} className="pb-mini">
                  <Icon name="book" size={18} />
                  <span>
                    <strong>{tc(p.title)}</strong>
                    <small>{t('{n} steps · ~{min} min · worked {pct}% of {uses} times', { n: p.steps.length, min: p.minutes, pct: Math.round((p.successes / Math.max(1, p.uses)) * 100), uses: p.uses })}</small>
                  </span>
                </Link>
              ) : null;
            }
            const u = view.users.find((x) => x.id === card.id);
            return u ? (
              <Link key={card.id} to="/app/team" className="pb-mini">
                <Avatar user={u} size={30} />
                <span>
                  <strong>{tc(u.name)}</strong>
                  <small>{t('{role} · {state} · workload {n}', { role: t(ROLE_LABEL[u.role]), state: t(u.available ? 'available' : 'away'), n: view.loads[u.id] ?? 0 })}</small>
                </span>
              </Link>
            ) : null;
          })}
        </div>
      )}
      {a.suggestions.length > 0 && (
        <div className="follow">
          {a.suggestions.map((s) => (
            <button key={s.k} type="button" className="chip" onClick={() => onAsk(tm(s))}>
              {tm(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- full page

export function AssistantPage({ initial }: { initial?: AskOptions | null }) {
  const conv = useConversation();
  const page = { recipientId: initial?.recipientId ?? null, tab: null };
  const asked = useRef(false);
  useEffect(() => {
    if (initial?.question && !asked.current) {
      asked.current = true;
      conv.ask(initial.question, initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  return <Conversation conv={conv} context={page} />;
}

/** A small button that opens the assistant with a prepared request ("Prepare a brief", "Draft a plan"…). */
export function AskButton({ label, question, intent, recipientId, targetId, className = 'btn btn-light btn-sm' }: { label: string; question: string; intent: Intent; recipientId: string; targetId?: string; className?: string }) {
  const { open } = useAssistant();
  const { me } = useSession();
  if (me.role === 'admin') return null;
  return (
    <button type="button" className={className} onClick={() => open({ question, intent, recipientId, targetId })}>
      <Sparkle size={14} /> {label}
    </button>
  );
}
