// Phase 4 over HTTP: settings, monitoring and suggestions go through the same checked endpoints.
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';

const { app, close } = createApp({ dataFile: null, staticDir: null, sweepMs: 0 });
afterAll(() => close());
const login = async (email: string) => (await request(app).post('/api/login').send({ email, password: 'sanad123' })).body.token as string;
const act = (token: string, action: unknown) => request(app).post('/api/action').set('Authorization', `Bearer ${token}`).send({ action });

describe('Phase 4 API', () => {
  it('saves notification settings for the caller only, and rejects bad ones', async () => {
    const t = await login('mariam@sanad.ae');
    const prefs = { tz: 'Asia/Dubai', quiet: true, quietFrom: '22:00', quietTo: '07:00', urgentThrough: true, muted: ['reminders'] };
    const ok = await act(t, { type: 'update_notify_prefs', prefs });
    expect(ok.status).toBe(200);
    expect(ok.body.view.users.find((u: { id: string }) => u.id === 'u-mariam').prefs).toEqual(prefs);
    expect((await act(t, { type: 'update_notify_prefs', prefs: { ...prefs, tz: '<script>' } })).status).toBe(400);
    const other = await request(app).get('/api/state').set('Authorization', `Bearer ${await login('aisha@sanad.ae')}`);
    expect(other.body.users.find((u: { id: string }) => u.id === 'u-mariam').prefs).toBeUndefined();
  });

  it('sends alerts only to people who can see their section', async () => {
    const k = await request(app).get('/api/state').set('Authorization', `Bearer ${await login('khadija@sanad.ae')}`);
    expect(k.body.alerts.length).toBeGreaterThan(0);
    const f = await request(app).get('/api/state').set('Authorization', `Bearer ${await login('faisal@sanad.ae')}`);
    expect(f.body.alerts.every((a: { domain: string }) => a.domain !== 'medical')).toBe(true);
  });

  it('lets the task’s creator accept a suggested time, and refuses others', async () => {
    const faisal = await login('faisal@sanad.ae');
    const state = await request(app).get('/api/state').set('Authorization', `Bearer ${faisal}`);
    const p = state.body.proposals.find((x: { status: string }) => x.status === 'open');
    expect(p).toBeTruthy();
    expect((await act(await login('aisha@sanad.ae'), { type: 'decide_proposal', proposalId: p.id, decision: 'accept' })).status).toBeGreaterThanOrEqual(403);
    const res = await act(faisal, { type: 'decide_proposal', proposalId: p.id, decision: 'accept' });
    expect(res.status).toBe(200);
    expect(res.body.view.proposals.find((x: { id: string }) => x.id === p.id).status).toBe('accepted');
  });

  it('refuses standing permissions from anyone without authority', async () => {
    const res = await act(await login('aisha@sanad.ae'), { type: 'grant_standing', recipientId: 'r-fatima', kind: 'outcome_task', ownerId: null, days: 30 });
    expect(res.status).toBe(403);
  });
});
