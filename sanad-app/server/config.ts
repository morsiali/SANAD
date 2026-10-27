// Server configuration from the environment. Defaults suit the demo; production settings are listed in docs/DEPLOYMENT.md.
export interface ServerConfig {
  /** Demo mode: public list of demo accounts, workspace reset, shared demo password. Turn off for real use. */
  demo: boolean;
  /** How long a sign-in lasts before the person must sign in again. */
  sessionHours: number;
  /** Failed sign-ins allowed per email (and per address) in the window before a pause. */
  loginAttempts: number;
  loginWindowMinutes: number;
  /** Send Strict-Transport-Security (only behind HTTPS). */
  hsts: boolean;
  /** Trust X-Forwarded-For from a reverse proxy for client addresses. */
  trustProxy: boolean;
}

const flag = (v: string | undefined, dflt: boolean) => (v === undefined || v === '' ? dflt : !['0', 'false', 'no', 'off'].includes(v.toLowerCase()));
const num = (v: string | undefined, dflt: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  return {
    demo: flag(env.SANAD_DEMO, !production),
    sessionHours: num(env.SANAD_SESSION_HOURS, 12, 1, 24 * 30),
    loginAttempts: num(env.SANAD_LOGIN_ATTEMPTS, 5, 3, 50),
    loginWindowMinutes: num(env.SANAD_LOGIN_WINDOW_MINUTES, 15, 1, 24 * 60),
    hsts: flag(env.SANAD_HSTS, production),
    trustProxy: flag(env.SANAD_TRUST_PROXY, false),
  };
}
