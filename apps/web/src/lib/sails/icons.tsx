/**
 * Shared sail metadata + SVG icons for the play screen UI.
 *
 * Used by `apps/web/src/components/play/SailPanel.tsx` (live sail picker)
 * and the future ProgPanel sail-order editor (Phase 2). Pure data — no
 * React state, no hooks, no store, no side effects.
 *
 * Each icon is a JSX SVG fragment intended to be wrapped in a sized
 * container by the consumer. The `viewBox` is `0 0 32 40` (slightly
 * taller than wide to give room for the mast + sail silhouette).
 *
 * NOTE: the original SVGs in SailPanel.tsx carried `className={styles.sailIcon}`,
 * which set `width: 100%; height: 100%; display: block;` so the SVG would fill
 * its wrapper. The className is intentionally dropped here because this module
 * is independent of SailPanel's CSS module. Consumers are responsible for
 * sizing the SVG via a descendant selector on the wrapper (see SailPanel's
 * `.sailRowIcon svg` / `.confirmIcon svg` rules).
 */

import type { ReactElement } from 'react';
import type { SailId } from '@nemo/shared-types';

/** Ordered list of sails with their French display names. */
export const SAIL_DEFS: { id: SailId; name: string }[] = [
  { id: 'JIB', name: 'Foc' },
  { id: 'LJ', name: 'Foc léger' },
  { id: 'SS', name: 'Trinquette' },
  { id: 'C0', name: 'Code 0' },
  { id: 'SPI', name: 'Spinnaker' },
  { id: 'HG', name: 'Gennaker lourd' },
  { id: 'LG', name: 'Gennaker léger' },
];

/**
 * SVG icon for each sail. Profile view, mast on the left.
 * Uses `currentColor` for stroke/fill so consumers control the color
 * via CSS on a parent class.
 */
export const SAIL_ICONS: Record<SailId, ReactElement> = {
  JIB: (
    <svg viewBox="0 0 32 40" fill="none">
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3 L6 37 L22 37 Z" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  LJ: (
    <svg viewBox="0 0 32 40" fill="none">
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 4 Q16 14 18 24 Q16 32 6 36" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.10" strokeDasharray="3 2" />
    </svg>
  ),
  SS: (
    <svg viewBox="0 0 32 40" fill="none">
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 6 L6 34 L16 34 Z" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  C0: (
    <svg viewBox="0 0 32 40" fill="none">
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3 Q28 8 30 20 Q28 32 6 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  SPI: (
    <svg viewBox="0 0 32 40" fill="none">
      <line x1="4" y1="2" x2="4" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 3 Q32 6 30 20 Q32 34 4 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.2" />
      <line x1="4" y1="3" x2="20" y2="2" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1" />
    </svg>
  ),
  HG: (
    <svg viewBox="0 0 32 40" fill="none">
      <line x1="8" y1="2" x2="8" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3 Q24 6 28 20 Q24 34 8 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.2" />
      <line x1="8" y1="3" x2="4" y2="6" stroke="currentColor" strokeWidth="1" />
      <line x1="8" y1="37" x2="4" y2="34" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  LG: (
    <svg viewBox="0 0 32 40" fill="none">
      <line x1="8" y1="2" x2="8" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4 Q22 8 26 20 Q22 32 8 36" stroke="currentColor" strokeWidth="1.0" fill="currentColor" fillOpacity="0.10" strokeDasharray="3 2" />
      <line x1="8" y1="4" x2="4" y2="7" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  ),
};
