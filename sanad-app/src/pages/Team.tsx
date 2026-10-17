import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ROLES, ROLE_LABEL, type Role } from '../../shared/types';
import { isActive } from '../../shared/routing';
import { useSession } from '../lib/store';
import { t, tc, tm, tn } from '../lib/i18n';
import { Avatar, Empty, Field, Icon, Modal, RoleTag } from '../components/ui';

export function Team() {
  const { view, me, act } = useSession();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'people' ? 'people' : 'team';
  const [role, setRole] = useState<Role | ''>('');
  const [adding, setAdding] = useState<'user' | 'person' | null>(null);
  const isCoord = me.role === 'coordinator';

  const people = view.users.filter((u) => (!role || u.role === role) && (me.role !== 'family' || u.role !== 'family' || u.id === me.id));
  const recipients = view.recipients.filter((r) => me.role !== 'family' || me.recipients.includes(r.id));
  const maxLoad = Math.max(6, ...Object.values(view.loads));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">{me.role === 'family' ? 'Care team' : 'Team & people'}</h1>
          <p className="muted">Everyone in the care network, how busy they are, and who they support.</p>
        </div>
        {isCoord && (
          <button type="button" className="btn btn-dark" onClick={() => setAdding(tab === 'team' ? 'user' : 'person')}>
            <Icon name="plus" size={16} /> {tab === 'team' ? 'Add team member' : 'Add person'}
          </button>
        )}
      </header>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'team'} className={`tab ${tab === 'team' ? 'tab-on' : ''}`} onClick={() => setSp({})}>
          Team
        </button>
        <button type="button" role="tab" aria-selected={tab === 'people'} className={`tab ${tab === 'people' ? 'tab-on' : ''}`} onClick={() => setSp({ tab: 'people' })}>
          People we care for
        </button>
      </div>

      {tab === 'team' ? (
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
                  {u.role !== 'family' && (
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
                    {u.role !== 'family' && (
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
      ) : recipients.length ? (
        <div className="team-grid">
          {recipients.map((r) => {
            const open = view.challenges.filter((c) => c.recipientId === r.id && isActive(c));
            const family = view.users.filter((u) => u.role === 'family' && u.recipients.includes(r.id));
            const carers = view.users.filter((u) => u.role !== 'family' && u.recipients.includes(r.id));
            return (
              <article key={r.id} className="person-card">
                <header>
                  <span className="person-ava">{r.name[0]}</span>
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {t('Age {age} · {area}', { age: r.age, area: tc(r.area) })}
                    </small>
                  </span>
                </header>
                {r.note && <p className="small">{r.note}</p>}
                <small className="muted">
                  {t('Family: {f} · Regular team: {t}', { f: family.map((f) => tc(f.name)).join('، ') || t('none linked'), t: carers.map((c) => tc(c.name)).join('، ') || t('none yet') })}
                </small>
                <footer>
                  <Link to={`/app/challenges?person=${r.id}&scope=all`} className="btn btn-light btn-sm">
                    {tn('{n} open challenge', '{n} open challenges', open.length)}
                  </Link>
                  <Link to={`/app/report?person=${r.id}`} className="link small">
                    {t('Report for {name}', { name: tc(r.name).split(' ')[0] })}
                  </Link>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title="Nobody yet" text="The coordinator links people to your account." />
      )}

      {adding === 'user' && <AddUser onClose={() => setAdding(null)} />}
      {adding === 'person' && <AddPerson onClose={() => setAdding(null)} />}
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

function AddPerson({ onClose }: { onClose: () => void }) {
  const { view, act } = useSession();
  const [f, setF] = useState({ name: '', age: 70, area: '', note: '', familyIds: [] as string[] });
  const save = async () => {
    const r = await act({ type: 'add_recipient', ...f });
    if (r.ok) onClose();
  };
  return (
    <Modal
      title="Add a person we care for"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-dark" disabled={f.name.trim().length < 2} onClick={save}>
            Add person
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Full name">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Age">
          <input type="number" min={1} max={120} value={f.age} onChange={(e) => setF({ ...f, age: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Area">
        <input value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="e.g. Jumeirah, Dubai" />
      </Field>
      <Field label="Care note">
        <textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
      <fieldset className="checks">
        <legend>Family members</legend>
        {view.users
          .filter((u) => u.role === 'family')
          .map((u) => (
            <label key={u.id} className="check">
              <input type="checkbox" checked={f.familyIds.includes(u.id)} onChange={(e) => setF({ ...f, familyIds: e.target.checked ? [...f.familyIds, u.id] : f.familyIds.filter((x) => x !== u.id) })} />
              {u.name}
            </label>
          ))}
      </fieldset>
    </Modal>
  );
}
