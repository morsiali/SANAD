import { useState } from 'react';
import { ROLES, ROLE_LABEL, type Approval, type Domain, type Membership, type Role } from '../../shared/types';
import { DOMAINS, DOMAIN_HINT, DOMAIN_LABEL, ROLE_DOMAINS, SENSITIVE, authorityHolders, canManageTeam, hasAuthority, isLive, isOrgStaff } from '../../shared/access';
import { useSession } from '../lib/store';
import { isAr, t, tc, tm } from '../lib/i18n';
import { dateTime, timeAgo } from '../lib/format';
import { Avatar, Empty, Field, Icon, Modal, RoleTag } from './ui';

const domainNames = (ds: Domain[]) => ds.map((d) => t(DOMAIN_LABEL[d])).join(isAr() ? '، ' : ', ');

export function DomainChips({ domains }: { domains: Domain[] }) {
  return (
    <div className="tags">
      {domains.map((d) => (
        <span key={d} className={`chip chip-static ${SENSITIVE.includes(d) ? 'chip-sens' : ''}`}>
          {t(DOMAIN_LABEL[d])}
        </span>
      ))}
    </div>
  );
}

function AuthorityBadge({ m }: { m: Membership }) {
  if (m.authority === 'none') return null;
  const label = m.authority === 'self' ? 'Own authority' : 'Guardian';
  return (
    <span className={`ver-badge ${m.authorityVerified ? 'ver-yes' : 'ver-no'}`} title={m.authorityEvidence ? tc(m.authorityEvidence) : undefined}>
      <Icon name="shield" size={12} /> {t(label)} · {t(m.authorityVerified ? 'verified' : 'waiting for verification')}
    </span>
  );
}

