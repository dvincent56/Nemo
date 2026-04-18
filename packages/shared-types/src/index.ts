export type BoatClass = 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';

export type SailId = 'LW' | 'JIB' | 'GEN' | 'C0' | 'HG' | 'SPI';

export type SailState = 'STABLE' | 'TRANSITION';

export interface Position {
  lat: number;
  lon: number;
}

export interface WeatherPoint {
  tws: number;
  twd: number;
  swh: number;
  mwd: number;
  mwp: number;
}

export interface Polar {
  boatClass: BoatClass;
  tws: number[];
  twa: number[];
  speeds: number[][];
}

export interface Boat {
  id: string;
  ownerId: string;
  name: string;
  boatClass: BoatClass;
  position: Position;
  heading: number;
  bsp: number;
  sail: SailId;
  sailState: SailState;
  hullCondition: number;
  rigCondition: number;
  sailCondition: number;
  elecCondition: number;
}

export type OrderType = 'CAP' | 'TWA' | 'WPT' | 'SAIL' | 'MODE' | 'VMG';

export type OrderTrigger =
  | { type: 'IMMEDIATE' }
  | { type: 'SEQUENTIAL' }
  | { type: 'AT_TIME'; time: number }
  | { type: 'AT_WAYPOINT'; waypointOrderId: string }
  | { type: 'AFTER_DURATION'; duration: number };

export interface Order {
  id: string;
  type: OrderType;
  trigger: OrderTrigger;
  value: Record<string, unknown>;
  activatedAt?: number;
  completed?: boolean;
}

/**
 * Envelope événementielle reçue côté serveur (modèle event-sourced, V3+).
 * Chaque ordre arrive avec un timestamp client + une séquence par connexion.
 * Le serveur valide le clientTs (protection anti-triche) puis stocke un
 * trustedTs. Le effectiveTs dérive du trigger : IMMEDIATE → trustedTs,
 * AT_TIME → trigger.time, etc.
 *
 * Le tick loop consomme ces envelopes, pas une "queue à la tête courante".
 */
export interface OrderEnvelope {
  order: Order;
  clientTs: number;         // ms since epoch, ce que le client affirme
  clientSeq: number;        // séquence incrémentale par connexion (dédup)
  trustedTs: number;        // ms, timestamp validé (= clientTs si |clientTs - serverNow| < tolérance)
  effectiveTs: number;      // ms, moment où l'ordre prend effet côté jeu
  receivedAt: number;       // ms, heure de réception serveur (métriques/debug)
  connectionId: string;     // pour dédup (connectionId, clientSeq)
}

/**
 * Zones d'exclusion — décision UX 2026-04-15 :
 *   WARN    : ralentissement léger (multiplier par défaut 0.8)
 *   PENALTY : ralentissement fort   (multiplier par défaut 0.5)
 * HARD_BLOCK retiré — pas d'interdiction stricte, juste un coût vitesse.
 */
export type ExclusionZoneType = 'WARN' | 'PENALTY';

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export interface ExclusionZone {
  id: string;
  raceId: string;
  name: string;
  type: ExclusionZoneType;
  geometry: GeoJsonPolygon;
  speedMultiplier?: number;
  color: string;
  reason: string;
  activeFrom: string | null;
  activeTo: string | null;
}

export type GateType = 'GATE' | 'MARK' | 'FINISH';

export interface RaceGate {
  id: string;
  raceId: string;
  name: string;
  orderIndex: number;
  gateType: GateType;
  point1: Position;
  point2: Position | null;
  passingSide: 'PORT' | 'STARBOARD' | null;
  hasLeaderboard: boolean;
  creditBonus: number;
}

export interface BoatHUDData {
  dateUtc: string;
  raceTime: string;
  rank: number;
  dtf: number;
  dtu: number | null;
  twd: number;
  tws: number;
  twa: number;
  twaColor: 'optimal' | 'overlap' | 'neutral' | 'deadzone';
  hdg: number;
  bsp: number;
  vmg: number;
  sail: SailId;
  sailState: SailState;
  transitionRemaining: number | null;
  overlapFactor: number;
  inOverlapZone: boolean;
  foilsEfficiency: number;
  hullCondition: number;
  rigCondition: number;
  sailCondition: number;
  lat: number;
  lon: number;
  latDMS: string;
  lonDMS: string;
  coastDistance: number;
  coastRisk: 'NONE' | 'CAUTION' | 'DANGER' | 'CRITICAL';
}

export interface GeoPoint {
  lat: number;
  lon: number;
}
