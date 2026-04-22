// packages/routing/src/presets.ts
import type { Preset, PresetParams } from './types';

export const PRESETS: Record<Preset, PresetParams> = {
  FAST:     { timeStepSec: 3 * 3600, headingCount: 24, horizonSec: 72 * 3600,  sectorCount: 360 },
  BALANCED: { timeStepSec: 2 * 3600, headingCount: 36, horizonSec: 168 * 3600, sectorCount: 720 },
  HIGHRES:  { timeStepSec: 1 * 3600, headingCount: 72, horizonSec: 168 * 3600, sectorCount: 1440 },
};
