import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, STAGES, STAGE_LABEL, isHousehold, type Challenge } from '../../shared/types';
import { alertsFor, myPeople, nextDose } from '../lib/people';
import { isOrgStaff } from '../../shared/access';
import { isActive } from '../../shared/routing';
import { nextActions, type NextAction } from '../../shared/intelligence';
import { metrics } from '../../shared/analytics';
import { userName } from '../../shared/engine';
import { useSession } from '../lib/store';
import { t, tc, tm, tn } from '../lib/i18n';
import { greeting, firstName, recipientName, timeAgo } from '../lib/format';
import { ROLE_CONFIG } from '../lib/roles';
import { useActions } from '../components/actions';
import { Avatar, ChallengeRow, Empty, Icon, Sparkle } from '../components/ui';
import { CareTags } from '../components/CareProfile';

export function Dashboard() {
  const { view, me, now } = useSession();
  const { run } = useActions();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const actions = useMemo(() => nextActions(view, now), [view, now]);
  const cfg = ROLE_CONFIG[me.role];
  const isCoord = me.role === 'coordinator';
  const isFamily = isHousehold(me.role);
  const mine = view.challenges.filter((c) => (isFamily ? me.recipients.includes(c.recipientId) : isCoord ? true : c.assigneeId === me.id || c.reporterId === me.id));
  const m = metrics(mine, now);
  const top = actions[0];

  const subline = me.role === 'self'
    ? t('Here’s your care at a glance.')
    : isFamily
    ? t(me.recipients.length > 1 ? 'Here’s how {names} are doing today.' : 'Here’s how {names} is doing today.', {
        names: me.recipients.map((r) => recipientName(view, r).split(' ')[0]).join(` ${t('and')} `),
      })
    : actions.length
      ? tn('{n} thing needs you today.', '{n} things need you today.', actions.length)
      : t('Nothing needs you right now.');

  const ask = (e: FormEvent) => {
    e.preventDefault();
    nav(`/app/intelligence${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  };

  const isAdmin = me.role === 'admin';
  const pendingForMe = view.approvals.filter((a) => a.status === 'pending' && a.approverIds.includes(me.id) && a.expiresAt >= now).length;
  const invitesForMe = view.invites.filter((i) => i.status === 'pending' && i.email === me.email.toLowerCase() && i.expiresAt > now).length;
  const orgPeople = myPeople(view);
  const unverified = view.memberships.filter((x) => x.status === 'active' && x.authority !== 'none' && !x.authorityVerified && orgPeople.some((r) => r.id === x.recipientId)).length;
  const tiles = isAdmin
    ? [
        { label: 'People in your organisation', value: orgPeople.length, to: '/app/people' },
        { label: 'Authority waiting to be verified', value: unverified, to: '/app/people', alert: unverified > 0 },
        { label: 'Invitations waiting', value: view.invites.filter((i) => i.status === 'pending' && i.expiresAt > now).length, to: '/app/people' },
        { label: 'Access requests waiting', value: view.approvals.filter((a) => a.status === 'pending').length, to: '/app/approvals' },
      ]
    : isCoord
    ? [
        { label: 'Open across the network', value: m.open, to: '/app/challenges?scope=all' },
        { label: 'Waiting for triage', value: view.challenges.filter((c) => isActive(c) && (c.stage === 'reported' || !c.assigneeId)).length, to: '/app/challenges?stage=reported' },
        { label: 'Escalated', value: m.escalated, to: '/app/challenges?flag=escalated', alert: m.escalated > 0 },
        { label: 'Solved within response time', value: m.slaCompliance === null ? '—' : `${m.slaCompliance}%`, to: '/app/analytics' },
      ]
    : isFamily
      ? [
          { label: 'Open requests', value: m.open, to: '/app/challenges' },
          { label: 'Waiting for your confirmation', value: view.challenges.filter((c) => c.stage === 'resolved' && me.recipients.includes(c.recipientId)).length, to: '/app/challenges?stage=resolved' },
          { label: 'Solved this week', value: m.resolved7, to: '/app/challenges?stage=verified' },
          { label: 'Average rating you gave', value: m.avgRating ?? '—', to: '/app/analytics' },
        ]
      : [
          { label: 'Assigned to you', value: view.challenges.filter((c) => c.assigneeId === me.id && isActive(c)).length, to: '/app/challenges?scope=mine' },
          { label: 'Due within 4 hours', value: view.challenges.filter((c) => c.assigneeId === me.id && isActive(c) && c.dueAt - now < 4 * 3.6e6).length, to: '/app/challenges?scope=mine&sort=due' },
          { label: 'In your team queue', value: view.challenges.filter((c) => c.role === me.role && !c.assigneeId && isActive(c)).length, to: '/app/challenges?scope=team' },
          { label: 'Solved this week', value: m.resolved7, to: '/app/analytics' },
        ];

  const activity = view.challenges
    .flatMap((c) => c.history.map((h) => ({ h, c })))
    .sort((a, b) => b.h.at - a.h.at)
    .slice(0, 7);

  return (
    <div className="page">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="grad-label">{isFamily ? t('Care circle · {title}', { title: tc(me.title) }) : `${t(ROLE_LABEL[me.role])} · ${tc(me.org)}`}</p>
          <h1 className="display">
            {t('{greeting}, {name}', { greeting: greeting(now), name: firstName(me.name) })}
          </h1>
          <p className="lede">{subline}</p>
          <form className="ask-big" onSubmit={ask}>
            <Sparkle size={20} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isFamily ? 'How is Mum doing today?' : 'What should I focus on next?'} aria-label="Ask SANAD" />
            <button type="submit" className="btn btn-dark btn-sm">
              Ask
            </button>
          </form>
        </div>
        <div className="spotlight">
          <span className="spot-label">
            <Sparkle size={14} /> Next best action
          </span>
          {top ? (
            <>
              <Link to={`/app/challenges/${top.challenge.id}`} className="spot-title">
                {top.challenge.title}
              </Link>
              <p className="spot-why">
                {top.challenge.ref} · {recipientName(view, top.challenge.recipientId)} · {tm(top.whyM)}
              </p>
              <div className="row gap-s">
                <button type="button" className="btn btn-dark" onClick={() => run(top.kind, top.challenge)}>
                  {tm(top.labelM)}
                </button>
                <Link className="btn btn-light" to={`/app/challenges/${top.challenge.id}`}>
                  Open
                </Link>
              </div>
            </>
          ) : (
            <>
              <strong className="spot-title">You’re all caught up</strong>
              <p className="spot-why">New challenges routed to you will appear here first.</p>
              {isAdmin ? (
                <Link className="btn btn-dark" to="/app/people">
                  {t('Review care teams')}
                </Link>
              ) : (
                <Link className="btn btn-dark" to="/app/report">
                  Report a challenge
                </Link>
              )}
            </>
          )}
        </div>
      </section>

      {(pendingForMe > 0 || invitesForMe > 0) && (
        <Link to="/app/approvals" className="callout callout-warn">
          <Icon name="shield" size={18} />
          <span>
            <strong>{t(pendingForMe ? (pendingForMe === 1 ? '1 request needs your approval' : '{n} requests need your approval') : invitesForMe === 1 ? 'You have 1 invitation to a care team' : 'You have {n} invitations to care teams', { n: pendingForMe || invitesForMe })}</strong>
            <small>{t('Nothing changes until you decide.')}</small>
          </span>
        </Link>
      )}

      <section className="tiles" aria-label="Key numbers">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className={`tile ${'alert' in t && t.alert ? 'tile-alert' : ''}`}>
            <span className="tile-value">{t.value}</span>
            <span className="tile-label">{t.label}</span>
          </Link>
        ))}
      </section>

      <div className="cols">
        <section className="panel">
          <header className="panel-head">
            <h2>{isFamily ? 'Your requests' : 'Your queue'}</h2>
            <Link to="/app/challenges" className="link">
              All challenges
            </Link>
          </header>
          {isFamily ? (
            <div className="rows">
              {actions.slice(0, 6).map((a) => (
                <QueueRow key={a.challenge.id} a={a} />
              ))}
              {mine
                .filter((c) => isActive(c) && !actions.some((a) => a.challenge.id === c.id))
                .slice(0, 6)
                .map((c) => (
                  <ChallengeRow key={c.id} c={c} view={view} />
                ))}
              {!actions.length && !mine.filter(isActive).length && <Empty title="Everything is calm" text="When something comes up, report it and SANAD finds the right person." action={<Link to="/app/report" className="btn btn-dark btn-sm">Report a challenge</Link>} />}
            </div>
          ) : actions.length ? (
            <div className="rows">
              {actions.slice(0, 6).map((a) => (
                <QueueRow key={a.challenge.id} a={a} />
              ))}
            </div>
          ) : (
            <Empty title="Queue clear" text="Nothing is waiting on you. New work routed to you lands here." />
          )}
        </section>

        <aside className="stack">
          {!isOrgStaff(me) && myPeople(view).length > 0 && <PeoplePanel />}
          {isCoord && <TeamLoad />}
          {!isFamily && !isCoord && <Pulse items={view.challenges.filter((c) => c.assigneeId === me.id)} />}
          <section className="panel">
            <header className="panel-head">
              <h2>Quick report</h2>
            </header>
            <p className="muted small">{cfg.focus}</p>
            <div className="quick">
              {cfg.templates.map((t, i) => (
                <Link key={t.label} to={`/app/report?t=${i}`} className="quick-btn">
                  <Icon name="plus" size={14} /> {t.label}
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>Latest activity</h2>
        </header>
        {activity.length ? (
          <ul className="feed">
            {activity.map(({ h, c }) => (
              <li key={h.id}>
                {h.actorId === 'system' ? <span className="feed-sys"><Sparkle size={14} /></span> : <Avatar user={view.users.find((u) => u.id === h.actorId)} size={28} />}
                <span>
                  <Link to={`/app/challenges/${c.id}`}>
                    <strong>{c.ref}</strong> {h.m ? tm(h.m) : h.text}
                  </Link>
                  <small>{timeAgo(h.at, now)}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No activity yet" />
        )}
      </section>
    </div>
  );
}

function QueueRow({ a }: { a: NextAction }) {
  const { view } = useSession();
  const { run } = useActions();
  return (
    <ChallengeRow
      c={a.challenge}
      view={view}
      action={
        <button type="button" className={`btn btn-sm ${a.kind === 'continue' || a.kind === 'review' ? 'btn-light' : 'btn-dark'}`} onClick={() => run(a.kind, a.challenge)}>
          {tm(a.labelM)}
        </button>
      }
    />
  );
}

function PeoplePanel() {
  const { view, me, now } = useSession();
  return (
    <section className="panel panel-tint">
      <header className="panel-head">
        <h2>{t(me.role === 'self' ? 'My care' : isHousehold(me.role) ? 'People you care for' : 'Your people')}</h2>
        <Link to="/app/people" className="link small">
          {t('See all')}
        </Link>
      </header>
      {myPeople(view).map((r) => {
        const rid = r.id;
        const open = view.challenges.filter((c: Challenge) => c.recipientId === rid && isActive(c));
        const team = [...new Set(open.map((c) => c.assigneeId).filter(Boolean))] as string[];
        const warn = alertsFor(view, r, now).filter((a) => a.tone === 'warn');
        const next = nextDose(view, rid, now);
        return (
          <Link key={rid} to={`/app/people/${rid}`} className="person">
            <span className="person-ava">{r.name[0]}</span>
            <span className="person-body">
              <strong>{r.name}</strong>
              <small>{t('Age {age} · {area}', { age: r.age, area: tc(r.area) })}</small>
              <CareTags r={r} compact />
              {warn.map((a) => (
                <span key={a.key} className="person-alert">
                  <Icon name="flag" size={12} /> {t(a.text, a.vars)}
                </span>
              ))}
              {next && (
                <span className="person-stats">
                  {t('Next medicine: {med} at {time}', { med: tc(next.med.name), time: next.slot.slice(11) })}
                </span>
              )}
              <span className="person-stats">
                {open.length ? t('{n} open · {h} high priority', { n: open.length, h: open.filter((c) => c.priority === 'urgent' || c.priority === 'high').length }) : t('No open challenges')}
              </span>
              {team.length > 0 && (
                <span className="ava-stack">
                  {team.map((id) => (
                    <Avatar key={id} user={view.users.find((u) => u.id === id)} size={24} />
                  ))}
                  <small>working on it</small>
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </section>
  );
}

function TeamLoad() {
  const { view } = useSession();
  const staff = view.users.filter((u) => u.role !== 'family' && u.role !== 'coordinator');
  const max = Math.max(6, ...staff.map((u) => view.loads[u.id] ?? 0));
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Team load</h2>
        <Link to="/app/team" className="link">
          Manage
        </Link>
      </header>
      <ul className="loads">
        {staff
          .sort((a, b) => (view.loads[b.id] ?? 0) - (view.loads[a.id] ?? 0))
          .map((u) => {
            const l = view.loads[u.id] ?? 0;
            return (
              <li key={u.id} title={t('{name}: workload {n} (urgent counts 4, high 3, medium 2, low 1)', { name: tc(u.name), n: l })}>
                <Avatar user={u} size={26} />
                <span className="load-name">
                  {u.name}
                  <small>{u.available ? ROLE_LABEL[u.role] : 'Away'}</small>
                </span>
                <span className="load-bar">
                  <span style={{ width: `${(l / max) * 100}%` }} className={l / max > 0.7 ? 'hot' : ''} />
                </span>
                <b>{l}</b>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

function Pulse({ items }: { items: Challenge[] }) {
  const { view, me } = useSession();
  const counts = STAGES.slice(1, 5).map((s) => ({ s, n: items.filter((c) => c.stage === s).length }));
  const team = view.challenges.filter((c) => c.role === me.role && isActive(c) && c.assigneeId && c.assigneeId !== me.id);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Your workflow</h2>
      </header>
      <div className="pulse">
        {counts.map(({ s, n }) => (
          <Link key={s} to={`/app/challenges?scope=mine&stage=${s}`} className="pulse-cell">
            <b>{n}</b>
            <small>{STAGE_LABEL[s]}</small>
          </Link>
        ))}
      </div>
      {team.length > 0 && (
        <p className="muted small">
          {t('Teammates are handling {n} more: {names}.', { n: team.length, names: [...new Set(team.map((c) => tc(userName(view, c.assigneeId))))].join('، ') })}
        </p>
      )}
    </section>
  );
}
