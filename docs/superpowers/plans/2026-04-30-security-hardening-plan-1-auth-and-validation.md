# Security Hardening — Plan 1 : Auth fail-closed + Input Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Éliminer les points d'auth fail-open et l'absence de validation d'entrée identifiés dans l'audit sécurité du 2026-04-30 — sans casser le flow de dev local.

**Architecture :**
- Le mode dev (token `dev.<sub>.<username>`, route `/api/v1/auth/dev-login`, routes `/api/v1/dev/*`) devient explicitement opt-in via `NEMO_ALLOW_DEV_AUTH=1`. Le boot du `game-engine` refuse de démarrer si aucun mode d'auth n'est configuré (ni Cognito, ni dev-auth flag).
- Toutes les entrées HTTP et WS sont validées via des schémas Zod. Un wrapper Fastify minimal (`validateRequest`) parse body/query/params et renvoie 400 sur échec.
- Hardening transport : `@fastify/helmet`, `@fastify/rate-limit`, allowlist CORS multi-origins, JWKS avec cooldown.

**Tech Stack :** Fastify 5, Zod, jose 5, node:test (test runner), tsx, TypeScript strict.

**Hors scope (Plan 2 dédié) :** cookie httpOnly + ticket WS, CSRF tokens, audit IDOR systématique, intégration Stripe (Phase 4).

---

## File Structure

**Créés :**
- `apps/game-engine/src/lib/validate.ts` — wrapper Zod pour Fastify (parse body/query/params).
- `apps/game-engine/src/lib/validate.test.ts` — tests du wrapper.
- `apps/game-engine/src/auth/config.ts` — `loadAuthConfig()` + `assertAuthConfig()` qui détermine le mode (cognito | dev | error) au boot.
- `apps/game-engine/src/auth/config.test.ts` — tests des invariants de boot.
- `apps/game-engine/src/auth/cognito.test.ts` — tests `verifyAccessToken` (dev token gating, rejet par défaut).
- `apps/game-engine/src/api/auth.test.ts` — tests d'intégration Fastify (dev-login retourne 404 si flag absent).
- `packages/shared-types/src/orders.zod.ts` — schémas Zod pour `Order`, `OrderTrigger`, `OrderEnvelope` (réutilisables par engine + ws-gateway).
- `packages/shared-types/src/orders.zod.test.ts` — tests de validation.
- `apps/ws-gateway/src/build-envelope.test.ts` — tests `buildEnvelope` avec payloads malicieux.

**Modifiés :**
- `apps/game-engine/src/index.ts` — appel `assertAuthConfig()` avant boot ; helmet + rate-limit ; CORS allowlist ; inversion `NEMO_DEV_ROUTES` default.
- `apps/game-engine/src/auth/cognito.ts` — gating dev token, JWKS cooldown, `requireAdmin` preHandler.
- `apps/game-engine/src/api/auth.ts` — gating dev-login.
- `apps/game-engine/src/api/marina.ts` — Zod sur POST `/api/v1/boats`.
- `apps/game-engine/src/api/races.ts` — Zod sur query GET `/api/v1/races`.
- `apps/game-engine/package.json` — ajoute `zod`, `@fastify/helmet`, `@fastify/rate-limit`.
- `apps/ws-gateway/src/index.ts` — utilise `OrderEnvelopeZ`, durcit `CLIENT_TS_TOLERANCE_MS`, ajoute rate-limit token bucket.
- `apps/ws-gateway/package.json` — ajoute `zod`, `@nemo/shared-types` workspace dep si absent.
- `packages/shared-types/src/index.ts` — ré-export des schémas Zod.
- `.env.example` (root) — ajoute `NEMO_ALLOW_DEV_AUTH=1` avec commentaire.

---

## Task 1: Auth config invariants (boot fail-closed)

**Files:**
- Create: `apps/game-engine/src/auth/config.ts`
- Create: `apps/game-engine/src/auth/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/game-engine/src/auth/config.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadAuthConfig, assertAuthConfig } from './config.js';

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); }
  finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

describe('loadAuthConfig', () => {
  it('returns mode=cognito when all COGNITO_* are set', () => {
    const cfg = withEnv(
      { COGNITO_REGION: 'eu-west-3', COGNITO_USER_POOL_ID: 'eu-west-3_X', COGNITO_CLIENT_ID: 'cid', NEMO_ALLOW_DEV_AUTH: undefined },
      () => loadAuthConfig(),
    );
    assert.equal(cfg.mode, 'cognito');
  });

  it('returns mode=dev when NEMO_ALLOW_DEV_AUTH=1 and Cognito missing', () => {
    const cfg = withEnv(
      { COGNITO_REGION: undefined, COGNITO_USER_POOL_ID: undefined, COGNITO_CLIENT_ID: undefined, NEMO_ALLOW_DEV_AUTH: '1' },
      () => loadAuthConfig(),
    );
    assert.equal(cfg.mode, 'dev');
  });

  it('returns mode=error when neither Cognito nor dev flag is set', () => {
    const cfg = withEnv(
      { COGNITO_REGION: undefined, COGNITO_USER_POOL_ID: undefined, COGNITO_CLIENT_ID: undefined, NEMO_ALLOW_DEV_AUTH: undefined },
      () => loadAuthConfig(),
    );
    assert.equal(cfg.mode, 'error');
  });

  it('returns mode=error when COGNITO_REGION set but COGNITO_USER_POOL_ID missing', () => {
    const cfg = withEnv(
      { COGNITO_REGION: 'eu-west-3', COGNITO_USER_POOL_ID: undefined, COGNITO_CLIENT_ID: 'cid', NEMO_ALLOW_DEV_AUTH: undefined },
      () => loadAuthConfig(),
    );
    assert.equal(cfg.mode, 'error');
  });
});

describe('assertAuthConfig', () => {
  it('throws when mode=error', () => {
    assert.throws(
      () => assertAuthConfig({ mode: 'error', reason: 'test' }),
      /auth configuration invalid/,
    );
  });

  it('does not throw when mode=cognito', () => {
    assert.doesNotThrow(() => assertAuthConfig({
      mode: 'cognito', region: 'r', userPoolId: 'u', clientId: 'c',
    }));
  });

  it('does not throw when mode=dev', () => {
    assert.doesNotThrow(() => assertAuthConfig({ mode: 'dev' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="loadAuthConfig|assertAuthConfig"`
Expected: FAIL — module `./config.js` not found.

- [ ] **Step 3: Implement `config.ts`**

