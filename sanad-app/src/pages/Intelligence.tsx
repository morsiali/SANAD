import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ROLE_LABEL } from '../../shared/types';
import { ask, STARTERS, type Answer } from '../../shared/intelligence';
import { t, tc, tm } from '../lib/i18n';
import { userName } from '../../shared/engine';
import { useSession } from '../lib/store';
import { Avatar, ChallengeRow, Icon, PriorityPill, RoleTag, Sparkle } from '../components/ui';

interface Turn {
  id: number;
  q: string;
  a: Answer;
}


export function Intelligence() {
  const { view, now } = useSession();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const counter = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = (text: string) => {
    const question = text.trim();
    if (!question) return;
    setTurns((prev) => [...prev, { id: ++counter.current, q: question, a: ask(view, question, now) }]);
    setQ('');
  };

  useEffect(() => {
    const initial = sp.get('q');
    if (initial) {
      send(initial);
      setSp({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(q);
    inputRef.current?.focus();
  };

  return (
    <div className="page intel-page">
      <section className="intel-hero">
        <Sparkle size={40} />
        <h1 className="display">Don’t search. Just ask.</h1>
        <p className="lede">SANAD Intelligence reads every challenge, playbook and team calendar you can see, and answers in plain language. It runs inside SANAD — nothing is sent anywhere else.</p>
      </section>

      <div className="convo" aria-live="polite">
        {turns.length === 0 && (
          <div className="starters">
            {STARTERS.map((s) => (
              <button key={s.k} type="button" className="starter" onClick={() => send(tm(s))}>
                <Sparkle size={14} /> {tm(s)}
              </button>
            ))}
          </div>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="turn">
            <p className="turn-q">{turn.q}</p>
            <div className="turn-a">
              <span className="turn-ava">
                <Sparkle size={18} />
              </span>
              <div className="turn-body">
                <p>{turn.a.says.map((m) => tm(m)).join(' ')}</p>
                {turn.a.preview && (
                  <div className="route-card">
                    <span className="route-to">
                      <RoleTag role={turn.a.preview.role} />
                      <Icon name="arrow" size={14} />
                      <Avatar user={view.users.find((u) => u.id === turn.a.preview!.assigneeId)} size={24} />
                      <strong>{turn.a.preview.assigneeId ? tc(userName(view, turn.a.preview.assigneeId)) : t('{role} queue', { role: t(ROLE_LABEL[turn.a.preview.role]) })}</strong>
                      <PriorityPill p={turn.a.preview.priority} />
                    </span>
                    <small>{tm(turn.a.preview.why[0])}</small>
                    <Link className="btn btn-dark btn-sm" to={`/app/report?title=${encodeURIComponent(turn.a.previewText ?? turn.q)}`}>
                      Report this
                    </Link>
                  </div>
                )}
                {turn.a.cards.length > 0 && (
                  <div className="answer-cards">
                    {turn.a.cards.map((card) => {
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
                              <strong>{p.title}</strong>
                              <small>
                                {t('{n} steps · ~{min} min · worked {pct}% of {uses} times', { n: p.steps.length, min: p.minutes, pct: Math.round((p.successes / Math.max(1, p.uses)) * 100), uses: p.uses })}
                              </small>
                            </span>
                          </Link>
                        ) : null;
                      }
                      const u = view.users.find((x) => x.id === card.id);
                      return u ? (
                        <Link key={card.id} to="/app/team" className="pb-mini">
                          <Avatar user={u} size={30} />
                          <span>
                            <strong>{u.name}</strong>
                            <small>
                              {t('{role} · {state} · workload {n}', { role: t(ROLE_LABEL[u.role]), state: t(u.available ? 'available' : 'away'), n: view.loads[u.id] ?? 0 })}
                            </small>
                          </span>
                        </Link>
                      ) : null;
                    })}
                  </div>
                )}
                {turn.a.suggestions.length > 0 && (
                  <div className="follow">
                    {turn.a.suggestions.map((s) => (
                      <button key={s.k} type="button" className="chip" onClick={() => send(tm(s))}>
                        {tm(s)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="ask-dock" onSubmit={onSubmit}>
        <Sparkle size={20} />
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a person, a problem, or a SAN number" aria-label="Ask SANAD" autoFocus />
        {turns.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTurns([])}>
            Clear
          </button>
        )}
        <button type="submit" className="btn btn-dark" disabled={!q.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
