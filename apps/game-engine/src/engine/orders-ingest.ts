import { randomUUID } from 'node:crypto';
import type {
  Order,
  OrderEnvelope,
  OrderTrigger,
  OrderType,
} from '@nemo/shared-types';

/**
 * Ingestion événementielle des ordres (modèle V3+).
 *
 * Règles :
 *   - Chaque message ORDER WS arrive avec `clientTs` + `clientSeq` +
 *     `connectionId`.
 *   - Le serveur valide le clientTs : accepte si |serverNow - clientTs| < 2s,
 *     sinon force trustedTs = serverNow (protection anti-triche).
 *   - Dédup par `(connectionId, clientSeq)`. Même clientSeq reçu deux fois
 *     côté même connexion → ignoré.
 *   - Les envelopes sont ajoutées à `orderHistory` immédiatement, PAS au
 *     prochain tick. Le tick lit ensuite l'historique pour construire les
 *     segments.
 */

export const CLIENT_TS_TOLERANCE_MS = 2000;

export interface IngestState {
  history: OrderEnvelope[];
  seenSeqs: Map<string, Set<number>>;
}

export function createIngestState(): IngestState {
  return { history: [], seenSeqs: new Map() };
}

export function validateClientTs(clientTs: number, serverNowMs: number): number {
  if (Math.abs(serverNowMs - clientTs) < CLIENT_TS_TOLERANCE_MS) return clientTs;
  return serverNowMs;
}

function computeEffectiveTs(trigger: OrderTrigger, trustedTs: number): number {
  switch (trigger.type) {
    case 'IMMEDIATE':
    case 'SEQUENTIAL':
      return trustedTs;
    case 'AT_TIME':
      // trigger.time est exprimé en secondes Unix (convention existante)
      return trigger.time * 1000;
    case 'AT_WAYPOINT':
    case 'AFTER_DURATION':
      // Ces triggers sont résolus dynamiquement pendant le tick ; on range
      // l'envelope avec un effectiveTs conservateur = trustedTs. Le segment
      // builder pourra l'avancer si le waypoint est atteint plus tard.
      return trustedTs;
  }
}

export interface RawOrderInput {
  type: OrderType;
  value: Record<string, unknown>;
  trigger: OrderTrigger;
  clientTs: number;
  clientSeq: number;
  connectionId: string;
}

export interface IngestResult {
  accepted: boolean;
  reason?: 'duplicate' | 'invalid';
  envelope?: OrderEnvelope;
}

/**
 * Reçoit un ordre brut du transport WS et retourne l'envelope validée.
 * Mute `state.history` + `state.seenSeqs` si accepté.
 */
export function onOrderReceived(
  state: IngestState,
  input: RawOrderInput,
  serverNowMs: number,
): IngestResult {
  const seqsForConn = state.seenSeqs.get(input.connectionId) ?? new Set<number>();
  if (seqsForConn.has(input.clientSeq)) {
    return { accepted: false, reason: 'duplicate' };
  }

  const trustedTs = validateClientTs(input.clientTs, serverNowMs);
  const effectiveTs = computeEffectiveTs(input.trigger, trustedTs);

  const order: Order = {
    id: randomUUID(),
    type: input.type,
    trigger: input.trigger,
    value: input.value,
  };

  const envelope: OrderEnvelope = {
    order,
    clientTs: input.clientTs,
    clientSeq: input.clientSeq,
    trustedTs,
    effectiveTs,
    receivedAt: serverNowMs,
    connectionId: input.connectionId,
  };

  seqsForConn.add(input.clientSeq);
  state.seenSeqs.set(input.connectionId, seqsForConn);
  // Insertion triée par effectiveTs pour ne pas avoir à trier à chaque tick.
  const idx = state.history.findIndex((e) => e.effectiveTs > effectiveTs);
  if (idx === -1) state.history.push(envelope);
  else state.history.splice(idx, 0, envelope);

  return { accepted: true, envelope };
}

/**
 * Nettoie l'historique et les seqs : on garde les ordres dont effectiveTs est
 * >= maintenant - keepWindowMs (pour permettre des re-plays de ticks récents
 * en cas de recovery).
 */
export function pruneHistory(state: IngestState, serverNowMs: number, keepWindowMs: number): void {
  const cutoff = serverNowMs - keepWindowMs;
  state.history = state.history.filter((e) => e.effectiveTs >= cutoff);
  // Les seqs ne sont jamais purgées sur une connexion active — le dédup doit
  // tenir toute la session. Les déconnexions nettoient la Map.
}

export function dropConnection(state: IngestState, connectionId: string): void {
  state.seenSeqs.delete(connectionId);
}
