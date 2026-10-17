import { useMemo, useState } from 'react';
import { CATEGORY_LABEL, PRIORITIES, ROLES, ROLE_LABEL, type Category, type Priority, type Role, type Rule, type Settings } from '../../shared/types';
import { decideRouting } from '../../shared/routing';
import { userName } from '../../shared/engine';
import { useSession } from '../lib/store';
import { isAr, t, tc, tm, tn } from '../lib/i18n';
import { Avatar, Field, Icon, Meter, Modal, PriorityPill, RoleTag, Sparkle } from '../components/ui';

const AR_RE = /[\u0600-\u06ff]/;

export function Routing() {
  const { view, me, act } = useSession();
  const isCoord = me.role === 'coordinator';
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [test, setTest] = useState('Dad’s walker is broken and he nearly fell');
  const preview = useMemo(
    () => (test.trim().length > 3 ? decideRouting({ title: test, description: '', recipientId: view.recipients[0]?.id ?? '' }, { users: view.users, rules: view.rules, settings: view.settings, loads: view.loads }) : null),
    [test, view],
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">{isCoord ? 'Routing rules' : 'How routing works'}</h1>
          <p className="muted">
            SANAD reads each new problem, matches it to a rule, sets urgency, and picks the available person with the right skills, the lightest workload and an existing relationship with the family.
            {!isCoord && ' Only the care coordinator can change these rules.'}
          </p>
        </div>
        {isCoord && (
          <button type="button" className="btn btn-dark" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> New rule
          </button>
        )}
      </header>

      <section className="panel panel-intel">
        <h2 className="h2">
          <Sparkle size={18} /> Try it
        </h2>
        <div className="sandbox">
          <input value={test} onChange={(e) => setTest(e.target.value)} aria-label="Describe a problem to test routing" placeholder="Describe a problem" />
          {preview && (
            <div className="sandbox-out">
              <span className="route-to">
                <RoleTag role={preview.role} />
                <Icon name="arrow" size={14} />
                <Avatar user={view.users.find((u) => u.id === preview.assigneeId)} size={26} />
                <strong>{preview.assigneeId ? userName(view, preview.assigneeId) : 'Team queue'}</strong>
                <PriorityPill p={preview.priority} />
              </span>
              <Meter value={preview.confidence} label="Confidence" />
              <ul className="reasons">
                {preview.why.map((r, i) => (
                  <li key={i}>{tm(r)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="rules">
        {view.rules.map((r) => (
          <article key={r.id} className={`rule ${r.enabled ? '' : 'rule-off'}`}>
            <header>
              <div>
                <h3>{r.name}</h3>
                <span className="rule-meta">
                  {CATEGORY_LABEL[r.category]} <Icon name="arrow" size={13} /> <RoleTag role={r.role} />
                  {r.priorityFloor && (
                    <>
                      · at least <PriorityPill p={r.priorityFloor} />
                    </>
                  )}
                </span>
              </div>
              {isCoord && (
                <div className="row gap-xs">
                  <label className="switch" title={r.enabled ? 'Rule is on' : 'Rule is off'}>
                    <input type="checkbox" checked={r.enabled} onChange={(e) => act({ type: 'upsert_rule', rule: { ...r, enabled: e.target.checked } })} aria-label={t('{name} enabled', { name: tc(r.name) })} />
                    <span className="switch-ui" aria-hidden="true" />
                  </label>
                  <button type="button" className="icon-btn" onClick={() => setEditing(r)} aria-label={t('Edit {name}', { name: tc(r.name) })}>
                    <Icon name="edit" size={16} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => act({ type: 'delete_rule', id: r.id })} aria-label={t('Delete {name}', { name: tc(r.name) })}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              )}
            </header>
            <div className="tags">
              {r.keywords
                .filter((k) => AR_RE.test(k) === isAr())
                .map((k) => (
                  <span key={k} className="chip chip-static" data-raw="">
                    {k}
                  </span>
                ))}
              {r.keywords.some((k) => AR_RE.test(k) !== isAr()) && (
                <span className="chip chip-static muted">{t(isAr() ? '+{n} English keywords' : '+{n} Arabic keywords', { n: r.keywords.filter((k) => AR_RE.test(k) !== isAr()).length })}</span>
              )}
            </div>
          </article>
        ))}
      </section>

      <SlaPanel settings={view.settings} editable={isCoord} />
      {editing && <RuleEditor rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SlaPanel({ settings, editable }: { settings: Settings; editable: boolean }) {
  const { act } = useSession();
  const [s, setS] = useState<Settings>(settings);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const hours = (m: number) => (m >= 60 ? t('{n} h', { n: Math.round((m / 60) * 10) / 10 }) : t('{n} min', { n: m }));
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Response times & behaviour</h2>
      </header>
      <div className="sla-grid">
        {PRIORITIES.map((p) => (
          <div key={p} className="sla-cell">
            <PriorityPill p={p} />
            {editable ? (
              <label>
                <input type="number" min={5} value={s.sla[p]} onChange={(e) => setS({ ...s, sla: { ...s.sla, [p]: Number(e.target.value) } })} aria-label={t('{p} response minutes', { p: t(p[0].toUpperCase() + p.slice(1)) })} />
                <small>{t('minutes ({h})', { h: hours(s.sla[p]) })}</small>
              </label>
            ) : (
              <b>{hours(settings.sla[p])}</b>
            )}
          </div>
        ))}
      </div>
      <div className="toggles">
        {(
          [
            ['autoEscalate', 'Escalate to the coordinator automatically when a response time is missed'],
            ['balanceLoad', 'Balance workload across available team members'],
            ['preferContinuity', 'Prefer people who already support the family'],
          ] as [keyof Settings, string][]
        ).map(([k, label]) => (
          <label key={k} className="switch">
            <input type="checkbox" disabled={!editable} checked={s[k] as boolean} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />
            <span className="switch-ui" aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>
      {editable && (
        <div className="row gap-s">
          <button type="button" className="btn btn-dark" disabled={!dirty} onClick={() => act({ type: 'update_settings', settings: s })}>
            Save settings
          </button>
          {dirty && (
            <button type="button" className="btn btn-ghost" onClick={() => setS(settings)}>
              Discard
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function RuleEditor({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const { act } = useSession();
  const [name, setName] = useState(rule?.name ?? '');
  const [category, setCategory] = useState<Category>(rule?.category ?? 'general');
  const [role, setRole] = useState<Role>(rule?.role ?? 'caregiver');
  const [keywords, setKeywords] = useState(rule?.keywords.join(', ') ?? '');
  const [floor, setFloor] = useState<Priority | ''>(rule?.priorityFloor ?? '');
  const save = async () => {
    const r = await act({ type: 'upsert_rule', rule: { id: rule?.id, name, category, role, keywords: keywords.split(','), enabled: rule?.enabled ?? true, priorityFloor: floor || null } });
    if (r.ok) onClose();
  };
  return (
    <Modal
      title={rule ? t('Edit “{name}”', { name: tc(rule.name) }) : t('New routing rule')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-dark" disabled={name.trim().length < 2 || !keywords.trim()} onClick={save}>
            Save rule
          </button>
        </>
      }
    >
      <Field label="Rule name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid-3">
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((k) => (
              <option key={k} value={k}>
                {CATEGORY_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Send to">
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Minimum priority">
          <select value={floor} onChange={(e) => setFloor(e.target.value as Priority | '')}>
            <option value="">None</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Keywords and phrases" hint="Comma separated. Words match their plurals; phrases count double.">
        <textarea rows={4} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </Field>
    </Modal>
  );
}
