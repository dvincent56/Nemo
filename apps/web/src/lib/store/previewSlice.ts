'use client';
import type { SailId } from '@nemo/shared-types';
import type { GameStore } from './types';

/**
 * Preview state — holds values the player is previewing (dragging compass,
 * selecting a sail) before they validate the change.
 *
 * The projection hook reads these with fallback to actual hud/sail state,
 * so the projection line updates in real time as the player explores
 * alternatives without committing.
 */
export interface PreviewState {
  /** Previewed heading during compass drag; null when not previewing */
  hdg: number | null;
  /** Previewed sail before validation; null when not previewing */
  sail: SailId | null;
  /** Whether TWA lock is active */
  twaLocked: boolean;
  /** Locked TWA value (used when twaLocked is true) */
  lockedTwa: number;
}

export const INITIAL_PREVIEW: PreviewState = {
  hdg: null,
  sail: null,
  twaLocked: false,
  lockedTwa: 0,
};

export function createPreviewSlice(set: (fn: (s: GameStore) => Partial<GameStore>) => void) {
  return {
    preview: INITIAL_PREVIEW,
    setPreview: (patch: Partial<PreviewState>) =>
      set((s) => ({ preview: { ...s.preview, ...patch } })),
    resetPreview: () =>
      set(() => ({ preview: INITIAL_PREVIEW })),
  };
}