```typescript
// apps/game-engine/src/auth/config.ts
/**
 * Auth mode resolution. Decided once at boot, never re-read.
 *
 * - cognito: full COGNITO_* triple present → JWT signature verification.
 * - dev:     NEMO_ALLOW_DEV_AUTH=1 → accepts dev.<sub>.<username> tokens.
 * - error:   neither configuration is complete → boot must abort.
 */

export type AuthConfig =
  | { mode: 'cognito'; region: string; userPoolId: string; clientId: string }
  | { mode: 'dev' }
  | { mode: 'error'; reason: string };

export function loadAuthConfig(): AuthConfig {
  const region = process.env['COGNITO_REGION'];
  const userPoolId = process.env['COGNITO_USER_POOL_ID'];
  const clientId = process.env['COGNITO_CLIENT_ID'];
  const cognitoComplete = !!(region && userPoolId && clientId);
  const cognitoPartial = !!(region || userPoolId || clientId) && !cognitoComplete;
  const devAllowed = process.env['NEMO_ALLOW_DEV_AUTH'] === '1';

  if (cognitoComplete) {
    return { mode: 'cognito', region: region!, userPoolId: userPoolId!, clientId: clientId! };
  }
  if (cognitoPartial) {
    return { mode: 'error', reason: 'COGNITO_REGION/USER_POOL_ID/CLIENT_ID must all be set together' };
  }
  if (devAllowed) {
    return { mode: 'dev' };
  }
  return {
    mode: 'error',
    reason: 'No auth mode configured. Set the COGNITO_* triple for prod, or NEMO_ALLOW_DEV_AUTH=1 for local dev.',
  };
}

export function assertAuthConfig(cfg: AuthConfig): void {
  if (cfg.mode === 'error') {
    throw new Error(`auth configuration invalid: ${cfg.reason}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="loadAuthConfig|assertAuthConfig"`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/auth/config.ts apps/game-engine/src/auth/config.test.ts
git commit -m "feat(auth): explicit auth-mode resolution with fail-closed default"
```

---

## Task 2: Wire boot guard into game-engine entrypoint

**Files:**
- Modify: `apps/game-engine/src/index.ts:82-100`

- [ ] **Step 1: Add the guard at the very top of `main()`**

In [apps/game-engine/src/index.ts](apps/game-engine/src/index.ts#L82-L100), replace the current top of `main()`:

```typescript
// apps/game-engine/src/index.ts (around line 11)
import { registerAuthRoutes } from './api/auth.js';
import { loadAuthConfig, assertAuthConfig } from './auth/config.js';
```

```typescript
// apps/game-engine/src/index.ts — start of main()
async function main() {
  const authConfig = loadAuthConfig();
  assertAuthConfig(authConfig);
  log.info({ mode: authConfig.mode }, 'auth mode resolved');

  await GameBalance.loadFromDisk();
  log.info({ version: GameBalance.version }, 'game-balance loaded');
  validateCatalogCoverage();
  // ... rest unchanged
```

Pass `authConfig` down where needed (Task 3 reads it).

- [ ] **Step 2: Smoke-test the boot guard manually**

```bash
unset COGNITO_REGION COGNITO_USER_POOL_ID COGNITO_CLIENT_ID NEMO_ALLOW_DEV_AUTH
pnpm --filter @nemo/game-engine dev
```

Expected: process exits with `auth configuration invalid: No auth mode configured...`. Logs don't show "game-engine listening".

```bash
NEMO_ALLOW_DEV_AUTH=1 pnpm --filter @nemo/game-engine dev
```

Expected: starts normally, log line `auth mode resolved {mode: "dev"}`.

- [ ] **Step 3: Commit**

```bash
git add apps/game-engine/src/index.ts
git commit -m "feat(auth): assert auth configuration at boot"
```

---

## Task 3: Gate dev-login route + dev token verification behind the flag

**Files:**
- Modify: `apps/game-engine/src/api/auth.ts:13-27`
- Modify: `apps/game-engine/src/auth/cognito.ts:30-69`
- Create: `apps/game-engine/src/api/auth.test.ts`
- Create: `apps/game-engine/src/auth/cognito.test.ts`

- [ ] **Step 1: Write the failing tests for `verifyAccessToken`**

```typescript
// apps/game-engine/src/auth/cognito.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccessToken } from './cognito.js';

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

describe('verifyAccessToken', () => {
  it('rejects dev.* token when NEMO_ALLOW_DEV_AUTH is unset', async () => {
    await withEnv(
      { COGNITO_REGION: undefined, COGNITO_USER_POOL_ID: undefined, COGNITO_CLIENT_ID: undefined, NEMO_ALLOW_DEV_AUTH: undefined },
      async () => {
        await assert.rejects(
          () => verifyAccessToken('dev.alice-sub.alice'),
          /dev tokens disabled/,
        );
      },
    );
  });

  it('accepts dev.* token when NEMO_ALLOW_DEV_AUTH=1', async () => {
    await withEnv(
      { COGNITO_REGION: undefined, COGNITO_USER_POOL_ID: undefined, COGNITO_CLIENT_ID: undefined, NEMO_ALLOW_DEV_AUTH: '1' },
      async () => {
        const ctx = await verifyAccessToken('dev.alice-sub.alice');
        assert.equal(ctx.sub, 'alice-sub');
        assert.equal(ctx.username, 'alice');
        assert.equal(ctx.tier, 'FREE');
      },
    );
  });

  it('does not accept dev.* token when COGNITO_* is configured (defense in depth)', async () => {
    await withEnv(
      { COGNITO_REGION: 'eu-west-3', COGNITO_USER_POOL_ID: 'eu-west-3_X', COGNITO_CLIENT_ID: 'cid', NEMO_ALLOW_DEV_AUTH: '1' },
      async () => {
        // With Cognito configured, dev tokens are NEVER accepted, even if flag is set.
        // (Cognito path will try to verify the JWT signature and fail.)
        await assert.rejects(() => verifyAccessToken('dev.alice-sub.alice'));
      },
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="verifyAccessToken"`
Expected: FAIL — first test fails because current code accepts dev tokens unconditionally when Cognito missing.

- [ ] **Step 3: Modify `cognito.ts` to gate dev token + add JWKS cooldown**

Replace [apps/game-engine/src/auth/cognito.ts:30-69](apps/game-engine/src/auth/cognito.ts#L30-L69):

```typescript
// apps/game-engine/src/auth/cognito.ts
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(e: CognitoEnv): ReturnType<typeof createRemoteJWKSet> {
  if (jwks) return jwks;
  const url = new URL(
    `https://cognito-idp.${e.region}.amazonaws.com/${e.userPoolId}/.well-known/jwks.json`,
  );
  // cooldownDuration: minimum interval (ms) between two refresh attempts when
  // an unknown kid is encountered. Allows key rotation to be picked up at most
  // every 5 minutes without hammering the JWKS endpoint.
  jwks = createRemoteJWKSet(url, { cooldownDuration: 300_000 });
  return jwks;
}

