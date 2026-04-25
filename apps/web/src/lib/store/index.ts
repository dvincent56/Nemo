'use client';

import { create } from 'zustand';
import { decode, encode } from '@msgpack/msgpack';
import type { GameStore } from './types';
import { createHudSlice } from './hudSlice';
import { createSailSlice } from './sailSlice';
import { createMapSlice } from './mapSlice';
import { createSelectionSlice } from './selectionSlice';
import { createTimelineSlice } from './timelineSlice';
import { createLayersSlice } from './layersSlice';
import { createPanelSlice } from './panelSlice';
import { createWeatherSlice } from './weatherSlice';
import { createConnectionSlice } from './connectionSlice';
import { createProgSlice } from './progSlice';
import { createPreviewSlice } from './previewSlice';
import { createZonesSlice } from './zonesSlice';
import { createMapAppearanceSlice } from './mapAppearanceSlice';
import { createTrackSlice } from './trackSlice';
import { mergeField } from './pending';

export type { GameStore, HudState, SailSliceState, MapState, SelectionState } from './types';
export type { TimelineState, LayersState, PanelState, WeatherState, MapAppearanceState } from './types';
export type { ConnectionState, ProgState, OrderEntry, BoatLive } from './types';
export type { ConnState, PanelName, LayerName, PlaybackSpeed, TwaColor } from './types';
export type { GfsStatus, TrackState, TrackPoint } from './types';

const SAIL_CODES = ['JIB', 'LJ', 'SS', 'C0', 'SPI', 'HG', 'LG'] as const;

function twaColorFromCode(code: number): 'optimal' | 'overlap' | 'neutral' | 'deadzone' {
  return code === 0 ? 'deadzone' : code === 2 ? 'optimal' : code === 3 ? 'overlap' : 'neutral';
}

export const useGameStore = create<GameStore>((set) => ({
  ...createHudSlice(set),
  ...createSailSlice(set),
  ...createMapSlice(set),
  ...createSelectionSlice(set),
  ...createTimelineSlice(set),
  ...createLayersSlice(set),
  ...createPanelSlice(set),
  ...createWeatherSlice(set),
  ...createConnectionSlice(set),
  ...createProgSlice(set),
  ...createPreviewSlice(set),
  ...createZonesSlice(set),
  ...createMapAppearanceSlice(set),
  ...createTrackSlice(set),

  boats: new Map(),
  lastTickUnix: null,

  applyMessages: (msgs) =>
    set((s) => {
      const nextBoats = new Map(s.boats);
      let nextHud = s.hud;
      let nextSail = s.sail;
      const ownBoatId = process.env['NEXT_PUBLIC_DEMO_BOAT_ID'] ?? 'demo-boat-1';

      for (const m of msgs) {
        const boatId = String(m['boatId'] ?? '');
        if (!boatId) continue;
        nextBoats.set(boatId, {
          id: boatId,
          lat: Number(m['lat'] ?? 0),
          lon: Number(m['lon'] ?? 0),
          hdg: Number(m['hdg'] ?? 0),
          bsp: Number(m['bsp'] ?? 0),
          sail: Number(m['sail'] ?? 0),
          tickSeq: Number(m['tickSeq'] ?? 0),
        });

        if (boatId === ownBoatId) {
          const sailIdx = Number(m['sail'] ?? 2);
          const currentSail = SAIL_CODES[sailIdx] ?? 'JIB';
          const twaColorCode = Number(m['twaColor'] ?? 1);
          const serverTwd = m['twd'];
          const serverTws = m['tws'];
          const serverTwaLock = m['twaLock'];
          const hdgFromMsg = Number(m['hdg'] ?? s.hud.hdg);
          const twdFromMsg = typeof serverTwd === 'number' ? serverTwd : s.hud.twd;
          const twsFromMsg = typeof serverTws === 'number' ? serverTws : s.hud.tws;
          const now = Date.now();
          const hdgMerged = mergeField(s.hud.pending.hdg, hdgFromMsg, now);
          const sailAutoServer = m['sailAuto'] === true;
          const sailAutoMerged = mergeField(s.sail.pending.sailAuto, sailAutoServer, now);
          const sailChangeServer = {
            currentSail,
            transitionStartMs: Number(m['transitionStartMs'] ?? 0),
            transitionEndMs: Number(m['transitionEndMs'] ?? 0),
          };
          const sailChangeMerged = mergeField(
            s.sail.pending.sailChange,
            sailChangeServer,
            now,
            (a, b) => a.currentSail === b.currentSail,
          );
          // Prefer the authoritative TWA (server's TWD + heading) over the
          // locally-interpolated one, so the displayed TWA matches the engine.
          const derivedTwa = ((hdgMerged.value - twdFromMsg + 540) % 360) - 180;
          nextHud = {
            ...s.hud,
            lat: Number(m['lat'] ?? s.hud.lat),
            lon: Number(m['lon'] ?? s.hud.lon),
            hdg: hdgMerged.value,
            bsp: Number(m['bsp'] ?? s.hud.bsp),
            twd: twdFromMsg,
            tws: twsFromMsg,
            twa: typeof serverTwaLock === 'number' ? serverTwaLock : derivedTwa,
            twaLock: typeof serverTwaLock === 'number' ? serverTwaLock : null,
            overlapFactor: Number(m['overlapFactor'] ?? s.hud.overlapFactor),
            bspBaseMultiplier: Number(m['bspBaseMultiplier'] ?? s.hud.bspBaseMultiplier),
            twaColor: twaColorFromCode(twaColorCode),
            pending: hdgMerged.pending ? { hdg: hdgMerged.pending } : {},
          };
          nextSail = {
            ...s.sail,
            currentSail: sailChangeMerged.value.currentSail,
            sailPending: null,
            transitionStartMs: sailChangeMerged.value.transitionStartMs,
            transitionEndMs: sailChangeMerged.value.transitionEndMs,
            sailAuto: sailAutoMerged.value,
            maneuverKind: (Number(m['maneuverKind'] ?? 0)) as 0 | 1 | 2,
            maneuverStartMs: Number(m['maneuverStartMs'] ?? 0),
            maneuverEndMs: Number(m['maneuverEndMs'] ?? 0),
            pending: {
              ...(sailAutoMerged.pending ? { sailAuto: sailAutoMerged.pending } : {}),
              ...(sailChangeMerged.pending ? { sailChange: sailChangeMerged.pending } : {}),
            },
          };
        }
      }

      return {
        boats: nextBoats,
        hud: nextHud,
        sail: nextSail,
        lastTickUnix: Math.floor(Date.now() / 1000),
      };
    }),
}));

