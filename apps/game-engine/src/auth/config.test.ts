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