export interface AuthContext {
  sub: string;
  username: string;
  tier: 'FREE' | 'CAREER';
  isAdmin: boolean;
  claims: JWTPayload;
}

export async function verifyAccessToken(token: string): Promise<AuthContext> {
  const e = env();
  if (!e) {
    if (process.env['NEMO_ALLOW_DEV_AUTH'] !== '1') {
      throw new Error('dev tokens disabled (set NEMO_ALLOW_DEV_AUTH=1 for local dev)');
    }
    if (token.startsWith('dev.')) {
      const parts = token.split('.');
      const sub = parts[1] ?? 'dev-user';
      const username = parts[2] ?? 'dev';
      return { sub, username, tier: 'FREE', isAdmin: false, claims: { sub, username } };
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
  // Admin claim: must come from a Cognito group (cognito:groups is an array).
  // We never trust client-side hints — only the signed token.
  const groups = (payload['cognito:groups'] as string[] | undefined) ?? [];
  const isAdmin = groups.includes('admin');
  return { sub, username, tier, isAdmin, claims: payload };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="verifyAccessToken"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for the dev-login route**

```typescript
// apps/game-engine/src/api/auth.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerAuthRoutes } from './auth.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerAuthRoutes(app);
  return app;
}

describe('POST /api/v1/auth/dev-login', () => {
  it('returns 404 when NEMO_ALLOW_DEV_AUTH is unset', async () => {
    const prev = process.env['NEMO_ALLOW_DEV_AUTH'];
    delete process.env['NEMO_ALLOW_DEV_AUTH'];
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-login', payload: { username: 'alice' } });
      assert.equal(res.statusCode, 404);
    } finally {
      await app.close();
      if (prev === undefined) delete process.env['NEMO_ALLOW_DEV_AUTH'];
      else process.env['NEMO_ALLOW_DEV_AUTH'] = prev;
    }
  });

  it('returns 200 with token when NEMO_ALLOW_DEV_AUTH=1', async () => {
    const prev = process.env['NEMO_ALLOW_DEV_AUTH'];
    process.env['NEMO_ALLOW_DEV_AUTH'] = '1';
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-login', payload: { username: 'alice' } });
      assert.equal(res.statusCode, 200);
      const body = res.json() as { token: string; username: string };
      assert.equal(body.username, 'alice');
      assert.match(body.token, /^dev\./);
    } finally {
      await app.close();
      if (prev === undefined) delete process.env['NEMO_ALLOW_DEV_AUTH'];
      else process.env['NEMO_ALLOW_DEV_AUTH'] = prev;
    }
  });
});
```

- [ ] **Step 6: Run tests to verify failure (current code uses isProd flag)**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="dev-login"`
Expected: FAIL — current `isProd` logic returns 200 even without the flag.

- [ ] **Step 7: Modify `apps/game-engine/src/api/auth.ts`**

Replace lines 13-27:

```typescript
// apps/game-engine/src/api/auth.ts
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
  // ... /api/v1/auth/me and logout unchanged
```

- [ ] **Step 8: Run tests, verify pass**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="dev-login|verifyAccessToken"`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/game-engine/src/auth/cognito.ts apps/game-engine/src/api/auth.ts \
        apps/game-engine/src/auth/cognito.test.ts apps/game-engine/src/api/auth.test.ts
git commit -m "feat(auth): gate dev tokens and dev-login behind NEMO_ALLOW_DEV_AUTH"
```

---

## Task 4: Server-side admin guard

**Files:**
- Modify: `apps/game-engine/src/auth/cognito.ts` (add `requireAdmin` export)
- Create: nothing additional — used in Task 5+ when admin routes appear.

- [ ] **Step 1: Add `requireAdmin` preHandler to cognito.ts**

Append to [apps/game-engine/src/auth/cognito.ts](apps/game-engine/src/auth/cognito.ts) (after `enforceAuth`):

```typescript
/**
 * Use as `{ preHandler: [enforceAuth, requireAdmin] }` on admin-only routes.
 * Reads `req.auth.isAdmin` (populated by enforceAuth from a signed claim).
 * NEVER trusts the username, token suffix, or any client-controlled hint.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.auth) { reply.code(401).send({ error: 'unauthenticated' }); return; }
  if (!req.auth.isAdmin) { reply.code(403).send({ error: 'admin only' }); return; }
}
```

- [ ] **Step 2: Add a test that verifies `requireAdmin` rejects non-admin auth**

```typescript
// Append to apps/game-engine/src/auth/cognito.test.ts
import Fastify from 'fastify';
import { enforceAuth, requireAdmin } from './cognito.js';
import cookie from '@fastify/cookie';

describe('requireAdmin', () => {
  it('returns 403 for a dev token (non-admin by construction)', async () => {
    const prev = process.env['NEMO_ALLOW_DEV_AUTH'];
    process.env['NEMO_ALLOW_DEV_AUTH'] = '1';
    const app = Fastify({ logger: false });
    await app.register(cookie);
    app.get('/admin/ping', { preHandler: [enforceAuth, requireAdmin] }, async () => ({ ok: true }));
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/ping',
        headers: { authorization: 'Bearer dev.alice-sub.alice' },
      });
      assert.equal(res.statusCode, 403);
    } finally {
      await app.close();
      if (prev === undefined) delete process.env['NEMO_ALLOW_DEV_AUTH'];
      else process.env['NEMO_ALLOW_DEV_AUTH'] = prev;
    }
  });
});
```

- [ ] **Step 3: Run tests, verify pass**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="requireAdmin"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/auth/cognito.ts apps/game-engine/src/auth/cognito.test.ts
git commit -m "feat(auth): add requireAdmin preHandler reading signed cognito:groups claim"
```

---

## Task 5: Add Zod as direct dep + introduce request-validation wrapper

**Files:**
- Modify: `apps/game-engine/package.json`
- Create: `apps/game-engine/src/lib/validate.ts`
- Create: `apps/game-engine/src/lib/validate.test.ts`

- [ ] **Step 1: Add `zod` to game-engine dependencies**

```bash
pnpm --filter @nemo/game-engine add zod@^3.23.8
```

Expected: `package.json` updated, lockfile regenerated.

- [ ] **Step 2: Write the failing test**

```typescript
// apps/game-engine/src/lib/validate.test.ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="validateBody|validateQuery"`
Expected: FAIL — module `./validate.js` not found.

- [ ] **Step 4: Implement `validate.ts`**

```typescript
// apps/game-engine/src/lib/validate.ts
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
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="validateBody|validateQuery"`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/game-engine/package.json apps/game-engine/src/lib/validate.ts apps/game-engine/src/lib/validate.test.ts
git add ../../pnpm-lock.yaml 2>/dev/null || git add pnpm-lock.yaml
git commit -m "feat(api): add Zod request-validation wrapper for Fastify"
```

---

## Task 6: Apply Zod schemas on highest-risk HTTP routes

**Files:**
- Modify: `apps/game-engine/src/api/marina.ts:205-219` (POST `/api/v1/boats`)
- Modify: `apps/game-engine/src/api/races.ts:138-154` (GET `/api/v1/races` query)

- [ ] **Step 1: Find current POST /api/v1/boats body validation in marina.ts**

```bash
grep -n "POST.*'/api/v1/boats'" apps/game-engine/src/api/marina.ts
```

Read the surrounding ~30 lines. The current pattern is `if (!name || typeof name !== 'string' ...)` ad-hoc validation.

- [ ] **Step 2: Replace ad-hoc validation with Zod schema**

```typescript
// apps/game-engine/src/api/marina.ts (top of file imports)
import { z } from 'zod';
import { validateBody, validateQuery } from '../lib/validate.js';
```

Define the schema near the top of `registerMarinaRoutes`:

```typescript
const CreateBoatBodyZ = z.object({
  boatClass: BoatClassZ,
  name: z.string().trim().min(1).max(40),
});
```

Replace the route handler:

```typescript
app.post('/api/v1/boats', {
  preHandler: [enforceAuth, validateBody(CreateBoatBodyZ)],
}, async (req, reply) => {
  const { boatClass, name } = req.validBody as z.infer<typeof CreateBoatBodyZ>;
  // ... existing handler body using boatClass and name (no more manual checks)
});
```

Strip the now-dead manual checks (`if (!name || typeof name !== 'string' ...)`).

- [ ] **Step 3: Add a query schema on GET /api/v1/races**

In [apps/game-engine/src/api/races.ts:138-154](apps/game-engine/src/api/races.ts#L138-L154):

```typescript
import { z } from 'zod';
import { BoatClassZ } from '@nemo/game-balance';
import { validateBody, validateQuery, validateParams } from '../lib/validate.js';

const RaceStatusZ = z.enum(['DRAFT', 'PUBLISHED', 'BRIEFING', 'LIVE', 'FINISHED']);
const ListRacesQueryZ = z.object({
  class: BoatClassZ.optional(),
  status: RaceStatusZ.optional(),
});
const RaceIdParamsZ = z.object({ id: z.string().min(1).max(64) });
```

```typescript
export function registerRaceRoutes(app: FastifyInstance): void {
  app.get('/api/v1/races', { preHandler: [validateQuery(ListRacesQueryZ)] }, async (req) => {
    const q = req.validQuery as z.infer<typeof ListRacesQueryZ>;
    const fromDb = await loadFromDb();
    let out = fromDb ?? SEED.slice();
    if (q.class) out = out.filter((r) => r.boatClass === q.class);
    if (q.status) out = out.filter((r) => r.status === q.status);
    return { races: out, source: fromDb ? 'db' : 'memory' };
  });

  app.get('/api/v1/races/:id', { preHandler: [validateParams(RaceIdParamsZ)] }, async (req, reply) => {
    const { id } = req.validParams as z.infer<typeof RaceIdParamsZ>;
    const fromDb = await loadFromDb();
    const list = fromDb ?? SEED;
    const race = list.find((r) => r.id === id);
    if (!race) { reply.code(404); return { error: 'not found' }; }
    return race;
  });
}
```

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm --filter @nemo/game-engine typecheck && pnpm --filter @nemo/game-engine test`
Expected: green, all existing tests still pass.

Manual smoke:
```bash
NEMO_ALLOW_DEV_AUTH=1 pnpm --filter @nemo/game-engine dev
# in another shell:
curl -s 'http://localhost:3001/api/v1/races?class=NOPE'
# expected: 400 with issues array
curl -s 'http://localhost:3001/api/v1/races?class=IMOCA60'
# expected: 200 with races filtered
```

- [ ] **Step 5: Commit**

```bash
git add apps/game-engine/src/api/marina.ts apps/game-engine/src/api/races.ts
git commit -m "feat(api): apply Zod schemas to POST /boats and GET /races"
```

---

## Task 7: Zod schemas for Order envelopes (shared)

**Files:**
- Create: `packages/shared-types/src/orders.zod.ts`
- Create: `packages/shared-types/src/orders.zod.test.ts`
- Modify: `packages/shared-types/src/index.ts` (re-export)
- Modify: `packages/shared-types/package.json` (add zod dep if absent)

- [ ] **Step 1: Add zod to `packages/shared-types`**

```bash
pnpm --filter @nemo/shared-types add zod@^3.23.8
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/shared-types/src/orders.zod.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrderZ, OrderTriggerZ } from './orders.zod.js';

describe('OrderTriggerZ', () => {
  it('accepts IMMEDIATE', () => {
    assert.equal(OrderTriggerZ.safeParse({ type: 'IMMEDIATE' }).success, true);
  });
  it('accepts AT_TIME with numeric time', () => {
    assert.equal(OrderTriggerZ.safeParse({ type: 'AT_TIME', time: 1700000000 }).success, true);
  });
  it('rejects AT_TIME without time', () => {
    assert.equal(OrderTriggerZ.safeParse({ type: 'AT_TIME' }).success, false);
  });
  it('rejects unknown trigger type', () => {
    assert.equal(OrderTriggerZ.safeParse({ type: 'NUKE' }).success, false);
  });
});

describe('OrderZ', () => {
  it('accepts a CAP order with numeric heading value', () => {
    const r = OrderZ.safeParse({
      id: 'o1', type: 'CAP', trigger: { type: 'IMMEDIATE' },
      value: { heading: 180 },
    });
    assert.equal(r.success, true);
  });
  it('rejects unknown order type', () => {
    const r = OrderZ.safeParse({
      id: 'o1', type: 'TROLL', trigger: { type: 'IMMEDIATE' }, value: {},
    });
    assert.equal(r.success, false);
  });
  it('rejects oversize value blob (>2KB)', () => {
    const huge = { junk: 'x'.repeat(3000) };
    const r = OrderZ.safeParse({
      id: 'o1', type: 'CAP', trigger: { type: 'IMMEDIATE' }, value: huge,
    });
    assert.equal(r.success, false);
  });
});
```

- [ ] **Step 3: Run test, verify failure**

Run: `pnpm --filter @nemo/shared-types test`
Expected: FAIL — module `./orders.zod.js` not found.
(If `@nemo/shared-types` has no test script yet, add `"test": "node --import tsx --test \"src/**/*.test.ts\""` to its package.json first, mirroring `@nemo/game-engine`.)

- [ ] **Step 4: Implement `orders.zod.ts`**

```typescript
// packages/shared-types/src/orders.zod.ts
import { z } from 'zod';

export const OrderTypeZ = z.enum(['CAP', 'TWA', 'WPT', 'SAIL', 'MODE', 'VMG']);

export const OrderTriggerZ = z.discriminatedUnion('type', [
  z.object({ type: z.literal('IMMEDIATE') }),
  z.object({ type: z.literal('SEQUENTIAL') }),
  z.object({ type: z.literal('AT_TIME'), time: z.number().finite() }),
  z.object({ type: z.literal('AT_WAYPOINT'), waypointOrderId: z.string().min(1).max(128) }),
  z.object({ type: z.literal('AFTER_DURATION'), duration: z.number().finite().nonnegative() }),
]);

// `value` is intentionally permissive (different OrderType need different shapes,
// the engine refines per-type), but capped to 2KB JSON to bound damage.
const ValueZ = z.record(z.unknown()).superRefine((val, ctx) => {
  const size = JSON.stringify(val).length;
  if (size > 2048) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `value blob too large (${size}B > 2048B)` });
  }
});

