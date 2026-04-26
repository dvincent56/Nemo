import type {
  OrderEnvelope,
  Polar,
  Position,
  SailId,
  WeatherPoint,
} from '@nemo/shared-types';
import { advancePosition, computeTWA, getPolarSpeed } from '@nemo/polar-lib/browser';
import { bearingDeg } from './geo';

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
   * Inclut conditionFactor × overlapFactor (facteurs constants sur le tick).
   * Les facteurs dépendant du temps (transition voile, virement/empannage) sont
   * ré-évalués par segment via `perSegmentTimeModulator`.
   */
  bspMultiplier: number;
  /**
   * Modulateur par segment : appelé avec la position de départ du segment,
   * retourne un multiplicateur supplémentaire (typiquement zone PENALTY).
   * Défaut 1.0 si omis.
   */
  perSegmentBspModulator?: (segStartPosition: Position) => number;
  /**
   * Modulateur par segment basé sur le temps de DÉBUT du segment. Utilisé pour
   * que les pénalités à durée bornée (transition de voile, manœuvre) ne
   * s'appliquent qu'aux segments antérieurs à leur fin — un segment qui démarre
   * APRÈS la fin de transition obtient son facteur 1.0 et donc la BSP pleine.
   * Défaut 1.0 si omis.
   */
  perSegmentTimeModulator?: (segStartMs: number) => number;
  /**
   * Frontières temporelles supplémentaires à insérer en plus des `effectiveTs`
   * d'ordres. Typiquement la fin de transition voile et la fin de manœuvre, pour
   * que le segment post-pénalité existe et soit broadcast avec la vitesse pleine.
   * Les valeurs hors [tickStartMs, tickEndMs] sont ignorées.
   */
  extraBoundariesMs?: readonly number[];
}

/**
 * Sélectionne l'unique WPT "actif" dans une chaîne AT_WAYPOINT — c'est-à-dire
 * le premier (par ordre d'effectiveTs croissant) WPT non complété dont le
 * prédécesseur AT_WAYPOINT est complété (ou qui n'a pas de prédécesseur :
 * IMMEDIATE / SEQUENTIAL).
 *
 * Sans ce filtrage, `buildSegments` appliquait TOUS les WPT non complétés à
 * `tickStartMs` (snap des ordres "late" via le filtre `effectiveTs <
 * tickEndMs`). Le routeur émet des chaînes WPT avec `trigger: AT_WAYPOINT`
 * mais le gateway/ingest met `effectiveTs = trustedTs ≈ now` pour TOUS les
 * WPT (cf. apps/ws-gateway/src/index.ts L167-169 et
 * apps/game-engine/src/engine/orders-ingest.ts L48-53). Conséquence : les 16
 * WPT d'une route arrivaient avec le même effectiveTs et `applyOrder`
 * s'exécutait pour chacun à la même boundary — le DERNIER écrasait le heading
 * de tous les précédents, et le bateau partait vers le WP final au lieu du
 * WP_1.
 *
 * La logique de capture (`tick.ts`) vérifie tous les WPT actifs à chaque
 * tick — quand WP_1 est capturé (`completed: true`), `activeWaypointId`
 * retourne WP_2 au tick suivant (son prédécesseur est complété), et ainsi de
 * suite le long de la chaîne.
 */
export function activeWaypointId(orders: readonly OrderEnvelope[]): string | null {
  // Les ordres sont déjà triés par effectiveTs croissant (orders-ingest.ts L109).
  for (const env of orders) {
    if (env.order.type !== 'WPT') continue;
    if (env.order.completed) continue;
    const trigger = env.order.trigger;
    if (trigger.type !== 'AT_WAYPOINT') {
      // IMMEDIATE / SEQUENTIAL / AT_TIME / AFTER_DURATION → tête de chaîne.
      return env.order.id;
    }
    const predId = trigger.waypointOrderId;
    const pred = orders.find((x) => x.order.id === predId);
    // Prédécesseur introuvable → on traite comme orphelin et on l'active
    // (sécurité : ne jamais bloquer un WPT à cause d'un id manquant).
    if (!pred || pred.order.completed === true) {
      return env.order.id;
    }
  }
  return null;
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
      // VMG auto résolu par le tick principal (orientation dynamique).
      break;
    case 'WPT': {
      // Cap dynamique vers le waypoint, recalculé à chaque application de l'ordre
      // (i.e. à chaque tick puisque les WPT non complétés sont conservés et
      // re-snappés à tickStartMs au tick suivant — voir tick.ts).
      const lat = order.value['lat'];
      const lon = order.value['lon'];
      if (typeof lat === 'number' && typeof lon === 'number') {
        next.heading = bearingDeg(state.position, { lat, lon });
        next.twaLock = null;
      }
      break;
    }
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
  const {
    tickStartMs,
    tickEndMs,
    initialState,
    orders,
    polar,
    weather,
    bspMultiplier,
    perSegmentBspModulator,
    perSegmentTimeModulator,
    extraBoundariesMs,
  } = input;

  // Si un twaLock est actif à l'entrée du tick, on recalcule le heading au
  // TWD courant avant de commencer.
  let state: SegmentState = { ...initialState };
  if (state.twaLock !== null) {
    state.heading = ((weather.twd + state.twaLock) + 360) % 360;
  }

  // Late orders (effectiveTs < tickStartMs) → snap to tickStartMs.
  // Completed orders are skipped: a CAP/TWA marked completed by a later WPT
  // (or a WPT marked completed by a later CAP/TWA) must NOT influence
  // segment heading anymore. See `orderHistory.ts` for supersession rules.
  // WPT chain filtering: in a chain of WPT orders linked by AT_WAYPOINT,
  // only the active one (head whose predecessor is completed) drives the
  // heading on this tick. The rest are dormant until their predecessor
  // captures. See `activeWaypointId` rationale.
  const activeWptId = activeWaypointId(orders);
  const events = orders
    .filter((o) => !o.order.completed && o.effectiveTs < tickEndMs)
    .filter((o) => o.order.type !== 'WPT' || o.order.id === activeWptId)
    .map((o) => o.effectiveTs < tickStartMs ? { ...o, effectiveTs: tickStartMs } : o);

  // Boundaries dédupliqués (plusieurs ordres au même instant = un seul cut).
  const boundarySet = new Set<number>([tickStartMs, tickEndMs]);
  for (const e of events) boundarySet.add(e.effectiveTs);
  if (extraBoundariesMs) {
    for (const b of extraBoundariesMs) {
      if (b > tickStartMs && b < tickEndMs) boundarySet.add(b);
    }
  }
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
    const timeFactor = perSegmentTimeModulator ? perSegmentTimeModulator(segStart) : 1.0;
    const bsp = baseBsp * bspMultiplier * perSegmentFactor * timeFactor;

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
