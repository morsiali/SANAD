import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Notification } from '../../shared/types';
import { useSession } from '../lib/store';
import { locale, t, tc, tm, tn } from '../lib/i18n';
import { timeAgo } from '../lib/format';
import { Empty, Icon } from '../components/ui';

const KIND_ICON: Record<Notification['kind'], string> = {
  assigned: 'layers',
  update: 'refresh',
  escalation: 'flag',
  resolved: 'check',
  comment: 'chat',
  system: 'bell',
};

export function Inbox() {
  const { view, act, now } = useSession();
  const nav = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const items = view.notifications.filter((n) => filter === 'all' || !n.read);
  const unread = view.notifications.filter((n) => !n.read).length;

  const open = async (n: Notification) => {
    if (!n.read) await act({ type: 'mark_read', notificationId: n.id }, { quiet: true });
    if (n.challengeId && view.challenges.some((c) => c.id === n.challengeId)) return nav(`/app/challenges/${n.challengeId}`);
    if (n.link) return nav(n.link);
    const k = n.m?.k ?? '';
    if (k.startsWith('n_approval') || k === 'n_invited') return nav('/app/approvals');
    if (k === 'n_dose_missed' || k === 'n_access_changed' || k === 'n_joined_team' || k === 'n_authority_verified') return nav('/app/people');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">Inbox</h1>
          <p className="muted">{unread ? tn('{n} unread update', '{n} unread updates', unread) : t('You’re up to date.')}</p>
        </div>
        <button type="button" className="btn btn-light" disabled={!unread} onClick={() => act({ type: 'mark_read', notificationId: 'all' })}>
          <Icon name="check" size={16} /> Mark all as read
        </button>
      </header>
      <div className="tabs" role="tablist">
        {(['all', 'unread'] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={`tab ${filter === f ? 'tab-on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? t('All') : t('Unread ({n})', { n: unread })}
          </button>
        ))}
      </div>
      <section className="panel">
        {items.length ? (
          <ul className="notes">
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" className={`note ${n.read ? '' : 'note-new'} note-${n.kind}`} onClick={() => open(n)}>
                  <span className="note-icon">
                    <Icon name={KIND_ICON[n.kind]} size={16} />
                  </span>
                  <span className="note-text">
                    {n.m ? tm(n.m) : n.text}
                    {n.heldUntil && n.heldUntil > now && <em className="note-held"> · {t('Held for your quiet hours until {time}', { time: new Date(n.heldUntil).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</em>}
                    {n.urgent && <em className="note-urgent"> · {t('Urgent')}</em>}
                  </span>
                  <small>{timeAgo(n.at, now)}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="inbox" title={filter === 'unread' ? 'No unread updates' : 'Nothing here yet'} text="You’ll hear about new assignments, replies and fixes here." />
        )}
      </section>
    </div>
  );
}