export const OrderZ = z.object({
  id: z.string().min(1).max(128),
  type: OrderTypeZ,
  trigger: OrderTriggerZ,
  value: ValueZ,
  activatedAt: z.number().optional(),
  completed: z.boolean().optional(),
});

export const OrderEnvelopeInputZ = z.object({
  // Subset of OrderEnvelope that the client actually controls. The gateway
  // adds connectionId, trustedTs, effectiveTs, receivedAt server-side.
  order: OrderZ,
  clientTs: z.number().finite(),
  clientSeq: z.number().int().nonnegative(),
});
```

- [ ] **Step 5: Re-export from package index**

In [packages/shared-types/src/index.ts](packages/shared-types/src/index.ts), append:

```typescript
export {
  OrderTypeZ,
  OrderTriggerZ,
  OrderZ,
  OrderEnvelopeInputZ,
} from './orders.zod.js';
```

- [ ] **Step 6: Run test, verify pass**

Run: `pnpm --filter @nemo/shared-types test`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/src/orders.zod.ts packages/shared-types/src/orders.zod.test.ts \
        packages/shared-types/src/index.ts packages/shared-types/package.json pnpm-lock.yaml
git commit -m "feat(shared-types): Zod schemas for Order envelopes"
```

---

## Task 8: Apply OrderZ in ws-gateway + tighten timestamp tolerance

