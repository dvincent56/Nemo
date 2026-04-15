'use client';

import { create } from 'zustand';
import { decode, encode } from '@msgpack/msgpack';

export interface BoatLive {
  id: string;
  lat: number;
  lon: number;
  hdg: number;
  bsp: number;
  sail: number;
  tickSeq: number;
}

export interface HudState {
  tws: number;
  twd: number;
  twa: number;
  hdg: number;
  bsp: number;
  vmg: number;
  dtf: number;
  overlapFactor: number;
  twaColor: 'optimal' | 'overlap' | 'neutral' | 'deadzone';
  sail: 'LW' | 'JIB' | 'GEN' | 'C0' | 'HG' | 'SPI';
  sailPending: 'LW' | 'JIB' | 'GEN' | 'C0' | 'HG' | 'SPI' | null;
  transitionRemainingSec: number;
  sailAuto: boolean;
  rank: number;
  lat: number;
  lon: number;
}

const INITIAL_HUD: HudState = {
  tws: 0, twd: 0, twa: 0, hdg: 0, bsp: 0, vmg: 0, dtf: 0,
  overlapFactor: 1.0, twaColor: 'neutral',
  sail: 'GEN', sailPending: null, transitionRemainingSec: 0, sailAuto: false,
  rank: 0, lat: 0, lon: 0,
};

type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

const SAIL_CODES: HudState['sail'][] = ['LW', 'JIB', 'GEN', 'C0', 'HG', 'SPI'];

interface Store {
  connection: ConnState;
  lastTickUnix: number | null;
  hud: HudState;
  boats: Map<string, BoatLive>;
  setHud: (patch: Partial<HudState>) => void;
  applyMessages: (msgs: Record<string, unknown>[]) => void;
  setConnection: (s: ConnState) => void;
  setSailPending: (sail: HudState['sailPending']) => void;
  toggleSailAuto: () => void;
}

function twaColorFromCode(code: number): HudState['twaColor'] {
  return code === 0 ? 'deadzone' : code === 2 ? 'optimal' : code === 3 ? 'overlap' : 'neutral';
}

export const useGameStore = create<Store>((set) => ({
  connection: 'idle',
  lastTickUnix: null,
  hud: INITIAL_HUD,
  boats: new Map(),

  setHud: (patch) => set((s) => ({ hud: { ...s.hud, ...patch } })),

  applyMessages: (msgs) => set((s) => {
    const nextBoats = new Map(s.boats);
    let nextHud = s.hud;
    let ownUpdate: Record<string, unknown> | null = null;
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
      if (boatId === ownBoatId) ownUpdate = m;
    }

    if (ownUpdate) {
      const sailIdx = Number(ownUpdate['sail'] ?? 2);
      const sail = SAIL_CODES[sailIdx] ?? 'GEN';
      const twaColorCode = Number(ownUpdate['twaColor'] ?? 1);
      nextHud = {
        ...s.hud,
        lat: Number(ownUpdate['lat'] ?? s.hud.lat),
        lon: Number(ownUpdate['lon'] ?? s.hud.lon),
        hdg: Number(ownUpdate['hdg'] ?? s.hud.hdg),
        bsp: Number(ownUpdate['bsp'] ?? s.hud.bsp),
        sail,
        overlapFactor: Number(ownUpdate['overlapFactor'] ?? s.hud.overlapFactor),
        twaColor: twaColorFromCode(twaColorCode),
      };
    }

    return {
      boats: nextBoats,
      hud: nextHud,
      lastTickUnix: Math.floor(Date.now() / 1000),
    };
  }),

  setConnection: (connection) => set({ connection }),
  setSailPending: (sail) => set((s) => ({ hud: { ...s.hud, sailPending: sail } })),
  toggleSailAuto: () => set((s) => ({ hud: { ...s.hud, sailAuto: !s.hud.sailAuto } })),
}));

function decodeFrame(buf: ArrayBufferLike): Record<string, unknown>[] {
  const decoded = decode(new Uint8Array(buf));
  if (Array.isArray(decoded)) return decoded as Record<string, unknown>[];
  return [decoded as Record<string, unknown>];
}

// ---------------------------------------------------------------------------
// Connexion WS — singleton par raceId pour pouvoir appeler sendOrder() depuis
// n'importe quel composant (Compass, SailPanel) sans prop drilling.
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

export function connectRace(raceId: string, accessToken?: string): RaceConnection {
  if (activeConnection && activeConnection.raceId === raceId && !activeConnection.closed) {
    return activeConnection;
  }
  if (activeConnection) activeConnection.close();

  const url = `${WS_BASE}/race/${encodeURIComponent(raceId)}`;
  const protocols = accessToken ? [`bearer.${accessToken}`] : undefined;
  const store = useGameStore.getState();
  store.setConnection('connecting');

  const state: RaceConnection = {
    ws: null,
    raceId,
    clientSeq: 0,
    closed: false,
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
    ws.onopen = () => {
      useGameStore.getState().setConnection('open');
      retry = 500;
    };
    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      try {
        const msgs = decodeFrame(ev.data);
        useGameStore.getState().applyMessages(msgs);
      } catch { /* ignore malformed */ }
    };
    ws.onerror = () => useGameStore.getState().setConnection('error');
    ws.onclose = () => {
      useGameStore.getState().setConnection('closed');
      if (!state.closed) {
        setTimeout(open, retry);
        retry = Math.min(retry * 2, 30_000);
      }
    };
  };

  open();
  return state;
}

/**
 * Émet un ordre vers le serveur en MessagePack binaire. L'envelope est
 * complétée côté serveur (trustedTs, effectiveTs, connectionId).
 *
 * @returns true si le message a été envoyé, false si pas de connexion ouverte.
 */
export interface OrderPayload {
  type: 'CAP' | 'TWA' | 'WPT' | 'SAIL' | 'MODE' | 'VMG';
  value: Record<string, unknown>;
  trigger?: { type: 'IMMEDIATE' } | { type: 'AT_TIME'; time: number };
}

export function sendOrder(payload: OrderPayload): boolean {
  if (!activeConnection?.ws || activeConnection.ws.readyState !== WebSocket.OPEN) {
    return false;
  }
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
