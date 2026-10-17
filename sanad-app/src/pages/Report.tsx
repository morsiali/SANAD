import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CATEGORY_LABEL, PRIORITIES, ROLE_LABEL, type Category, type Priority } from '../../shared/types';
import { computeLoads, decideRouting } from '../../shared/routing';
import { rankPlaybooks } from '../../shared/intelligence';
import { userName } from '../../shared/engine';
import { useSession } from '../lib/store';
import { t, tc, tm, tn } from '../lib/i18n';
import { dateTime } from '../lib/format';
import { ROLE_CONFIG } from '../lib/roles';
import { Avatar, Field, Icon, Meter, PriorityPill, RoleTag, Sparkle } from '../components/ui';

export function Report() {
  const { view, me, act } = useSession();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const people = view.recipients.filter((r) => me.role !== 'family' || me.recipients.includes(r.id));
  const tpl = ROLE_CONFIG[me.role].templates[Number(sp.get('t'))];
  const [title, setTitle] = useState(tpl?.title ?? sp.get('title') ?? '');
  const [description, setDescription] = useState(tpl?.description ?? '');
  const [recipientId, setRecipientId] = useState(sp.get('person') ?? (me.recipients.find((r) => people.some((p) => p.id === r)) ?? people[0]?.id ?? ''));
  const [priority, setPriority] = useState<Priority | 'auto'>('auto');
  const [category, setCategory] = useState<Category | 'auto'>('auto');
  const [busy, setBusy] = useState(false);
  const [debounced, setDebounced] = useState({ title, description });

  useEffect(() => {
    const t = setTimeout(() => setDebounced({ title, description }), 250);
    return () => clearTimeout(t);
  }, [title, description]);

  const preview = useMemo(() => {
    if (debounced.title.trim().length < 4 || !recipientId) return null;
    return decideRouting(
      { ...debounced, recipientId, priority, category },
      { users: view.users, rules: view.rules, settings: view.settings, loads: Object.keys(view.loads).length ? view.loads : computeLoads(view.users, view.challenges) },
    );
  }, [debounced, recipientId, priority, category, view]);

  const selfHelp = useMemo(() => (preview ? rankPlaybooks(view.playbooks, `${debounced.title} ${debounced.description}`, preview.category).slice(0, 2) : []), [preview, view.playbooks, debounced]);
  const assignee = view.users.find((u) => u.id === preview?.assigneeId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await act({ type: 'create_challenge', title, description, recipientId, priority, category });
    setBusy(false);
    if (r.ok && r.createdId) nav(`/app/challenges/${r.createdId}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">Report a challenge</h1>
          <p className="muted">Describe the problem in your own words. SANAD works out who should handle it — before you send it.</p>
        </div>
      </header>

      <div className="cols report-cols">
        <form className="panel form" onSubmit={submit}>
          <div className="quick">
            {ROLE_CONFIG[me.role].templates.map((t) => (
              <button
                key={t.label}
                type="button"
                className="quick-btn"
                onClick={() => {
                  setTitle(t.title);
                  setDescription(t.description);
                }}
              >
                <Icon name="plus" size={14} /> {t.label}
              </button>
            ))}
          </div>
          <Field label="Who is this about?">
            <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)} required>
              {people.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.area}
                </option>
              ))}
            </select>
          </Field>
          <Field label="What’s the problem?" hint="A short headline, e.g. “Insulin pens running low”.">
            <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={4} maxLength={140} />
          </Field>
          <Field label="Details" hint="When it started, what you’ve tried, anything urgent.">
            <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>
          <div className="grid-2">
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | 'auto')}>
                <option value="auto">Let SANAD decide</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value as Category | 'auto')}>
                <option value="auto">Let SANAD decide</option>
                {(Object.keys(CATEGORY_LABEL) as Category[]).map((k) => (
                  <option key={k} value={k}>
                    {CATEGORY_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="muted small note-line">
            <Icon name="shield" size={14} /> In an emergency call 998 first, then report here so the care team is informed.
          </p>
          <div className="row gap-s">
            <button type="submit" className="btn btn-dark" disabled={busy || title.trim().length < 4 || !recipientId}>
              {busy ? 'Routing…' : 'Send to the right person'}
            </button>
            <Link to="/app" className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </form>

        <aside className="stack">
          <section className="panel panel-intel route-preview" aria-live="polite">
            <h2 className="h2">
              <Sparkle size={18} /> Where this will go
            </h2>
            {preview ? (
              <>
                <div className="owner">
                  <Avatar user={assignee} size={46} />
                  <span>
                    <strong>{assignee ? assignee.name : t('{role} team queue', { role: t(ROLE_LABEL[preview.role]) })}</strong>
                    <small>{assignee ? `${assignee.title} · ${assignee.org}` : 'Nobody available right now'}</small>
                    <RoleTag role={preview.role} />
                  </span>
                </div>
                <dl className="facts">
                  <dt>Category</dt>
                  <dd>{CATEGORY_LABEL[preview.category]}</dd>
                  <dt>Priority</dt>
                  <dd>
                    <PriorityPill p={preview.priority} />
                  </dd>
                  <dt>Response by</dt>
                  <dd>{dateTime(Date.now() + view.settings.sla[preview.priority] * 60000)}</dd>
                </dl>
                <div className="conf">
                  <span>Confidence</span>
                  <b>{Math.round(preview.confidence * 100)}%</b>
                </div>
                <Meter value={preview.confidence} label="Routing confidence" />
                <ul className="reasons">
                  {preview.why.map((r, i) => (
                    <li key={i}>{tm(r)}</li>
                  ))}
                </ul>
                {preview.ruleId === null && preview.role === 'coordinator' && <p className="muted small">{t('The coordinator ({name}) will route it by hand. Adding detail helps SANAD route it directly.', { name: tc(userName(view, preview.assigneeId)) })}</p>}
              </>
            ) : (
              <p className="muted">Start typing the problem and you’ll see who gets it, how urgent it is and why.</p>
            )}
          </section>
          {selfHelp.length > 0 && (
            <section className="panel">
              <h2 className="h2">Known fixes</h2>
              <p className="muted small">These playbooks solved similar problems. The person who picks this up can apply one in a click.</p>
              <ul className="mini-list">
                {selfHelp.map((m) => (
                  <li key={m.playbook.id}>
                    <Link to={`/app/playbooks?open=${m.playbook.id}`}>{m.playbook.title}</Link>
                    <small>{tm(m.why[m.why.length - 1])}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