**Files:**
- Modify: `apps/ws-gateway/src/index.ts:67-105, 184-258`
- Modify: `apps/ws-gateway/package.json` (add @nemo/shared-types if absent)
- Create: `apps/ws-gateway/src/build-envelope.ts` (extract pure logic)
- Create: `apps/ws-gateway/src/build-envelope.test.ts`

- [ ] **Step 1: Extract `buildEnvelope` to its own module**

Create [apps/ws-gateway/src/build-envelope.ts](apps/ws-gateway/src/build-envelope.ts):

```typescript
// apps/ws-gateway/src/build-envelope.ts
import type { Order, OrderEnvelope, OrderTrigger } from '@nemo/shared-types';
import { OrderZ } from '@nemo/shared-types';

// Tightened from 2000ms to 500ms per security audit: a 2s window let clients
// antedate orders to bypass server-side temporal guards.
export const CLIENT_TS_TOLERANCE_MS = 500;

function computeEffectiveTs(trigger: OrderTrigger, trustedTs: number): number {
  if (trigger.type === 'AT_TIME') {
    return trigger.time * 1000;
  }
  return trustedTs;
}

export function buildEnvelope(args: {
  rawOrder: unknown;
  clientTs: number;
  clientSeq: number;
  connectionId: string;
  serverNow: number;
}): OrderEnvelope | null {
  const { rawOrder, clientTs, clientSeq, connectionId, serverNow } = args;
  if (!Number.isFinite(clientTs) || !Number.isFinite(clientSeq)) return null;

  // Apply default id before validation if absent — matches old buildEnvelope behaviour.
  const candidate = (typeof rawOrder === 'object' && rawOrder !== null)
    ? { id: `${connectionId}-${clientSeq}`, ...(rawOrder as Record<string, unknown>) }
    : rawOrder;

  const parsed = OrderZ.safeParse(candidate);
  if (!parsed.success) return null;
  const order: Order = parsed.data;

  const trustedTs = Math.abs(serverNow - clientTs) < CLIENT_TS_TOLERANCE_MS ? clientTs : serverNow;
  const effectiveTs = computeEffectiveTs(order.trigger, trustedTs);

  return {
    order,
    clientTs,
    clientSeq,
    trustedTs,
    effectiveTs,
    receivedAt: serverNow,
    connectionId,
  };
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/ws-gateway/src/build-envelope.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, CLIENT_TS_TOLERANCE_MS } from './build-envelope.js';

const baseArgs = {
  clientTs: 1_000_000,
  clientSeq: 0,
  connectionId: 'conn_test',
  serverNow: 1_000_000,
};

describe('buildEnvelope', () => {
  it('accepts a valid CAP order', () => {
    const env = buildEnvelope({
      ...baseArgs,
      rawOrder: { type: 'CAP', trigger: { type: 'IMMEDIATE' }, value: { heading: 90 } },
    });
    assert.ok(env);
    assert.equal(env!.order.type, 'CAP');
    assert.equal(env!.connectionId, 'conn_test');
  });

  it('rejects unknown type', () => {
    const env = buildEnvelope({
      ...baseArgs,
      rawOrder: { type: 'NUKE', trigger: { type: 'IMMEDIATE' }, value: {} },
    });
    assert.equal(env, null);
  });

  it('rejects oversize value blob', () => {
    const env = buildEnvelope({
      ...baseArgs,
      rawOrder: { type: 'CAP', trigger: { type: 'IMMEDIATE' }, value: { x: 'a'.repeat(3000) } },
    });
    assert.equal(env, null);
  });

  it('rejects null/non-object payload', () => {
    assert.equal(buildEnvelope({ ...baseArgs, rawOrder: null }), null);
    assert.equal(buildEnvelope({ ...baseArgs, rawOrder: 42 }), null);
    assert.equal(buildEnvelope({ ...baseArgs, rawOrder: 'oops' }), null);
  });

  it('falls back to serverNow when clientTs is too far in the past', () => {
    const env = buildEnvelope({
      ...baseArgs,
      clientTs: baseArgs.serverNow - (CLIENT_TS_TOLERANCE_MS + 1),
      rawOrder: { type: 'CAP', trigger: { type: 'IMMEDIATE' }, value: { heading: 90 } },
    });
    assert.ok(env);
    assert.equal(env!.trustedTs, baseArgs.serverNow);
  });

  it('keeps clientTs when within tolerance', () => {
    const env = buildEnvelope({
      ...baseArgs,
      clientTs: baseArgs.serverNow - 100,
      rawOrder: { type: 'CAP', trigger: { type: 'IMMEDIATE' }, value: { heading: 90 } },
    });
    assert.ok(env);
    assert.equal(env!.trustedTs, baseArgs.serverNow - 100);
  });
});
```

