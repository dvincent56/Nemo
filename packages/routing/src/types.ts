// packages/routing/src/types.ts
import type { Position, Polar, SailId, BoatClass } from '@nemo/shared-types';
import type {
  BoatLoadout,
  ConditionState,
  CoastlineIndex,
  WindGridConfig,
} from '@nemo/game-engine-core/browser';

export type Preset = 'FAST' | 'BALANCED' | 'HIGHRES';

export interface PresetParams {
  timeStepSec: number;
  headingCount: number;
  horizonSec: number;
  sectorCount: number;
}

export interface RouteInput {
  from: Position;
  to: Position;
  startTimeMs: number;
  boatClass: BoatClass;
  polar: Polar;
  loadout: BoatLoadout;
  condition: ConditionState;
  windGrid: WindGridConfig;
  windData: Float32Array;
  /**
   * Optional previous GFS run grid. When the requested (lat, lon, time)
   * falls outside the current grid's temporal coverage, the router falls
   * back to this one. Useful during the GFS refresh window where the new
   * run is still being fetched progressively and its last-forecast-hour
   * is earlier than the sim clock.
   */
  prevWindGrid?: WindGridConfig;
  prevWindData?: Float32Array;
  /**
   * Optional coastline for grounding avoidance. When omitted or empty, the
   * routing engine will happily produce paths that cross land. Two ways to
   * provide it: either pass raw GeoJSON (will be indexed on each call) or
   * pass a prebuilt `coastlineIndex` (preferred — the worker builds it once
   * at module scope and reuses it across routing calls, avoiding a 10 MB
   * clone + reindex per request).
   */
  coastlineGeoJson?: GeoJSON.FeatureCollection;
  coastlineIndex?: CoastlineIndex;
  /**
   * Enable coastline avoidance (segment-crosses + min-distance floor). Off by
   * default — routes are faster but may cross land. In the in-game panel this
   * is exposed under an "expert" toggle; the default mode stays fast.
   */
  coastDetection?: boolean;
  /**
   * Half-angle of the heading cone toward the target (recomputed per parent
   * candidate). Default 90° → a 180° arc, wide enough for hard-upwind tacks.
   * Larger values (120-135°) are more exhaustive but slower; smaller values
   * (60°) can miss strategic detours.
   */
  coneHalfDeg?: number;
  preset: Preset;
}

export interface IsochronePoint {
  lat: number;
  lon: number;
  hdg: number;
  bsp: number;
  tws: number;
  twd: number;
  twa: number;
  sail: SailId;
  timeMs: number;
  distFromStartNm: number;
  parentIdx: number;
}

export interface RoutePolylinePoint {
  lat: number;
  lon: number;
  timeMs: number;
  twa: number;
  tws: number;
  bsp: number;
  sail: SailId;
}

export interface CapScheduleEntry {
  triggerMs: number;
  /**
   * Heading (true-north, degrees) to hold until the next entry.
   * Ignored when `twaLock` is set.
   */
  cap: number;
  /**
   * Optional TWA lock (signed degrees, starboard positive). When set, the
   * sim sets `segmentState.twaLock` and recomputes heading every tick from
   * the local TWD + twaLock — the boat tracks a constant true-wind angle
   * instead of a fixed heading. Emitted by the router when consecutive
   * polyline points share a stable TWA across a wind shift: holding TWA is
   * strictly more faithful than re-emitting CAP entries each step.
   */
  twaLock?: number;
  sail?: SailId;
  /** Planned position at triggerMs — routing's own prediction. Optional,
   * used for logging/debug to compare against the actual sim position. */
  plannedLat?: number;
  plannedLon?: number;
}

export interface RoutePlan {
  reachedGoal: boolean;
  polyline: RoutePolylinePoint[];
  waypoints: Position[];
  capSchedule: CapScheduleEntry[];
  isochrones: IsochronePoint[][];
  totalDistanceNm: number;
  eta: number;
  preset: Preset;
  computeTimeMs: number;
}
