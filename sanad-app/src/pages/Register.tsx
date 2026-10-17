import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ROLES, ROLE_LABEL, type Role } from '../../shared/types';
import { SELF_SIGNUP_ROLES } from '../../shared/engine';
import { useApp } from '../lib/store';
import { ApiError } from '../lib/backend';
import { LangToggle } from '../lib/lang';
import { t, tm } from '../lib/i18n';
import { ROLE_ICON } from '../lib/format';
import { ROLE_PITCH } from './Landing';
import { Field, Icon, Logo, Sparkle } from '../components/ui';

const ROLE_BLURB: Record<Role, string> = {
  family: 'I look after a parent or relative',
  caregiver: 'I give care at home',
  doctor: 'I look after patients clinically',
  transport: 'I arrange or drive rides',
  pharmacy: 'I prepare and deliver medicine',
  social: 'I handle benefits, equipment or wellbeing',
  coordinator: 'I oversee the whole care network',
};

const TITLE_HINT: Partial<Record<Role, string>> = {
  caregiver: 'e.g. Home care nurse',
  doctor: 'e.g. Family physician',
  transport: 'e.g. Dispatcher',
  pharmacy: 'e.g. Pharmacist',
  social: 'e.g. Social worker',
};
const SKILL_HINT: Partial<Record<Role, string>> = {
  caregiver: 'e.g. insulin, wound, mobility',
  doctor: 'e.g. diabetes, blood pressure',
  transport: 'e.g. wheelchair, dialysis',
  pharmacy: 'e.g. refill, delivery',
  social: 'e.g. thiqa, equipment',
};

