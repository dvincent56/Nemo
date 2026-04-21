import type { FastifyInstance } from 'fastify';
import type { TickManager } from '../engine/manager.js';
import type { BoatRuntime } from '../engine/tick.js';

/**
 * Dev-only helpers. Exposed routes mutate engine state from HTTP, so they
 * must never be registered in production. The caller is expected to gate
 * registration on a `NEMO_DEV_ROUTES=1` env (or equivalent).
 */
export function registerDevRoutes(
  app: FastifyInstance,
  tick: TickManager,
  buildDemoRuntime: () => BoatRuntime,
): void {
  // POST /api/v1/dev/reset-demo — reset the demo boat to its start position
  // and default state (heading, sail, no lock). Called by the Play screen on
  // mount so "launching the game" always lands on the configured START_POS,
  // rather than wherever the continuously-running tick loop drifted to.
  app.post('/api/v1/dev/reset-demo', async () => {
    await tick.replaceRuntimes([buildDemoRuntime()]);
    return { ok: true };
  });
}