- [ ] **Step 3: Add a test script to ws-gateway if absent**

Read [apps/ws-gateway/package.json](apps/ws-gateway/package.json). If no `test` script, add:
```json
"test": "node --import tsx --test \"src/**/*.test.ts\""
```

- [ ] **Step 4: Run test to verify failure (no module yet built)**

Run: `pnpm --filter @nemo/ws-gateway test`
Expected: FAIL — module `./build-envelope.js` not found OR oversize-blob test fails (current ad-hoc validator passes oversize data).

- [ ] **Step 5: Wire `buildEnvelope` import in `index.ts`**

Replace lines 67-105 of [apps/ws-gateway/src/index.ts](apps/ws-gateway/src/index.ts#L67-L105) — delete the local copies, replace with:

```typescript
import { buildEnvelope, CLIENT_TS_TOLERANCE_MS } from './build-envelope.js';
```

(Also remove the now-orphan `computeEffectiveTs` if any callsite remains; only `buildEnvelope` should reach it.)

- [ ] **Step 6: Run all ws-gateway tests, verify pass**

Run: `pnpm --filter @nemo/ws-gateway test`
Expected: PASS, 6 build-envelope tests + any prior tests.

- [ ] **Step 7: Commit**

```bash
git add apps/ws-gateway/src/build-envelope.ts apps/ws-gateway/src/build-envelope.test.ts \
        apps/ws-gateway/src/index.ts apps/ws-gateway/package.json
git commit -m "feat(ws): validate Order envelopes via Zod, tighten ts tolerance to 500ms"
```

---

## Task 9: Per-connection rate-limit on WS inbound messages

**Files:**
- Modify: `apps/ws-gateway/src/index.ts:184-258` (in the `ws.on('message', ...)` handler)
- Create: `apps/ws-gateway/src/rate-limit.ts`
- Create: `apps/ws-gateway/src/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/ws-gateway/src/rate-limit.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from './rate-limit.js';

describe('TokenBucket', () => {
  it('allows up to capacity messages immediately', () => {
    const b = new TokenBucket({ capacity: 5, refillPerSec: 1, now: () => 1000 });
    for (let i = 0; i < 5; i++) assert.equal(b.tryConsume(), true);
    assert.equal(b.tryConsume(), false);
  });

  it('refills over time', () => {
    let t = 1000;
    const b = new TokenBucket({ capacity: 5, refillPerSec: 10, now: () => t });
    for (let i = 0; i < 5; i++) b.tryConsume();
    t = 1500; // 500ms later → 5 tokens refilled
    for (let i = 0; i < 5; i++) assert.equal(b.tryConsume(), true);
    assert.equal(b.tryConsume(), false);
  });

  it('does not refill above capacity', () => {
    let t = 1000;
    const b = new TokenBucket({ capacity: 5, refillPerSec: 10, now: () => t });
    t = 10_000; // long delay
    for (let i = 0; i < 5; i++) assert.equal(b.tryConsume(), true);
    assert.equal(b.tryConsume(), false);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @nemo/ws-gateway test -- --test-name-pattern="TokenBucket"`
Expected: FAIL — module `./rate-limit.js` not found.

- [ ] **Step 3: Implement `rate-limit.ts`**

```typescript
// apps/ws-gateway/src/rate-limit.ts
export interface TokenBucketOpts {
  capacity: number;        // max tokens (burst)
  refillPerSec: number;    // sustained rate
  now?: () => number;      // for tests
}

export class TokenBucket {
  private tokens: number;
  private lastMs: number;
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly now: () => number;

  constructor(opts: TokenBucketOpts) {
    this.capacity = opts.capacity;
    this.refillPerSec = opts.refillPerSec;
    this.tokens = opts.capacity;
    this.now = opts.now ?? Date.now;
    this.lastMs = this.now();
  }

  tryConsume(): boolean {
    const t = this.now();
    const elapsed = (t - this.lastMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastMs = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
```

- [ ] **Step 4: Wire into ws-gateway message handler**

In [apps/ws-gateway/src/index.ts](apps/ws-gateway/src/index.ts), update `ClientCtx`:

```typescript
import { TokenBucket } from './rate-limit.js';

interface ClientCtx {
  connectionId: string;
  raceId: string;
  playerId: string;
  username: string;
  boatId: string | null;
  channel: string;
  subscribedAt: number;
  bucket: TokenBucket;  // NEW
}
```

In the `wss.handleUpgrade` callback, populate it:
```typescript
const ctx: ClientCtx = {
  // ... existing fields
  bucket: new TokenBucket({ capacity: 30, refillPerSec: 10 }), // 30 burst, 10/sec sustained
};
```

At the very top of `ws.on('message', ...)`:
```typescript
ws.on('message', (data, isBinary) => {
  if (!isBinary) return;
  if (!ctx.bucket.tryConsume()) {
    log.warn({ conn: ctx.connectionId }, 'rate limit hit, dropping message');
    return;
  }
  // ... existing decoding logic
```

- [ ] **Step 5: Run all ws-gateway tests, verify pass**

Run: `pnpm --filter @nemo/ws-gateway test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ws-gateway/src/rate-limit.ts apps/ws-gateway/src/rate-limit.test.ts apps/ws-gateway/src/index.ts
git commit -m "feat(ws): per-connection token-bucket rate limiting on inbound messages"
```

---

## Task 10: helmet, rate-limit, CORS allowlist on game-engine

**Files:**
- Modify: `apps/game-engine/package.json` (add deps)
- Modify: `apps/game-engine/src/index.ts:87-92`
- Create: `apps/game-engine/src/lib/cors-allowlist.ts`
- Create: `apps/game-engine/src/lib/cors-allowlist.test.ts`

> **Note for future scaling (informational, no action in this plan):** The
> rate-limit configured below is **per-process, in-memory**. Today (Phase 3)
> there is exactly one `game-engine` process for all races, so per-IP counters
> are coherent. When the architecture moves to one Worker/pod per race
> (cf. memory `project_scaling_plan`, Phase 4+), an attacker can hit multiple
> pods and multiply their effective quota by the shard count. At that point
> swap the in-memory store for the Redis-backed one — `@fastify/rate-limit`
> supports it natively via `redis: ioredisInstance` in the register options.
> Track this as a follow-up when `apps/game-engine/src/pool.ts` lands.

- [ ] **Step 1: Add deps**

```bash
pnpm --filter @nemo/game-engine add @fastify/helmet@^12.0.0 @fastify/rate-limit@^10.1.0
```

- [ ] **Step 2: Write the failing test for CORS allowlist parsing**

```typescript
// apps/game-engine/src/lib/cors-allowlist.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCorsAllowlist } from './cors-allowlist.js';

describe('parseCorsAllowlist', () => {
  it('parses a single origin', () => {
    assert.deepEqual(parseCorsAllowlist('http://localhost:3000'), ['http://localhost:3000']);
  });
  it('parses comma-separated origins, trimmed', () => {
    assert.deepEqual(
      parseCorsAllowlist('http://localhost:3000, https://nemo.example.com'),
      ['http://localhost:3000', 'https://nemo.example.com'],
    );
  });
  it('rejects "*" wildcard', () => {
    assert.throws(() => parseCorsAllowlist('*'), /wildcard not allowed/);
  });
  it('rejects an origin without scheme', () => {
    assert.throws(() => parseCorsAllowlist('nemo.example.com'), /must start with http/);
  });
  it('rejects empty input', () => {
    assert.throws(() => parseCorsAllowlist(''), /empty/);
  });
  it('strips trailing slashes', () => {
    assert.deepEqual(parseCorsAllowlist('https://nemo.example.com/'), ['https://nemo.example.com']);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="parseCorsAllowlist"`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement allowlist parser**

```typescript
// apps/game-engine/src/lib/cors-allowlist.ts
/**
 * Parse and validate the CORS origin allowlist from WEB_ORIGIN env var.
 * Comma-separated, scheme required, wildcard refused.
 */
export function parseCorsAllowlist(raw: string): string[] {
  if (!raw.trim()) throw new Error('WEB_ORIGIN is empty');
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p === '*') throw new Error('CORS wildcard not allowed; list explicit origins');
    if (!/^https?:\/\//.test(p)) throw new Error(`CORS origin must start with http(s):// — got "${p}"`);
    out.push(p.replace(/\/$/, ''));
  }
  return out;
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @nemo/game-engine test -- --test-name-pattern="parseCorsAllowlist"`
Expected: PASS, 6 tests.

- [ ] **Step 6: Wire helmet, rate-limit, CORS allowlist into entrypoint**

In [apps/game-engine/src/index.ts](apps/game-engine/src/index.ts) at line 87-92, replace:

```typescript
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { parseCorsAllowlist } from './lib/cors-allowlist.js';

