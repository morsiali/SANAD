// SANAD API: auth, a single command endpoint backed by the shared engine, live updates over SSE.
import express, { type NextFunction, type Request, type Response } from 'express';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { apply, sweep, viewFor } from '../shared/engine';
import { createSeed } from '../shared/seed';
import { EngineError, type Action, type State } from '../shared/types';

export const DEMO_PASSWORD = 'sanad123';

interface Persisted {
  state: State;
  secret: string;
  credentials: Record<string, string>;
}

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`;
}

function checkPassword(pw: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(pw, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export interface AppOptions {
  dataFile?: string | null; // null = memory only (tests)
  staticDir?: string | null;
  sweepMs?: number;
}

export function createApp(opts: AppOptions = {}) {
  const dataFile = opts.dataFile === undefined ? resolve('data/sanad.json') : opts.dataFile;
  let db: Persisted;

  const fresh = (): Persisted => {
    const state = createSeed();
    const credentials: Record<string, string> = {};
    const shared = hashPassword(DEMO_PASSWORD);
    for (const u of state.users) credentials[u.id] = shared;
    return { state, secret: randomBytes(24).toString('hex'), credentials };
  };

  if (dataFile && existsSync(dataFile)) {
    db = JSON.parse(readFileSync(dataFile, 'utf8')) as Persisted;
  } else {
    db = fresh();
  }

  const save = () => {
    if (!dataFile) return;
    mkdirSync(dirname(dataFile), { recursive: true });
    const tmp = `${dataFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, dataFile);
  };
  save();

  // ---- live updates -------------------------------------------------------
  const clients = new Set<Response>();
  const broadcast = () => {
    const payload = `data: ${JSON.stringify({ version: db.state.version })}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const tick = () => {
    if (sweep(db.state)) {
      save();
      broadcast();
    }
  };
  const timer = opts.sweepMs === 0 ? null : setInterval(tick, opts.sweepMs ?? 30_000);
  timer?.unref?.();

  // ---- auth ----------------------------------------------------------------
  const sign = (userId: string) => `${userId}.${createHmac('sha256', db.secret).update(userId).digest('hex').slice(0, 40)}`;
  const verifyToken = (token: string | undefined): string | null => {
    if (!token) return null;
    const userId = token.slice(0, token.lastIndexOf('.'));
    if (!userId || sign(userId) !== token) return null;
    return db.state.users.some((u) => u.id === userId) ? userId : null;
  };

  type AuthedRequest = Request & { userId?: string };
  const auth = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
    const userId = verifyToken(token);
    if (!userId) return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    req.userId = userId;
    next();
  };

  // ---- routes --------------------------------------------------------------
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, mode: 'server', version: db.state.version }));

  app.get('/api/accounts', (_req, res) => {
    res.json(db.state.users.map((u) => ({ id: u.id, name: u.name, role: u.role, title: u.title, org: u.org, email: u.email, initials: u.initials, color: u.color })));
  });

  app.post('/api/login', (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const user = db.state.users.find((u) => u.email.toLowerCase() === email);
    if (!user || !checkPassword(password, db.credentials[user.id])) {
      return res.status(401).json({ error: 'That email and password do not match. Demo accounts use “sanad123”.' });
    }
    res.json({ token: sign(user.id), userId: user.id });
  });

  app.get('/api/state', auth, (req: AuthedRequest, res) => {
    tick();
    res.json(viewFor(db.state, req.userId!));
  });

  app.post('/api/action', auth, (req: AuthedRequest, res) => {
    const action = req.body?.action as Action | undefined;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') return res.status(400).json({ error: 'Missing action' });
    try {
      const result = apply(db.state, req.userId!, action);
      db.state = result.state;
      if (action.type === 'add_user' && result.createdId) db.credentials[result.createdId] = hashPassword(DEMO_PASSWORD);
      save();
      broadcast();
      res.json({ view: viewFor(db.state, req.userId!), message: result.message, m: result.m, createdId: result.createdId });
    } catch (e) {
      if (e instanceof EngineError) return res.status(e.status).json({ error: e.message, m: e.m });
      console.error(e);
      res.status(500).json({ error: 'Something went wrong on the server. Your change was not saved.' });
    }
  });

  app.post('/api/password', auth, (req: AuthedRequest, res) => {
    const current = String(req.body?.current ?? '');
    const next = String(req.body?.next ?? '');
    if (!checkPassword(current, db.credentials[req.userId!])) return res.status(400).json({ error: 'Your current password is not correct' });
    if (next.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for the new password' });
    db.credentials[req.userId!] = hashPassword(next);
    save();
    res.json({ message: 'Password changed' });
  });

  app.post('/api/reset', auth, (req: AuthedRequest, res) => {
    const me = db.state.users.find((u) => u.id === req.userId);
    if (me?.role !== 'coordinator') return res.status(403).json({ error: 'Only the care coordinator can reset the workspace' });
    const secret = db.secret;
    db = fresh();
    db.secret = secret; // keep sessions valid
    save();
    broadcast();
    res.json({ view: viewFor(db.state, req.userId!), message: 'Demo workspace reset' });
  });

  app.get('/api/export', auth, (req: AuthedRequest, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="sanad-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(viewFor(db.state, req.userId!));
  });

  app.get('/api/events', auth, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ version: db.state.version })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route' }));

  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(join(opts.staticDir!, 'index.html')));
  }

  return { app, close: () => timer && clearInterval(timer), getState: () => db.state };
}
