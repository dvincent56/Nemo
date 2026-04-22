// packages/routing/src/schedule.ts
import type { RoutePolylinePoint, CapScheduleEntry } from './types';

const DEG = Math.PI / 180;

function bearingBetween(a: RoutePolylinePoint, b: RoutePolylinePoint): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

function angleDiffDeg(a: number, b: number): number {
  const d = (((a - b) + 540) % 360) - 180;
  return Math.abs(d);
}

/**
 * How tightly the polyline's TWA must hug a single value to be considered
 * "TWA-stable" — i.e. the boat is tracking a constant apparent-wind-angle
 * across a rotating wind rather than sailing a fixed CAP. 3° is tight
 * enough that we only collapse genuinely stable runs into a lock entry.
 */
const TWA_LOCK_TOLERANCE_DEG = 3;

/**
 * Minimum number of polyline segments that must share a TWA (within
 * tolerance) before we emit a `twaLock` entry instead of individual CAP
 * entries. 3 segments at a 2h step ≈ 6h of held TWA — enough that the
 * lock entry is meaningfully different from CAP spam.
 */
const TWA_LOCK_MIN_SEGMENTS = 3;

/**
 * Emit schedule entries describing the routed plan. Two kinds of entry:
 *   - **CAP**: hold a fixed true-heading until the next entry. Re-emitted
 *     whenever the heading rotates by >= `minDegChange` between segments.
 *   - **TWA-lock**: hold a fixed true-wind-angle. Emitted when several
 *     consecutive segments share a near-constant TWA — this is strictly
 *     more faithful than re-emitting CAP entries each step, because the
 *     sim will adjust heading tick-by-tick to track the wind shift.
 *
 * Heuristic: before emitting a CAP entry at index `i`, we scan forward
 * for a TWA-stable run starting at `i`. If it spans >= `TWA_LOCK_MIN_SEGMENTS`
 * segments and the sail doesn't change across the run, we emit a single
 * twaLock entry and advance past the run. Otherwise we emit CAP as before.
 */
export function buildCapSchedule(
  polyline: RoutePolylinePoint[],
  minDegChange: number,
): CapScheduleEntry[] {
  if (polyline.length < 2) return [];
  const entries: CapScheduleEntry[] = [];

  let i = 0;
  // Track previously-emitted CAP + sail so we only emit on change.
  let lastCap: number | null = null;
  let lastSail: RoutePolylinePoint['sail'] | null = null;

  while (i < polyline.length - 1) {
    const here = polyline[i]!;
    const nextSail = polyline[i + 1]!.sail;

    // Look ahead for a TWA-stable run starting at i. The run uses the TWA
    // sampled at segment *endpoints* (polyline[i+1..]), because that's what
    // the boat will experience after entering this segment.
    const twaAnchor = polyline[i + 1]!.twa;
    let j = i + 1;
    while (
      j + 1 < polyline.length &&
      angleDiffDeg(polyline[j + 1]!.twa, twaAnchor) <= TWA_LOCK_TOLERANCE_DEG &&
      polyline[j + 1]!.sail === nextSail
    ) {
      j++;
    }
    const runSegments = j - i; // number of segments covered if we twaLock from i

    const sailChanged = nextSail !== lastSail;

    // TWA-lock only pays off when the sim would otherwise need to turn —
    // i.e. the bearing varies across the run. If CAP is near-constant, the
    // existing CAP path already emits a single entry (next CAP changes
    // fail the >= minDegChange gate), so emitting twaLock here is just
    // noise. We require at least one pair of consecutive segments in the
    // run to rotate by >= minDegChange to keep this.
    let capRotates = false;
    if (runSegments >= TWA_LOCK_MIN_SEGMENTS) {
      let prevRunCap = bearingBetween(here, polyline[i + 1]!);
      for (let k = i + 1; k < j; k++) {
        const capK = bearingBetween(polyline[k]!, polyline[k + 1]!);
        if (angleDiffDeg(capK, prevRunCap) >= minDegChange) { capRotates = true; break; }
        prevRunCap = capK;
      }
    }

    if (runSegments >= TWA_LOCK_MIN_SEGMENTS && capRotates) {
      // Emit a TWA-lock entry covering segments [i..j].
      const entry: CapScheduleEntry = {
        triggerMs: here.timeMs,
        cap: bearingBetween(here, polyline[i + 1]!),
        twaLock: twaAnchor,
        plannedLat: here.lat,
        plannedLon: here.lon,
      };
      if (sailChanged || entries.length === 0) entry.sail = nextSail;
      entries.push(entry);
      lastCap = null;          // heading is now under TWA-lock — reset
      lastSail = nextSail;
      i = j;                   // resume after the locked run
      continue;
    }

    // Otherwise fall back to CAP emission for segment i → i+1.
    const cap = bearingBetween(here, polyline[i + 1]!);
    const headingChanged = lastCap === null || angleDiffDeg(cap, lastCap) >= minDegChange;
    if (headingChanged || sailChanged) {
      const entry: CapScheduleEntry = {
        triggerMs: here.timeMs,
        cap,
        plannedLat: here.lat,
        plannedLon: here.lon,
      };
      if (sailChanged || entries.length === 0) entry.sail = nextSail;
      entries.push(entry);
      lastCap = cap;
      lastSail = nextSail;
    }
    i++;
  }

  return entries;
}
