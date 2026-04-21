import type {
  OrderEnvelope,
  Polar,
  Position,
  SailId,
  WeatherPoint,
} from '@nemo/shared-types';
import { advancePosition, computeTWA, getPolarSpeed } from '@nemo/polar-lib/browser';

/**
 * Modèle événementiel : chaque tick est découpé en segments par les ordres
 * dont `effectiveTs` tombe dans l'intervalle [tickStartMs, tickEndMs).
 *
 * Principe : initialState fixe le heading/sail/twa-lock au début du tick.
 * À chaque boundary (effectiveTs d'un ordre), on applique l'ordre puis on
 * avance la position du segment suivant avec la vitesse issue de la polaire
 * pour le nouvel état.
 *
 * Les ordres WPT, SEQUENTIAL, AT_WAYPOINT et AFTER_DURATION ne sont pas
 * découpés ici — ils relèvent de la logique de file résiduelle (orders.ts).
 * Ce segmenter gère CAP, TWA, SAIL, MODE à effectiveTs précis.
 */

export interface SegmentState {
  position: Position;
  heading: number;      // degrés vrais
  twaLock: number | null; // si ≠ null, heading recalculé au tick depuis TWD courant
  sail: SailId;
  sailAuto: boolean;
}

export interface TickSegment {
  startMs: number;     // inclusif
  endMs: number;       // exclusif
  startPosition: Position;
  endPosition: Position;
  heading: number;
  twa: number;         // signé
  bsp: number;         // BSP retenue pour le segment (polaire × facteurs amont)
  sail: SailId;
  durationSec: number;
}

export interface BuildSegmentsInput {
  tickStartMs: number;
  tickEndMs: number;
  initialState: SegmentState;
  orders: readonly OrderEnvelope[];  // déjà triés par effectiveTs
  polar: Polar;
  weather: WeatherPoint;             // on considère la météo constante sur le tick (30s)
  /**
   * Multiplicateur scalaire appliqué à la BSP polaire brute de chaque segment.
   * Inclut conditionFactor × transitionFactor × overlapFactor × maneuverFactor.
   */
  bspMultiplier: number;
  /**
   * Modulateur par segment : appelé avec la position de départ du segment,
   * retourne un multiplicateur supplémentaire (typiquement zone PENALTY).
   * Défaut 1.0 si omis.
   */
  perSegmentBspModulator?: (segStartPosition: Position) => number;
}

function applyOrder(state: SegmentState, envelope: OrderEnvelope, twd: number): SegmentState {
  const next: SegmentState = { ...state };
  const order = envelope.order;
  switch (order.type) {
    case 'CAP': {
      const hdg = order.value['heading'];
      if (typeof hdg === 'number') {
        next.heading = ((hdg % 360) + 360) % 360;
        next.twaLock = null;
      }
      break;
    }
    case 'TWA': {
      const twa = order.value['twa'];
      if (typeof twa === 'number') {
        next.twaLock = twa;
        next.heading = ((twd + twa) + 360) % 360;
      }
      break;
    }
    case 'SAIL': {
      const sail = order.value['sail'];
      if (typeof sail === 'string') next.sail = sail as SailId;
      break;
    }
    case 'MODE': {
      const auto = order.value['auto'];
      if (typeof auto === 'boolean') next.sailAuto = auto;
      break;
    }
    case 'VMG':
    case 'WPT':
      // VMG auto / WPT sont résolus par le tick principal (orientation dynamique).
      break;
  }
  return next;
}

/**
 * Découpe le tick en segments. Retourne aussi l'état final après le dernier
 * segment pour pouvoir réinjecter dans le runtime du prochain tick.
 */
export function buildSegments(input: BuildSegmentsInput): {
  segments: TickSegment[];
  finalState: SegmentState;
} {
  const { tickStartMs, tickEndMs, initialState, orders, polar, weather, bspMultiplier, perSegmentBspModulator } = input;

  // Si un twaLock est actif à l'entrée du tick, on recalcule le heading au
  // TWD courant avant de commencer.
  let state: SegmentState = { ...initialState };
  if (state.twaLock !== null) {
    state.heading = ((weather.twd + state.twaLock) + 360) % 360;
  }

  // Late orders (effectiveTs < tickStartMs) → snap to tickStartMs
  const events = orders
    .filter((o) => o.effectiveTs < tickEndMs)
    .map((o) => o.effectiveTs < tickStartMs ? { ...o, effectiveTs: tickStartMs } : o);

  // Boundaries dédupliqués (plusieurs ordres au même instant = un seul cut).
  const boundarySet = new Set<number>([tickStartMs, tickEndMs]);
  for (const e of events) boundarySet.add(e.effectiveTs);
  const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

  const segments: TickSegment[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i] as number;
    const segEnd = boundaries[i + 1] as number;
    if (segEnd <= segStart) continue;

    // Appliquer tous les ordres avec effectiveTs === segStart.
    // Includes late orders snapped to tickStartMs.
    for (const e of events) {
      if (e.effectiveTs === segStart) state = applyOrder(state, e, weather.twd);
    }

    // TWA courant du segment depuis heading et TWD météo.
    const twa = computeTWA(state.heading, weather.twd);
    const baseBsp = getPolarSpeed(polar, state.sail, twa, weather.tws);
    const perSegmentFactor = perSegmentBspModulator ? perSegmentBspModulator(state.position) : 1.0;
    const bsp = baseBsp * bspMultiplier * perSegmentFactor;

    const durationSec = (segEnd - segStart) / 1000;
    const endPos = advancePosition(state.position, state.heading, bsp, durationSec);

    segments.push({
      startMs: segStart,
      endMs: segEnd,
      startPosition: state.position,
      endPosition: endPos,
      heading: state.heading,
      twa,
      bsp,
      sail: state.sail,
      durationSec,
    });

    state = { ...state, position: endPos };
  }

  return { segments, finalState: state };
}
