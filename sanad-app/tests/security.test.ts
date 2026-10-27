// Phase 5: security hardening of the server.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';

const lines: string[] = [];
const demo = createApp({ dataFile: null, staticDir: null, sweepMs: 0, log: (l) => lines.push(l), config: { demo: true } });
const prod = createApp({ dataFile: null, staticDir: null, sweepMs: 0, log: () => undefined, config: { demo: false, sessionHours: 1, hsts: true }, seed: 'demo' });
afterAll(() => {
  demo.close();
  prod.close();
});
afterEach(() => vi.useRealTimers());

const login = async (app: typeof demo.app, email: string, password = 'sanad123') => request(app).post('/api/login').send({ email, password });
const state = (app: typeof demo.app, token: string) => request(app).get('/api/state').set('Authorization', `Bearer ${token}`);

describe('security headers and errors', () => {
  it('sends protective headers on every response', async () => {
    const res = await request(prod.app).get('/api/health');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toMatch(/max-age/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('answers malformed requests without internals', async () => {
    const res = await request(demo.app).post('/api/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at |node_modules|SyntaxError/);
  });
});

describe('sessions', () => {
  it('rejects tampered and forged tokens', async () => {
    const token = (await login(demo.app, 'mariam@sanad.ae')).body.token as string;
    expect((await state(demo.app, token)).status).toBe(200);
    expect((await state(demo.app, token.replace('u-mariam', 'u-sara'))).status).toBe(401);
    const parts = token.split('.');
    parts[parts.length - 1] = 'A'.repeat(parts[parts.length - 1].length);
    expect((await state(demo.app, parts.join('.'))).status).toBe(401);
    expect((await state(demo.app, 'u-sara')).status).toBe(401);
  });

  it('expires sessions after the configured time', async () => {
    const token = (await login(prod.app, 'aisha@sanad.ae')).body.token as string;
    expect((await state(prod.app, token)).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61 * 60_000);
    expect((await state(prod.app, token)).status).toBe(401);
  });

  it('a password change signs out other sessions and keeps this one with a new token', async () => {
    const a = (await login(demo.app, 'khalid@sanad.ae')).body.token as string;
    const b = (await login(demo.app, 'khalid@sanad.ae')).body.token as string;
    const res = await request(demo.app).post('/api/password').set('Authorization', `Bearer ${a}`).send({ current: 'sanad123', next: 'khalid-new-1' });
    expect(res.status).toBe(200);
    expect((await state(demo.app, a)).status).toBe(401);
    expect((await state(demo.app, b)).status).toBe(401);
    expect((await state(demo.app, res.body.token)).status).toBe(200);
  });

  it('"sign out everywhere" ends every session', async () => {
    const t = (await login(demo.app, 'joseph@sanad.ae')).body.token as string;
    await request(demo.app).post('/api/logout-all').set('Authorization', `Bearer ${t}`);
    expect((await state(demo.app, t)).status).toBe(401);
  });
});

describe('sign-in limits', () => {
  it('pauses sign-in after repeated failures, even with the right password', async () => {
    for (let i = 0; i < 5; i++) expect((await login(prod.app, 'omar@sanad.ae', 'wrong')).status).toBe(401);
    const blocked = await login(prod.app, 'omar@sanad.ae');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not reveal whether an email exists, and gives no demo hint outside demo mode', async () => {
    const p = createApp({ dataFile: null, staticDir: null, sweepMs: 0, log: () => undefined, config: { demo: false }, seed: 'demo' });
    const unknown = await login(p.app, 'nobody@example.com', 'x');
    const known = await login(p.app, 'sara@sanad.ae', 'x');
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(known.body.error);
    expect(known.body.error).not.toMatch(/sanad123/);
    p.close();
  });
});

describe('demo-only routes', () => {
  it('hides the account list and the reset outside demo mode', async () => {
    expect((await request(prod.app).get('/api/accounts')).body).toEqual([]);
    expect((await request(demo.app).get('/api/accounts')).status).toBe(200);
    const sara = (await login(prod.app, 'sara@sanad.ae')).body.token;
    expect((await request(prod.app).post('/api/reset').set('Authorization', `Bearer ${sara}`)).status).toBe(404);
  });
});

describe('operations', () => {
  it('reports readiness and, to coordinators only, counts without personal data', async () => {
    expect((await request(demo.app).get('/api/ready')).body.ok).toBe(true);
    const sara = (await login(demo.app, 'sara@sanad.ae')).body.token;
    const m = await request(demo.app).get('/api/metrics').set('Authorization', `Bearer ${sara}`);
    expect(m.status).toBe(200);
    expect(m.body.requests).toBeGreaterThan(0);
    expect(JSON.stringify(m.body)).not.toMatch(/@sanad\.ae|Fatima|u-[a-z]+/);
    const mariam = (await login(demo.app, 'mariam@sanad.ae')).body.token;
    expect((await request(demo.app).get('/api/metrics').set('Authorization', `Bearer ${mariam}`)).status).toBe(403);
  });

  it('accepts short browser error reports and limits them', async () => {
    expect((await request(demo.app).post('/api/client-error').send({ message: 'x'.repeat(5000), where: '/app/people/r-fatima?token=secret' })).status).toBe(204);
    const last = JSON.parse(lines.filter((l) => l.includes('client_error')).pop()!);
    expect(last.message.length).toBeLessThanOrEqual(300);
    expect(last.where).not.toMatch(/token|secret/);
    let status = 204;
    for (let i = 0; i < 25; i++) status = (await request(demo.app).post('/api/client-error').send({ message: 'e' })).status;
    expect(status).toBe(429);
  });

  it('never writes tokens, query strings or ids into the request log', async () => {
    const t = (await login(demo.app, 'huda@sanad.ae')).body.token as string;
    await request(demo.app).get(`/api/documents/f77?token=${encodeURIComponent(t)}`);
    await state(demo.app, t);
    const all = lines.join('\n');
    expect(all).not.toContain(t);
    expect(all).not.toContain('f77');
    expect(all).toContain('GET /api/documents/:id');
  });
});

describe('starting for real use', () => {
  const initial = { orgName: 'Test Care', name: 'Lina Coordinator', email: 'lina@example.org', password: 'a-long-passphrase-1' };

  it('starts an empty workspace with one coordinator and no demo accounts', async () => {
    const p = createApp({ dataFile: null, staticDir: null, sweepMs: 0, log: () => undefined, config: { demo: false }, initial });
    expect((await login(p.app, 'mariam@sanad.ae')).status).toBe(401);
    const t = (await login(p.app, 'lina@example.org', 'a-long-passphrase-1')).body.token;
    const v = await state(p.app, t);
    expect(v.body.users).toHaveLength(1);
    expect(v.body.recipients).toHaveLength(0);
    expect(v.body.rules.length).toBeGreaterThan(0);
    p.close();
  });

  it('refuses to start without a first coordinator, or with a weak password', () => {
    expect(() => createApp({ dataFile: null, staticDir: null, sweepMs: 0, log: () => undefined, config: { demo: false } })).toThrow(/SANAD_ADMIN_EMAIL/);
    expect(() => createApp({ dataFile: null, staticDir: null, sweepMs: 0, log: () => undefined, config: { demo: false }, initial: { ...initial, password: 'short' } })).toThrow();
  });

  it('refuses a demo data file outside demo mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sanad-sec-'));
    const file = join(dir, 'db.json');
    createApp({ dataFile: file, staticDir: null, sweepMs: 0, log: () => undefined, config: { demo: true } }).close();
    expect(() => createApp({ dataFile: file, staticDir: null, sweepMs: 0, log: () => undefined, config: { demo: false } })).toThrow(/demo password/);
    rmSync(dir, { recursive: true, force: true });
  });
});
