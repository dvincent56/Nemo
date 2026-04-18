import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Vérification JWT Cognito (access token) via JWKS distant.
 *
 * Variables d'environnement requises :
 *   COGNITO_REGION       (ex. eu-west-3)
 *   COGNITO_USER_POOL_ID (ex. eu-west-3_AbCdEf)
 *   COGNITO_CLIENT_ID    (app client id côté web)
 *
 * Phase 3 : vérification complète du token (signature, issuer, audience, exp).
 * Phase 4 : intégration des flows Google/Apple/Facebook via Cognito Hosted UI.
 */

interface CognitoEnv {
  region: string;
  userPoolId: string;
  clientId: string;
}

function env(): CognitoEnv | null {
  const region = process.env['COGNITO_REGION'];
  const userPoolId = process.env['COGNITO_USER_POOL_ID'];
  const clientId = process.env['COGNITO_CLIENT_ID'];
  if (!region || !userPoolId || !clientId) return null;
  return { region, userPoolId, clientId };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(e: CognitoEnv): ReturnType<typeof createRemoteJWKSet> {
  if (jwks) return jwks;
  const url = new URL(
    `https://cognito-idp.${e.region}.amazonaws.com/${e.userPoolId}/.well-known/jwks.json`,
  );
  jwks = createRemoteJWKSet(url);
  return jwks;
}

export interface AuthContext {
  sub: string;
  username: string;
  tier: 'FREE' | 'CAREER';
  claims: JWTPayload;
}

export async function verifyAccessToken(token: string): Promise<AuthContext> {
  const e = env();
  if (!e) {
    // Mode dev/stub : si Cognito non configuré, on accepte un token signé "dev.<sub>.<username>".
    if (token.startsWith('dev.')) {
      const parts = token.split('.');
      const sub = parts[1] ?? 'dev-user';
      const username = parts[2] ?? 'dev';
      return { sub, username, tier: 'FREE', claims: { sub, username } };
    }
    throw new Error('COGNITO_* env missing and token is not a dev stub');
  }
  const issuer = `https://cognito-idp.${e.region}.amazonaws.com/${e.userPoolId}`;
  const { payload } = await jwtVerify(token, getJwks(e), {
    issuer,
    audience: e.clientId,
  });
  const sub = String(payload['sub'] ?? '');
  const username = String(payload['cognito:username'] ?? payload['username'] ?? sub);
  const tier = (payload['custom:tier'] as 'FREE' | 'CAREER' | undefined) ?? 'FREE';
  return { sub, username, tier, claims: payload };
}

/**
 * Fastify preHandler — enforce auth sur toutes les routes sauf whitelist.
 */
export function authPreHandler(publicPaths: ReadonlySet<string>) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (publicPaths.has(req.routeOptions.url ?? req.url)) return;
    const header = req.headers.authorization;
    const cookieToken = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies?.['nemo_access_token'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : cookieToken;
    if (!token) {
      reply.code(401).send({ error: 'missing token' });
      return;
    }
    try {
      const ctx = await verifyAccessToken(token);
      (req as FastifyRequest & { auth?: AuthContext }).auth = ctx;
    } catch (err) {
      reply.code(401).send({ error: 'invalid token', detail: (err as Error).message });
    }
  };
}

// ---------------------------------------------------------------------------
// Fastify type augmentation — makes req.auth available with full type safety
// ---------------------------------------------------------------------------
declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * Fastify preHandler hook — extracts and validates auth token.
 * Use as `{ preHandler: [enforceAuth] }` on protected routes.
 */
export async function enforceAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  const cookieToken = req.cookies?.['nemo_access_token'];
  const token = header?.startsWith('Bearer ') ? header.slice(7) : cookieToken;
  if (!token) {
    reply.code(401).send({ error: 'unauthenticated' });
    return;
  }
  try {
    req.auth = await verifyAccessToken(token);
  } catch {
    reply.code(401).send({ error: 'invalid token' });
  }
}
