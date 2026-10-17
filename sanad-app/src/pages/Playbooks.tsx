import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CATEGORY_LABEL, type Category, type Playbook } from '../../shared/types';
import { isActive } from '../../shared/routing';
import { rankPlaybooks } from '../../shared/intelligence';
import { canWork, userName } from '../../shared/engine';
import { useSession } from '../lib/store';
import { t, tc, tm, tn } from '../lib/i18n';
import { Empty, Field, Icon, Modal } from '../components/ui';

const EFFORT = ['', 'Low effort', 'Medium effort', 'High effort'];

export function Playbooks() {
  const { view } = useSession();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | ''>('');
  const openId = sp.get('open');
  const editing = sp.get('edit');
  const creating = sp.get('new') === '1';

  const list = useMemo(() => {
    let out = view.playbooks.filter((p) => !cat || p.category === cat);
    if (q.trim()) {
      const ranked = rankPlaybooks(out, q, undefined, 0.08);
      const ids = new Set(ranked.map((r) => r.playbook.id));
      const text = out.filter((p) => !ids.has(p.id) && `${p.title} ${p.summary}`.toLowerCase().includes(q.toLowerCase()));
      out = [...ranked.map((r) => r.playbook), ...text];
    } else {
      out = [...out].sort((a, b) => b.uses - a.uses);
    }
    return out;
  }, [view.playbooks, q, cat]);

  const close = () => setSp({}, { replace: true });
  const open = view.playbooks.find((p) => p.id === openId);
  const edit = view.playbooks.find((p) => p.id === editing);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">Playbooks</h1>
          <p className="muted">Proven fixes, written by the people who solved them. Apply one to a challenge and its steps become the checklist.</p>
        </div>
        <button type="button" className="btn btn-dark" onClick={() => setSp({ new: '1' })}>
          <Icon name="plus" size={16} /> New playbook
        </button>
      </header>
      <div className="filters">
        <label className="search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Describe a problem, e.g. “driver didn’t come”" aria-label="Search playbooks" />
        </label>
        <div className="chip-select" role="group" aria-label="Category">
          <button type="button" className={`chip ${!cat ? 'chip-on' : ''}`} onClick={() => setCat('')}>
            All
          </button>
          {(Object.keys(CATEGORY_LABEL) as Category[])
            .filter((k) => view.playbooks.some((p) => p.category === k))
            .map((k) => (
              <button key={k} type="button" className={`chip ${cat === k ? 'chip-on' : ''}`} onClick={() => setCat(k)}>
                {CATEGORY_LABEL[k]}
              </button>
            ))}
        </div>
      </div>
      {list.length ? (
        <div className="pb-grid">
          {list.map((p) => {
            const rate = p.uses ? Math.round((p.successes / p.uses) * 100) : null;
            return (
              <button key={p.id} type="button" className="pb-card" onClick={() => setSp({ open: p.id })}>
                <span className="pill pill-soft">{CATEGORY_LABEL[p.category]}</span>
                <strong>{p.title}</strong>
                <p>{p.summary}</p>
                <span className="pb-stats">
                  <span>{t('{n} min', { n: p.minutes })}</span>
                  <span>{t('{n} steps', { n: p.steps.length })}</span>
                  <span>{rate === null ? t('New') : t('{pct}% success', { pct: rate })}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty icon="book" title="No playbooks match" text="Write the fix down so the next person can solve it in minutes." action={<button type="button" className="btn btn-dark btn-sm" onClick={() => setSp({ new: '1' })}>New playbook</button>} />
      )}

      {open && <PlaybookView p={open} onClose={close} onEdit={() => setSp({ edit: open.id })} />}
      {(creating || edit) && <PlaybookEditor p={edit} onClose={close} />}
      {!open && openId && <Modal title="Playbook not found" onClose={close}><p>It may have been deleted.</p></Modal>}
    </div>
  );
}

function PlaybookView({ p, onClose, onEdit }: { p: Playbook; onClose: () => void; onEdit: () => void }) {
  const { view, me, act } = useSession();
  const targets = view.challenges.filter((c) => isActive(c) && canWork(me, c) && c.playbookId !== p.id);
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  const canEdit = p.authorId === me.id || me.role === 'coordinator';
  const rate = p.uses ? Math.round((p.successes / p.uses) * 100) : null;
  return (
    <Modal
      title={p.title}
      onClose={onClose}
      wide
      footer={
        <>
          {canEdit && (
            <>
              <button
                type="button"
                className="btn btn-ghost danger"
                onClick={async () => {
                  if ((await act({ type: 'delete_playbook', id: p.id })).ok) onClose();
                }}
              >
                <Icon name="trash" size={16} /> Delete
              </button>
              <button type="button" className="btn btn-light" onClick={onEdit}>
                <Icon name="edit" size={16} /> Edit
              </button>
            </>
          )}
          <button type="button" className="btn btn-dark" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="modal-sub">{p.summary}</p>
      <div className="pb-stats pb-stats-lg">
        <span>{t('{n} min', { n: p.minutes })}</span>
        <span>{EFFORT[p.effort]}</span>
        <span>{rate === null ? t('Not used yet') : t('{pct}% of {n} uses solved it', { pct: rate, n: p.uses })}</span>
        <span>{t('By {name}', { name: tc(userName(view, p.authorId)) })}</span>
      </div>
      <ol className="steps">
        {p.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {p.tags.length > 0 && (
        <div className="tags">
          {p.tags.map((tag) => (
            <span key={tag} className="chip chip-static">
              {tc(tag)}
            </span>
          ))}
        </div>
      )}
      <div className="apply-box">
        <h3 className="h3">Use it now</h3>
        {targets.length ? (
          <div className="row gap-s wrap">
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Challenge to apply to">
              {targets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ref} · {c.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-dark btn-sm"
              disabled={!target}
              onClick={async () => {
                if ((await act({ type: 'apply_playbook', id: target, playbookId: p.id })).ok) onClose();
              }}
            >
              Apply to challenge
            </button>
          </div>
        ) : (
          <p className="muted small">You have no open challenges to apply it to right now.</p>
        )}
      </div>
    </Modal>
  );
}

function PlaybookEditor({ p, onClose }: { p?: Playbook; onClose: () => void }) {
  const { act } = useSession();
  const [title, setTitle] = useState(p?.title ?? '');
  const [summary, setSummary] = useState(p?.summary ?? '');
  const [category, setCategory] = useState<Category>(p?.category ?? 'general');
  const [steps, setSteps] = useState<string[]>(p?.steps.length ? p.steps : ['', '']);
  const [minutes, setMinutes] = useState(p?.minutes ?? 30);
  const [effort, setEffort] = useState<1 | 2 | 3>(p?.effort ?? 1);
  const [tags, setTags] = useState(p?.tags.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const valid = title.trim().length >= 3 && steps.some((s) => s.trim());

  const save = async () => {
    setBusy(true);
    const r = await act({
      type: 'upsert_playbook',
      playbook: { id: p?.id, title, summary, category, steps, minutes, effort, tags: tags.split(',') },
    });
    setBusy(false);
    if (r.ok) onClose();
  };

  return (
    <Modal
      title={p ? 'Edit playbook' : 'New playbook'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-dark" disabled={!valid || busy} onClick={save}>
            {p ? 'Save changes' : 'Publish playbook'}
          </button>
        </>
      }
    >
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Same-day refill with home delivery" />
      </Field>
      <Field label="When to use it">
        <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One sentence" />
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
        <Field label="Minutes">
          <input type="number" min={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </Field>
        <Field label="Effort">
          <select value={effort} onChange={(e) => setEffort(Number(e.target.value) as 1 | 2 | 3)}>
            <option value={1}>Low</option>
            <option value={2}>Medium</option>
            <option value={3}>High</option>
          </select>
        </Field>
      </div>
      <fieldset className="steps-edit">
        <legend>Steps</legend>
        {steps.map((s, i) => (
          <div key={i} className="step-row">
            <span className="step-n">{i + 1}</span>
            <input value={s} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))} aria-label={t('Step {n}', { n: i + 1 })} />
            <button type="button" className="icon-btn" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={t('Remove step {n}', { n: i + 1 })} disabled={steps.length === 1}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-light btn-sm" onClick={() => setSteps([...steps, ''])}>
          <Icon name="plus" size={14} /> Add step
        </button>
      </fieldset>
      <Field label="Keywords" hint="Comma separated. They help SANAD suggest this playbook.">
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="refill, delivery, insulin" />
      </Field>
    </Modal>
  );
}
