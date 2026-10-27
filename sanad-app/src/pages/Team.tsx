import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ROLES, ROLE_LABEL, isHousehold, type Role } from '../../shared/types';
import { isOrgStaff } from '../../shared/access';
import { isActive } from '../../shared/routing';
import { useSession } from '../lib/store';
import { t, tc, tm, tn } from '../lib/i18n';
import { Avatar, Empty, Field, Icon, Modal, RoleTag } from '../components/ui';

export function Team() {
  const { view, me, act } = useSession();
  const [sp] = useSearchParams();
  const [role, setRole] = useState<Role | ''>('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const isCoord = me.role === 'coordinator';

  // Household members see the people on their own care teams; staff see the network.
  const household = isHousehold(me.role);
  const people = view.users.filter((u) => (!role || u.role === role) && (!household || u.id === me.id || u.recipients.some((r) => me.recipients.includes(r))) && (u.role !== 'admin' || isOrgStaff(me)));
  // People we care for moved to their own page; keep old links working.
  if (sp.get('tab') === 'people') return <Navigate to={`/app/people?${new URLSearchParams([...sp].filter(([k]) => k !== 'tab')).toString()}`} replace />;
  const maxLoad = Math.max(6, ...Object.values(view.loads));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">{household ? 'Care team' : 'Team'}</h1>
          <p className="muted">{t(household ? 'The people who support your family, and what they are working on.' : 'Everyone in the care network, how busy they are, and who they support.')}</p>
        </div>
        <div className="row gap-s wrap">
          <Link to="/app/people" className="btn btn-light">
            <Icon name="heart" size={16} /> {t('People we care for')}
          </Link>
          {isCoord && (
            <button type="button" className="btn btn-dark" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} /> {t('Add team member')}
            </button>
          )}
        </div>
      </header>
      <>
          <div className="chip-select" role="group" aria-label="Filter by role">
            <button type="button" className={`chip ${!role ? 'chip-on' : ''}`} onClick={() => setRole('')}>
              Everyone
            </button>
            {ROLES.map((r) => (
              <button key={r} type="button" className={`chip ${role === r ? 'chip-on' : ''}`} onClick={() => setRole(r)}>
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <div className="team-grid">
            {people.map((u) => {
              const load = view.loads[u.id] ?? 0;
              const open = view.challenges.filter((c) => c.assigneeId === u.id && isActive(c)).length;
              const canToggle = u.id === me.id || isCoord;
              return (
                <article key={u.id} className="person-card">
                  <header>
                    <Avatar user={u} size={46} />
                    <span>
                      <strong>{u.name}</strong>
                      <small>
                        {u.title} · {u.org}
                      </small>
                    </span>
                  </header>
                  <RoleTag role={u.role} />
                  {!isHousehold(u.role) && (
                    <div className="load-row" title="Workload: urgent counts 4, high 3, medium 2, low 1">
                      <span className="load-bar">
                        <span style={{ width: `${(load / maxLoad) * 100}%` }} className={load / maxLoad > 0.7 ? 'hot' : ''} />
                      </span>
                      <small>
                        {t('{n} open · load {l}', { n: open, l: load })}
                      </small>
                    </div>
                  )}
                  {u.skills.length > 0 && (
                    <div className="tags">
                      {u.skills.map((s) => (
                        <span key={s} className="chip chip-static">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  {u.recipients.length > 0 && (
                    <small className="muted">{t('Supports {names}', { names: u.recipients.map((r) => tc(view.recipients.find((x) => x.id === r)?.name ?? '').split(' ')[0]).filter(Boolean).join('، ') })}</small>
                  )}
                  <footer>
                    {canToggle ? (
                      <label className="switch">
                        <input type="checkbox" checked={u.available} onChange={(e) => act({ type: 'set_availability', userId: u.id, available: e.target.checked })} />
                        <span className="switch-ui" aria-hidden="true" />
                        {u.available ? 'Available' : 'Away'}
                      </label>
                    ) : (
                      <span className={`presence ${u.available ? 'presence-on' : ''}`}>
                        <i />
                        {u.available ? 'Available' : 'Away'}
                      </span>
                    )}
                    {isCoord && u.role !== 'coordinator' && (
                      <button type="button" className="link small" onClick={() => setEditing(u.id)}>
                        {t('Edit details')}
                      </button>
                    )}
                    {!isHousehold(u.role) && (
                      <Link to={`/app/intelligence?q=${encodeURIComponent(`Who handles ${u.skills[0] ?? ROLE_LABEL[u.role].toLowerCase()}`)}`} className="link small">
                        Routing check
                      </Link>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
      </>

      {adding && <AddUser onClose={() => setAdding(false)} />}
      {editing && <EditUser userId={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AddUser({ onClose }: { onClose: () => void }) {
  const { view, act, backend } = useSession();
  const [f, setF] = useState({ name: '', role: 'caregiver' as Role, title: '', org: '', email: '', skills: '', recipients: [] as string[] });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await act({ type: 'add_user', ...f, skills: f.skills.split(',') });
    setBusy(false);
    if (r.ok) onClose();
  };
  return (
    <Modal
      title="Add a team member"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-dark" disabled={busy || f.name.trim().length < 2 || !f.email.includes('@')} onClick={save}>
            Add member
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Full name">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email" hint={t(backend.mode === 'server' ? 'They sign in with password “sanad123” and can change it in Settings.' : 'They sign in with password “sanad123”.')}>
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Role">
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Job title">
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Organisation">
          <input value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} />
        </Field>
        <Field label="Skills" hint="Comma separated — used to match problems.">
          <input value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} placeholder="wound, insulin" />
        </Field>
      </div>
      <fieldset className="checks">
        <legend>Supports</legend>
        {view.recipients.map((r) => (
          <label key={r.id} className="check">
            <input
              type="checkbox"
              checked={f.recipients.includes(r.id)}
              onChange={(e) => setF({ ...f, recipients: e.target.checked ? [...f.recipients, r.id] : f.recipients.filter((x) => x !== r.id) })}
            />
            {r.name}
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}

function EditUser({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { view, act } = useSession();
  const u = view.users.find((x) => x.id === userId)!;
  const [f, setF] = useState({ title: u.title, org: u.org, skills: u.skills.join(', '), recipients: [...u.recipients] });
  const save = async () => {
    const r = await act({ type: 'update_user', userId, title: f.title, org: f.org, skills: f.skills.split(/[,،]/), recipients: f.recipients });
    if (r.ok) onClose();
  };
  return (
    <Modal
      title={t('Edit {name}', { name: tc(u.name) })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-dark" onClick={save}>
            Save changes
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Job title">
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Organisation">
          <input value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} />
        </Field>
      </div>
      {!isHousehold(u.role) && (
        <Field label="Skills" hint="Comma separated — used to match problems.">
          <input value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} />
        </Field>
      )}
      <fieldset className="checks">
        <legend>{isHousehold(u.role) ? t('Cares for') : t('Supports')}</legend>
        {view.recipients.map((r) => (
          <label key={r.id} className="check">
            <input
              type="checkbox"
              checked={f.recipients.includes(r.id)}
              onChange={(e) => setF({ ...f, recipients: e.target.checked ? [...f.recipients, r.id] : f.recipients.filter((x) => x !== r.id) })}
            />
            {tc(r.name)}
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}
