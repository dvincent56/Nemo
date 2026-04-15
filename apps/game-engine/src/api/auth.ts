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
  const isProd = !!process.env['COGNITO_REGION'];

  app.post<{ Body: { username?: string } }>('/api/v1/auth/dev-login', async (req, reply) => {
    if (isProd) { reply.code(404); return { error: 'disabled in production' }; }
    const username = req.body?.username?.trim() || 'dev';
    const token = `dev.${username}.${username}`;
    // Dev : httpOnly=false pour que le client lise le token et le passe en
    // sub-protocol WS (`bearer.<token>`). En prod Cognito on remettra
    // httpOnly=true et on utilisera un endpoint ws-ticket dédié.
    reply.setCookie('nemo_access_token', token, {
      path: '/', httpOnly: false, sameSite: 'lax', secure: false, maxAge: 3600,
    });
    return { token, username };
  });

  app.post<{ Body: { code: string; redirectUri: string } }>(
    '/api/v1/auth/exchange',
    async (_req, reply) => {
      if (!isProd) { reply.code(501); return { error: 'cognito not configured' }; }
      // Phase 4 : échange du code contre id/access/refresh token via Cognito token endpoint.
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
