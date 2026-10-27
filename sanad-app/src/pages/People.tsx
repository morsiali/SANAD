import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isHousehold, type Recipient } from '../../shared/types';
import { isActive } from '../../shared/routing';
import { canWrite } from '../../shared/access';
import { AGE_GROUPS, AGE_LABEL, CARE_NEEDS, LIVINGS, LIVING_LABEL, NEED_ICON, NEED_LABEL, SUPPORT_HINT, SUPPORT_LABEL, SUPPORT_LEVELS, careProfile, type CareProfile } from '../../shared/care';
import { useSession } from '../lib/store';
import { t, tc, tn } from '../lib/i18n';
import { dateTime, timeAgo } from '../lib/format';
import { alertsFor, displayName, lastUpdate, myMembership, myPeople, nextDose } from '../lib/people';
import { Empty, Field, Icon, Modal } from '../components/ui';
import { CareProfileFields, CareTags, draftFrom, emptyDraft, type ProfileDraft } from '../components/CareProfile';

type GroupBy = 'support' | 'living' | 'need' | 'age';
const GROUP_BY: { k: GroupBy; label: string }[] = [
  { k: 'support', label: 'Support level' },
  { k: 'need', label: 'Care need' },
  { k: 'living', label: 'Living situation' },
  { k: 'age', label: 'Age group' },
];

function groupsFor(by: GroupBy): { key: string; label: string; test: (p: CareProfile) => boolean }[] {
  if (by === 'support') return SUPPORT_LEVELS.map((s) => ({ key: s, label: SUPPORT_LABEL[s], test: (p) => p.support === s }));
  if (by === 'living') return LIVINGS.map((l) => ({ key: l, label: LIVING_LABEL[l], test: (p) => p.living === l }));
  if (by === 'age') return [...AGE_GROUPS].reverse().map((a) => ({ key: a, label: AGE_LABEL[a], test: (p) => p.ageGroup === a }));
  return [...CARE_NEEDS.map((n) => ({ key: n, label: NEED_LABEL[n], test: (p: CareProfile) => p.needs.includes(n) })), { key: 'none', label: 'No specific care needs', test: (p: CareProfile) => p.needs.length === 0 }];
}

export function PersonAvatar({ r, size = 46 }: { r: Pick<Recipient, 'name' | 'photo' | 'preferredName'>; size?: number }) {
  if (r.photo) return <img className="person-photo" src={r.photo} alt="" width={size} height={size} />;
  return (
    <span className="person-ava" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {tc(r.name)[0]}
    </span>
  );
}

