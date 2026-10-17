import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROLES, ROLE_LABEL, type Challenge, type Role } from '../../shared/types';
import { useSession } from '../lib/store';
import { t } from '../lib/i18n';
import { Avatar, Field, Icon, Modal } from './ui';

export type RunKind = 'accept' | 'start' | 'claim' | 'resolve' | 'verify' | 'reopen' | 'handoff' | 'escalate' | 'reassign' | 'triage' | 'review' | 'continue';

interface Ctx {
  run(kind: RunKind, c: Challenge): void;
}
const ActionCtx = createContext<Ctx | null>(null);

export function useActions() {
  const c = useContext(ActionCtx);
  if (!c) throw new Error('useActions outside provider');
  return c;
}

type Open = { kind: 'resolve' | 'verify' | 'reopen' | 'handoff' | 'escalate' | 'reassign'; c: Challenge } | null;

export function ActionProvider({ children }: { children: ReactNode }) {
  const { act, view, me } = useSession();
  const nav = useNavigate();
  const [open, setOpen] = useState<Open>(null);
  const [text, setText] = useState('');
  const [rating, setRating] = useState(5);
  const [role, setRole] = useState<Role>('doctor');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    setOpen(null);
    setText('');
    setBusy(false);
  }, []);
  const { pathname } = useLocation();
  useEffect(() => close(), [pathname, close]);

  const run = useCallback(
    (kind: RunKind, c: Challenge) => {
      if (kind === 'accept' || kind === 'start' || kind === 'claim') {
        void act({ type: kind, id: c.id });
        return;
      }
      if (kind === 'review' || kind === 'continue') {
        nav(`/app/challenges/${c.id}`);
        return;
      }
      setText('');
      setRating(5);
      if (kind === 'triage' || kind === 'handoff') {
        setRole(c.routing.role !== c.role ? c.routing.role : c.role === 'coordinator' ? 'caregiver' : c.role === 'doctor' ? 'caregiver' : 'doctor');
        setOpen({ kind: 'handoff', c });
        return;
      }
      if (kind === 'reassign') setAssignee(view.users.find((u) => u.role === c.role && u.id !== c.assigneeId && u.available)?.id ?? '');
      setOpen({ kind, c });
    },
    [act, nav, view.users],
  );

  const submit = async () => {
    if (!open) return;
    setBusy(true);
    const { c } = open;
    let r;
    if (open.kind === 'resolve') r = await act({ type: 'resolve', id: c.id, resolution: text });
    else if (open.kind === 'verify') r = await act({ type: 'verify', id: c.id, rating });
    else if (open.kind === 'reopen') r = await act({ type: 'reopen', id: c.id, reason: text });
    else if (open.kind === 'handoff') r = await act({ type: 'handoff', id: c.id, role, reason: text });
    else if (open.kind === 'escalate') r = await act({ type: 'escalate', id: c.id, reason: text });
    else r = await act({ type: 'reassign', id: c.id, assigneeId: assignee, reason: text });
    if (r.ok) close();
    else setBusy(false);
  };

  let modal: ReactNode = null;
  if (open) {
    const { c } = open;
    const submitLabel = { resolve: 'Mark resolved', verify: 'Confirm and close', reopen: 'Reopen', handoff: 'Hand off', escalate: 'Escalate', reassign: 'Assign' }[open.kind];
    const title = {
      resolve: t('Resolve {ref}', { ref: c.ref }),
      verify: t('Confirm the fix for {ref}', { ref: c.ref }),
      reopen: t('Reopen {ref}', { ref: c.ref }),
      handoff: c.stage === 'reported' ? t('Route {ref}', { ref: c.ref }) : t('Hand off {ref}', { ref: c.ref }),
      escalate: t('Escalate {ref}', { ref: c.ref }),
      reassign: t('Assign {ref}', { ref: c.ref }),
    }[open.kind];
    const needsText = open.kind !== 'verify';
    const canSubmit = !busy && (!needsText || text.trim().length >= (open.kind === 'resolve' ? 5 : 3)) && (open.kind !== 'reassign' || !!assignee);
    const pool = open.kind === 'reassign' ? view.users.filter((u) => (me.role === 'coordinator' ? u.role !== 'family' || u.recipients.includes(c.recipientId) : u.role === me.role) && u.id !== c.assigneeId) : [];
    modal = (
      <Modal
        title={title}
        onClose={close}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn btn-dark" disabled={!canSubmit} onClick={submit}>
              {busy ? 'Saving…' : submitLabel}
            </button>
          </>
        }
      >
        <p className="modal-sub">{c.title}</p>
        {open.kind === 'verify' && (
          <>
            {c.resolution && (
              <blockquote className="resolution">
                <strong>What was done</strong>
                {c.resolution}
              </blockquote>
            )}
            <fieldset className="rating">
              <legend>How well was it solved?</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={n <= rating ? 'on' : ''} onClick={() => setRating(n)} aria-label={t('{n} out of 5', { n })} aria-pressed={n === rating}>
                  <Icon name="star" size={22} />
                </button>
              ))}
            </fieldset>
            <p className="muted small">Not solved? Close this and choose “Reopen” instead.</p>
          </>
        )}
        {open.kind === 'handoff' && (
          <Field label="Send to" group>
            <div className="chip-select" role="radiogroup">
              {ROLES.filter((r) => r !== 'family' || view.users.some((u) => u.role === 'family' && u.recipients.includes(c.recipientId))).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={role === r} className={`chip ${role === r ? 'chip-on' : ''}`} onClick={() => setRole(r)}>
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </Field>
        )}
        {open.kind === 'reassign' && (
          <Field label="Assign to" group>
            <div className="pick-list">
              {pool.map((u) => (
                <button key={u.id} type="button" className={`pick ${assignee === u.id ? 'pick-on' : ''}`} onClick={() => setAssignee(u.id)} aria-pressed={assignee === u.id}>
                  <Avatar user={u} size={28} />
                  <span>
                    <strong>{u.name}</strong>
                    <small>
                      {t('{role} · workload {n}', { role: t(ROLE_LABEL[u.role]), n: view.loads[u.id] ?? 0 })}
                      {u.available ? '' : t(' · away')}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </Field>
        )}
        {needsText && (
          <Field
            label={{ resolve: 'What did you do?', reopen: 'What is still wrong?', handoff: 'Why does it belong there?', escalate: 'What is blocking it?', reassign: 'Note for the new owner' }[open.kind as 'resolve']}
            hint={open.kind === 'resolve' ? 'The family sees this when they confirm the fix.' : undefined}
          >
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
      </Modal>
    );
  }

  return (
    <ActionCtx.Provider value={{ run }}>
      {children}
      {modal}
    </ActionCtx.Provider>
  );
}
