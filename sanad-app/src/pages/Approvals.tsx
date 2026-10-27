import { Link } from 'react-router-dom';
import { ROLE_LABEL, type Action, type Approval, type Domain } from '../../shared/types';
import { DOMAIN_LABEL, SENSITIVE } from '../../shared/access';
import { useSession } from '../lib/store';
import { t, tc, tm } from '../lib/i18n';
import { dateTime, timeAgo } from '../lib/format';
import { DomainChips, STATUS_TXT } from '../components/careteam';
import { Empty, Icon } from '../components/ui';

/** What the approval would change, in plain words, from the exact stored action. */
function Details({ a }: { a: Approval }) {
  const { view } = useSession();
  const act = a.action as Action;
  const r = view.recipients.find((x) => x.id === a.recipientId);
  let who = '';
  let domains: Domain[] = [];
  let extra = '';
  if (act.type === 'invite_member') {
    who = `${act.email} · ${t(ROLE_LABEL[act.role])}`;
    domains = act.domains;
    extra = act.accessDays ? t('Access ends {n} days after they accept', { n: act.accessDays }) : t('Access lasts until it is removed');
  } else if (act.type === 'set_access') {
    const m = view.memberships.find((x) => x.id === act.membershipId);
    const u = view.users.find((x) => x.id === m?.userId);
    who = tc(u?.name ?? '');
    domains = act.domains;
    const added = act.domains.filter((d) => !m?.domains.includes(d));
    if (added.length) extra = t('Adds: {domains}', { domains: added.map((d) => t(DOMAIN_LABEL[d])).join(', ') });
  }
  const sensitive = domains.filter((d) => SENSITIVE.includes(d));
  return (
    <dl className="facts approval-facts">
      <dt>{t('Person affected')}</dt>
      <dd>{r ? <Link to={`/app/people/${r.id}`}>{tc(r.name)}</Link> : '—'}</dd>
      <dt>{t('Who gets access')}</dt>
      <dd>{who}</dd>
      <dt>{t('Information involved')}</dt>
      <dd>
        <DomainChips domains={domains} />
        {sensitive.length > 0 && <small className="muted block">{t('Includes sensitive information: {domains}', { domains: sensitive.map((d) => t(DOMAIN_LABEL[d])).join(', ') })}</small>}
      </dd>
      {extra && (
        <>
          <dt>{t('Details')}</dt>
          <dd>{extra}</dd>
        </>
      )}
      {a.reason && (
        <>
          <dt>{t('Reason given')}</dt>
          <dd>{tc(a.reason)}</dd>
        </>
      )}
      <dt>{t('Can it be undone?')}</dt>
      <dd>{t(a.reversible ? 'Yes — access can be removed at any time from the Care team tab.' : 'No')}</dd>
    </dl>
  );
}

function ApprovalCard({ a }: { a: Approval }) {
  const { view, me, act, now } = useSession();
  const requester = view.users.find((u) => u.id === a.requestedBy);
  const mine = a.approverIds.includes(me.id) && a.status === 'pending';
  const expired = a.status === 'pending' && a.expiresAt < now;
  return (
    <article className={`panel approval-card approval-${a.status}`} aria-labelledby={`ap-${a.id}`}>
      <header className="panel-head">
        <h2 id={`ap-${a.id}`}>{tm(a.summary)}</h2>
        <span className={`status-pill status-${expired ? 'expired' : a.status}`}>{t(STATUS_TXT[expired ? 'expired' : a.status])}</span>
      </header>
      <p className="small muted">
        {t('Asked by {name} {ago}', { name: tc(requester?.name ?? ''), ago: timeAgo(a.createdAt, now) })}
        {a.status === 'pending' && !expired && <> · {t('Expires {date}', { date: dateTime(a.expiresAt) })}</>}
        {a.decidedAt && <> · {t('Decided {ago}', { ago: timeAgo(a.decidedAt, now) })}</>}
      </p>
      <Details a={a} />
      {a.error && <p className="form-error">{tm(a.error)}</p>}
      {mine && !expired && (
        <div className="row gap-s wrap">
          <button type="button" className="btn btn-dark" onClick={() => act({ type: 'decide_approval', approvalId: a.id, decision: 'approve', fingerprint: a.fingerprint })}>
            <Icon name="check" size={16} /> {t('Approve')}
          </button>
          <button type="button" className="btn btn-light" onClick={() => act({ type: 'decide_approval', approvalId: a.id, decision: 'reject', fingerprint: a.fingerprint })}>
            {t('Decline')}
          </button>
          <small className="muted">{t('Approving runs exactly this change once. If anything about it changes, a new approval is needed.')}</small>
        </div>
      )}
      {a.requestedBy === me.id && a.status === 'pending' && !expired && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => act({ type: 'cancel_approval', approvalId: a.id })}>
          {t('Cancel request')}
        </button>
      )}
    </article>
  );
}

export function Approvals() {
  const { view, me, act, now } = useSession();
  const forMe = view.approvals.filter((a) => a.approverIds.includes(me.id) && a.status === 'pending' && a.expiresAt >= now).sort((a, b) => a.expiresAt - b.expiresAt);
  const others = view.approvals.filter((a) => !forMe.includes(a)).sort((a, b) => b.createdAt - a.createdAt);
  const invites = view.invites.filter((i) => i.email === me.email.toLowerCase() && i.status === 'pending' && i.expiresAt > now);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">{t('Approvals')}</h1>
          <p className="muted">{t('Requests that need your consent, invitations for you, and the requests you made. Nothing in a request happens until it is approved.')}</p>
        </div>
      </header>

      {invites.length > 0 && (
        <section className="panel" aria-labelledby="my-inv-h">
          <header className="panel-head">
            <h2 id="my-inv-h">{t('Invitations for you')}</h2>
          </header>
          <ul className="invites">
            {invites.map((i) => {
              const r = view.recipients.find((x) => x.id === i.recipientId);
              const by = view.users.find((u) => u.id === i.invitedBy);
              return (
                <li key={i.id} className="invite">
                  <div>
                    <strong>{t('Join {name}’s care team', { name: tc(r?.name ?? t('a person')) })}</strong>
                    <small className="muted block">{t('From {name} · as {role}', { name: tc(by?.name ?? ''), role: t(ROLE_LABEL[i.role]) })}</small>
                    <DomainChips domains={i.domains} />
                  </div>
                  <button type="button" className="btn btn-dark btn-sm" onClick={() => act({ type: 'accept_invite', code: i.code })}>
                    {t('Accept')}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <h2 className="section-title">{t('Waiting for you')}</h2>
      {forMe.length ? forMe.map((a) => <ApprovalCard key={a.id} a={a} />) : <Empty icon="check" title="Nothing waiting for your approval" />}

      {others.length > 0 && (
        <>
          <h2 className="section-title">{t('Other requests')}</h2>
          {others.map((a) => (
            <ApprovalCard key={a.id} a={a} />
          ))}
        </>
      )}
    </div>
  );
}
