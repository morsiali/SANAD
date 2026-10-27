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

  it('registers new people who can then sign in', async () => {
    const short = await request(app).post('/api/register').send({ role: 'family', name: 'Reem Saleh', email: 'reem@example.ae', password: 'short', recipient: { name: 'Salem', age: 80, area: '' } });
    expect(short.status).toBe(400);
    const coord = await request(app).post('/api/register').send({ role: 'coordinator', name: 'X Y', email: 'xy@example.ae', password: 'longenough' });
    expect(coord.status).toBe(403);
    const ok = await request(app).post('/api/register').send({ role: 'family', name: 'Reem Saleh', email: 'reem@example.ae', password: 'reem12345', recipient: { name: 'Salem Saleh', age: 80, area: 'Jumeirah' } });
    expect(ok.status).toBe(200);
    const state = await request(app).get('/api/state').set('Authorization', `Bearer ${ok.body.token}`);
    expect(state.body.recipients.some((r: { name: string }) => r.name === 'Salem Saleh')).toBe(true);
    expect(await login('reem@example.ae', 'reem12345')).toBeTruthy();
    const dup = await request(app).post('/api/register').send({ role: 'doctor', name: 'Again', email: 'reem@example.ae', password: 'reem12345' });
    expect(dup.status).toBe(409);
  });

  it('never sends private therapy notes to an educator, in state or export, and audits exports', async () => {
    const grace = await login('grace@sanad.ae');
    const state = await request(app).get('/api/state').set('Authorization', `Bearer ${grace}`);
    expect(state.status).toBe(200);
    expect(JSON.stringify(state.body)).not.toContain('coping cards for transitions');
    expect(state.body.access['r-rashid']).toEqual(['overview', 'academic', 'social']);
    const exp = await request(app).get('/api/export').set('Authorization', `Bearer ${grace}`);
    expect(JSON.stringify(exp.body)).not.toContain('coping cards for transitions');
    const salma = await login('salma@sanad.ae');
    const salmaState = await request(app).get('/api/state').set('Authorization', `Bearer ${salma}`);
    expect(JSON.stringify(salmaState.body)).toContain('coping cards for transitions');
    const write = await request(app).post('/api/action').set('Authorization', `Bearer ${grace}`).send({ action: { type: 'add_record', recipientId: 'r-rashid', domain: 'wellbeing_notes', kind: 'progress_note', title: 'x', body: '' } });
    expect(write.status).toBe(403);
  });

  it('creates invitations with server-generated codes that can be looked up and used once', async () => {
    const huda = await login('huda@sanad.ae');
    const res = await request(app)
      .post('/api/action')
      .set('Authorization', `Bearer ${huda}`)
      .send({ action: { type: 'invite_member', recipientId: 'r-rashid', email: 'coach@club.ae', role: 'educator', relationship: 'Swimming coach', domains: ['overview', 'activity'], accessDays: 30, code: 'chosen-by-client' } });
    expect(res.status).toBe(200);
    const inv = res.body.view.invites.find((i: { id: string }) => i.id === res.body.createdId);
    expect(inv.code).not.toBe('chosen-by-client');
    expect(inv.code.length).toBeGreaterThanOrEqual(16);
    const info = await request(app).get(`/api/invite/${inv.code}`);
    expect(info.body).toEqual({ role: 'educator', email: 'coach@club.ae', recipient: 'Rashid', status: 'pending' });
    expect((await request(app).get('/api/invite/not-a-code')).status).toBe(404);
    const reg = await request(app).post('/api/register').send({ role: 'educator', name: 'Coach Sam', email: 'coach@club.ae', password: 'coach12345', inviteCode: inv.code });
    expect(reg.status).toBe(200);
    const st = await request(app).get('/api/state').set('Authorization', `Bearer ${reg.body.token}`);
    expect(st.body.access['r-rashid']).toEqual(['overview', 'activity']);
    expect(JSON.stringify(st.body)).not.toContain('Mild spastic diplegia');
    const again = await request(app).post('/api/register').send({ role: 'educator', name: 'Coach Two', email: 'coach2@club.ae', password: 'coach12345', inviteCode: inv.code });
    expect(again.status).toBe(409);
  });

  it('uploads documents through the server, checks content, and re-checks access on every download', async () => {
    const mariam = await login('mariam@sanad.ae');
    const { samplePdf } = await import('../shared/seed');
    const b64 = samplePdf(['Discharge letter (synthetic)']).split(',')[1];
    const up = await request(app).post('/api/documents').set('Authorization', `Bearer ${mariam}`).send({ recipientId: 'r-fatima', domain: 'medical', title: 'Discharge letter', description: '', fileName: 'letter.pdf', mime: 'application/pdf', dataBase64: b64 });
    expect(up.status).toBe(200);
    const id = up.body.createdId as string;
    const doc = up.body.view.documents.find((d: { id: string }) => d.id === id);
    expect(doc).toMatchObject({ storage: 'server', mime: 'application/pdf' });
    expect(doc.fileKey).toBeUndefined();
    const dl = await request(app).get(`/api/documents/${id}`).set('Authorization', `Bearer ${mariam}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/attachment/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.body.subarray(0, 4).toString()).toBe('%PDF');
    // The teacher is not on Fatima's team: no download, no metadata.
    const grace = await login('grace@sanad.ae');
    expect((await request(app).get(`/api/documents/${id}`).set('Authorization', `Bearer ${grace}`)).status).toBe(404);
    // A file pretending to be a PDF is refused, and so is a client-chosen storage key.
    const fake = await request(app).post('/api/documents').set('Authorization', `Bearer ${mariam}`).send({ recipientId: 'r-fatima', domain: 'medical', title: 'Fake', description: '', fileName: 'x.pdf', mime: 'application/pdf', dataBase64: Buffer.from('<html>').toString('base64') });
    expect(fake.status).toBe(400);
    const sneaky = await request(app).post('/api/action').set('Authorization', `Bearer ${mariam}`).send({ action: { type: 'add_document', recipientId: 'r-fatima', domain: 'medical', title: 'Sneaky', description: '', fileName: 'x.pdf', mime: 'application/pdf', size: 1, fileKey: 'stolen-key' } });
    expect(sneaky.status).toBe(400);
    // Someone without the section cannot upload into it.
    const denied = await request(app).post('/api/documents').set('Authorization', `Bearer ${grace}`).send({ recipientId: 'r-rashid', domain: 'medical', title: 'Report', description: '', fileName: 'r.pdf', mime: 'application/pdf', dataBase64: b64 });
    expect(denied.status).toBe(403);
    const state = await request(app).get('/api/state').set('Authorization', `Bearer ${mariam}`);
    expect(state.body.audit.some((e: { type: string; targetId: string }) => e.type === 'doc_viewed' && e.targetId === id)).toBe(true);
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
