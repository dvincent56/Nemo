// apps/web/src/hooks/useGfsStatus.ts
import { useEffect } from 'react';
import { useGameStore } from '@/lib/store';
import type { GfsStatus } from '@/lib/store/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function useGfsStatus() {
  const setGfsStatus = useGameStore((s) => s.setGfsStatus);
  const gfsStatus = useGameStore((s) => s.weather.gfsStatus);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/weather/status`);
        if (!res.ok) return;
        const data = (await res.json()) as GfsStatus;
        if (active) setGfsStatus(data);
      } catch {
        // silently ignore
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { active = false; clearInterval(id); };
  }, [setGfsStatus]);

  return gfsStatus;
}
