import { encode } from '@msgpack/msgpack';
import type { BoatRuntime, TickOutcome } from '../engine/tick.js';

/**
 * Protocole broadcast V1 — taille serrée, encodage MessagePack compact.
 * Les binary layouts "22 bytes" / "9 bytes" annoncés dans la spec §5.1 sont
 * des ordres de grandeur post-compression MessagePack + hints de type Int/Float.
 * La structure logique est ici — le sérialiseur passe au format MessagePack.
 */

export interface FullUpdate {
  kind: 'full';
  boatId: string;
  tickSeq: number;
  lat: number;
  lon: number;
  hdg: number;
  bsp: number;
  sail: number;
}

export interface DeltaUpdate {
  kind: 'delta';
  boatId: string;
  tickSeq: number;
  dLat: number;
  dLon: number;
}

export interface GoneUpdate {
  kind: 'gone';
  boatId: string;
}

/** Extension propre au bateau du joueur (addendum HUD §2.1). */
export interface MyBoatFullUpdate extends FullUpdate {
  overlapFactor: number;
  twaColor: 0 | 1 | 2 | 3;
  driveMode: 0 | 1 | 2;
  coastRisk: 0 | 1 | 2 | 3;
  transitionStartMs: number;   // timestamp when sail change started (0 = none)
  transitionEndMs: number;     // timestamp when sail change ends (0 = none)
  sailAuto: boolean;           // auto mode active
  maneuverKind: 0 | 1 | 2;    // 0 = none, 1 = tack, 2 = gybe
  maneuverStartMs: number;     // timestamp when tack/gybe started (0 = none)
  maneuverEndMs: number;       // timestamp when tack/gybe ends (0 = none)
}

export type BroadcastMsg = FullUpdate | DeltaUpdate | GoneUpdate | MyBoatFullUpdate;

const SAIL_IDS = ['LW', 'JIB', 'GEN', 'C0', 'HG', 'SPI'] as const;
export type SailCode = 0 | 1 | 2 | 3 | 4 | 5;

export function sailIdToCode(sail: typeof SAIL_IDS[number]): SailCode {
  return SAIL_IDS.indexOf(sail) as SailCode;
}

export function encodeBatch(msgs: readonly BroadcastMsg[]): Uint8Array {
  return encode(msgs);
}

export function encodeSingle(msg: BroadcastMsg): Uint8Array {
  return encode(msg);
}

/**
 * Construit un payload FullUpdate à partir d'un runtime + outcome de tick.
 * `isOwner=true` ajoute les champs MyBoatFullUpdate (overlap, twaColor, etc.).
 */
export function buildFullUpdate(
  runtime: BoatRuntime,
  outcome: TickOutcome,
  tickSeq: number,
  isOwner: boolean,
): FullUpdate | MyBoatFullUpdate {
  const sailCode = sailIdToCode(runtime.boat.sail as typeof SAIL_IDS[number]);
  const base: FullUpdate = {
    kind: 'full',
    boatId: runtime.boat.id,
    tickSeq,
    lat: runtime.boat.position.lat,
    lon: runtime.boat.position.lon,
    hdg: runtime.boat.heading,
    bsp: outcome.bsp,
    sail: sailCode,
  };
  if (!isOwner) return base;

  const a = Math.abs(outcome.twa);
  const twaColor: MyBoatFullUpdate['twaColor'] =
    a < 28 ? 0 : (a > 54 && a < 140) ? 2 : a >= 38 && a <= 54 ? 3 : a >= 140 && a <= 162 ? 3 : 1;
  const driveMode: MyBoatFullUpdate['driveMode'] =
    runtime.boat.driveMode === 'CONSERVATIVE' ? 0 :
    runtime.boat.driveMode === 'NORMAL' ? 1 : 2;
  const sailState = runtime.sailState;
  return {
    ...base,
    overlapFactor: outcome.overlapFactor,
    twaColor,
    driveMode,
    coastRisk: outcome.coastRisk,
    transitionStartMs: sailState.transitionStartMs,
    transitionEndMs: sailState.transitionEndMs,
    sailAuto: sailState.autoMode,
    maneuverKind: runtime.maneuver ? (runtime.maneuver.kind === 'TACK' ? 1 : 2) : 0,
    maneuverStartMs: runtime.maneuver?.startMs ?? 0,
    maneuverEndMs: runtime.maneuver?.endMs ?? 0,
  };
}