// ... inside main()
const allowlist = parseCorsAllowlist(process.env['WEB_ORIGIN'] ?? 'http://localhost:3000');
log.info({ origins: allowlist }, 'CORS allowlist resolved');

const app = Fastify({ logger: false });
await app.register(helmet, { contentSecurityPolicy: false }); // API: no CSP, but X-Frame-Options/HSTS/etc.
await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute',
  // Per-IP by default. Authenticated users get a higher quota at route level if needed.
});
await app.register(cookie);
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl
    if (allowlist.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
});
```

- [ ] **Step 7: Manual smoke test**

```bash
WEB_ORIGIN='http://localhost:3000,https://staging.nemo.example.com' \
NEMO_ALLOW_DEV_AUTH=1 pnpm --filter @nemo/game-engine dev
# in another shell:
curl -i 'http://localhost:3001/health'
# expect headers: x-frame-options, x-content-type-options, strict-transport-security
curl -i -H 'Origin: https://attacker.example.com' 'http://localhost:3001/api/v1/races'
# expect: 500 / no access-control-allow-origin header for that origin
curl -i -H 'Origin: http://localhost:3000' 'http://localhost:3001/api/v1/races'
# expect: 200 + access-control-allow-origin: http://localhost:3000
```

Also test rate-limit:
```bash
for i in {1..250}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/health; done | sort | uniq -c
# expect: ~200 of "200" then "429" responses
```

- [ ] **Step 8: Commit**

```bash
git add apps/game-engine/package.json apps/game-engine/src/index.ts \
        apps/game-engine/src/lib/cors-allowlist.ts apps/game-engine/src/lib/cors-allowlist.test.ts \
        pnpm-lock.yaml
