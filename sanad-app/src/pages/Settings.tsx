import { useEffect, useState, type FormEvent } from 'react';
import type { SystemStatus } from '../lib/backend';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABEL, isHousehold } from '../../shared/types';
import { useSession } from '../lib/store';
import { downloadJson } from '../lib/format';
import { useLanguage } from '../lib/lang';
import { Avatar, Field, Icon, Modal } from '../components/ui';
import { NotifySettings } from '../components/monitoring';
import { readDisplay, saveDisplay, type Display } from '../lib/display';
import { t } from '../lib/i18n';

export function SettingsPage() {
  const { me, act, backend, token, toast, replaceView, signOut, adoptToken } = useSession();
  const nav = useNavigate();
  const { lang, setLang } = useLanguage();
  const [name, setName] = useState(me.name);
  const [title, setTitle] = useState(me.title);
  const [skills, setSkills] = useState(me.skills.join(', '));
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [confirmReset, setConfirmReset] = useState(false);

  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    void act({ type: 'update_profile', name, title, skills: skills.split(',') });
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast('The new passwords do not match', 'error');
    try {
      const r = await backend.changePassword(token, pw.current, pw.next);
      if (r.token) adoptToken(r.token);
      toast(r.message);
      setPw({ current: '', next: '', confirm: '' });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const doExport = async () => {
    try {
      const data = await backend.exportData(token);
      if (__SANAD_MODE__ === 'demo') {
        // Hosted demo pages can't start downloads, so the export goes to the clipboard instead.
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        toast('Your data was copied to the clipboard as JSON');
        return;
      }
      downloadJson(data, `sanad-export-${new Date().toISOString().slice(0, 10)}.json`);
      toast('Export downloaded');
    } catch (err) {
      toast(__SANAD_MODE__ === 'demo' ? 'Copying was blocked by the browser. Run SANAD locally to download a JSON export.' : (err as Error).message, 'error');
    }
  };
  const doReset = async () => {
    try {
      const r = await backend.reset(token);
      replaceView(r.view);
      toast(r.message);
      setConfirmReset(false);
      nav('/app');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">Settings</h1>
          <p className="muted">Your profile, availability and data.</p>
        </div>
      </header>
      <div className="cols cols-even">
        <form className="panel form" onSubmit={saveProfile}>
          <header className="panel-head">
            <h2>Profile</h2>
          </header>
          <div className="owner">
            <Avatar user={me} size={52} />
            <span>
              <strong>{me.name}</strong>
              <small>
                {ROLE_LABEL[me.role]} · {me.email}
              </small>
            </span>
          </div>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Job title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          {!isHousehold(me.role) && (
            <Field label="Skills" hint="Comma separated. Problems that mention these come to you first.">
              <input value={skills} onChange={(e) => setSkills(e.target.value)} />
            </Field>
          )}
          <button type="submit" className="btn btn-dark" disabled={name.trim().length < 2}>
            Save profile
          </button>
        </form>

        <div className="stack">
          {!isHousehold(me.role) && (
            <section className="panel">
              <header className="panel-head">
                <h2>Availability</h2>
              </header>
              <label className="switch">
                <input type="checkbox" checked={me.available} onChange={(e) => act({ type: 'set_availability', userId: me.id, available: e.target.checked })} />
                <span className="switch-ui" aria-hidden="true" />
                {me.available ? 'Available for new work' : 'Away'}
              </label>
              <p className="muted small">When you’re away, work you haven’t started moves to an available teammate, and new problems skip you.</p>
            </section>
          )}
          <section className="panel">
            <header className="panel-head">
              <h2>Language</h2>
            </header>
            <p className="muted small">Choose the language for SANAD on this device.</p>
            <div className="seg" role="group" aria-label="Language">
              <button type="button" data-raw="" lang="en" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
                English
              </button>
              <button type="button" data-raw="" lang="ar" className={lang === 'ar' ? 'on' : ''} aria-pressed={lang === 'ar'} onClick={() => setLang('ar')}>
                العربية
              </button>
            </div>
          </section>
          <form className="panel form" onSubmit={changePw}>
            <header className="panel-head">
              <h2>Password</h2>
            </header>
            <Field label="Current password">
              <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <div className="grid-2">
              <Field label="New password">
                <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              </Field>
              <Field label="Repeat new password">
                <input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
              </Field>
            </div>
            <button type="submit" className="btn btn-light" disabled={!pw.current || pw.next.length < 8}>
              Change password
            </button>
          </form>
          <section className="panel">
            <header className="panel-head">
              <h2>Data</h2>
            </header>
            <p className="muted small">
              {backend.mode === 'server'
                ? 'Connected to the SANAD server. Changes are shared live with everyone and saved on the server.'
                : 'Running in this browser. Changes are saved here and shared between your open tabs.'}
            </p>
            <div className="row gap-s wrap">
              <button type="button" className="btn btn-light" onClick={doExport}>
                <Icon name="download" size={16} /> {__SANAD_MODE__ === 'demo' ? 'Copy my data' : 'Export my data'}
              </button>
              {me.role === 'coordinator' && backend.demo && (
                <button type="button" className="btn btn-light danger" onClick={() => setConfirmReset(true)}>
                  <Icon name="refresh" size={16} /> Reset demo data
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  signOut();
                  nav('/signin');
                }}
              >
                <Icon name="logout" size={16} /> Sign out
              </button>
              {backend.mode === 'server' && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    try {
                      toast(await backend.logoutAll(token));
                    } finally {
                      signOut();
                      nav('/signin');
                    }
                  }}
                >
                  <Icon name="shield" size={16} /> Sign out on all devices
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
      <div className="cols cols-even settings-more">
        {me.role !== 'admin' && <NotifySettings />}
        <DisplaySettings />
      </div>
      {(me.role === 'coordinator' || me.role === 'admin') && <SystemStatusPanel />}
      {confirmReset && (
        <Modal
          title="Reset the demo workspace?"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
                Keep my data
              </button>
              <button type="button" className="btn btn-dark" onClick={doReset}>
                Reset everything
              </button>
            </>
          }
        >
          <p>All challenges, playbooks, rules and people go back to the starting demo. Passwords return to “sanad123”. This cannot be undone.</p>
        </Modal>
      )}
    </div>
  );
}

