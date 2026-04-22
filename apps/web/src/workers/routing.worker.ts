/// <reference lib="webworker" />
import { computeRoute, type RouteInput, type RoutePlan } from '@nemo/routing';
import { GameBalance } from '@nemo/game-balance/browser';

export type RoutingInMessage =
  | { type: 'compute'; input: RouteInput; gameBalanceJson: unknown };

export type RoutingOutMessage =
  | { type: 'result'; plan: RoutePlan }
  | { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<RoutingInMessage>) => {
  const msg = e.data;
  if (msg.type !== 'compute') return;
  try {
    GameBalance.load(msg.gameBalanceJson);
    const plan = await computeRoute(msg.input);
    (self as unknown as Worker).postMessage({ type: 'result', plan } satisfies RoutingOutMessage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ type: 'error', message } satisfies RoutingOutMessage);
  }
};
