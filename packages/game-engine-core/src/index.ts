export {
  runTick,
  type BoatRuntime,
  type TickDeps,
  type TickOutcome,
  type CoastlineProbe,
} from './tick';

export {
  resolveBoatLoadout,
  aggregateEffects,
  type BoatLoadout,
  type AggregatedEffects,
  type AggregateContext,
  type ResolvedItem,
} from './loadout';

export {
  buildSegments,
  type SegmentState,
  type TickSegment,
  type BuildSegmentsInput,
} from './segments';

export {
  buildZoneIndex,
  applyZones,
  getZonesAtPosition,
  type IndexedZone,
  type ZoneBBox,
  type ZoneApplication,
} from './zones';

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
} from './sails';

export {
  applyWear,
  computeWearDelta,
  conditionSpeedPenalty,
  swellSpeedFactor,
  INITIAL_CONDITIONS,
  type ConditionState,
} from './wear';

export { bandFor } from './bands';

export type { WeatherProvider, WeatherPoint, WindGridConfig } from './weather';

export { CoastlineIndex, type CoastGeometry } from './coastline';
