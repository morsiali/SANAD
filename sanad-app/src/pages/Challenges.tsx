import { useMemo, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CATEGORY_LABEL, PRIORITIES, STAGES, STAGE_LABEL, type Category, type Challenge, type Stage } from '../../shared/types';
import { isActive, PRIORITY_WEIGHT } from '../../shared/routing';
import { useSession } from '../lib/store';
import { t, tc, tm, tn } from '../lib/i18n';
import { recipientName } from '../lib/format';
import { useActions } from '../components/actions';
import { Avatar, ChallengeRow, Empty, Icon, PriorityPill, SlaBadge } from '../components/ui';

const VIEW_KEY = 'sanad.challenges.view';

export function Challenges() {
  const { view, me, act } = useSession();
  const { run } = useActions();
  const [sp, setSp] = useSearchParams();
  const [layout, setLayout] = useState<'list' | 'board'>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as 'list' | 'board') || 'list';
    } catch {
      return 'list';
    }
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);

  const defaultScope = me.role === 'coordinator' || me.role === 'family' ? 'all' : 'mine';
  const scope = sp.get('scope') ?? defaultScope;
  const stage = sp.get('stage') ?? '';
  const priority = sp.get('priority') ?? '';
  const category = sp.get('category') ?? '';
  const person = sp.get('person') ?? '';
  const flag = sp.get('flag') ?? '';
  const sort = sp.get('sort') ?? 'urgency';
  const q = sp.get('q') ?? '';
  const showClosed = sp.get('closed') === '1' || stage === 'resolved' || stage === 'verified';

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  const changeLayout = (l: 'list' | 'board') => {
    setLayout(l);
    try {
      localStorage.setItem(VIEW_KEY, l);
    } catch {
      /* ignore */
    }
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = view.challenges.filter((c) => {
      if (scope === 'mine' && c.assigneeId !== me.id) return false;
      if (scope === 'team' && !(c.role === me.role && isActive(c))) return false;
      if (scope === 'reported' && c.reporterId !== me.id) return false;
      if (stage && c.stage !== stage) return false;
      if (!stage && !showClosed && layout === 'list' && !isActive(c)) return false;
      if (priority && c.priority !== priority) return false;
      if (category && c.category !== category) return false;
      if (person && c.recipientId !== person) return false;
      if (flag === 'escalated' && !(c.escalated && isActive(c))) return false;
      if (flag === 'overdue' && !(isActive(c) && c.dueAt < Date.now())) return false;
      if (needle && !`${c.ref} ${c.title} ${c.description} ${recipientName(view, c.recipientId)}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const by: Record<string, (a: Challenge, b: Challenge) => number> = {
      urgency: (a, b) => Number(b.escalated) - Number(a.escalated) || PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || a.dueAt - b.dueAt,
      due: (a, b) => a.dueAt - b.dueAt,
      newest: (a, b) => b.createdAt - a.createdAt,
      updated: (a, b) => b.updatedAt - a.updatedAt,
    };
    out = [...out].sort(by[sort] ?? by.urgency);
    return out;
  }, [view, me, scope, stage, priority, category, person, flag, sort, q, showClosed, layout]);

  const scopes = [
    ...(me.role === 'family' ? [] : [{ k: 'mine', label: 'Assigned to me' }]),
    ...(me.role === 'family' || me.role === 'coordinator' ? [] : [{ k: 'team', label: 'My team' }]),
    { k: 'reported', label: 'Reported by me' },
    { k: 'all', label: me.role === 'coordinator' ? 'Everything' : 'All I can see' },
  ];
  const filtersOn = [stage, priority, category, person, flag, q].some(Boolean);

  const onDrop = async (target: Stage, droppedId: string) => {
    const c = view.challenges.find((x) => x.id === (droppedId || dragId));
    setDragId(null);
    setOverStage(null);
    if (!c || c.stage === target) return;
    if (target === 'resolved') return run('resolve', c);
    if (target === 'verified') return c.stage === 'resolved' ? run('verify', c) : void act({ type: 'move', id: c.id, stage: target });
    if (target === 'accepted' && c.stage === 'routed') return run(c.assigneeId === me.id ? 'accept' : 'claim', c);
    if (target === 'in_progress' && (c.stage === 'accepted' || c.stage === 'routed')) return run('start', c);
    if (target === 'in_progress' && (c.stage === 'resolved' || c.stage === 'verified')) return run('reopen', c);
    await act({ type: 'move', id: c.id, stage: target });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">Challenges</h1>
          <p className="muted">Every problem, who owns it, and how close it is to solved.</p>
        </div>
        <div className="row gap-s">
          <div className="seg" role="group" aria-label="Layout">
            <button type="button" className={layout === 'list' ? 'on' : ''} onClick={() => changeLayout('list')} aria-pressed={layout === 'list'}>
              <Icon name="list" size={16} /> List
            </button>
            <button type="button" className={layout === 'board' ? 'on' : ''} onClick={() => changeLayout('board')} aria-pressed={layout === 'board'}>
              <Icon name="board" size={16} /> Board
            </button>
          </div>
          <Link to="/app/report" className="btn btn-dark">
            <Icon name="plus" size={16} /> Report
          </Link>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Scope">
        {scopes.map((s) => (
          <button key={s.k} type="button" role="tab" aria-selected={scope === s.k} className={`tab ${scope === s.k ? 'tab-on' : ''}`} onClick={() => set('scope', s.k)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="filters">
        <label className="search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => set('q', e.target.value)} placeholder="Search title, person or SAN number" aria-label="Search challenges" />
        </label>
        {layout === 'list' && (
          <select value={stage} onChange={(e) => set('stage', e.target.value)} aria-label="Stage">
            <option value="">Open stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        <select value={priority} onChange={(e) => set('priority', e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p[0].toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => set('category', e.target.value)} aria-label="Category">
          <option value="">Any category</option>
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((k) => (
            <option key={k} value={k}>
              {CATEGORY_LABEL[k]}
            </option>
          ))}
        </select>
        <select value={person} onChange={(e) => set('person', e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {view.recipients
            .filter((r) => me.role !== 'family' || me.recipients.includes(r.id))
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>
        <select value={flag} onChange={(e) => set('flag', e.target.value)} aria-label="Flag">
          <option value="">Any status</option>
          <option value="escalated">Escalated</option>
          <option value="overdue">Overdue</option>
        </select>
        <select value={sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
          <option value="urgency">Most urgent first</option>
          <option value="due">Due soonest</option>
          <option value="newest">Newest</option>
          <option value="updated">Recently updated</option>
        </select>
        {layout === 'list' && !stage && (
          <label className="check">
            <input type="checkbox" checked={showClosed} onChange={(e) => set('closed', e.target.checked ? '1' : '')} /> Include solved
          </label>
        )}
        {filtersOn && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSp(new URLSearchParams(scope !== defaultScope ? { scope } : {}), { replace: true })}>
            Clear filters
          </button>
        )}
      </div>

      {layout === 'list' ? (
        <section className="panel" aria-live="polite">
          <p className="count">
            {tn('{n} challenge', '{n} challenges', list.length)}
          </p>
          {list.length ? (
            <div className="rows">
              {list.map((c) => (
                <ChallengeRow key={c.id} c={c} view={view} />
              ))}
            </div>
          ) : (
            <Empty icon="search" title="No challenges match" text="Try another scope or clear the filters." action={filtersOn ? <button type="button" className="btn btn-light btn-sm" onClick={() => setSp(new URLSearchParams(), { replace: true })}>Clear filters</button> : <Link className="btn btn-dark btn-sm" to="/app/report">Report a challenge</Link>} />
          )}
        </section>
      ) : (
        <div className="board" aria-label="Workflow board">
          {STAGES.map((s) => {
            const items = list.filter((c) => c.stage === s);
            return (
              <section
                key={s}
                className={`col ${overStage === s ? 'col-over' : ''}`}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault();
                  setOverStage(s);
                }}
                onDragLeave={() => setOverStage((o) => (o === s ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  void onDrop(s, e.dataTransfer.getData('text/plain'));
                }}
                aria-label={STAGE_LABEL[s]}
              >
                <header>
                  <h2>{STAGE_LABEL[s]}</h2>
                  <span>{items.length}</span>
                </header>
                <div className="col-body">
                  {items.map((c) => (
                    <Link
                      key={c.id}
                      to={`/app/challenges/${c.id}`}
                      className={`card ${c.escalated && isActive(c) ? 'card-esc' : ''} ${dragId === c.id ? 'card-drag' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        setDragId(c.id);
                        e.dataTransfer.setData('text/plain', c.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                    >
                      <span className="card-top">
                        <span className="ref">{c.ref}</span>
                        <PriorityPill p={c.priority} />
                      </span>
                      <strong>{c.title}</strong>
                      <small>{recipientName(view, c.recipientId)}</small>
                      <span className="card-foot">
                        <Avatar user={view.users.find((u) => u.id === c.assigneeId)} size={24} />
                        <SlaBadge c={c} />
                      </span>
                    </Link>
                  ))}
                  {!items.length && <p className="col-empty">Drop here</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {layout === 'board' && <p className="muted small">Drag a card to move it through the workflow. Resolving asks for a note; closing is done by the reporter or family.</p>}
    </div>
  );
}
