'use client';

import type { GameStore } from './types';

export interface ProjectionSnapshotPoint {
  /** Milliseconds since the projection start (relative offset). */
  dtMs: number;
  lat: number;
  lon: number;
}

export interface ProjectionSnapshot {
  points: ProjectionSnapshotPoint[];
}

/**
 * Snapshot of the latest projection points (lat/lon/dtMs only) published by
 * the projection hook so other consumers (timeline scrubber, ghost boat) can
 * read the future trajectory without owning the worker pipeline.
 *
 * Intentionally drops bsp/tws/twd — those are reconstructible from the
 * weather grid and the timeline only needs geometry for ghost interpolation.
 */
export function createProjectionSnapshotSlice(
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  return {
    projectionSnapshot: null as ProjectionSnapshot | null,

    setProjectionSnapshot: (snap: ProjectionSnapshot | null) =>
      set(() => ({ projectionSnapshot: snap })),
  };
}
