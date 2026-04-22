// apps/web/src/lib/simulator/types.ts
import type { BoatClass, SailId, Position, Polar } from '@nemo/shared-types';
import type { BoatLoadout, ConditionState } from '@nemo/game-engine-core';

export interface SimBoatSetup {
  id: string;
  name: string;
  boatClass: BoatClass;
  loadout: BoatLoadout;
  initialSail: SailId;
  initialCondition: ConditionState;
}

export interface SimFleetState {
  position: Position;
  heading: number;
  bsp: number;
  twa: number;
  sail: SailId;
  condition: ConditionState;
  distanceNm: number;
}

export type SimOrderKind = 'CAP' | 'TWA' | 'SAIL' | 'MODE';
export interface SimOrder {
  kind: SimOrderKind;
  value: number | SailId | boolean;
}

export type SimSpeedFactor = 600 | 1800 | 3600 | 7200;

export type SimInMessage =
  | { type: 'init'; boats: SimBoatSetup[]; startPos: Position; startTimeMs: number;
      windGrid: unknown; windData: unknown; coastlineGeoJson: unknown;
      polars: Record<BoatClass, Polar>;
      gameBalanceJson: unknown }
  | { type: 'updateWindGrid'; windGrid: unknown; windData: unknown;
      prevWindGrid?: unknown; prevWindData?: unknown }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'setSpeed'; factor: SimSpeedFactor }
  | { type: 'order'; order: SimOrder; triggerSimMs: number }
  | { type: 'schedule'; boatId: string; entries: Array<{ triggerMs: number; cap: number; twaLock?: number; sail?: SailId; plannedLat?: number; plannedLon?: number }> };

export type SimOutMessage =
  | { type: 'tick'; simTimeMs: number; fleet: Record<string, SimFleetState> }
  | { type: 'done'; reason: 'grib_exhausted' | 'all_grounded' }
  | { type: 'error'; message: string };
