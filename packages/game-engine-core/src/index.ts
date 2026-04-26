export {
  runTick,
  type BoatRuntime,
  type TickDeps,
  type TickOutcome,
  type CoastlineProbe,
} from './tick';

export {
  computeBsp,
  type SpeedEffects,
} from './speed-model';

// Re-export polar-lib's getPolarSpeed so browser callers (projection
// worker) can reach the single source of truth via @nemo/game-engine-core
// without adding @nemo/polar-lib to their direct dependencies.
export { getPolarSpeed } from '@nemo/polar-lib/browser';

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

export {
  supersedeWaypointsByCapTwa,
  supersedeCapTwaByWaypoint,
  supersedeHeadingIntent,
} from './orderHistory';
