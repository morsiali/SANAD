import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, isHousehold } from '../../shared/types';
import { isActive } from '../../shared/routing';
import { useApp } from '../lib/store';
import { t } from '../lib/i18n';
import { ActionProvider } from './actions';
import { AssistantProvider, useAssistant, usePageContext } from './assistant';
import { isDue } from './monitoring';
import { LangToggle } from '../lib/lang';
import { Avatar, Icon, Logo, Sparkle } from './ui';

export function Shell() {
  const { ready, view, me, token } = useApp();
  if (!ready) return <Loading />;
  if (!token || !view || !me) return <Navigate to="/signin" replace />;
  return (
    <ActionProvider>
      <AssistantProvider>
        <Frame />
      </AssistantProvider>
    </ActionProvider>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status">
      <Sparkle size={34} className="spin" />
      <span>Loading SANAD…</span>
    </div>
  );
}

function Frame() {
  const { view, me, signOut } = useApp() as ReturnType<typeof useApp> & { view: NonNullable<ReturnType<typeof useApp>['view']>; me: NonNullable<ReturnType<typeof useApp>['me']> };
  const nav = useNavigate();
  const loc = useLocation();
  const assistant = useAssistant();
  const page = usePageContext();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrawer(false);
    setMenu(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  // Notifications held for quiet hours are not counted until the quiet hours end.
  const unread = view.notifications.filter((n) => isDue(n, Date.now())).length;
  const mine = view.challenges.filter((c) => c.assigneeId === me.id && isActive(c)).length;
  const toConfirm = view.challenges.filter((c) => c.stage === 'resolved' && (c.reporterId === me.id || (isHousehold(me.role) && me.recipients.includes(c.recipientId)))).length;
  const approvalsForMe = view.approvals.filter((a) => a.status === 'pending' && a.approverIds.includes(me.id) && a.expiresAt >= Date.now()).length + view.invites.filter((i) => i.status === 'pending' && i.email === me.email.toLowerCase() && i.expiresAt > Date.now()).length;
  const isAdmin = me.role === 'admin';
  const triage = me.role === 'coordinator' ? view.challenges.filter((c) => isActive(c) && (c.escalated || c.stage === 'reported' || !c.assigneeId)).length : 0;

  const peopleLabel = me.role === 'self' ? 'My care' : isHousehold(me.role) ? 'My family' : 'People we care for';
  const items = [
    { to: '/app', icon: 'home', label: 'Dashboard', end: true },
    ...(isAdmin ? [] : [{ to: '/app/today', icon: 'sun', label: 'Today' }]),
    { to: '/app/people', icon: 'heart', label: peopleLabel },
    ...(isAdmin ? [] : [{ to: '/app/calendar', icon: 'calendar', label: 'Calendar' }]),
    ...(isAdmin ? [] : [{ to: '/app/forecast', icon: 'clock', label: 'Coming up' }]),
    ...(isAdmin ? [] : [{ to: '/app/challenges', icon: 'layers', label: 'Challenges', badge: mine + toConfirm + triage || undefined }]),
    ...(isAdmin ? [] : [{ to: '/app/report', icon: 'plus', label: 'Report a challenge' }]),
    { to: '/app/approvals', icon: 'shield', label: 'Approvals', badge: approvalsForMe || undefined },
    { to: '/app/workflow', icon: 'map', label: 'How SANAD works' },
    ...(isAdmin ? [] : [{ to: '/app/intelligence', icon: 'sparkle', label: 'Ask SANAD' }]),
    ...(isAdmin ? [] : [{ to: '/app/playbooks', icon: 'book', label: 'Playbooks' }]),
    { to: '/app/inbox', icon: 'inbox', label: 'Inbox', badge: unread || undefined },
    { to: '/app/team', icon: 'users', label: isHousehold(me.role) ? 'Care team' : 'Team' },
    ...(isAdmin ? [] : [{ to: '/app/routing', icon: 'route', label: me.role === 'coordinator' ? 'Routing rules' : 'How routing works' }]),
    ...(isAdmin ? [] : [{ to: '/app/analytics', icon: 'chart', label: 'Insights' }]),
    { to: '/app/settings', icon: 'settings', label: 'Settings' },
  ];

  // The top search box opens the assistant beside the current page, aware of the person being viewed.
  const onAsk = (e: FormEvent) => {
    e.preventDefault();
    if (isAdmin) return;
    if (loc.pathname.startsWith('/app/intelligence')) {
      nav(q.trim() ? `/app/intelligence?q=${encodeURIComponent(q.trim())}` : '/app/intelligence');
    } else {
      assistant.open(q.trim() ? { question: q.trim(), recipientId: page.recipientId } : undefined);
    }
    setQ('');
  };

  return (
    <div className="shell">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <aside className={`side ${drawer ? 'side-open' : ''}`} aria-label="Main navigation">
        <div className="side-head">
          <Link to="/app" aria-label="SANAD dashboard">
            <Logo />
          </Link>
          <button type="button" className="icon-btn side-x" onClick={() => setDrawer(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <div className="side-me">
          <Avatar user={me} size={38} />
          <span>
            <strong>{me.name}</strong>
            <small>{isHousehold(me.role) ? me.title : `${ROLE_LABEL[me.role]} · ${me.org}`}</small>
          </span>
        </div>
        <nav className="side-nav">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive: a }) => `side-link ${a ? 'on' : ''}`}>
              {it.icon === 'sparkle' ? <Sparkle size={18} /> : <Icon name={it.icon} />}
              <span>{it.label}</span>
              {it.badge ? <em aria-label={t('{n} need attention', { n: it.badge })}>{it.badge}</em> : null}
            </NavLink>
          ))}
        </nav>
        {!isHousehold(me.role) && !isAdmin && (
        <div className="side-foot">
          <span className={`presence ${me.available ? 'presence-on' : ''}`}>
            <i />
            {me.available ? 'Available for new work' : 'Away — new work goes to teammates'}
          </span>
        </div>
        )}
      </aside>
      {drawer && <div className="side-scrim" onClick={() => setDrawer(false)} />}

      <div className="main-col">
        <header className="topbar">
          <button type="button" className="icon-btn burger" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          {!isAdmin && <form className="ask" onSubmit={onAsk} role="search">
            <Sparkle size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask SANAD — “what should I focus on next?”" aria-label="Ask SANAD" />
            <kbd>Enter</kbd>
          </form>}
          <div className="top-right">
            {!isAdmin && (
              <Link to="/app/report" className="btn btn-dark btn-sm top-report">
                <Icon name="plus" size={16} />
                <span>Report</span>
              </Link>
            )}
            <LangToggle />
            <Link to="/app/inbox" className="icon-btn bell" aria-label={t('Inbox, {n} unread', { n: unread })}>
              <Icon name="bell" />
              {unread > 0 && <em>{unread > 9 ? '9+' : unread}</em>}
            </Link>
            <div className="me-menu" ref={menuRef}>
              <button type="button" className="me-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" aria-label="Account menu">
                <Avatar user={me} size={34} />
              </button>
              {menu && (
                <div className="menu" role="menu">
                  <div className="menu-head">
                    <strong>{me.name}</strong>
                    <small>{me.email}</small>
                  </div>
                  <Link role="menuitem" to="/app/settings">
                    <Icon name="settings" size={16} /> Settings
                  </Link>
                  <Link role="menuitem" to="/home">
                    <Icon name="home" size={16} /> SANAD website
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      signOut();
                      nav('/signin');
                    }}
                  >
                    <Icon name="logout" size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className={`content ${assistant.isOpen ? 'content-with-assist' : ''}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
