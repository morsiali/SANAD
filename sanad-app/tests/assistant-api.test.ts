// Phase 3 over HTTP: the server runs the assistant on the caller's own filtered view, audits each request,
// limits the rate, and only shows a model overview that passed validation.
import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';

const reply = (text: string) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) }) as unknown as Response;

let modelReply: (body: { messages: { content: string }[] }) => Response = () => reply('{}');
const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => modelReply(JSON.parse(init.body)));

const plain = createApp({ dataFile: null, staticDir: null, sweepMs: 0 });
const withModel = createApp({ dataFile: null, staticDir: null, sweepMs: 0, model: { apiKey: 'test-key', model: 'test-model', fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 1000 } });
afterAll(() => {
  plain.close();
  withModel.close();
});

async function login(app: typeof plain.app, email: string) {
  return (await request(app).post('/api/login').send({ email, password: 'sanad123' })).body.token as string;
}

describe('assistant API', () => {
  it('requires sign-in and reports whether an AI model is configured', async () => {
    expect((await request(plain.app).post('/api/assistant').send({ question: 'hi' })).status).toBe(401);
    const t = await login(plain.app, 'mariam@sanad.ae');
    expect((await request(plain.app).get('/api/assistant/status').set('Authorization', `Bearer ${t}`)).body).toEqual({ model: false, name: null });
    const t2 = await login(withModel.app, 'mariam@sanad.ae');
    expect((await request(withModel.app).get('/api/assistant/status').set('Authorization', `Bearer ${t2}`)).body.model).toBe(true);
  });

  it('answers from the caller’s own view and records the request in the audit log', async () => {
    const t = await login(plain.app, 'grace@sanad.ae');
    const res = await request(plain.app).post('/api/assistant').set('Authorization', `Bearer ${t}`).send({ question: 'What changed for Rashid this month?', lang: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('summary');
    expect(res.body.engine).toBe('rules');
    expect(res.body.sources.every((s: { domain: string }) => ['overview', 'academic', 'social'].includes(s.domain))).toBe(true);
    const ev = plain.getState().audit.filter((e) => e.type === 'assistant' && e.actorId === 'u-grace');
    expect(ev.length).toBe(1);
    expect(ev[0].recipientId).toBe('r-rashid');
  });

  it('cannot be pointed at someone outside the caller’s care', async () => {
    const t = await login(plain.app, 'grace@sanad.ae');
    const res = await request(plain.app).post('/api/assistant').set('Authorization', `Bearer ${t}`).send({ question: 'What medicines?', recipientId: 'r-fatima', intent: 'meds' });
    expect(res.body.intent).toBe('no_access');
    expect(res.body.sources).toHaveLength(0);
  });

  it('ignores unknown intents sent by a client', async () => {
    const t = await login(plain.app, 'mariam@sanad.ae');
    const res = await request(plain.app).post('/api/assistant').set('Authorization', `Bearer ${t}`).send({ question: 'Should I double her insulin dose?', recipientId: 'r-fatima', intent: 'legacy' });
    expect(res.body.intent).toBe('refuse');
  });

  it('shows a validated model overview with citations', async () => {
    modelReply = (body) => {
      const ids = [...body.messages[0].content.matchAll(/\[([a-z0-9:, -]+)\]/gi)].flatMap((m) => m[1].split(', '));
      return reply(JSON.stringify({ paragraphs: [{ text: 'Several fasting glucose readings were recorded this week.', cites: [ids[0]] }] }));
    };
    const t = await login(withModel.app, 'mariam@sanad.ae');
    const res = await request(withModel.app).post('/api/assistant').set('Authorization', `Bearer ${t}`).send({ question: 'What changed for Fatima this week?' });
    expect(res.body.engine).toBe('model');
    expect(res.body.overview).toHaveLength(1);
    expect(res.body.sources.map((s: { id: string }) => s.id)).toContain(res.body.overview[0].cites[0]);
  });

  it('drops a model overview that cites something it was not given, or gives clinical advice', async () => {
    const t = await login(withModel.app, 'mariam@sanad.ae');
    modelReply = () => reply(JSON.stringify({ paragraphs: [{ text: 'Readings were recorded.', cites: ['secret-record'] }] }));
    let res = await request(withModel.app).post('/api/assistant').set('Authorization', `Bearer ${t}`).send({ question: 'What changed for Fatima this week?' });
    expect(res.body.engine).toBe('rules');
    expect(res.body.overview).toBeUndefined();
    expect(res.body.modelNote.k).toBe('as_model_rejected');
    modelReply = (body) => {
      const id = body.messages[0].content.match(/\[([a-z0-9]+)/i)![1];
      return reply(JSON.stringify({ paragraphs: [{ text: 'Increase the insulin dose to 14 units.', cites: [id] }] }));
    };
    res = await request(withModel.app).post('/api/assistant').set('Authorization', `Bearer ${t}`).send({ question: 'What changed for Fatima this week?' });
    expect(res.body.engine).toBe('rules');
    expect(res.body.modelNote.k).toBe('as_model_rejected');
  });

  it('never sends refusals or emergencies to the model', async () => {
    fetchImpl.mockClear();
    const t = await login(withModel.app, 'mariam@sanad.ae');
    await request(withModel.app).post('/api/assistant').set('Authorization', `Bearer ${t}`).send({ question: 'Should Fatima take more insulin?' });
    await request(withModel.app).post('/api/assistant').set('Authorization', `Bearer ${t}`).send({ question: 'She collapsed and has chest pain' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('limits how many questions one person can ask per minute', async () => {
    const t = await login(plain.app, 'khalid@sanad.ae');
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await request(plain.app).post('/api/assistant').set('Authorization', `Bearer ${t}`).send({ question: 'What changed for Hamad?' })).status;
    expect(last).toBe(429);
  });
});