/** The family care dashboard: one card per person this user can open. */
export function People() {
  const { view, me, now } = useSession();
  const [sp, setSp] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const by = (GROUP_BY.find((g) => g.k === sp.get('group'))?.k ?? 'support') as GroupBy;
  const support = sp.get('support') ?? '';
  const need = sp.get('need') ?? '';
  const q = sp.get('q') ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  const household = isHousehold(me.role);
  const people = myPeople(view);
  const rows = useMemo(
    () => people.map((r) => ({ r, p: careProfile(r), open: view.challenges.filter((c) => c.recipientId === r.id && isActive(c)), alerts: alertsFor(view, r, now), next: nextDose(view, r.id, now), updated: lastUpdate(view, r) })),
    [people, view, now],
  );
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (x) =>
      (!support || x.p.support === support) &&
      (!need || (need === 'attention' ? x.alerts.some((a) => a.tone === 'warn') : need === 'alone' ? x.p.living === 'alone' : x.p.needs.includes(need as never))) &&
      (!needle || `${x.r.name} ${tc(x.r.name)} ${x.r.preferredName ?? ''} ${x.r.area} ${tc(x.r.area)}`.toLowerCase().includes(needle)),
  );
  const groups = groupsFor(by)
    .map((g) => ({ ...g, items: shown.filter((x) => g.test(x.p)) }))
    .filter((g) => g.items.length);
  const title = me.role === 'self' ? 'My care' : household ? 'My family' : 'People we care for';
  const intro = me.role === 'self' ? 'Your profile, your care team and what is coming up.' : household ? 'Everyone you care for, what is coming up, and anything that needs you.' : me.role === 'coordinator' || me.role === 'admin' ? 'Everyone your organisation coordinates care for. Clinical details are only visible to their care teams.' : 'The people whose care team you are on.';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">{t(title)}</h1>
          <p className="muted">{t(intro)}</p>
        </div>
        {me.role === 'coordinator' && (
          <button type="button" className="btn btn-dark" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> {t('Add person')}
          </button>
        )}
      </header>

      {!people.length ? (
        <Empty icon="heart" title="Nobody here yet" text={household ? 'Create a profile when you sign up, or ask the care coordinator to add someone.' : 'You will see people here once their care team invites you.'} />
      ) : (
        <>
          {people.length > 2 && (
            <section className="care-summary" aria-label={t('People by support level')}>
              {SUPPORT_LEVELS.map((s) => {
                const inLevel = rows.filter((x) => x.p.support === s);
                const open = inLevel.reduce((n, x) => n + x.open.length, 0);
                return (
                  <button key={s} type="button" className={`care-tile care-${s} ${support === s ? 'on' : ''}`} aria-pressed={support === s} onClick={() => set('support', support === s ? '' : s)}>
                    <span className="care-tile-n">{inLevel.length}</span>
                    <span className="care-tile-label">{t(SUPPORT_LABEL[s])}</span>
                    <small>{t(SUPPORT_HINT[s])}</small>
                    <small className="care-tile-open">{tn('{n} open challenge', '{n} open challenges', open)}</small>
                  </button>
                );
              })}
            </section>
          )}

          {people.length > 1 && (
            <div className="row wrap gap-s care-toolbar">
              <input className="people-search" type="search" value={q} onChange={(e) => set('q', e.target.value)} placeholder={t('Search by name or area')} aria-label={t('Search people')} />
              <div className="seg" role="group" aria-label={t('Group people by')}>
                {GROUP_BY.map((g) => (
                  <button key={g.k} type="button" className={by === g.k ? 'on' : ''} aria-pressed={by === g.k} onClick={() => set('group', g.k === 'support' ? '' : g.k)}>
                    {t(g.label)}
                  </button>
                ))}
              </div>
              <div className="chip-select" role="group" aria-label={t('Filter by care need')}>
                <button type="button" className={`chip ${!need ? 'chip-on' : ''}`} onClick={() => set('need', '')}>
                  {t('All needs')}
                </button>
                <button type="button" className={`chip ${need === 'attention' ? 'chip-on' : ''}`} onClick={() => set('need', need === 'attention' ? '' : 'attention')}>
                  <Icon name="flag" size={13} /> {t('Needs attention')}
                </button>
                <button type="button" className={`chip ${need === 'alone' ? 'chip-on' : ''}`} onClick={() => set('need', need === 'alone' ? '' : 'alone')}>
                  <Icon name="user" size={13} /> {t('Lives alone')}
                </button>
                {CARE_NEEDS.filter((n) => rows.some((x) => x.p.needs.includes(n))).map((n) => (
                  <button key={n} type="button" className={`chip ${need === n ? 'chip-on' : ''}`} onClick={() => set('need', need === n ? '' : n)}>
                    <Icon name={NEED_ICON[n]} size={13} /> {t(NEED_LABEL[n])}
                  </button>
                ))}
              </div>
            </div>
          )}

          {groups.length ? (
            groups.map((g) => (
              <section key={g.key} className="care-group" aria-labelledby={`care-g-${g.key}`}>
                {people.length > 1 && (
                  <h2 id={`care-g-${g.key}`} className="care-group-head">
                    {t(g.label)} <span className="count">{g.items.length}</span>
                  </h2>
                )}
                <div className="team-grid">
                  {g.items.map((x) => (
                    <PersonCard key={x.r.id} {...x} onEdit={setEditing} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <Empty
              title="Nobody matches these filters"
              text="Clear a filter to see everyone again."
              action={
                <button type="button" className="btn btn-light btn-sm" onClick={() => setSp({})}>
                  {t('Clear filters')}
                </button>
              }
            />
          )}
        </>
      )}
      {adding && <AddPerson onClose={() => setAdding(false)} />}
      {editing && <EditPerson recipientId={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PersonCard({ r, open, alerts, next, updated, onEdit }: { r: Recipient; open: { id: string }[]; alerts: ReturnType<typeof alertsFor>; next: ReturnType<typeof nextDose>; updated: number; onEdit: (id: string) => void }) {
  const { view, me, now } = useSession();
  const mem = myMembership(view, r.id, now);
  const editable = canWrite(view, me.id, r.id, 'overview', now);
  const name = tc(r.name);
  return (
    <article className="person-card" aria-labelledby={`pc-${r.id}`}>
      <header>
        <PersonAvatar r={r} />
        <span>
          <Link id={`pc-${r.id}`} to={`/app/people/${r.id}`} className="person-link">
            <strong>{name}</strong>
          </Link>
          <small>
            {t('Age {age} · {area}', { age: r.age, area: tc(r.area) })}
            {r.preferredName && r.preferredName !== r.name && <> · {t('Likes to be called {name}', { name: tc(r.preferredName) })}</>}
          </small>
          {mem && mem.relationship !== 'Self' && <small className="muted">{t('Your role: {rel}', { rel: tc(mem.relationship) })}</small>}
        </span>
      </header>
      <CareTags r={r} compact />
      {r.communication && (
        <p className="small comm">
          <Icon name="chat" size={14} /> {tc(r.communication)}
        </p>
      )}
      <ul className="card-facts">
        {next && (
          <li>
            <Icon name="clock" size={14} /> {t('Next medicine: {med} at {time}', { med: tc(next.med.name), time: dateTime(next.at) })}
          </li>
        )}
        <li>
          <Icon name="layers" size={14} /> {open.length ? tn('{n} open problem', '{n} open problems', open.length) : t('No open problems')}
        </li>
        <li className="muted">
          <Icon name="refresh" size={14} /> {t('Updated {ago}', { ago: timeAgo(updated || now, now) })}
        </li>
      </ul>
      {alerts.length > 0 && (
        <ul className="alerts" aria-label={t('Alerts for {name}', { name })}>
          {alerts.map((a) => (
            <li key={a.key} className={`alert alert-${a.tone}`}>
              <Link to={a.to}>{t(a.text, a.vars)}</Link>
            </li>
          ))}
        </ul>
      )}
      <footer>
        <Link to={`/app/people/${r.id}`} className="btn btn-dark btn-sm">
          {t('Open profile')}
        </Link>
        {me.role !== 'admin' && (
          <Link to={`/app/report?person=${r.id}`} className="link small">
            {t('Report a problem')}
          </Link>
        )}
        {editable && (
          <button type="button" className="link small" onClick={() => onEdit(r.id)}>
            {t('Edit care profile')}
          </button>
        )}
      </footer>
    </article>
  );
}

export function AddPerson({ onClose }: { onClose: () => void }) {
  const { view, act } = useSession();
  const [f, setF] = useState({ name: '', age: 70, area: '', note: '', familyIds: [] as string[] });
  const [care, setCare] = useState<ProfileDraft>(emptyDraft);
  const save = async () => {
    const r = await act({ type: 'add_recipient', ...f, support: care.support, living: care.living, needs: care.needs });
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
      <CareProfileFields value={care} onChange={setCare} note={f.note} age={f.age} idPrefix="add-care" />
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

export function EditPerson({ recipientId, onClose }: { recipientId: string; onClose: () => void }) {
  const { view, act } = useSession();
  const r = view.recipients.find((x) => x.id === recipientId)!;
  const [f, setF] = useState({ age: r.age, area: r.area, note: r.note });
  const [care, setCare] = useState<ProfileDraft>(() => draftFrom(r));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const res = await act({ type: 'update_recipient', recipientId, ...f, support: care.support, living: care.living, needs: care.needs });
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Modal
      title={t('Care profile: {name}', { name: tc(r.name) })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-dark" disabled={busy || !(f.age >= 1 && f.age <= 120)} onClick={save}>
            Save changes
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Age">
          <input id="edit-care-age" type="number" min={1} max={120} value={f.age} onChange={(e) => setF({ ...f, age: Number(e.target.value) })} />
        </Field>
        <Field label="Area">
          <input value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} />
        </Field>
      </div>
      <Field label="Care note">
        <textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
      <CareProfileFields value={care} onChange={setCare} note={f.note} age={f.age} idPrefix="edit-care" />
    </Modal>
  );
}
