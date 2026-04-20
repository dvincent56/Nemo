// apps/web/src/lib/projection/types.ts
import type { SailId, BoatClass } from '@nemo/shared-types';

// ── Worker Input ──

export interface ProjectionInput {
  /** Current boat position */
  lat: number;
  lon: number;
  hdg: number;
  /** Current timestamp (ms) */
  nowMs: number;
  /** Boat class for maneuver config lookup */
  boatClass: BoatClass;
  /** Active sail */
  activeSail: SailId;
  /** Whether sail auto-mode is on */
  sailAuto: boolean;
  /** TWA lock value (null = heading mode, number = locked TWA) */
  twaLock: number | null;
  /** Programmed segments — ordered list of future orders */
  segments: ProjectionSegment[];
  /** Polar table: per-sail speed grids keyed by SailId */
  polar: { twa: number[]; tws: number[]; speeds: Record<string, number[][]> };
  /** Aggregated upgrade effects */
  effects: ProjectionEffects;
  /** Current wear condition (0-100 per component) */
  condition: { hull: number; rig: number; sails: number; electronics: number };
  /** Current maneuver in progress (null if none) */
  activeManeuver: { endMs: number; speedFactor: number } | null;
  /** Current sail transition in progress (null if none) */
  activeTransition: { endMs: number; speedFactor: number } | null;
  /** Previous TWA for maneuver detection on first step */
  prevTwa: number | null;
  /** Reference TWD shown to the player at boat position (hud.twd).
   *  The worker applies (referenceTwd - localGridTwd) as offset to all
   *  grid wind directions so the projection starts consistent with the UI. */
  referenceTwd: number;
  /** Race exclusion zones (WARN/PENALTY) — projection applies speedMultiplier
   *  when the boat is inside a zone. Each zone is temporally gated by
   *  activeFrom/activeTo if provided. */
  zones: ProjectionZone[];
  /** Weather grid config */
  windGrid: {
    bounds: { north: number; south: number; east: number; west: number };
    resolution: number;
    cols: number;
    rows: number;
    /** Timestamps (ms) for each time layer */
    timestamps: number[];
  };
  /** Flattened weather data: Float32Array with FIELDS_PER_POINT floats per grid point per timestamp */
  windData: Float32Array;
}

export interface ProjectionSegment {
  /** When this order triggers (ms timestamp) */
  triggerMs: number;
  /** Order type */
  type: 'CAP' | 'TWA' | 'SAIL' | 'MODE';
  /** New heading for CAP, new TWA for TWA, sail ID for SAIL, auto boolean for MODE */
  value: number | string | boolean;
}

export interface ProjectionZone {
  id: string;
  name: string;
  type: 'WARN' | 'PENALTY';
  speedMultiplier: number;
  /** Flattened polygon ring as [lon0, lat0, lon1, lat1, ...] — first ring only,
   *  holes not supported for projection simplicity. */
  ring: number[];
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  /** Unix ms; null = always active */
  activeFromMs: number | null;
  activeToMs: number | null;
}

export interface ProjectionEffects {
  speedByTwa: [number, number, number, number, number];
  speedByTws: [number, number, number];
  wearMul: { hull: number; rig: number; sail: number; elec: number };
  maneuverMul: {
    tack: { dur: number; speed: number };
    gybe: { dur: number; speed: number };
    sailChange: { dur: number; speed: number };
  };
}

// ── Worker Output ──

export interface ProjectionPoint {
  lat: number;
  lon: number;
  timestamp: number;
  bsp: number;
  tws: number;
  twd: number;
}

export interface TimeMarker {
  index: number;
  label: string;
}

export interface ManeuverMarker {
  index: number;
  type: 'tack' | 'gybe' | 'sail_change' | 'cap_change' | 'twa_change' | 'grounding' | 'zone_entry';
  detail: string;
}

export interface ProjectionResult {
  points: ProjectionPoint[];
  timeMarkers: TimeMarker[];
  maneuverMarkers: ManeuverMarker[];
  bspMax: number;
}

// ── Worker Messages ──

export type WorkerInMessage =
  | { type: 'compute'; input: ProjectionInput }
  | { type: 'updateWind'; windData: Float32Array; timestamps: number[] };

export type WorkerOutMessage =
  | { type: 'result'; result: ProjectionResult }
  | { type: 'error'; message: string };
