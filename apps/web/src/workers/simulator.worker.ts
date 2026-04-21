/// <reference lib="webworker" />
// apps/web/src/workers/simulator.worker.ts
// Web Worker adapter — drives SimulatorEngine with a 100ms real-time loop.

import { SimulatorEngine } from '../lib/simulator/engine';
import type { SimInMessage, SimOutMessage } from '../lib/simulator/types';

const engine = new SimulatorEngine((msg: SimOutMessage) => self.postMessage(msg));
let loopTimer: ReturnType<typeof setInterval> | null = null;

self.onmessage = async (e: MessageEvent<SimInMessage>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        await engine.init(msg);
        break;
      case 'start':
        engine.start();
        if (loopTimer) clearInterval(loopTimer);
        loopTimer = setInterval(() => engine.advanceSync(100), 100);
        break;
      case 'pause':
        engine.pause();
        if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
        break;
      case 'setSpeed':
        engine.setSpeed(msg.factor);
        break;
      case 'reset':
        engine.reset();
        if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
        break;
      case 'order':
        engine.order(msg.order, msg.triggerSimMs);
        break;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies SimOutMessage);
  }
};
