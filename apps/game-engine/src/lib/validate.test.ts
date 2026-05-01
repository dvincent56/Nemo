import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { z } from 'zod';
import { validateBody, validateQuery } from './validate.js';

describe('validateBody', () => {
  it('passes parsed body to handler when valid', async () => {
    const schema = z.object({ name: z.string().min(1).max(20) });
    const app = Fastify({ logger: false });
    app.post('/x', { preHandler: [validateBody(schema)] }, async (req) => {
      const body = req.validBody as z.infer<typeof schema>;
      return { got: body.name };
    });
    const res = await app.inject({ method: 'POST', url: '/x', payload: { name: 'Alice' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { got: 'Alice' });
    await app.close();
  });

  it('returns 400 with field details on invalid body', async () => {
    const schema = z.object({ name: z.string().min(1).max(20) });
    const app = Fastify({ logger: false });
    app.post('/x', { preHandler: [validateBody(schema)] }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'POST', url: '/x', payload: { name: '' } });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { error: string; issues: { path: string[]; message: string }[] };
    assert.equal(body.error, 'invalid body');
    assert.ok(body.issues.some((i) => i.path.includes('name')));
    await app.close();
  });

  it('returns 400 when body is not an object', async () => {
    const schema = z.object({ name: z.string() });
    const app = Fastify({ logger: false });
    app.post('/x', { preHandler: [validateBody(schema)] }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'POST', url: '/x', payload: 'not an object', headers: { 'content-type': 'application/json' } });
    assert.equal(res.statusCode, 400);
    await app.close();
  });
});

describe('validateQuery', () => {
  it('parses and replaces req.validQuery with the typed value', async () => {
    const schema = z.object({ limit: z.coerce.number().int().min(1).max(100) });
    const app = Fastify({ logger: false });
    app.get('/x', { preHandler: [validateQuery(schema)] }, async (req) => {
      const q = req.validQuery as z.infer<typeof schema>;
      return { limit: q.limit };
    });
    const res = await app.inject({ method: 'GET', url: '/x?limit=42' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { limit: 42 });
    await app.close();
  });

  it('rejects out-of-range query', async () => {
    const schema = z.object({ limit: z.coerce.number().int().min(1).max(100) });
    const app = Fastify({ logger: false });
    app.get('/x', { preHandler: [validateQuery(schema)] }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/x?limit=99999' });
    assert.equal(res.statusCode, 400);
    await app.close();
  });
});
