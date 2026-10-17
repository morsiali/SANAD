// Two interchangeable backends with one interface:
//  - server: the Express API (multi-user, persisted to disk, live updates over SSE)
//  - browser: the same engine running locally, persisted to localStorage, synced across tabs
import { apply, register, sweep, viewFor, type RegisterInput } from '../../shared/engine';
import { createSeed } from '../../shared/seed';
import type { Action, Msg, Role, State, View } from '../../shared/types';

declare const __SANAD_MODE__: string;

export interface Account {
  id: string;
  name: string;
  role: Role;
  title: string;
  org: string;
  email: string;
  initials: string;
  color: string;
}

export interface ActResult {
  view: View;
  message: string;
  m?: Msg;
  createdId?: string;
}

export interface Backend {
  mode: 'server' | 'browser';
  accounts(): Promise<Account[]>;
  login(email: string, password: string): Promise<{ token: string; userId: string }>;
  register(input: RegisterInput & { password: string }): Promise<{ token: string; userId: string }>;
  load(token: string): Promise<View>;
  act(token: string, action: Action): Promise<ActResult>;
  subscribe(token: string, onChange: () => void): () => void;
  changePassword(token: string, current: string, next: string): Promise<string>;
  reset(token: string): Promise<ActResult>;
  exportData(token: string): Promise<unknown>;
}

export class ApiError extends Error {
  status: number;
  m?: Msg;
  constructor(message: string, status: number, m?: Msg) {
    super(message);
    this.status = status;
    this.m = m;
  }
}

// ---------------------------------------------------------------- server ----
function serverBackend(): Backend {
  const call = async <T,>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    let res: Response;
    try {
      res = await fetch(path, { ...init, headers });
    } catch {
      throw new ApiError('Cannot reach the SANAD server. Check that it is running.', 0);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.m);
    return body as T;
  };
  return {
    mode: 'server',
    accounts: () => call('/api/accounts'),
    login: (email, password) => call('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    register: (input) => call('/api/register', { method: 'POST', body: JSON.stringify(input) }),
    load: (token) => call('/api/state', { token }),
    act: (token, action) => call('/api/action', { method: 'POST', token, body: JSON.stringify({ action }) }),
    changePassword: async (token, current, next) => (await call<{ message: string }>('/api/password', { method: 'POST', token, body: JSON.stringify({ current, next }) })).message,
    reset: (token) => call('/api/reset', { method: 'POST', token }),
    exportData: (token) => call('/api/export', { token }),
    subscribe(token, onChange) {
      let es: EventSource | null = null;
      let closed = false;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let first = true;
      const open = () => {
        if (closed) return;
        es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
        es.onmessage = () => {
          if (first) {
            first = false;
            return;
          }
          onChange();
        };
        es.onerror = () => {
          es?.close();
          first = true;
          retry = setTimeout(() => {
            onChange();
            open();
          }, 3000);
        };
      };
      open();
      return () => {
        closed = true;
        clearTimeout(retry);
        es?.close();
      };
    },
  };
}

// --------------------------------------------------------------- browser ----
const STATE_KEY = 'sanad.browser.state.v1';
const CREDS_KEY = 'sanad.browser.creds.v1';
const DEMO_PASSWORD = 'sanad123';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — keep working in memory */
  }
}

function browserBackend(): Backend {
  let memory: State | null = null;
  let creds: Record<string, string> = {};
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sanad') : null;
  const listeners = new Set<() => void>();
  channel?.addEventListener('message', () => {
    memory = null;
    listeners.forEach((l) => l());
  });

  const read = (): State => {
    if (memory) return memory;
    const raw = safeGet(STATE_KEY);
    if (raw) {
      try {
        memory = JSON.parse(raw) as State;
      } catch {
        memory = null;
      }
    }
    if (!memory) {
      memory = createSeed();
      write(memory, false);
    }
    try {
      creds = JSON.parse(safeGet(CREDS_KEY) ?? '{}');
    } catch {
      creds = {};
    }
    return memory;
  };
  const write = (s: State, announce = true) => {
    memory = s;
    safeSet(STATE_KEY, JSON.stringify(s));
    safeSet(CREDS_KEY, JSON.stringify(creds));
    if (announce) {
      channel?.postMessage('changed');
      listeners.forEach((l) => l());
    }
  };
  const userFromToken = (token: string) => {
    const s = read();
    if (!s.users.some((u) => u.id === token)) throw new ApiError('Your session has ended. Please sign in again.', 401);
    return token;
  };

  setInterval(() => {
    const s = read();
    if (sweep(s, Date.now())) write(s);
  }, 30_000);

  return {
    mode: 'browser',
    accounts: async () => read().users.map(({ id, name, role, title, org, email, initials, color }) => ({ id, name, role, title, org, email, initials, color })),
    async login(email, password) {
      const s = read();
      const u = s.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!u || (creds[u.id] ?? DEMO_PASSWORD) !== password) throw new ApiError('That email and password do not match. Demo accounts use “sanad123”.', 401);
      return { token: u.id, userId: u.id };
    },
    async register(input) {
      if (input.password.length < 8) throw new ApiError('Use at least 8 characters for the password', 400);
      try {
        const r = register(read(), input);
        creds[r.userId] = input.password;
        write(r.state);
        return { token: r.userId, userId: r.userId };
      } catch (e) {
        const err = e as Error & { status?: number; m?: Msg };
        throw new ApiError(err.message, err.status ?? 400, err.m);
      }
    },
    async load(token) {
      const s = read();
      if (sweep(s, Date.now())) write(s);
      return viewFor(s, userFromToken(token));
    },
    async act(token, action) {
      const me = userFromToken(token);
      try {
        const r = apply(read(), me, action);
        write(r.state);
        return { view: viewFor(r.state, me), message: r.message, m: r.m, createdId: r.createdId };
      } catch (e) {
        const err = e as Error & { status?: number; m?: Msg };
        throw new ApiError(err.message, err.status ?? 400, err.m);
      }
    },
    subscribe(_token, onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    async changePassword(token, current, next) {
      const me = userFromToken(token);
      if ((creds[me] ?? DEMO_PASSWORD) !== current) throw new ApiError('Your current password is not correct', 400);
      if (next.length < 8) throw new ApiError('Use at least 8 characters for the new password', 400);
      creds[me] = next;
      write(read(), false);
      return 'Password changed';
    },
    async reset(token) {
      const me = userFromToken(token);
      if (read().users.find((u) => u.id === me)?.role !== 'coordinator') throw new ApiError('Only the care coordinator can reset the workspace', 403);
      creds = {};
      const s = createSeed();
      write(s);
      return { view: viewFor(s, me), message: 'Demo workspace reset' };
    },
    async exportData(token) {
      return viewFor(read(), userFromToken(token));
    },
  };
}

let chosen: Promise<Backend> | null = null;

export function getBackend(): Promise<Backend> {
  if (chosen) return chosen;
  chosen = (async () => {
    if (__SANAD_MODE__ === 'demo' || location.protocol === 'file:') return browserBackend();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch('/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      const body = await res.json();
      if (body?.ok) return serverBackend();
    } catch {
      /* no server — fall through */
    }
    return browserBackend();
  })();
  return chosen;
}
