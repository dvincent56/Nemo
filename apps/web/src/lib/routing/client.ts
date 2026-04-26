'use client';

// Shared client helper that owns a single persistent `routing.worker.ts`
// instance and exposes a Promise-based API. Consumers (DevSimulatorClient,
// PlayClient, …) call `computeRoute(input, gameBalanceJson)` without having
// to manage worker construction, request ids, or message routing.
//
// The worker is lazy-spawned on the first call and reused for the lifetime
// of the page. Since the worker loads + indexes the coastline GeoJSON once
// at module scope, sharing a single worker across components keeps that
// expensive state warm.

import type { RouteInput, RoutePlan } from '@nemo/routing';

type PendingHandlers = {
  resolve: (plan: RoutePlan) => void;
  reject: (err: Error) => void;
};

type RoutingOutMessage =
  | { type: 'result'; requestId: number; plan: RoutePlan }
  | { type: 'error'; requestId: number; message: string };

let worker: Worker | null = null;
let nextReqId = 1;
const pending = new Map<number, PendingHandlers>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(
    new URL('@/workers/routing.worker.ts', import.meta.url),
    { type: 'module' },
  );
  w.onmessage = (e: MessageEvent<RoutingOutMessage>) => {
    const msg = e.data;
    const handler = pending.get(msg.requestId);
    if (!handler) return;
    pending.delete(msg.requestId);
    if (msg.type === 'result') handler.resolve(msg.plan);
    else handler.reject(new Error(msg.message || 'Unknown router error'));
  };
  w.onerror = (err) => {
    // A worker-level error fails every in-flight request rather than
    // leaving them hung (we can't tell which request faulted).
    const message =
      err instanceof ErrorEvent && err.message ? err.message : 'Worker crashed';
    for (const { reject } of pending.values()) {
      reject(new Error(message));
    }
    pending.clear();
  };
  worker = w;
  return w;
}

export function computeRoute(
  input: RouteInput,
  gameBalanceJson: unknown,
): Promise<RoutePlan> {
  const w = getWorker();
  const requestId = nextReqId++;
  return new Promise<RoutePlan>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    w.postMessage({ type: 'compute', requestId, input, gameBalanceJson });
  });
}
