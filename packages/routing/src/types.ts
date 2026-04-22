// packages/routing/src/types.ts
import type { Position, Polar, SailId, BoatClass } from '@nemo/shared-types';
import type {
  BoatLoadout,
  ConditionState,
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
   * Optional coastline for grounding avoidance. When omitted or empty, the
   * routing engine will happily produce paths that cross land. Consumers
   * that care (in-game player routing) should provide it; the dev simulator
   * currently omits it because cloning 10 MB of GeoJSON per worker was the
   * main cause of the routing hang.
   */
  coastlineGeoJson?: GeoJSON.FeatureCollection;
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
  cap: number;
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
