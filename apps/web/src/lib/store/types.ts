'use client';

import type { SailId, OrderTrigger, BoatClass, ExclusionZone } from '@nemo/shared-types';
import type { RoutePlan } from '@nemo/routing';
import type { DecodedWeatherGrid } from '@/lib/weather/binaryDecoder';
import type { BoatEffects } from '@/lib/api';
import type { PendingField } from './pending';
import type { ProgState as ProgStateImpl } from '@/lib/prog/types';

export type {
  ProgMode,
  CapOrder,
  WpOrder,
  FinalCapOrder,
  SailOrder,
  ProgDraft,
  ProgState,
  EditingOrder,
  ProgNotice,
} from '@/lib/prog/types';

export type TwaColor = 'optimal' | 'overlap' | 'neutral' | 'deadzone';

export interface WearDetail {
  hull: number;
  rig: number;
  sails: number;
  electronics: number;
}

export interface HudState {
  boatClass: BoatClass | null;
  tws: number; twd: number; twa: number; hdg: number;
  bsp: number; vmg: number; dtf: number; overlapFactor: number;
  /** Polar→actual BSP multiplier (wear + upgrades + swell, no overlap/transition/maneuver/zone). */
  bspBaseMultiplier: number;
  twaColor: TwaColor;
  rank: number; totalParticipants: number; rankTrend: number;
  wearGlobal: number; wearDetail: WearDetail;
  speedPenaltyPct: number;
  lat: number; lon: number;
  /** Server lock state — the angle if locked, null if in heading mode. */
  twaLock: number | null;
  /** Aggregated loadout effects from the engine — used by the projection
   *  worker so upgrade bonuses/penalties shape the predicted trajectory. */
  effects: BoatEffects;
  pending: {
    hdg?: PendingField<number>;
    twa?: PendingField<number>;
    bsp?: PendingField<number>;
  };
}

export type SailAvailability = 'active' | 'available' | 'disabled';

