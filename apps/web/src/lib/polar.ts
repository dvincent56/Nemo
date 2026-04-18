/**
 * Client-side polar speed lookup.
 * Loads polar JSON via fetch, caches in memory, bilinear interpolation.
 */

import type { BoatClass, Polar } from '@nemo/shared-types';

const cache = new Map<BoatClass, Polar>();
const pending = new Map<BoatClass, Promise<Polar>>();

const POLAR_FILES: Record<BoatClass, string> = {
  FIGARO: 'figaro.json',
  CLASS40: 'class40.json',
  OCEAN_FIFTY: 'ocean-fifty.json',
  IMOCA60: 'imoca60.json',
  ULTIM: 'ultim.json',
};

/** Fetch and cache polar data for a boat class */
export async function loadPolar(boatClass: BoatClass): Promise<Polar> {
  const cached = cache.get(boatClass);
  if (cached) return cached;

  // Deduplicate concurrent fetches
  const inflight = pending.get(boatClass);
  if (inflight) return inflight;

  const promise = fetch(`/data/polars/${POLAR_FILES[boatClass]}`)
    .then((r) => r.json())
    .then((polar: Polar) => {
      cache.set(boatClass, polar);
      pending.delete(boatClass);
      return polar;
    });

  pending.set(boatClass, promise);
  return promise;
}

/** Get cached polar (sync) — returns null if not loaded yet */
export function getCachedPolar(boatClass: BoatClass): Polar | null {
  return cache.get(boatClass) ?? null;
}

function findBracket(arr: readonly number[], value: number): { i0: number; i1: number; t: number } {
  const first = arr[0]!;
  const last = arr[arr.length - 1]!;
  if (value <= first) return { i0: 0, i1: 0, t: 0 };
  if (value >= last) {
    const i = arr.length - 1;
    return { i0: i, i1: i, t: 0 };
  }
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i]!;
    const b = arr[i + 1]!;
    if (value >= a && value <= b) {
      const span = b - a;
      return { i0: i, i1: i + 1, t: span === 0 ? 0 : (value - a) / span };
    }
  }
  return { i0: 0, i1: 0, t: 0 };
}

/**
 * Bilinear interpolation on the polar grid.
 * Returns estimated BSP in knots for the given TWA and TWS.
 */
export function getPolarSpeed(polar: Polar, twa: number, tws: number): number {
  const absTwa = Math.min(Math.abs(twa), 180);
  const a = findBracket(polar.twa, absTwa);
  const s = findBracket(polar.tws, tws);

  const r0 = polar.speeds[a.i0];
  const r1 = polar.speeds[a.i1];
  if (!r0 || !r1) return 0;

  const v00 = r0[s.i0] ?? 0;
  const v01 = r0[s.i1] ?? 0;
  const v10 = r1[s.i0] ?? 0;
  const v11 = r1[s.i1] ?? 0;

  const top = v00 * (1 - s.t) + v01 * s.t;
  const bot = v10 * (1 - s.t) + v11 * s.t;
  return top * (1 - a.t) + bot * a.t;
}
