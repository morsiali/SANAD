import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORY_LABEL, ROLE_LABEL, STAGES, STAGE_LABEL, type Challenge, type Priority, type Role, type Stage, type User, type View } from '../../shared/types';
import { recipientName, slaText, ROLE_ICON } from '../lib/format';
import { useApp } from '../lib/store';
import { isAr, t, tc, tm } from '../lib/i18n';
import { userName } from '../../shared/engine';

const P: Record<string, ReactNode> = {
  home: <><path d="m3 10.5 9-7 9 7" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" /></>,
  grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>,
  board: <><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="11" rx="1.5" /><rect x="17" y="4" width="4" height="7" rx="1.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>,
  inbox: <><path d="M3 13h5l2 3h4l2-3h5" /><path d="M5 5h14l2 8v6H3v-6Z" /></>,
  book: <><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M4 21.5V4.5M8 7h8M8 11h6" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></>,
  route: <><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 15v2M11 10v7M15 12v5M19 6v11" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  heart: <path d="M12 20.5S3.5 15.4 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7c0 6.2-8.5 11.3-8.5 11.3Z" />,
  stethoscope: <><path d="M6 3v6a5 5 0 0 0 10 0V3" /><path d="M11 14v1a5 5 0 0 0 10 0v-2" /><circle cx="21" cy="11" r="1.6" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5Z" /></>,
  car: <><path d="M5 17H3v-5l2-5h14l2 5v5h-2" /><path d="M3 12h18" /><circle cx="7.5" cy="17" r="2" /><circle cx="16.5" cy="17" r="2" /></>,
  pill: <><rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-35 12 12)" /><path d="m9.2 7.8 5.6 8" /></>,
  chat: <path d="M20 15a3 3 0 0 1-3 3H8l-5 3.5V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  shield: <><path d="M12 21.5s8-3.5 8-10V5l-8-3-8 3v6.5c0 6.5 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 17v3h16v-3" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 3v5h5M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 21v-5h-5" /></>,
  handoff: <><path d="M4 12h12M12 6l6 6-6 6" /><path d="M20 4v16" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></>,
  map: <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Z" /><path d="M9 4v14M15 6v14" /></>,
  play: <path d="M7 4v16l13-8Z" />,
  layers: <><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={`icon i-${name} ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {P[name] ?? P.grid}
    </svg>
  );
}

/** The four-pointed sparkle that marks anything SANAD Intelligence does. */
export function Sparkle({ size = 18, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg aria-hidden="true" className={`sparkle ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#5E84E2" />
          <stop offset=".5" stopColor="#43A8B2" />
          <stop offset="1" stopColor="#86C159" />
        </linearGradient>
      </defs>
      <path fill={`url(#g${id})`} d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5-.6-5.6-4.9-9.9-10.5-10.5C7.1 11.4 11.4 7.1 12 1.5Z" />
    </svg>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`logo ${light ? 'logo-light' : ''}`}>
      <span className="logo-word">SANAD</span>
      <Sparkle size={12} />
    </span>
  );
}

export function Avatar({ user, size = 32 }: { user: Pick<User, 'initials' | 'color' | 'name'> | null | undefined; size?: number }) {
  if (!user) {
    return (
      <span className="avatar avatar-empty" style={{ width: size, height: size }} aria-label="Unassigned">
        <Icon name="user" size={size * 0.5} />
      </span>
    );
  }
  const arName = isAr() ? tc(user.name) : '';
  const initials =
    arName && arName !== user.name
      ? arName
          .replace(/^د\.\s*/, '')
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w.replace(/^ال/, '')[0] ?? '')
          .join('\u200c')
      : user.initials;
  return (
    <span className="avatar" style={{ width: size, height: size, background: user.color, fontSize: size * 0.38 }} title={tc(user.name)} aria-hidden="true">
      {initials}
    </span>
  );
}

export function PriorityPill({ p }: { p: Priority }) {
  return <span className={`pill pri-${p}`}>{p === 'urgent' ? 'Urgent' : p[0].toUpperCase() + p.slice(1)}</span>;
}

export function StagePill({ s }: { s: Stage }) {
  return <span className={`pill stage-${s}`}>{STAGE_LABEL[s]}</span>;
}

export function RoleTag({ role }: { role: Role }) {
  return (
    <span className="role-tag">
      <Icon name={ROLE_ICON[role]} size={14} />
      {ROLE_LABEL[role]}
    </span>
  );
}

export function SlaBadge({ c }: { c: Challenge }) {
  const { now } = useApp();
  const s = slaText(c, now);
  return (
    <span className={`sla sla-${s.tone}`}>
      <Icon name="clock" size={13} />
      {s.text}
    </span>
  );
}

export function Stepper({ stage }: { stage: Stage }) {
  const idx = STAGES.indexOf(stage);
  return (
    <ol className="stepper" aria-label={t('Workflow: {stage}', { stage: t(STAGE_LABEL[stage]) })}>
      {STAGES.map((s, i) => (
        <li key={s} className={i < idx ? 'done' : i === idx ? 'current' : ''} aria-current={i === idx ? 'step' : undefined}>
          <span className="dot">{i < idx ? <Icon name="check" size={12} /> : i + 1}</span>
          <span className="lbl">{STAGE_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input, textarea, select, button:not(.modal-x)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, textarea, select')];
        if (!items.length) return;
        const [a, b] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn modal-x" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, group }: { label: string; hint?: string; children: ReactNode; group?: boolean }) {
  if (group) {
    return (
      <div className="field" role="group" aria-label={label}>
        <span className="field-label">{label}</span>
        {children}
        {hint && <span className="field-hint">{hint}</span>}
      </div>
    );
  }
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Empty({ icon = 'check', title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast-${x.tone}`}>
          <Icon name={x.tone === 'ok' ? 'check' : 'flag'} size={16} />
          {x.m ? tm(x.m) : t(x.text)}
        </div>
      ))}
    </div>
  );
}

export function ChallengeRow({ c, view, action }: { c: Challenge; view: View; action?: ReactNode }) {
  const assignee = view.users.find((u) => u.id === c.assigneeId);
  return (
    <div className={`crow ${c.escalated ? 'crow-esc' : ''}`}>
      <Link to={`/app/challenges/${c.id}`} className="crow-main">
        <span className="crow-top">
          <span className="ref">{c.ref}</span>
          <PriorityPill p={c.priority} />
          <StagePill s={c.stage} />
          {c.escalated && (
            <span className="pill pill-esc">
              <Icon name="flag" size={12} /> Escalated
            </span>
          )}
        </span>
        <span className="crow-title">{c.title}</span>
        <span className="crow-meta">
          {recipientName(view, c.recipientId)} · {CATEGORY_LABEL[c.category]} · <SlaBadge c={c} />
        </span>
      </Link>
      <span className="crow-owner" title={`${userName(view, c.assigneeId)} · ${ROLE_LABEL[c.role]}`}>
        <Avatar user={assignee} size={30} />
        <span className="crow-owner-txt">
          <strong>{assignee ? assignee.name : 'Team queue'}</strong>
          <small>{ROLE_LABEL[c.role]}</small>
        </span>
      </span>
      {action && <span className="crow-act">{action}</span>}
    </div>
  );
}

export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span className="meter" role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}