export interface SailSliceState {
  currentSail: SailId;
  sailPending: SailId | null;
  transitionStartMs: number;
  transitionEndMs: number;
  sailAuto: boolean;
  sailAvailability: Record<SailId, SailAvailability>;
  maneuverKind: 0 | 1 | 2;    // 0 = none, 1 = tack, 2 = gybe
  maneuverStartMs: number;
  maneuverEndMs: number;
  pending: {
    sailAuto?: PendingField<boolean>;
    sailChange?: PendingField<{
      currentSail: SailId;
      transitionStartMs: number;
      transitionEndMs: number;
    }>;
    maneuver?: PendingField<{
      maneuverKind: 0 | 1 | 2;
      maneuverStartMs: number;
      maneuverEndMs: number;
    }>;
  };
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface MapState {
  center: [lon: number, lat: number];
  zoom: number;
  isFollowingBoat: boolean;
  bounds: MapBounds;
}

export interface SelectionState {
  selectedBoatIds: Set<string>;
}

export type PlaybackSpeed = 60 | 120 | 240;

export interface TimelineState {
  currentTime: Date;
  isLive: boolean;
  playbackSpeed: PlaybackSpeed;
  isPlaying: boolean;
  raceStartMs: number | null;
  raceEndMs: number | null;
  forecastEndMs: number | null;
}

export interface TrackPoint {
  ts: number;     // ms epoch
  lat: number;
  lon: number;
  rank: number;
}

export interface TrackState {
  myPoints: TrackPoint[];          // sorted ASC by ts
  isLoading: boolean;
  error: string | null;
  /** Phase 1 : valeur = boat.id côté serveur. Phase 4 : UUID du
   *  race_participants. Le nom est volontairement participant-centric pour
   *  éviter de renommer ce champ plus tard. */
  selfParticipantId: string | null;
}

export type LayerName = 'wind' | 'swell' | 'opponents' | 'zones' | 'coastline';

export interface LayersState {
  wind: boolean;
  swell: boolean;
  opponents: boolean;
  zones: boolean;
  coastline: boolean;
}

export interface MapAppearanceState {
  oceanPresetId: string;
}

export type PanelName = 'ranking' | 'sails' | 'programming' | 'router';

export interface PanelState {
  activePanel: PanelName | null;
}

export interface WeatherGridPoint {
  lat: number; lon: number;
  tws: number; twd: number;
  swellHeight: number; swellDir: number; swellPeriod: number;
}

export interface WeatherGrid {
  points: WeatherGridPoint[];
  resolution: number;
  cols: number;
  rows: number;
  bounds: { north: number; south: number; east: number; west: number };
  timestamps: number[];
}

export interface GfsStatus {
  run: number;
  next: number;
  status: 0 | 1 | 2;
  alpha: number;
}

export interface WeatherState {
  gridData: WeatherGrid | null;
  gridExpiresAt: Date | null;
  isLoading: boolean;
  decodedGrid: DecodedWeatherGrid | null;
  /**
   * Previous GFS run's grid, retained during the refresh window so the sim
   * and router can fall back to it when the new run's temporal coverage is
   * not yet complete (cumulative fetch phases progressively extend the
   * current grid; in the meantime `prevDecodedGrid` has the older full-
   * horizon coverage). Rotated in by `setDecodedWeatherGrid` whenever the
   * incoming grid's `runTimestamp` differs from the current one.
   */
  prevDecodedGrid: DecodedWeatherGrid | null;
  gfsStatus: GfsStatus | null;
  /** Tactical 0.25° tile centered on the boat, t=0..24h. Optional.
   *  `grid` is the 2D snapshot (overlay rendering); `decoded` is the multi-hour
   *  binary form used for live point sampling at wall-clock time (tooltip),
   *  matching the engine's interpolation precisely. */
  tacticalTile: {
    grid: WeatherGrid;
    decoded: DecodedWeatherGrid;
    bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  } | null;
}

export type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface ConnectionState {
  wsState: ConnState;
}

export interface OrderEntry {
  id: string;
  type: 'CAP' | 'TWA' | 'WPT' | 'SAIL' | 'MODE';
  trigger: OrderTrigger;
  value: Record<string, unknown>;
  label: string;
  /**
   * `true` when the order has already been sent to the server (e.g. orders
   * applied via the router go straight over WS via `sendOrder`). They remain
   * visible in ProgPanel for context, but `handleCommit` must skip them so
   * "Valider la file" cannot re-send and produce duplicates (or — for
   * CAP/TWA — silently dropped orders by the engine de-dupe).
   */
  committed?: boolean;
}

export interface BoatLive {
  id: string;
  lat: number; lon: number;
  hdg: number; bsp: number;
  sail: number; tickSeq: number;
}

export type RouterPhase = 'idle' | 'placing' | 'calculating' | 'results';
export type RouterPreset = 'FAST' | 'BALANCED' | 'HIGHRES';

export interface RouterState {
  phase: RouterPhase;
  destination: { lat: number; lon: number } | null;
  preset: RouterPreset;
  coastDetection: boolean;
  coneHalfDeg: number;
  computedRoute: RoutePlan | null;
  error: string | null;
  /** Increments on every calculation start; results with stale id are dropped. */
  calcGenId: number;
}

export interface RouterActions {
  openRouter: () => void;
  closeRouter: () => void;
  enterPlacingMode: () => void;
  exitPlacingMode: () => void;
  setRouterDestination: (lat: number, lon: number) => void;
  setRouterPreset: (p: RouterPreset) => void;
  setRouterCoastDetection: (v: boolean) => void;
  setRouterConeHalfDeg: (deg: number) => void;
  /** Returns the new calcGenId for the caller to track. */
  startRouteCalculation: () => number;
  setRouteResult: (plan: RoutePlan, genId: number) => void;
  setRouteError: (msg: string, genId: number) => void;
  clearRoute: () => void;
}

// Combined store interface — all slices + actions
export interface GameStore extends RouterActions {
  hud: HudState;
  sail: SailSliceState;
  map: MapState;
  selection: SelectionState;
  timeline: TimelineState;
  layers: LayersState;
  mapAppearance: MapAppearanceState;
  panel: PanelState;
  weather: WeatherState;
  connection: ConnectionState;
  prog: ProgStateImpl;
  preview: import('./previewSlice').PreviewState;
  router: RouterState;
  zones: ExclusionZone[];
  boats: Map<string, BoatLive>;
  lastTickUnix: number | null;
  track: TrackState;
  projectionSnapshot: import('./projectionSnapshotSlice').ProjectionSnapshot | null;

