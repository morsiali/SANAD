import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABEL } from '../../shared/types';
import { isActive } from '../../shared/routing';
import { useApp } from '../lib/store';
import { t } from '../lib/i18n';
import { ActionProvider } from './actions';
import { LangToggle } from '../lib/lang';
import { Avatar, Icon, Logo, Sparkle } from './ui';

export function Shell() {
  const { ready, view, me, token } = useApp();
  if (!ready) return <Loading />;
  if (!token || !view || !me) return <Navigate to="/signin" replace />;
  return (
    <ActionProvider>
      <Frame />
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

  const unread = view.notifications.filter((n) => !n.read).length;
  const mine = view.challenges.filter((c) => c.assigneeId === me.id && isActive(c)).length;
  const toConfirm = view.challenges.filter((c) => c.stage === 'resolved' && (c.reporterId === me.id || (me.role === 'family' && me.recipients.includes(c.recipientId)))).length;
  const triage = me.role === 'coordinator' ? view.challenges.filter((c) => isActive(c) && (c.escalated || c.stage === 'reported' || !c.assigneeId)).length : 0;

  const items = [
    { to: '/app', icon: 'home', label: 'Dashboard', end: true },
    { to: '/app/challenges', icon: 'layers', label: 'Challenges', badge: mine + toConfirm + triage || undefined },
    { to: '/app/report', icon: 'plus', label: 'Report a challenge' },
    { to: '/app/intelligence', icon: 'sparkle', label: 'Ask SANAD' },
    { to: '/app/playbooks', icon: 'book', label: 'Playbooks' },
    { to: '/app/inbox', icon: 'inbox', label: 'Inbox', badge: unread || undefined },
    { to: '/app/team', icon: 'users', label: me.role === 'family' ? 'Care team' : 'Team & people' },
    { to: '/app/routing', icon: 'route', label: me.role === 'coordinator' ? 'Routing rules' : 'How routing works' },
    { to: '/app/analytics', icon: 'chart', label: 'Insights' },
    { to: '/app/settings', icon: 'settings', label: 'Settings' },
  ];

  const onAsk = (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return nav('/app/intelligence');
    nav(`/app/intelligence?q=${encodeURIComponent(q.trim())}`);
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
            <small>{me.role === 'family' ? me.title : `${ROLE_LABEL[me.role]} · ${me.org}`}</small>
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
        {me.role !== 'family' && (
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
          <form className="ask" onSubmit={onAsk} role="search">
            <Sparkle size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask SANAD — “what should I focus on next?”" aria-label="Ask SANAD" />
            <kbd>Enter</kbd>
          </form>
          <div className="top-right">
            <Link to="/app/report" className="btn btn-dark btn-sm top-report">
              <Icon name="plus" size={16} />
              <span>Report</span>
            </Link>
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
                  <Link role="menuitem" to="/">
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
        <main id="main" className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