export function Register() {
  const { signUp, token, view, backend } = useApp();
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<Role>('family');
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', title: '', org: '', skills: '', rName: '', rAge: '', rArea: '', rNote: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  if (token && view) return <Navigate to="/app" replace />;

  const isFamily = role === 'family';
  const mismatch = f.confirm.length > 0 && f.confirm !== f.password;
  const short = f.password.length > 0 && f.password.length < 8;
  const ready =
    f.name.trim().length >= 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim()) &&
    f.password.length >= 8 &&
    f.password === f.confirm &&
    (!isFamily || (f.rName.trim().length >= 2 && Number(f.rAge) >= 1 && Number(f.rAge) <= 120));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await signUp({
        role,
        name: f.name,
        email: f.email,
        password: f.password,
        title: f.title,
        org: f.org,
        skills: f.skills.split(/[,،]/),
        recipient: isFamily ? { name: f.rName, age: Number(f.rAge), area: f.rArea, note: f.rNote } : undefined,
      });
      nav('/app');
    } catch (err) {
      setError(err instanceof ApiError && err.m ? tm(err.m) : t((err as Error).message));
      setBusy(false);
    }
  };

  const pitch = ROLE_PITCH.find((p) => p.role === role);

  return (
    <div className="signin">
      <div className="signin-form reg-form">
        <div className="row signin-top">
          <Link to="/home" aria-label="SANAD home">
            <Logo />
          </Link>
          <LangToggle />
        </div>
        <div className="auth-tabs" role="tablist">
          <Link to="/signin" role="tab" aria-selected={false} className="auth-tab">
            {t('Sign in')}
          </Link>
          <span role="tab" aria-selected className="auth-tab on">
            {t('Create account')}
          </span>
        </div>
        <p className="reg-step">{t('Step {n} of 2', { n: step })}</p>
        {step === 1 ? (
          <>
            <h1 className="display">{t('How will you use SANAD?')}</h1>
            <p className="muted">{t('Your role decides what lands on your dashboard and what you can do.')}</p>
            <div className="role-grid" role="radiogroup" aria-label={t('Choose your role')}>
              {ROLES.map((r) => {
                const allowed = SELF_SIGNUP_ROLES.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={role === r}
                    disabled={!allowed}
                    className={`role-card ${role === r ? 'on' : ''}`}
                    onClick={() => setRole(r)}
                  >
                    <span className="role-ico">
                      <Icon name={ROLE_ICON[r]} size={20} />
                    </span>
                    <strong>{t(ROLE_LABEL[r])}</strong>
                    <small>{allowed ? t(ROLE_BLURB[r]) : t('By invitation from a care coordinator')}</small>
                  </button>
                );
              })}
            </div>
            <button type="button" className="btn btn-dark btn-lg" onClick={() => setStep(2)}>
              {t('Continue as {role}', { role: t(ROLE_LABEL[role]) })}
            </button>
          </>
        ) : (
          <form className="form" onSubmit={submit} noValidate>
            <h1 className="display">{t('Your details')}</h1>
            <p className="muted">
              {t('Joining as')} <strong>{t(ROLE_LABEL[role])}</strong> ·{' '}
              <button type="button" className="link" onClick={() => setStep(1)}>
                {t('Change role')}
              </button>
            </p>
            <Field label={t('Full name')}>
              <input id="reg-name" value={f.name} onChange={set('name')} autoComplete="name" required />
            </Field>
            <Field label={t('Email')}>
              <input id="reg-email" type="email" value={f.email} onChange={set('email')} autoComplete="email" required />
            </Field>
            <div className="grid-2">
              <Field label={t('Password')} hint={short ? t('Use at least 8 characters') : t('At least 8 characters')}>
                <input id="reg-password" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" required />
              </Field>
              <Field label={t('Repeat password')} hint={mismatch ? t('The passwords do not match') : undefined}>
                <input id="reg-confirm" type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" required />
              </Field>
            </div>
            {isFamily ? (
              <fieldset className="reg-group">
                <legend>{t('Who do you care for?')}</legend>
                <p className="muted small">{t('Problems you report will be about this person. You can ask the coordinator to add more people later.')}</p>
                <div className="grid-2">
                  <Field label={t('Their full name')}>
                    <input id="reg-rname" value={f.rName} onChange={set('rName')} required />
                  </Field>
                  <Field label={t('Age')}>
                    <input id="reg-rage" type="number" min={1} max={120} value={f.rAge} onChange={set('rAge')} required />
                  </Field>
                </div>
                <Field label={t('Area')}>
                  <input id="reg-rarea" value={f.rArea} onChange={set('rArea')} placeholder={t('e.g. Jumeirah, Dubai')} />
                </Field>
                <Field label={t('Anything the care team should know')} hint={t('Optional — for example mobility, conditions or who lives with them.')}>
                  <textarea id="reg-rnote" rows={2} value={f.rNote} onChange={set('rNote')} />
                </Field>
              </fieldset>
            ) : (
              <fieldset className="reg-group">
                <legend>{t('Your work')}</legend>
                <div className="grid-2">
                  <Field label={t('Job title')}>
                    <input id="reg-title" value={f.title} onChange={set('title')} placeholder={t(TITLE_HINT[role] ?? '')} />
                  </Field>
                  <Field label={t('Organisation')}>
                    <input id="reg-org" value={f.org} onChange={set('org')} />
                  </Field>
                </div>
                <Field label={t('Skills')} hint={t('Comma separated. Problems that mention these come to you first.')}>
                  <input id="reg-skills" value={f.skills} onChange={set('skills')} placeholder={t(SKILL_HINT[role] ?? '')} />
                </Field>
              </fieldset>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="row gap-s wrap">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
                {t('Back')}
              </button>
              <button type="submit" className="btn btn-dark btn-lg" disabled={!ready || busy || !backend}>
                {busy ? t('Creating your account…') : t('Create account')}
              </button>
            </div>
          </form>
        )}
        <p className="small muted">
          {t('Already have an account?')} <Link to="/signin" className="link">{t('Sign in')}</Link>
        </p>
      </div>
      <div className="signin-demo">
        <h2 className="display-m">
          <Sparkle size={22} /> {t(pitch?.head ?? 'See every problem in the network at once')}
        </h2>
        <p>{t(pitch?.text ?? '')}</p>
        {pitch && (
          <ul className="feature-tags reg-tags">
            {pitch.tags.map(([icon, label]) => (
              <li key={label}>
                <Icon name={icon} size={18} /> {t(label)}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">{t('Want to look around first? Sign in as one of the demo people instead — password “sanad123”.')}</p>
        <Link to="/signin" className="btn btn-light">
          {t('Try a demo account')}
        </Link>
      </div>
    </div>
  );
}