  setHud: (patch: Partial<HudState>) => void;
  setHudOptimistic: (field: 'hdg', value: number) => void;
  /** Patch HUD optimistically with one or more numeric fields; each gets a
   *  pending entry so the next tick's mergeField preserves the optimistic
   *  value until the server confirms convergence. */
  applyOptimisticHud: (patch: { hdg?: number; twa?: number; bsp?: number }) => void;
  setSail: (patch: Partial<SailSliceState>) => void;
  setSailOptimistic: (field: 'sailAuto', value: boolean) => void;
  setOptimisticSailChange: (patch: {
    currentSail: SailId;
    transitionStartMs: number;
    transitionEndMs: number;
  }) => void;
  /** Patch sail maneuver state optimistically (kind/start/end) with pending. */
  applyOptimisticManeuver: (patch: {
    maneuverKind: 0 | 1 | 2;
    maneuverStartMs: number;
    maneuverEndMs: number;
  }) => void;
  setMapView: (center: [number, number], zoom: number) => void;
  setMapBounds: (bounds: MapBounds) => void;
  setFollowBoat: (follow: boolean) => void;
  toggleBoat: (id: string) => void;
  clearSelection: () => void;
  setTime: (t: Date) => void;
  goLive: () => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  setIsPlaying: (b: boolean) => void;
  setRaceContext: (ctx: { startMs: number | null; endMs?: number | null; forecastEndMs: number | null }) => void;
  setTrack: (points: TrackPoint[]) => void;
  appendTrackPoint: (p: TrackPoint) => void;
  clearTrack: () => void;
  setTrackLoading: (loading: boolean) => void;
  setTrackError: (error: string | null) => void;
  setSelfParticipantId: (id: string | null) => void;
  toggleLayer: (layer: LayerName) => void;
  setOceanPreset: (id: string) => void;
  openPanel: (p: PanelName) => void;
  closePanel: () => void;
  setWeatherGrid: (grid: WeatherGrid, expiresAt: Date) => void;
  setWeatherLoading: (loading: boolean) => void;
  setDecodedWeatherGrid: (grid: DecodedWeatherGrid) => void;
  setGfsStatus: (status: GfsStatus) => void;
  setTacticalTile: (grid: WeatherGrid | null, decoded: DecodedWeatherGrid | null, bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null) => void;
  setConnection: (s: ConnState) => void;
  setProgMode: (mode: import('@/lib/prog/types').ProgMode) => void;
  addCapOrder: (o: import('@/lib/prog/types').CapOrder) => void;
  updateCapOrder: (id: string, patch: Partial<import('@/lib/prog/types').CapOrder>) => void;
  removeCapOrder: (id: string) => void;
  addWpOrder: (o: import('@/lib/prog/types').WpOrder) => void;
  updateWpOrder: (id: string, patch: Partial<import('@/lib/prog/types').WpOrder>) => void;
  removeWpOrder: (id: string) => void;
  setFinalCap: (o: import('@/lib/prog/types').FinalCapOrder | null) => void;
  addSailOrder: (o: import('@/lib/prog/types').SailOrder) => void;
  updateSailOrder: (id: string, patch: Partial<import('@/lib/prog/types').SailOrder>) => void;
  removeSailOrder: (id: string) => void;
  clearAllOrders: () => void;
  resetDraft: () => void;
  markCommitted: () => void;
  applyRouteAsCommitted: (next: import('@/lib/prog/types').ProgDraft) => void;
  setEditingOrder: (e: import('@/lib/prog/types').EditingOrder | null) => void;
  setPickingWp: (b: boolean) => void;
  setPendingNewWpId: (id: string | null) => void;
  setProgNotice: (notice: import('@/lib/prog/types').ProgNotice | null) => void;
  removeCapturedWps: (removedIds: string[]) => void;
  applyMessages: (msgs: Record<string, unknown>[]) => void;
  setPreview: (patch: Partial<import('./previewSlice').PreviewState>) => void;
  resetPreview: () => void;
  setZones: (zones: ExclusionZone[]) => void;
  setProjectionSnapshot: (snap: import('./projectionSnapshotSlice').ProjectionSnapshot | null) => void;
}