/** Text size and motion for this device. */
function DisplaySettings() {
  const [d, setD] = useState<Display>(readDisplay);
  const set = (next: Display) => {
    setD(next);
    saveDisplay(next);
  };
  return (
    <section className="panel form" aria-labelledby="display-h">
      <header className="panel-head">
        <h2 id="display-h">{t('Display')}</h2>
      </header>
      <fieldset className="plain">
        <legend className="field-label">{t('Text size')}</legend>
        <div className="seg" role="radiogroup" aria-label={t('Text size')}>
          {(
            [
              ['normal', 'Standard'],
              ['large', 'Large'],
              ['larger', 'Larger'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={d.text === v} className={d.text === v ? 'on' : ''} onClick={() => set({ ...d, text: v })}>
              {t(label)}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={d.motion === 'reduce'} onChange={(e) => set({ ...d, motion: e.target.checked ? 'reduce' : 'system' })} />
        <span>{t('Reduce motion (no animations or smooth scrolling)')}</span>
      </label>
      <p className="small muted">{t('Saved on this device only. SANAD also follows your device’s own “reduce motion” setting.')}</p>
    </section>
  );
}

/** Health of the SANAD server for coordinators and admins: counts and timings only. */
function SystemStatusPanel() {
  const { backend, token } = useSession();
  const [s, setS] = useState<SystemStatus | null | 'error'>(null);
  useEffect(() => {
    backend.systemStatus(token).then(setS, () => setS('error'));
  }, [backend, token]);
  if (backend.mode !== 'server') {
    return (
      <section className="panel settings-more">
        <h2>{t('System status')}</h2>
        <p className="muted small">{t('This is the browser demo: everything runs in this browser, so there is no server to monitor.')}</p>
      </section>
    );
  }
  if (!s) return null;
  if (s === 'error') return <p className="form-error">{t('System status could not be loaded.')}</p>;
  const rows: [string, string | number][] = [
    ['Running for', `${Math.floor(s.uptimeSeconds / 3600)} h ${Math.floor((s.uptimeSeconds % 3600) / 60)} min`],
    ['Mode', t(s.demo ? 'Demo' : 'Production')],
    ['Data storage', t(s.storage === 'file' ? 'File on the server' : 'Memory only')],
    ['AI model for the assistant', t(s.model ? 'Connected' : 'Not connected')],
    ['Requests', s.requests],
    ['Server errors', s.errors5xx],
    ['Refused or invalid requests', s.errors4xx],
    ['Failed sign-ins / paused', `${s.loginFailures} / ${s.lockouts}`],
    ['Errors reported by browsers', s.clientErrors],
    ['Background checks run', `${s.sweep.runs} (${t('last took {ms} ms', { ms: s.sweep.lastMs })}${s.sweep.failures ? `, ${t('{n} failed', { n: s.sweep.failures })}` : ''})`],
    ['Open monitoring alerts', s.records.alertsOpen],
  ];
  return (
    <section className="panel settings-more" aria-labelledby="status-h">
      <header className="panel-head">
        <h2 id="status-h">{t('System status')}</h2>
      </header>
      <table className="data-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{t(k)}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">{t('Counts since the server started. No personal information is collected here.')}</p>
    </section>
  );
}