git commit -m "feat(api): helmet, per-IP rate limit, strict CORS allowlist"
```

---

## Task 11: Invert default of NEMO_DEV_ROUTES

**Files:**
- Modify: `apps/game-engine/src/index.ts:149-152`

- [ ] **Step 1: Flip the default**

Replace:
```typescript
if (process.env['NEMO_DEV_ROUTES'] !== '0') {
  registerDevRoutes(app, tick, createDemoRuntime);
  log.info('dev routes enabled — POST /api/v1/dev/reset-demo available');
}
```

With:
```typescript
// Dev routes are OFF by default. Local dev sets NEMO_DEV_ROUTES=1 in .env.
if (process.env['NEMO_DEV_ROUTES'] === '1') {
  registerDevRoutes(app, tick, createDemoRuntime);
  log.warn('dev routes ENABLED — POST /api/v1/dev/reset-demo available (local dev only)');
}
```

- [ ] **Step 2: Update `.env.example` (root)**

Read [.env.example](.env.example). Add (or update if present):
```
# Local dev only — accepts unsigned dev tokens. Never set in prod.
NEMO_ALLOW_DEV_AUTH=1
# Local dev only — exposes /api/v1/dev/* mutating endpoints.
NEMO_DEV_ROUTES=1
# Comma-separated list of allowed origins. Wildcard refused.
WEB_ORIGIN=http://localhost:3000
```

- [ ] **Step 3: Smoke-test**

```bash
unset NEMO_DEV_ROUTES
NEMO_ALLOW_DEV_AUTH=1 pnpm --filter @nemo/game-engine dev
# Expected log: NO "dev routes ENABLED" line.
curl -X POST http://localhost:3001/api/v1/dev/reset-demo
# Expected: 404 (route unregistered)
```

```bash
NEMO_ALLOW_DEV_AUTH=1 NEMO_DEV_ROUTES=1 pnpm --filter @nemo/game-engine dev
# Expected log: "dev routes ENABLED"
```

- [ ] **Step 4: Commit**

```bash
git add apps/game-engine/src/index.ts .env.example
git commit -m "feat(api): dev routes off by default, opt-in via NEMO_DEV_ROUTES=1"
```

---

## Task 12: Dependency audit + final verification

**Files:** none modified (verification only)

- [ ] **Step 1: Run full test suite**

```bash
pnpm -w typecheck
pnpm -w test
```

Expected: green.

- [ ] **Step 2: Run pnpm audit**

```bash
pnpm -w audit --prod
```

Expected: review the report. Note any `high`/`critical` vulnerabilities; if any block prod, open an issue and add a follow-up task.

- [ ] **Step 3: Manual end-to-end smoke test**

In one shell:
```bash
NEMO_ALLOW_DEV_AUTH=1 NEMO_DEV_ROUTES=1 pnpm dev
```

In another:
```bash
# 1) Dev login works
curl -s -c /tmp/cj http://localhost:3001/api/v1/auth/dev-login -d '{"username":"alice"}' -H 'content-type: application/json'

# 2) /me returns the dev profile
curl -s -b /tmp/cj http://localhost:3001/api/v1/auth/me

# 3) Invalid race query returns 400
curl -i 'http://localhost:3001/api/v1/races?class=NOPE'

# 4) Non-allowed origin gets blocked
curl -i -H 'Origin: https://evil.example.com' http://localhost:3001/api/v1/races

# 5) WS connection with bogus order is dropped (check ws-gateway logs)
# Use a small node script that opens a ws to /race/r-vendee-2026 with bearer.dev.alice.alice
# and sends an msgpack frame with type='ORDER', payload.order.type='NUKE'.
# Expected log line: "malformed ORDER payload" or order rejected.
```

- [ ] **Step 4: Commit anything left (e.g., updated lockfile)**

```bash
git status
# if anything left:
git add -A && git commit -m "chore: regenerate lockfile after security hardening"
```

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "Security hardening Plan 1: auth fail-closed + input validation" \
  --body "$(cat <<'EOF'
## Summary
- Auth fail-closed: game-engine refuses to boot without explicit Cognito or NEMO_ALLOW_DEV_AUTH=1
- dev-login route + dev.* token verification gated behind NEMO_ALLOW_DEV_AUTH=1
- Server-side admin guard reads cognito:groups (signed claim only)
- Zod schemas on highest-risk HTTP routes (POST /boats, GET /races) and WS Order envelopes
- helmet, per-IP rate-limit, strict CORS allowlist on game-engine
- Per-connection token-bucket rate limit on WS inbound; client ts tolerance 2000→500ms
- Dev routes opt-in (NEMO_DEV_ROUTES=1) instead of opt-out

## Out of scope (Plan 2)
- httpOnly cookie + WS ticket flow
- CSRF tokens on cookie-based mutations
- Systematic IDOR audit pattern across all mutating routes
- Stripe webhook signature verification (Phase 4)

## Test plan
- [ ] pnpm -w test green
- [ ] pnpm -w typecheck green
- [ ] Manual smoke: boot fails without auth env
- [ ] Manual smoke: dev-login returns 404 without flag
- [ ] Manual smoke: invalid query returns 400
- [ ] Manual smoke: forbidden CORS origin blocked
- [ ] Manual smoke: WS rejects bogus Order types
EOF
)"
```

---

## Self-Review Notes

**Spec coverage (cross-checked against the audit's "Critique + Haut + Moyen" findings):**

| Audit finding | Task |
|---|---|
| CRITIQUE: stub dev-login si COGNITO_REGION vide | Tasks 1, 2, 3 |
| CRITIQUE: zéro Zod | Tasks 5, 6, 7, 8 |
| HAUT: dev.* token sans crypto | Task 3 |
| HAUT: Auth WS faible + payload non validé | Task 8 |
| HAUT: rôle admin via suffixe token | Task 4 |
| MOYEN: JWKS jamais rafraîchi | Task 3 (cooldownDuration) |
| MOYEN: pas de helmet/CSP/HSTS | Task 10 |
| MOYEN: pas de rate-limit HTTP/WS | Tasks 9, 10 |
| MOYEN: CORS hardcodé | Task 10 |
| MOYEN: timestamp tolerance 2000ms | Task 8 |
| MOYEN: dev routes opt-out par défaut | Task 11 |

**Deferred to Plan 2 (architectural changes requiring separate brainstorming):**
- Cookie httpOnly + WS ticket endpoint (impacte ws-gateway connect flow et tous les clients)
- CSRF tokens (choix `@fastify/csrf-protection` ou same-site strict only)
- Audit IDOR systématique (pass de revue dédié sur toutes les routes mutantes)
- Stripe webhook (déclencher quand Phase 4 démarre)
- Logs PII scrubbing (audit dédié des appels pino + console)
- **Rate-limit Redis-backed**: today (Phase 3) the game-engine is a single
  process, so the in-memory rate-limit from Task 10 is coherent. When
  `apps/game-engine/src/pool.ts` (1 Worker/pod per race, cf. memory
  `project_scaling_plan`) is implemented, a client hitting multiple pods will
  multiply their quota by the shard count. Switch to `@fastify/rate-limit`
  Redis store at that point. Trigger: arrival of multi-pod sharding in
  Phase 4 or Phase 5.
