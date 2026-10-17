import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ROLES, ROLE_LABEL } from '../../shared/types';
import { useApp } from '../lib/store';
import type { Account } from '../lib/backend';
import { LangToggle } from '../lib/lang';
import { t } from '../lib/i18n';
import { Avatar, Field, Logo, Sparkle } from '../components/ui';

export function SignIn() {
  const { signIn, token, view, backend } = useApp();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    backend?.accounts().then(setAccounts).catch(() => setAccounts([]));
  }, [backend]);

  if (token && view) return <Navigate to="/app" replace />;

  const go = async (e?: FormEvent, override?: { email: string; password: string }) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(override?.email ?? email, override?.password ?? password);
      nav('/app');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <div className="signin-form">
        <div className="row signin-top">
          <Link to="/" aria-label="SANAD home">
            <Logo />
          </Link>
          <LangToggle />
        </div>
        <h1 className="display">Sign in</h1>
        <p className="muted">Use your SANAD account, or pick a demo person on the right.</p>
        <form onSubmit={go} className="form">
          <Field label="Email">
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {t(error)}
            </p>
          )}
          <button type="submit" className="btn btn-dark btn-lg" disabled={busy || !backend}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="small muted">
          Demo password for every account: <code>sanad123</code>
        </p>
      </div>
      <div className="signin-demo">
        <h2 className="display-m">
          <Sparkle size={22} /> Try any seat in the care circle
        </h2>
        <p>Each person sees a different dashboard. Sign in as two people in separate tabs to watch a problem move between them live.</p>
        <div className="acct-groups">
          {ROLES.map((r) => {
            const group = accounts.filter((a) => a.role === r);
            if (!group.length) return null;
            return (
              <div key={r} className="acct-group">
                <h3>{ROLE_LABEL[r]}</h3>
                {group.map((a) => (
                  <button key={a.id} type="button" className="acct" disabled={busy} onClick={() => go(undefined, { email: a.email, password: 'sanad123' })}>
                    <Avatar user={a} size={34} />
                    <span>
                      <strong>{a.name}</strong>
                      <small>
                        {a.title} · {a.org}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
          {!accounts.length && <p className="muted">Loading accounts…</p>}
        </div>
      </div>
    </div>
  );
}
