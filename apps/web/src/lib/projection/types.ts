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
  /** Committed segments — the server-known programming. Always simulated. */
  segments: ProjectionSegment[];
  /** Draft segments — the user's in-progress edits. When provided AND
   *  distinct from `segments` (referential identity check), the worker runs
   *  a SECOND simulation and returns the result in `ProjectionResult.draft`.
   *  When omitted or referentially equal to `segments`, only one simulation
   *  runs (the committed one) — zero overhead for the idle case. */
  draftSegments?: ProjectionSegment[];
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
}

export interface WindGridHeader {
  bounds: { north: number; south: number; east: number; west: number };
  resolution: number;
  cols: number;
  rows: number;
  /** Timestamps (ms) for each time layer */
  timestamps: number[];
}

export interface ProjectionSegment {
  /** When this order triggers (ms timestamp). For orders chained via
   *  AT_WAYPOINT, this is initially Number.MAX_SAFE_INTEGER (sentinel: never
   *  fires by time). The worker rewrites it to currentMs at the moment the
   *  referenced waypoint is captured. */
  triggerMs: number;
  /** Order type */
  type: 'CAP' | 'TWA' | 'SAIL' | 'MODE' | 'WPT';
  /** New heading for CAP, new TWA for TWA, sail ID for SAIL, auto boolean for
   *  MODE, or { lat, lon, captureRadiusNm } for WPT. */
  value: number | string | boolean | { lat: number; lon: number; captureRadiusNm: number };
  /** Id of the predecessor WPT in an AT_WAYPOINT trigger chain. The worker
   *  uses this for two purposes:
   *    - WPT segments: activates them sequentially as the previous WPT is
   *      captured (chain ordering). IMMEDIATE-triggered WPTs leave this
   *      undefined.
   *    - Non-WPT segments (CAP/TWA/SAIL/MODE) with AT_WAYPOINT triggers
   *      (e.g. the final cap, or sail-at-WP changes): the segment fires when
   *      the referenced WPT is captured (its triggerMs is set to currentMs
   *      at that moment). */
  waypointPredecessorId?: string;
  /** Stable order id. For WPTs, used to resolve waypointPredecessorId
   *  references. For non-WPT segments, lets us match AT_WAYPOINT-triggered
   *  segments against the WPT capture event. */
  id?: string;
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
  /** Optional explicit coordinates. When provided, the renderer places the
   *  marker at (lat, lon) instead of looking up pointsBuf[index]. Used for
   *  WPT-capture markers so they sit at the actual WPT location (the visual
   *  bend) rather than the polyline vertex just before capture. */
  lat?: number;
  lon?: number;
}

/**
 * Number of float fields per packed point. Layout:
 *   [lat, lon, dtMs, bsp, tws, twd]
 * dtMs is the offset in ms from `ProjectionResult.startMs`. Storing dt
 * (instead of absolute ms) lets us fit the value in a Float32 with full
 * ms precision well beyond the 5-day projection horizon.
 */
export const PROJECTION_POINT_FIELDS = 6;

/**
 * Single-simulation output. Composed into `ProjectionResult` for both the
 * committed and (optional) draft projections.
 */
export interface ProjectionRun {
  /** Packed [lat, lon, dtMs, bsp, tws, twd] × pointsCount. The buffer is
   *  pre-allocated worst-case in the worker and transferred zero-copy. */
  pointsBuf: Float32Array;
  /** Number of valid points in pointsBuf (length / 6). */
  pointsCount: number;
  /** Reference timestamp; absolute timestamp_i = startMs + pointsBuf[i*6+2] */
  startMs: number;
  timeMarkers: TimeMarker[];
  maneuverMarkers: ManeuverMarker[];
  bspMax: number;
}

/**
 * Worker output. The committed projection is always present (root-level
 * fields preserve the legacy shape so existing consumers keep working).
 * When the user has unsaved draft edits AND they differ from committed,
 * `draft` carries the second simulation; otherwise it's undefined and the
 * caller can render the single committed line at full opacity.
 */
export interface ProjectionResult extends ProjectionRun {
  /** Present only when the input carried `draftSegments` distinct from the
   *  committed `segments`. When undefined, render only the committed line. */
  draft?: ProjectionRun;
}

/** Read a single packed point as an object. Use sparingly — for tight loops
 *  prefer direct buffer access via PROJECTION_POINT_FIELDS. */
export function readProjectionPoint(r: ProjectionResult, i: number): ProjectionPoint {
  const b = i * PROJECTION_POINT_FIELDS;
  return {
    lat: r.pointsBuf[b]!,
    lon: r.pointsBuf[b + 1]!,
    timestamp: r.startMs + r.pointsBuf[b + 2]!,
    bsp: r.pointsBuf[b + 3]!,
    tws: r.pointsBuf[b + 4]!,
    twd: r.pointsBuf[b + 5]!,
  };
}

// ── Worker Messages ──

export type WorkerInMessage =
  /** Seed the worker with the current weather grid. Sent once on grid load
   *  (and again only when the grid itself changes). Transferable — the
   *  caller's windData buffer is neutered after posting. */
  | { type: 'setWindGrid'; windGrid: WindGridHeader; windData: Float32Array }
  | { type: 'compute'; input: ProjectionInput };

export type WorkerOutMessage =
  | { type: 'result'; result: ProjectionResult }
  | { type: 'error'; message: string };
