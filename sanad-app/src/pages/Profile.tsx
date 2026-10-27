import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Domain, Recipient } from '../../shared/types';
import { isActive } from '../../shared/routing';
import { DOMAIN_LABEL, OPTIONAL_DOMAINS, canWrite } from '../../shared/access';
import { useSession } from '../lib/store';
import { t, tc, tm } from '../lib/i18n';
import { dateTime, timeAgo } from '../lib/format';
import { alertsFor, lastUpdate, myMembership, nextDose, profileTabs } from '../lib/people';
import { ChallengeRow, Empty, Field, Icon, Modal } from '../components/ui';
import { CareTags } from '../components/CareProfile';
import { MedicationPanel, RecordSection } from '../components/records';
import { CareTeamPanel } from '../components/careteam';
import { EditPerson, PersonAvatar } from './People';

type Tab = Domain | 'history';
const TAB_LABEL: Record<Tab, string> = { ...DOMAIN_LABEL, history: 'Activity history' };

export function Profile() {
  const { id } = useParams();
  const { view, now } = useSession();
  const [sp, setSp] = useSearchParams();
  const r = view.recipients.find((x) => x.id === id && !x.limited);
  if (!r || !view.access[r.id]) {
    return (
      <div className="page">
        <Empty icon="shield" title="You can’t open this profile" text="Only the person’s care team can see it. Ask the person, their guardian or their care coordinator to invite you." action={<Link to="/app/people" className="btn btn-dark btn-sm">{t('Back to people')}</Link>} />
      </div>
    );
  }
  const tabs = profileTabs(view, r);
  const asked = sp.get('tab') as Tab | null;
  const tab: Tab = asked && tabs.includes(asked) ? asked : 'overview';
  const mem = myMembership(view, r.id, now);

  return (
    <div className="page profile">
      <nav className="crumbs" aria-label={t('Breadcrumb')}>
        <Link to="/app/people">{t('People')}</Link> <span aria-hidden="true">/</span> <span>{tc(r.name)}</span>
      </nav>
      <header className="profile-head">
        <PersonAvatar r={r} size={72} />
        <div>
          <h1 className="display-s">{tc(r.name)}</h1>
          <p className="muted">
            {t('Age {age} · {area}', { age: r.age, area: tc(r.area) })}
            {r.preferredName && <> · {t('Likes to be called {name}', { name: tc(r.preferredName) })}</>}
            {mem && mem.relationship !== 'Self' && <> · {t('Your role: {rel}', { rel: tc(mem.relationship) })}</>}
          </p>
          <CareTags r={r} compact />
          <small className="muted">{t('Last update {ago}', { ago: timeAgo(lastUpdate(view, r) || now, now) })}</small>
        </div>
      </header>

      <div className="tabs profile-tabs" role="tablist" aria-label={t('Profile sections')}>
        {tabs.map((x) => (
          <button key={x} type="button" role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls="profile-panel" className={`tab ${tab === x ? 'tab-on' : ''}`} onClick={() => setSp(x === 'overview' ? {} : { tab: x })}>
            {t(TAB_LABEL[x])}
          </button>
        ))}
      </div>

      <div id="profile-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <Overview r={r} />}
        {tab === 'medical' && (
          <>
            <MedicationPanel recipientId={r.id} />
            <RecordSection recipientId={r.id} domain="medical" title="Medical record" intro="Conditions, allergies, measurements and results. Diagnoses can only be entered by doctors; everything shows who wrote it and whether it was verified." />
          </>
        )}
        {tab === 'wellbeing' && (
          <>
            {view.access[r.id].includes('wellbeing') && (
              <RecordSection recipientId={r.id} domain="wellbeing" title="Psychological well-being" intro="Check-ins and observations are labelled by who reported them. Nothing here is a diagnosis." />
            )}
            {view.access[r.id].includes('wellbeing_notes') && (
              <RecordSection recipientId={r.id} domain="wellbeing_notes" title="Private therapy notes" intro="Restricted: only people given access to private therapy notes can see this section. It is kept apart from general household information." />
            )}
          </>
        )}
        {tab === 'academic' && <RecordSection recipientId={r.id} domain="academic" title="Academic development" intro="School, learning goals and accommodations. Educators do not get access to medical or psychological records unless the family grants it separately." />}
        {tab === 'social' && <RecordSection recipientId={r.id} domain="social" title="Social development" intro="Progress is measured against goals the person chose or agreed — being more social is not automatically better." />}
        {tab === 'activity' && <RecordSection recipientId={r.id} domain="activity" title="Sports & physical activity" intro="Activities they enjoy and take part in, within any restrictions recorded by their clinicians." />}
        {tab === 'rehab' && <RecordSection recipientId={r.id} domain="rehab" title="Physiotherapy & rehabilitation" intro="Plans and exercises come only from physiotherapists. Anyone on the team can log completion, pain or difficulty." />}
        {tab === 'team' && <CareTeamPanel recipientId={r.id} />}
        {tab === 'history' && <History r={r} />}
      </div>
    </div>
  );
}

