/// <reference lib="webworker" />
// IMPORTANT: import CoastlineIndex + GameBalance through @nemo/routing only.
// Importing @nemo/game-engine-core/browser or @nemo/game-balance/browser
// directly here would cause Turbopack to bundle a second copy of the module
// graph, giving the worker a different GameBalance singleton than the one
// `computeRoute` sees — GameBalance.load() would populate one instance while
// `conditionSpeedPenalty` reads from the other, and wear config would be
// undefined there (see https://...). @nemo/routing re-exports both symbols
// so this stays a single graph.
import {
  computeRoute,
  CoastlineIndex,
  type RouteInput,
  type RoutePlan,
} from '@nemo/routing';
import { GameBalance } from '@nemo/game-balance/browser';

export type RoutingInMessage =
  | { type: 'compute'; requestId: number; input: RouteInput; gameBalanceJson: unknown };

export type RoutingOutMessage =
  | { type: 'result'; requestId: number; plan: RoutePlan }
  | { type: 'error'; requestId: number; message: string };

// Coastline is loaded once at module scope the first time a `compute`
// message arrives, then reused across all subsequent route computations in
// this worker's lifetime. Cloning + indexing 10 MB of GeoJSON per-call was
// the main reason coastline was previously disabled for the dev simulator.
const coast = new CoastlineIndex();
let coastReady = false;
let coastLoading: Promise<void> | null = null;

async function ensureCoastline(): Promise<void> {
  if (coastReady) return;
  if (coastLoading) return coastLoading;
  coastLoading = (async () => {
    try {
      const t0 = Date.now();
      const resp = await fetch('/data/coastline.geojson', { cache: 'no-store' });
      const json = (await resp.json()) as GeoJSON.FeatureCollection;
      coast.loadFromGeoJson(json);
      coastReady = true;
      console.log(`[routing-worker] coastline loaded + indexed in ${Date.now() - t0} ms`);
    } catch (err) {
      console.error('[routing-worker] coastline load failed — routes may cross land:', err);
    } finally {
      coastLoading = null;
    }
  })();
  return coastLoading;
}

self.onmessage = async (e: MessageEvent<RoutingInMessage>) => {
  const msg = e.data;
  if (msg.type !== 'compute') return;
  try {
    GameBalance.load(msg.gameBalanceJson);
    await ensureCoastline();
    const routeInput: RouteInput = coastReady
      ? { ...msg.input, coastlineIndex: coast }
      : msg.input;
    const plan = await computeRoute(routeInput);
    (self as unknown as Worker).postMessage({
      type: 'result',
      requestId: msg.requestId,
      plan,
    } satisfies RoutingOutMessage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[routing-worker] compute failed:', message, '\n', stack);
    (self as unknown as Worker).postMessage({
      type: 'error',
      requestId: msg.requestId,
      message: stack ? `${message}\n${stack}` : message,
    } satisfies RoutingOutMessage);
  }
};
