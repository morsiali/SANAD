import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Action, Msg, User, View } from '../../shared/types';
import { ApiError, getBackend, type Backend } from './backend';

const SESSION_KEY = 'sanad.session.v1';

export interface Toast {
  id: number;
  text: string;
  m?: Msg;
  tone: 'ok' | 'error';
}

interface Ctx {
  backend: Backend | null;
  token: string | null;
  view: View | null;
  me: User | null;
  ready: boolean;
  now: number;
  toasts: Toast[];
  signIn(email: string, password: string): Promise<void>;
  signOut(): void;
  act(action: Action, opts?: { quiet?: boolean }): Promise<{ ok: boolean; createdId?: string; message?: string }>;
  refresh(): Promise<void>;
  toast(text: string, tone?: Toast['tone'], m?: Msg): void;
  replaceView(v: View): void;
}

const AppCtx = createContext<Ctx | null>(null);

// Each tab keeps its own session (so two people can be signed in side by side);
// new tabs start from the most recent sign-in.
function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function writeSession(token: string | null) {
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      if (token) store().setItem(SESSION_KEY, token);
      else store().removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [token, setToken] = useState<string | null>(readSession);
  const [view, setView] = useState<View | null>(null);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok', m?: Msg) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, m, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 5200 : 3200);
  }, []);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    getBackend().then(setBackend);
  }, []);

  const signOut = useCallback(() => {
    writeSession(null);
    setToken(null);
    setView(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!backend || !token) return;
    try {
      setView(await backend.load(token));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOut();
      else toast((e as Error).message, 'error');
    }
  }, [backend, token, signOut, toast]);

  useEffect(() => {
    if (!backend) return;
    if (!token) {
      setReady(true);
      return;
    }
    let live = true;
    backend
      .load(token)
      .then((v) => live && setView(v))
      .catch(() => live && signOut())
      .finally(() => live && setReady(true));
    const unsub = backend.subscribe(token, () => {
      backend.load(token).then((v) => live && setView(v)).catch(() => undefined);
    });
    return () => {
      live = false;
      unsub();
    };
  }, [backend, token, signOut]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const b = backend ?? (await getBackend());
      const res = await b.login(email, password);
      const v = await b.load(res.token);
      writeSession(res.token);
      setView(v);
      setToken(res.token);
    },
    [backend],
  );

  const act = useCallback<Ctx['act']>(
    async (action, opts) => {
      if (!backend || !token) return { ok: false };
      try {
        const r = await backend.act(token, action);
        setView(r.view);
        if (!opts?.quiet && r.message !== 'No change') toast(r.message, 'ok', r.m);
        return { ok: true, createdId: r.createdId, message: r.message };
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) signOut();
        toast((e as Error).message, 'error', (e as ApiError).m);
        return { ok: false };
      }
    },
    [backend, token, toast, signOut],
  );

  const me = useMemo(() => view?.users.find((u) => u.id === view.me) ?? null, [view]);

  const value: Ctx = { backend, token, view, me, ready: ready && !!backend, now, toasts, signIn, signOut, act, refresh, toast, replaceView: setView };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

/** For pages under /app — view and me are guaranteed. */
export function useSession() {
  const c = useApp();
  return c as Ctx & { view: View; me: User; token: string; backend: Backend };
}