function Overview({ r }: { r: Recipient }) {
  const { view, me, now } = useSession();
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [editingCare, setEditingCare] = useState(false);
  const alerts = alertsFor(view, r, now);
  const next = nextDose(view, r.id, now);
  const open = view.challenges.filter((c) => c.recipientId === r.id && isActive(c));
  const editable = canWrite(view, me.id, r.id, 'overview', now);
  const can = view.access[r.id] ?? [];
  const latest = (domain: Domain) => view.records.filter((x) => x.recipientId === r.id && x.domain === domain && !x.archived).sort((a, b) => b.observedAt - a.observedAt)[0];
  const summaryDomains = (['medical', 'wellbeing', 'academic', 'social', 'activity', 'rehab'] as Domain[]).filter((d) => can.includes(d) && !r.hidden?.includes(d));

  return (
    <div className="cols">
      <div className="col-main">
        {alerts.length > 0 && (
          <section className="panel" aria-labelledby="alerts-h">
            <header className="panel-head">
              <h2 id="alerts-h">{t('Needs attention')}</h2>
            </header>
            <ul className="alerts">
              {alerts.map((a) => (
                <li key={a.key} className={`alert alert-${a.tone}`}>
                  <Link to={a.to}>{t(a.text, a.vars)}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="panel" aria-labelledby="latest-h">
          <header className="panel-head">
            <h2 id="latest-h">{t('Latest in each section')}</h2>
          </header>
          {summaryDomains.length ? (
            <ul className="latest">
              {summaryDomains.map((d) => {
                const rec = latest(d);
                return (
                  <li key={d}>
                    <Link to={`/app/people/${r.id}?tab=${d}`} className="latest-link">
                      <span className="latest-domain">{t(DOMAIN_LABEL[d])}</span>
                      <span>{rec ? tc(rec.title) : t('Nothing recorded yet')}</span>
                      {rec && <small className="muted">{timeAgo(rec.observedAt, now)}</small>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted small">{t('Your access covers the overview and care team only. Detailed records are visible to the care team members who have been given access.')}</p>
          )}
          {next && (
            <p className="small">
              <Icon name="clock" size={14} /> {t('Next medicine: {med} at {time}', { med: tc(next.med.name), time: dateTime(next.at) })}
            </p>
          )}
        </section>
        <section className="panel" aria-labelledby="open-h">
          <header className="panel-head">
            <h2 id="open-h">{t('Open problems')}</h2>
            {me.role !== 'admin' && (
              <Link to={`/app/report?person=${r.id}`} className="btn btn-dark btn-sm">
                <Icon name="plus" size={14} /> {t('Report a problem')}
              </Link>
            )}
          </header>
          {open.length ? (
            <div className="rows">
              {open.map((c) => (
                <ChallengeRow key={c.id} c={c} view={view} />
              ))}
            </div>
          ) : (
            <Empty title="No open problems" text="Anything reported for this person will appear here." />
          )}
        </section>
      </div>
      <aside className="col-side">
        <section className="panel" aria-labelledby="prefs-h">
          <header className="panel-head">
            <h2 id="prefs-h">{t('Preferences')}</h2>
            {editable && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingPrefs(true)}>
                <Icon name="edit" size={14} /> {t('Edit')}
              </button>
            )}
          </header>
          <dl className="facts">
            <dt>{t('Preferred name')}</dt>
            <dd>{r.preferredName ? tc(r.preferredName) : t('Not set')}</dd>
            <dt>{t('Communication')}</dt>
            <dd>{r.communication ? tc(r.communication) : t('Not set')}</dd>
            <dt>{t('Languages')}</dt>
            <dd>{r.languages?.length ? r.languages.map((l) => t(l)).join(', ') : t('Not set')}</dd>
            <dt>{t('Hidden sections')}</dt>
            <dd>{r.hidden?.length ? r.hidden.map((d) => t(DOMAIN_LABEL[d])).join(', ') : t('None')}</dd>
          </dl>
        </section>
        <section className="panel" aria-labelledby="cat-h">
          <header className="panel-head">
            <h2 id="cat-h">{t('Care category')}</h2>
            {editable && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingCare(true)}>
                <Icon name="edit" size={14} /> {t('Edit')}
              </button>
            )}
          </header>
          <CareTags r={r} />
          {r.note && <p className="small">{tc(r.note)}</p>}
        </section>
      </aside>
      {editingPrefs && <PrefsModal r={r} onClose={() => setEditingPrefs(false)} />}
      {editingCare && <EditPerson recipientId={r.id} onClose={() => setEditingCare(false)} />}
    </div>
  );
}

function PrefsModal({ r, onClose }: { r: Recipient; onClose: () => void }) {
  const { act, toast } = useSession();
  const [f, setF] = useState({ preferredName: r.preferredName ?? '', communication: r.communication ?? '', languages: (r.languages ?? []).join(', ') });
  const [hidden, setHidden] = useState<Domain[]>(r.hidden ?? []);
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const onFile = (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 110_000) {
      toast(t('Use a PNG, JPEG or WebP photo under 100 KB'), 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <Modal
      title={t('Preferences for {name}', { name: tc(r.name) })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-dark"
            onClick={async () => {
              const res = await act({ type: 'update_preferences', recipientId: r.id, preferredName: f.preferredName, communication: f.communication, languages: f.languages.split(/[,،]/).map((x) => x.trim()).filter(Boolean), hidden, photo });
              if (res.ok) onClose();
            }}
          >
            {t('Save changes')}
          </button>
        </>
      }
    >
      <Field label={t('Preferred name')}>
        <input id="pref-name" value={f.preferredName} onChange={(e) => setF({ ...f, preferredName: e.target.value })} />
      </Field>
      <Field label={t('Communication preferences')} hint={t('How they like to be spoken to and kept informed.')}>
        <textarea id="pref-comm" rows={3} value={f.communication} onChange={(e) => setF({ ...f, communication: e.target.value })} />
      </Field>
      <Field label={t('Languages')} hint={t('Separate with commas')}>
        <input id="pref-langs" value={f.languages} onChange={(e) => setF({ ...f, languages: e.target.value })} />
      </Field>
      <Field label={t('Photo (optional)')} hint={t('PNG, JPEG or WebP under 100 KB. Only people on the care team see it.')}>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])} />
      </Field>
      {(r.photo || photo) && (
        <button type="button" className="link small" onClick={() => setPhoto(null)}>
          {t('Remove photo')}
        </button>
      )}
      <fieldset className="checks">
        <legend>{t('Sections that do not apply')}</legend>
        {OPTIONAL_DOMAINS.map((d) => (
          <label key={d} className="check">
            <input type="checkbox" checked={hidden.includes(d)} onChange={(e) => setHidden(e.target.checked ? [...hidden, d] : hidden.filter((x) => x !== d))} /> {t(DOMAIN_LABEL[d])}
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}

function History({ r }: { r: Recipient }) {
  const { view, now } = useSession();
  const events = view.audit.filter((e) => e.recipientId === r.id).sort((a, b) => b.at - a.at);
  return (
    <section className="panel" aria-labelledby="hist-h">
      <header className="panel-head">
        <h2 id="hist-h">{t('Activity history')}</h2>
      </header>
      <p className="muted small">{t('Every change to this profile is recorded. You only see entries about information you are allowed to see.')}</p>
      {events.length ? (
        <ol className="audit">
          {events.map((e) => (
            <li key={e.id}>
              <span>{tm(e.m)}</span>
              <small className="muted">
                {t(DOMAIN_LABEL[e.domain])} · {timeAgo(e.at, now)} · {dateTime(e.at)}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <Empty title="No activity yet" />
      )}
    </section>
  );
}

