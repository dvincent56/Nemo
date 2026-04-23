/**
 * Client-side mirror of `packages/game-engine-core/src/sails.ts#pickOptimalSail`.
 *
 * The engine picks the sail with the highest polar BSP at the given TWA/TWS.
 * We replicate that here so SailPanel (and later Compass) can predict the
 * server's auto-mode choice without a round-trip.
 *
 * Must stay in sync with the engine implementation. Uses the same sail order
 * and the same bilinear lookup (`getPolarSpeed`) as the web polar cache.
 */
import type { Polar, SailId } from '@nemo/shared-types';
import { getPolarSpeed } from '@/lib/polar';

const ALL_SAILS: SailId[] = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'];

export function pickOptimalSail(polar: Polar, twa: number, tws: number): SailId {
  const twaAbs = Math.min(Math.abs(twa), 180);
  let best: SailId = 'JIB';
  let bestBsp = -Infinity;
  for (const s of ALL_SAILS) {
    const bsp = getPolarSpeed(polar, s, twaAbs, tws);
    if (bsp > bestBsp) {
      bestBsp = bsp;
      best = s;
    }
  }
  return best;
}
