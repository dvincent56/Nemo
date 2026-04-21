export {
  runTick,
  type BoatRuntime,
  type TickDeps,
  type TickOutcome,
  type CoastlineProbe,
} from './tick.js';

export {
  resolveBoatLoadout,
  aggregateEffects,
  type BoatLoadout,
  type AggregatedEffects,
  type AggregateContext,
  type ResolvedItem,
} from './loadout.js';

export {
  buildSegments,
  type SegmentState,
  type TickSegment,
  type BuildSegmentsInput,
} from './segments.js';

export {
  buildZoneIndex,
  applyZones,
  getZonesAtPosition,
  type IndexedZone,
  type ZoneBBox,
  type ZoneApplication,
} from './zones.js';

export {
  advanceSailState,
  detectManeuver,
  requestManualSailChange,
  transitionSpeedFactor,
  computeOverlapFactor,
  getTransitionDuration,
  isSailInRange,
  pickOptimalSail,
  maneuverSpeedFactor,
  type ManeuverPenaltyState,
  type SailRuntimeState,
  type ManeuverKind,
} from './sails.js';

export {
  applyWear,
  computeWearDelta,
  conditionSpeedPenalty,
  swellSpeedFactor,
  type ConditionState,
} from './wear.js';

export { bandFor } from './bands.js';

export type { WeatherProvider, WeatherPoint } from './weather.js';

export { CoastlineIndex, type CoastGeometry } from './coastline.js';
