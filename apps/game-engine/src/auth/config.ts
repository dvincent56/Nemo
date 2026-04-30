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
