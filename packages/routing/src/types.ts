// packages/routing/src/types.ts
import type { Position, Polar, SailId } from '@nemo/shared-types';
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
  polar: Polar;
  loadout: BoatLoadout;
  condition: ConditionState;
  windGrid: WindGridConfig;
  windData: Float32Array;
  coastlineGeoJson: GeoJSON.FeatureCollection;
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
