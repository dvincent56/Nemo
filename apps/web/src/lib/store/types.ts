'use client';

import type { SailId, OrderTrigger } from '@nemo/shared-types';

export type TwaColor = 'optimal' | 'overlap' | 'neutral' | 'deadzone';

export interface WearDetail {
  hull: number;
  rig: number;
  sails: number;
  electronics: number;
}

export interface HudState {
  tws: number; twd: number; twa: number; hdg: number;
  bsp: number; vmg: number; dtf: number; overlapFactor: number;
  twaColor: TwaColor;
  rank: number; totalParticipants: number; rankTrend: number;
  wearGlobal: number; wearDetail: WearDetail;
  lat: number; lon: number;
}

export type SailAvailability = 'active' | 'available' | 'disabled';

export interface SailSliceState {
  currentSail: SailId;
  sailPending: SailId | null;
  transitionRemainingSec: number;
  sailAuto: boolean;
  sailAvailability: Record<SailId, SailAvailability>;
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
  editMode: boolean;
}

export type PlaybackSpeed = 1 | 6 | 24;

export interface TimelineState {
  currentTime: Date;
  isLive: boolean;
  playbackSpeed: PlaybackSpeed;
}

export type LayerName = 'wind' | 'swell' | 'opponents' | 'zones';

export interface LayersState {
  wind: boolean;
  swell: boolean;
  opponents: boolean;
  zones: boolean;
}

export type PanelName = 'ranking' | 'sails' | 'programming';

export interface PanelState {
  activePanel: PanelName | null;
}

export interface WeatherGridPoint {
  lat: number; lon: number;
  tws: number; twd: number;
  swellHeight: number; swellDir: number;
}

export interface WeatherGrid {
  points: WeatherGridPoint[];
  resolution: number;
  bounds: { north: number; south: number; east: number; west: number };
  timestamps: number[];
}

export interface WeatherState {
  gridData: WeatherGrid | null;
  gridExpiresAt: Date | null;
  isLoading: boolean;
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
}

export interface ProgState {
  orderQueue: OrderEntry[];
  serverQueue: OrderEntry[];
}

export interface BoatLive {
  id: string;
  lat: number; lon: number;
  hdg: number; bsp: number;
  sail: number; tickSeq: number;
}

// Combined store interface — all slices + actions
export interface GameStore {
  hud: HudState;
  sail: SailSliceState;
  map: MapState;
  selection: SelectionState;
  timeline: TimelineState;
  layers: LayersState;
  panel: PanelState;
  weather: WeatherState;
  connection: ConnectionState;
  prog: ProgState;
  boats: Map<string, BoatLive>;
  lastTickUnix: number | null;

  setHud: (patch: Partial<HudState>) => void;
  setSail: (patch: Partial<SailSliceState>) => void;
  toggleSailAuto: () => void;
  setMapView: (center: [number, number], zoom: number) => void;
  setMapBounds: (bounds: MapBounds) => void;
  setFollowBoat: (follow: boolean) => void;
  toggleBoat: (id: string) => void;
  clearSelection: () => void;
  setEditMode: (active: boolean) => void;
  setTime: (t: Date) => void;
  goLive: () => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  toggleLayer: (layer: LayerName) => void;
  openPanel: (p: PanelName) => void;
  closePanel: () => void;
  setWeatherGrid: (grid: WeatherGrid, expiresAt: Date) => void;
  setWeatherLoading: (loading: boolean) => void;
  setConnection: (s: ConnState) => void;
  addOrder: (order: OrderEntry) => void;
  removeOrder: (id: string) => void;
  reorderQueue: (from: number, to: number) => void;
  commitQueue: () => void;
  applyMessages: (msgs: Record<string, unknown>[]) => void;
}
