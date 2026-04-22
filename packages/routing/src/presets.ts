// packages/routing/src/presets.ts
import type { Preset, PresetParams } from './types';

// Horizon capped at 240 h across presets — the wind grid we prefetch covers
// 240 h (10 days), the practical GFS forecast limit. FAST uses more headings
// (36 instead of 24) so the first few isos are smoother. BALANCED bumped to
// 48 headings for the same reason.
export const PRESETS: Record<Preset, PresetParams> = {
  FAST:     { timeStepSec: 3 * 3600, headingCount: 36, horizonSec: 240 * 3600, sectorCount: 360 },
  BALANCED: { timeStepSec: 2 * 3600, headingCount: 48, horizonSec: 240 * 3600, sectorCount: 720 },
  HIGHRES:  { timeStepSec: 1 * 3600, headingCount: 72, horizonSec: 240 * 3600, sectorCount: 1440 },
};
