import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';

const { app, close } = createApp({ dataFile: null, staticDir: null, sweepMs: 0 });
afterAll(() => close());

async function login(email: string, password = 'sanad123') {
  const res = await request(app).post('/api/login').send({ email, password });
  return res.body.token as string;
}

describe('API', () => {
  it('reports health and lists demo accounts', async () => {
    expect((await request(app).get('/api/health')).body.ok).toBe(true);
    const accounts = await request(app).get('/api/accounts');
    expect(accounts.body.length).toBeGreaterThanOrEqual(10);
    expect(accounts.body[0].password).toBeUndefined();
  });

  it('rejects bad credentials and missing tokens', async () => {
    expect((await request(app).post('/api/login').send({ email: 'mariam@sanad.ae', password: 'nope' })).status).toBe(401);
    expect((await request(app).get('/api/state')).status).toBe(401);
    expect((await request(app).get('/api/state').set('Authorization', 'Bearer u-sara.forged')).status).toBe(401);
  });

  it('returns a filtered view for each user', async () => {
    const token = await login('khalid@sanad.ae');
    const res = await request(app).get('/api/state').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.me).toBe('u-khalid');
    expect(res.body.challenges.every((c: { recipientId: string }) => c.recipientId === 'r-hamad')).toBe(true);
  });

  it('runs a challenge from report to routing via actions', async () => {
    const family = await login('mariam@sanad.ae');
    const created = await request(app)
      .post('/api/action')
      .set('Authorization', `Bearer ${family}`)
      .send({ action: { type: 'create_challenge', title: 'Pharmacy delivery for inhaler refill', description: 'running low', recipientId: 'r-fatima', priority: 'auto' } });
    expect(created.status).toBe(200);
    expect(created.body.message).toMatch(/routed to Omar/);
    const id = created.body.createdId;

    const pharmacist = await login('omar@sanad.ae');
    const accept = await request(app).post('/api/action').set('Authorization', `Bearer ${pharmacist}`).send({ action: { type: 'accept', id } });
    expect(accept.status).toBe(200);
    const c = accept.body.view.challenges.find((x: { id: string }) => x.id === id);
    expect(c.stage).toBe('accepted');
  });

  it('returns readable errors for forbidden actions', async () => {
    const carer = await login('aisha@sanad.ae');
    const res = await request(app).post('/api/action').set('Authorization', `Bearer ${carer}`).send({ action: { type: 'delete_rule', id: 'rule-clinical' } });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/coordinator/);
  });

  it('lets coordinators add people who can then sign in', async () => {
    const sara = await login('sara@sanad.ae');
    const res = await request(app)
      .post('/api/action')
      .set('Authorization', `Bearer ${sara}`)
      .send({ action: { type: 'add_user', name: 'Hessa Ali', role: 'caregiver', title: 'Nurse', org: 'Rahma', email: 'hessa@sanad.ae', skills: ['wound'], recipients: [] } });
    expect(res.status).toBe(200);
    expect(await login('hessa@sanad.ae')).toBeTruthy();
  });

  it('changes passwords', async () => {
    const token = await login('noura@sanad.ae');
    const bad = await request(app).post('/api/password').set('Authorization', `Bearer ${token}`).send({ current: 'x', next: 'longenough' });
    expect(bad.status).toBe(400);
    const ok = await request(app).post('/api/password').set('Authorization', `Bearer ${token}`).send({ current: 'sanad123', next: 'newpass123' });
    expect(ok.status).toBe(200);
    expect(await login('noura@sanad.ae', 'newpass123')).toBeTruthy();
  });

  it('only lets the coordinator reset', async () => {
    const carer = await login('aisha@sanad.ae');
    expect((await request(app).post('/api/reset').set('Authorization', `Bearer ${carer}`)).status).toBe(403);
    const sara = await login('sara@sanad.ae');
    const res = await request(app).post('/api/reset').set('Authorization', `Bearer ${sara}`);
    expect(res.status).toBe(200);
    expect(res.body.view.users.some((u: { email: string }) => u.email === 'hessa@sanad.ae')).toBe(false);
  });
});
