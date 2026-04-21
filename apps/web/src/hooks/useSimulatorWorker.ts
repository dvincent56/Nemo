// apps/web/src/hooks/useSimulatorWorker.ts
import { useEffect, useRef, useState } from 'react';
import type { SimInMessage, SimOutMessage, SimFleetState } from '@/lib/simulator/types';

export type SimStatus = 'idle' | 'running' | 'paused' | 'done';

export interface UseSimulatorWorker {
  simTimeMs: number;
  fleet: Record<string, SimFleetState>;
  status: SimStatus;
  doneReason: string | null;
  post: (m: SimInMessage) => void;
  setStatus: (s: SimStatus) => void;
  reinit: () => void; // terminate + recreate worker (Nouvelle simu)
}

export function useSimulatorWorker(): UseSimulatorWorker {
  const workerRef = useRef<Worker | null>(null);
  const [simTimeMs, setSimTimeMs] = useState(0);
  const [fleet, setFleet] = useState<Record<string, SimFleetState>>({});
  const [status, setStatus] = useState<SimStatus>('idle');
  const [doneReason, setDoneReason] = useState<string | null>(null);
  const [reinitKey, setReinitKey] = useState(0);

  useEffect(() => {
    const w = new Worker(new URL('../workers/simulator.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<SimOutMessage>) => {
      const msg = e.data;
      if (msg.type === 'tick') {
        setSimTimeMs(msg.simTimeMs);
        setFleet(msg.fleet);
      } else if (msg.type === 'done') {
        setStatus('done');
        setDoneReason(msg.reason);
      } else if (msg.type === 'error') {
        console.error('[sim]', msg.message);
      }
    };
    workerRef.current = w;
    setSimTimeMs(0);
    setFleet({});
    setStatus('idle');
    setDoneReason(null);
    return () => w.terminate();
  }, [reinitKey]);

  const post = (m: SimInMessage) => workerRef.current?.postMessage(m);
  const reinit = () => setReinitKey(k => k + 1);

  return { simTimeMs, fleet, status, doneReason, post, setStatus, reinit };
}
