import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ZodTypeAny, z } from 'zod';

declare module 'fastify' {
  interface FastifyRequest {
    validBody?: unknown;
    validQuery?: unknown;
    validParams?: unknown;
  }
}

function formatIssues(err: { issues: { path: (string | number)[]; message: string }[] }) {
  return err.issues.map((i) => ({ path: i.path.map(String), message: i.message }));
}

export function validateBody<S extends ZodTypeAny>(schema: S): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      reply.code(400).send({ error: 'invalid body', issues: formatIssues(result.error) });
      return;
    }
    req.validBody = result.data as z.infer<S>;
  };
}

export function validateQuery<S extends ZodTypeAny>(schema: S): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      reply.code(400).send({ error: 'invalid query', issues: formatIssues(result.error) });
      return;
    }
    req.validQuery = result.data as z.infer<S>;
  };
}

export function validateParams<S extends ZodTypeAny>(schema: S): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      reply.code(400).send({ error: 'invalid params', issues: formatIssues(result.error) });
      return;
    }
    req.validParams = result.data as z.infer<S>;
  };
}
