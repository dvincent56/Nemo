import type { FastifyInstance } from 'fastify';
import { verifyAccessToken } from '../auth/cognito.js';

/**
 * Endpoints d'auth minimaux Phase 3. Le vrai flow Cognito OAuth (Hosted UI)
 * est délégué au frontend Next.js + Cognito. Ici on expose :
 *   - POST /api/v1/auth/exchange : reçoit un code Cognito → cookie httpOnly
 *   - POST /api/v1/auth/dev-login : émet un token stub "dev.sub.username"
 *     (désactivé si COGNITO_* est configuré)
 *   - GET  /api/v1/auth/me       : renvoie le profil si le cookie est valide
 */

export function registerAuthRoutes(app: FastifyInstance): void {
  const cognitoConfigured = !!process.env['COGNITO_REGION'];
  const devAuthAllowed = process.env['NEMO_ALLOW_DEV_AUTH'] === '1';

  app.post<{ Body: { username?: string } }>('/api/v1/auth/dev-login', async (req, reply) => {
    if (!devAuthAllowed) { reply.code(404); return { error: 'dev-login disabled (set NEMO_ALLOW_DEV_AUTH=1)' }; }
    const username = req.body?.username?.trim() || 'dev';
    const token = `dev.${username}.${username}`;
    reply.setCookie('nemo_access_token', token, {
      path: '/', httpOnly: false, sameSite: 'lax', secure: false, maxAge: 3600,
    });
    return { token, username };
  });

  app.post<{ Body: { code: string; redirectUri: string } }>(
    '/api/v1/auth/exchange',
    async (_req, reply) => {
      if (!cognitoConfigured) { reply.code(501); return { error: 'cognito not configured' }; }
      reply.code(501);
      return { error: 'implemented in phase 4 infra' };
    },
  );

  app.get('/api/v1/auth/me', async (req, reply) => {
    const token = req.cookies['nemo_access_token'];
    if (!token) { reply.code(401); return { error: 'unauthenticated' }; }
    try {
      const ctx = await verifyAccessToken(token);
      return { sub: ctx.sub, username: ctx.username, tier: ctx.tier };
    } catch (err) {
      reply.code(401);
      return { error: 'invalid token', detail: (err as Error).message };
    }
  });

  app.post('/api/v1/auth/logout', async (_req, reply) => {
    reply.clearCookie('nemo_access_token', { path: '/' });
    return { ok: true };
  });
}