/** Domain checkboxes with plain-language hints. Private therapy notes are only offered for psychologists. */
function DomainPicker({ value, onChange, role, idPrefix }: { value: Domain[]; onChange: (d: Domain[]) => void; role: Role; idPrefix: string }) {
  return (
    <fieldset className="checks domain-picker">
      <legend>{t('What they can see')}</legend>
      {DOMAINS.filter((d) => d !== 'wellbeing_notes' || role === 'psychologist').map((d) => (
        <label key={d} className="check">
          <input
            id={`${idPrefix}-${d}`}
            type="checkbox"
            checked={value.includes(d)}
            disabled={d === 'overview'}
            onChange={(e) => onChange(e.target.checked ? DOMAINS.filter((x) => x === d || value.includes(x)) : value.filter((x) => x !== d))}
          />
          <span>
            {t(DOMAIN_LABEL[d])}
            <small className="muted block">{t(DOMAIN_HINT[d])}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Explains whose consent a change needs, before the user submits it. */
function ConsentNote({ recipientId, adding, evidence, setEvidence }: { recipientId: string; adding: Domain[]; evidence: string; setEvidence: (v: string) => void }) {
  const { view, me } = useSession();
  const sensitive = adding.filter((d) => SENSITIVE.includes(d));
  if (!sensitive.length) return null;
  if (hasAuthority(view, me.id, recipientId)) return <p className="notice small">{t('You are giving consent for: {domains}. This is recorded in the consent log.', { domains: domainNames(sensitive) })}</p>;
  const holders = authorityHolders(view, recipientId).filter((m) => m.userId !== me.id);
  if (holders.length) {
    return (
      <p className="notice small">
        <Icon name="shield" size={16} />{' '}
        {t('{domains} needs consent. This will be sent to {names} to approve; nothing changes until they do.', { domains: domainNames(sensitive), names: holders.map((h) => tc(view.users.find((u) => u.id === h.userId)?.name ?? '')).join(', ') })}
      </p>
    );
  }
  return (
    <Field label={t('How was consent given?')} hint={t('Nobody with authority for this person has an account yet. Write where the consent is recorded, e.g. “Signed consent form on file, 12 Oct”.')}>
      <textarea id="consent-evidence" rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
    </Field>
  );
}

function InviteModal({ recipientId, onClose }: { recipientId: string; onClose: () => void }) {
  const { view, act } = useSession();
  const [f, setF] = useState({ email: '', role: 'doctor' as Role, relationship: '', days: '' });
  const [domains, setDomains] = useState<Domain[]>(ROLE_DOMAINS.doctor);
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const invitable = ROLES.filter((r) => r !== 'coordinator' && r !== 'admin' && (r !== 'self' || !view.memberships.some((m) => m.recipientId === recipientId && m.authority === 'self' && m.status === 'active')));
  const save = async () => {
    setBusy(true);
    const res = await act({ type: 'invite_member', recipientId, email: f.email, role: f.role, relationship: f.relationship, domains, accessDays: f.days ? Number(f.days) : null, evidence });
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Modal
      wide
      title={t('Invite someone to the care team')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-dark" disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())} onClick={save}>
            {t('Create invitation')}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label={t('Their email')}>
          <input id="inv-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label={t('Their role')}>
          <select
            id="inv-role"
            value={f.role}
            onChange={(e) => {
              const role = e.target.value as Role;
              setF({ ...f, role });
              setDomains(ROLE_DOMAINS[role]);
            }}
          >
            {invitable.map((r) => (
              <option key={r} value={r}>
                {t(ROLE_LABEL[r])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Relationship or job')} hint={t('e.g. Class teacher, Aunt, Weekend carer')}>
          <input id="inv-rel" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} />
        </Field>
        <Field label={t('Access ends after')} hint={t('Leave empty to keep access until it is removed')}>
          <select id="inv-days" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}>
            <option value="">{t('No end date')}</option>
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>
                {t('{n} days', { n: d })}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <DomainPicker value={domains} onChange={setDomains} role={f.role} idPrefix="inv-d" />
      <ConsentNote recipientId={recipientId} adding={domains} evidence={evidence} setEvidence={setEvidence} />
      <p className="muted small">{t('The invitation link works for 7 days and only for this email address. SANAD does not send email in this version — you will copy the link and send it yourself.')}</p>
    </Modal>
  );
}

function AccessModal({ m, onClose }: { m: Membership; onClose: () => void }) {
  const { view, act } = useSession();
  const user = view.users.find((u) => u.id === m.userId);
  const [domains, setDomains] = useState<Domain[]>(m.domains);
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const adding = domains.filter((d) => !m.domains.includes(d));
  return (
    <Modal
      wide
      title={t('Access for {name}', { name: tc(user?.name ?? '') })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-dark"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await act({ type: 'set_access', membershipId: m.id, domains, evidence });
              setBusy(false);
              if (r.ok) onClose();
            }}
          >
            {t('Save access')}
          </button>
        </>
      }
    >
      <DomainPicker value={domains} onChange={setDomains} role={user?.role ?? 'family'} idPrefix="acc-d" />
      <ConsentNote recipientId={m.recipientId} adding={adding} evidence={evidence} setEvidence={setEvidence} />
      <p className="muted small">{t('Removing access takes effect immediately and is recorded in the consent log.')}</p>
    </Modal>
  );
}

function VerifyModal({ m, onClose }: { m: Membership; onClose: () => void }) {
  const { view, act } = useSession();
  const [evidence, setEvidence] = useState('');
  const user = view.users.find((u) => u.id === m.userId);
  return (
    <Modal
      title={t('Verify authority for {name}', { name: tc(user?.name ?? '') })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-dark"
            disabled={evidence.trim().length < 10}
            onClick={async () => {
              const r = await act({ type: 'verify_authority', membershipId: m.id, evidence });
              if (r.ok) onClose();
            }}
          >
            {t('Verify')}
          </button>
        </>
      }
    >
      <p className="small">{t('Family relationship alone does not give legal authority. Only verify after checking a document such as a guardianship order, power of attorney or, for a child, the birth certificate and family book.')}</p>
      <Field label={t('What did you check?')}>
        <textarea id="verify-evidence" rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </Field>
    </Modal>
  );
}

function ApprovalLine({ a }: { a: Approval }) {
  const { view, me, act, now } = useSession();
  const requester = view.users.find((u) => u.id === a.requestedBy);
  return (
    <li className={`approval approval-${a.status}`}>
      <div>
        <strong>{tm(a.summary)}</strong>
        <small className="muted block">
          {t('Asked by {name} {ago}', { name: tc(requester?.name ?? ''), ago: timeAgo(a.createdAt, now) })} · <span className={`status-${a.status}`}>{t(STATUS_TXT[a.status])}</span>
        </small>
      </div>
      {a.status === 'pending' && a.requestedBy === me.id && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => act({ type: 'cancel_approval', approvalId: a.id })}>
          {t('Cancel request')}
        </button>
      )}
    </li>
  );
}

export const STATUS_TXT: Record<Approval['status'], string> = {
  pending: 'Waiting for a decision',
  executed: 'Approved and done',
  rejected: 'Declined',
  expired: 'Expired',
  failed: 'Not carried out',
  cancelled: 'Cancelled',
};

export function CareTeamPanel({ recipientId }: { recipientId: string }) {
  const { view, me, act, now, toast } = useSession();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Membership | null>(null);
  const [verifying, setVerifying] = useState<Membership | null>(null);
  const [removing, setRemoving] = useState<Membership | null>(null);
  const [reason, setReason] = useState('');
  const r = view.recipients.find((x) => x.id === recipientId)!;
  const manages = canManageTeam(view, me.id, recipientId, now);
  const staffHere = isOrgStaff(me) && me.orgId === r.orgId;
  const members = view.memberships.filter((m) => m.recipientId === recipientId && isLive(m, now));
  const former = view.memberships.filter((m) => m.recipientId === recipientId && !isLive(m, now));
  const invites = view.invites.filter((i) => i.recipientId === recipientId && i.status === 'pending' && i.expiresAt > now);
  const consents = view.consents.filter((c) => c.recipientId === recipientId).sort((a, b) => b.at - a.at);
  const approvals = view.approvals.filter((a) => a.recipientId === recipientId).sort((a, b) => b.createdAt - a.createdAt);
  const link = (code: string) => `${location.origin}${location.pathname}#/register?invite=${encodeURIComponent(code)}`;
  const nameOf = (id: string) => {
    if (id === 'system') return 'SANAD';
    const inv = view.invites.find((i) => i.id === id);
    if (inv) return inv.email;
    return tc(view.users.find((u) => u.id === id)?.name ?? t('Someone'));
  };
  const BASIS: Record<string, string> = { self: 'By the person', guardian: 'By their guardian', recorded: 'Recorded by coordinator', creator: 'Created the profile' };

  return (
    <>
      <section className="panel" aria-labelledby="team-h">
        <header className="panel-head">
          <h2 id="team-h">{t('Care team')}</h2>
          {manages && (
            <button type="button" className="btn btn-dark btn-sm" onClick={() => setInviting(true)}>
              <Icon name="plus" size={14} /> {t('Invite someone')}
            </button>
          )}
        </header>
        {!manages && <p className="muted small">{t('Only the person, their verified guardian, or their care coordinator can change who is on this team.')}</p>}
        <ul className="members">
          {members.map((m) => {
            const u = view.users.find((x) => x.id === m.userId);
            return (
              <li key={m.id} className="member">
                <div className="member-who">
                  <Avatar user={u} size={38} />
                  <span className="member-name">
                    <strong>{tc(u?.name ?? '')}</strong>
                    <small className="muted">
                      {tc(m.relationship)} {m.expiresAt ? `· ${t('until {date}', { date: dateTime(m.expiresAt) })}` : ''}
                    </small>
                  </span>
                  {u && <RoleTag role={u.role} />}
                  <AuthorityBadge m={m} />
                </div>
                <DomainChips domains={m.domains} />
                <div className="row gap-s wrap">
                  {manages && m.authority !== 'self' && m.userId !== me.id && (
                    <>
                      <button type="button" className="btn btn-light btn-sm" onClick={() => setEditing(m)}>
                        {t('Change access')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(m)}>
                        {t('Remove')}
                      </button>
                    </>
                  )}
                  {staffHere && m.authority !== 'none' && !m.authorityVerified && (
                    <button type="button" className="btn btn-dark btn-sm" onClick={() => setVerifying(m)}>
                      <Icon name="shield" size={14} /> {t('Verify authority')}
                    </button>
                  )}
                  {m.userId === me.id && m.authority !== 'self' && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(m)}>
                      {t('Leave this care team')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!members.length && <Empty icon="users" title="Nobody on the care team yet" />}
        {former.length > 0 && (
          <details>
            <summary className="small">{t('Former members ({n})', { n: former.length })}</summary>
            <ul className="small">
              {former.map((m) => (
                <li key={m.id}>
                  {nameOf(m.userId)} · {m.revokedAt ? t('removed {ago}', { ago: timeAgo(m.revokedAt, now) }) : t('access ended')}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {manages && invites.length > 0 && (
        <section className="panel" aria-labelledby="inv-h">
          <header className="panel-head">
            <h2 id="inv-h">{t('Invitations waiting')}</h2>
          </header>
          <ul className="invites">
            {invites.map((i) => (
              <li key={i.id} className="invite">
                <div>
                  <strong>{i.email}</strong> · {t(ROLE_LABEL[i.role])}
                  <small className="muted block">{t('Expires {date}', { date: dateTime(i.expiresAt) })}</small>
                  <DomainChips domains={i.domains} />
                </div>
                <div className="row gap-s wrap">
                  <input className="invite-link" readOnly value={link(i.code)} aria-label={t('Invitation link for {email}', { email: i.email })} onFocus={(e) => e.target.select()} data-raw />
                  <button
                    type="button"
                    className="btn btn-light btn-sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(link(i.code));
                        toast(t('Link copied'), 'ok');
                      } catch {
                        toast(t('Select the link and copy it'), 'error');
                      }
                    }}
                  >
                    {t('Copy link')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => act({ type: 'cancel_invite', inviteId: i.id })}>
                    {t('Cancel')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {approvals.length > 0 && (
        <section className="panel" aria-labelledby="appr-h">
          <header className="panel-head">
            <h2 id="appr-h">{t('Access requests')}</h2>
          </header>
          <ul className="approvals-mini">
            {approvals.slice(0, 8).map((a) => (
              <ApprovalLine key={a.id} a={a} />
            ))}
          </ul>
        </section>
      )}

      <section className="panel" aria-labelledby="consent-h">
        <header className="panel-head">
          <h2 id="consent-h">{t('Consent log')}</h2>
        </header>
        {consents.length ? (
          <div className="table-wrap">
            <table className="consent-table">
              <thead>
                <tr>
                  <th scope="col">{t('When')}</th>
                  <th scope="col">{t('Who')}</th>
                  <th scope="col">{t('Change')}</th>
                  <th scope="col">{t('Information')}</th>
                  <th scope="col">{t('Consent')}</th>
                </tr>
              </thead>
              <tbody>
                {consents.map((c) => (
                  <tr key={c.id}>
                    <td>{dateTime(c.at)}</td>
                    <td>{nameOf(c.subjectId)}</td>
                    <td>{t(c.change === 'grant' ? 'Granted' : 'Removed')}</td>
                    <td>{domainNames(c.domains)}</td>
                    <td>
                      {t(BASIS[c.basis])} · {nameOf(c.givenBy)}
                      {c.evidence && <small className="muted block">{tc(c.evidence)}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="shield" title="No consent recorded yet" />
        )}
      </section>

      {inviting && <InviteModal recipientId={recipientId} onClose={() => setInviting(false)} />}
      {editing && <AccessModal m={editing} onClose={() => setEditing(null)} />}
      {verifying && <VerifyModal m={verifying} onClose={() => setVerifying(null)} />}
      {removing && (
        <Modal
          title={removing.userId === me.id ? t('Leave this care team?') : t('Remove {name}?', { name: nameOf(removing.userId) })}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setRemoving(null)}>
                {t('Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-dark"
                onClick={async () => {
                  const res = await act({ type: 'revoke_member', membershipId: removing.id, reason });
                  if (res.ok) {
                    setRemoving(null);
                    setReason('');
                  }
                }}
              >
                {t(removing.userId === me.id ? 'Leave' : 'Remove access')}
              </button>
            </>
          }
        >
          <p className="small">{t('Access ends immediately. Records they wrote stay in the profile with their name.')}</p>
          <Field label={t('Reason (optional)')}>
            <input id="revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </>
  );
}