// ---------------------------------------------------------------------------
// WebSocket connection — singleton per raceId
// ---------------------------------------------------------------------------

const WS_BASE = process.env['NEXT_PUBLIC_WS_BASE'] ?? 'ws://localhost:3002';
const WS_LIVE = process.env['NEXT_PUBLIC_WS_LIVE'] === '1';

interface RaceConnection {
  ws: WebSocket | null;
  raceId: string;
  clientSeq: number;
  closed: boolean;
  close(): void;
}

let activeConnection: RaceConnection | null = null;

function decodeFrame(buf: ArrayBufferLike): Record<string, unknown>[] {
  const decoded = decode(new Uint8Array(buf));
  if (Array.isArray(decoded)) return decoded as Record<string, unknown>[];
  return [decoded as Record<string, unknown>];
}

export function connectRace(raceId: string, accessToken?: string): RaceConnection {
  if (activeConnection && activeConnection.raceId === raceId && !activeConnection.closed) {
    return activeConnection;
  }
  if (activeConnection) activeConnection.close();

  const url = `${WS_BASE}/race/${encodeURIComponent(raceId)}`;
  const protocols = accessToken ? [`bearer.${accessToken}`] : undefined;
  useGameStore.getState().setConnection('connecting');

  const state: RaceConnection = {
    ws: null, raceId, clientSeq: 0, closed: false,
    close: () => {
      state.closed = true;
      state.ws?.close();
      if (activeConnection === state) activeConnection = null;
    },
  };
  activeConnection = state;

  let retry = 500;

  const open = (): void => {
    if (state.closed) return;
    const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
    state.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { useGameStore.getState().setConnection('open'); retry = 500; };
    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      try { useGameStore.getState().applyMessages(decodeFrame(ev.data)); } catch { /* ignore */ }
    };
    ws.onerror = () => useGameStore.getState().setConnection('error');
    ws.onclose = () => {
      useGameStore.getState().setConnection('closed');
      if (!state.closed) { setTimeout(open, retry); retry = Math.min(retry * 2, 30_000); }
    };
  };

  open();
  return state;
}

export interface OrderPayload {
  type: 'CAP' | 'TWA' | 'WPT' | 'SAIL' | 'MODE' | 'VMG';
  value: Record<string, unknown>;
  trigger?: import('@nemo/shared-types').OrderTrigger;
}

export function sendOrder(payload: OrderPayload): boolean {
  if (!activeConnection?.ws || activeConnection.ws.readyState !== WebSocket.OPEN) return false;
  activeConnection.clientSeq += 1;
  const envelope = {
    type: 'ORDER',
    payload: {
      order: {
        id: `${activeConnection.raceId}-${activeConnection.clientSeq}`,
        type: payload.type,
        value: payload.value,
        trigger: payload.trigger ?? { type: 'IMMEDIATE' },
      },
      clientTs: Date.now(),
      clientSeq: activeConnection.clientSeq,
    },
  };
  activeConnection.ws.send(encode(envelope));
  return true;
}

export function isLiveMode(): boolean {
  return WS_LIVE;
}
