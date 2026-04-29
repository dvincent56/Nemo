import type { OrderEnvelope } from '@nemo/shared-types';

/**
 * Supersession des intentions de cap (heading-intent supersession).
 *
 * Contexte : les ordres WPT persistent dans `orderHistory` à travers les
 * ticks tant qu'ils ne sont pas capturés (cf. `tick.ts` purge filter). Les
 * ordres CAP / TWA, eux, sont consommés et purgés dès qu'un tick a passé
 * leur `effectiveTs` — sauf s'ils sont planifiés dans le futur (AT_TIME),
 * auquel cas ils restent en historique jusqu'à leur tick d'application.
 *
 * Conséquence du bug (sens 1, WPT-puis-CAP) : un joueur qui applique une
 * route WPT puis une route CAP voyait les WPT précédents continuer à imposer
 * le cap après que le dernier CAP ait été consommé. Au tick suivant, plus
 * de CAP en orderHistory mais 16 WPT toujours actifs → le segmenter applique
 * tous les WPT à tickStartMs et le DERNIER (par ordre d'insertion =
 * effectiveTs ASC) écrase le cap : heading = bearing-vers-WPT-final au lieu
 * du CAP voulu.
 *
 * Conséquence du bug (sens 2, CAP-puis-WPT) : un joueur qui applique une
 * route CAP planifiée (AT_TIME futurs) puis une route WPT voyait son bateau
 * partir vers le cap programmé au lieu de suivre les WPT. Les CAP futurs
 * sont conservés par la purge (`effectiveTs >= tickEndMs`) et finissent
 * par s'appliquer après les WPT au tick d'échéance.
 *
 * Règle adoptée :
 * - Un ordre CAP / TWA neuf supersède les WPT antérieurs (effectiveTs
 *   strictement antérieur) non complétés.
 * - Un ordre WPT neuf supersède les CAP / TWA postérieurs ou simultanés
 *   (effectiveTs >= effectiveTs du WPT) non complétés. On utilise un
 *   cutoff inclusif côté CAP/TWA car le WPT applique l'intention "à partir
 *   de maintenant" et tout heading-order programmé pour plus tard relève
 *   de l'intention précédente que l'utilisateur vient de remplacer.
 *
 * Les ordres marqués `completed: true` :
 *  - sont ignorés par `buildSegments` (segments.ts skip completed)
 *  - sont ignorés par la détection de capture WPT (`tick.ts`
 *    `if (env.order.completed) continue`)
 *  - sont purgés au tick suivant (la purge ne conserve les ordres futurs
 *    que s'ils ne sont pas marqués completed).
 *
 * Cette fonction est appelée AU MOMENT DE L'INGESTION par `worker.ts` —
 * c'est essentiel parce que les CAP / TWA sont purgés après leur tick
 * d'application : si on attendait runTick pour faire la supersession,
 * un CAP arrivé à t mais déjà consommé à t+30s ne pourrait plus marquer
 * les WPT comme superseded au tick suivant.
 */
export function supersedeWaypointsByCapTwa(
  orderHistory: readonly OrderEnvelope[],
  incoming: OrderEnvelope,
): OrderEnvelope[] {
  if (incoming.order.type !== 'CAP' && incoming.order.type !== 'TWA') {
    return orderHistory.slice();
  }
  const cutoff = incoming.effectiveTs;
  return orderHistory.map((env) => {
    if (env.order.type !== 'WPT') return env;
    if (env.order.completed) return env;
    if (env.effectiveTs >= cutoff) return env;
    return { ...env, order: { ...env.order, completed: true } };
  });
}

/**
 * Symétrique de `supersedeWaypointsByCapTwa` : un WPT neuf marque tous les
 * CAP / TWA non complétés à partir de son `effectiveTs` (inclus) comme
 * `completed`. Voir la rationale en tête de fichier.
 *
 * Le cutoff est inclusif (>=) : un CAP planifié au même instant que le WPT
 * relève de l'intention précédente que l'utilisateur vient de remplacer en
 * appliquant la route WPT.
 */
export function supersedeCapTwaByWaypoint(
  orderHistory: readonly OrderEnvelope[],
  incoming: OrderEnvelope,
): OrderEnvelope[] {
  if (incoming.order.type !== 'WPT') {
    return orderHistory.slice();
  }
  const cutoff = incoming.effectiveTs;
  return orderHistory.map((env) => {
    if (env.order.type !== 'CAP' && env.order.type !== 'TWA') return env;
    if (env.order.completed) return env;
    if (env.effectiveTs < cutoff) return env;
    return { ...env, order: { ...env.order, completed: true } };
  });
}

/**
 * Convenience: applique la supersession appropriée selon le type de
 * l'ordre entrant. CAP / TWA → supersede WPTs antérieurs. WPT → supersede
 * CAP / TWA postérieurs ou simultanés. Tout autre type est passé tel quel.
 */
export function supersedeHeadingIntent(
  orderHistory: readonly OrderEnvelope[],
  incoming: OrderEnvelope,
): OrderEnvelope[] {
  if (incoming.order.type === 'CAP' || incoming.order.type === 'TWA') {
    return supersedeWaypointsByCapTwa(orderHistory, incoming);
  }
  if (incoming.order.type === 'WPT') {
    return supersedeCapTwaByWaypoint(orderHistory, incoming);
  }
  return orderHistory.slice();
}

/**
 * Atomically replaces the user-modifiable portion of an envelope history.
 *
 * Envelopes with `order.completed === true` are kept (consumed history is
 * preserved for replay/debug and so the engine doesn't "resurrect" already-
 * crossed waypoints or already-fired CAP orders). All other envelopes are
 * dropped and replaced by `incoming`, which is appended after the kept
 * history, sorted ascending by `effectiveTs` (matches the existing insertion
 * invariant maintained by `onOrderReceived` and the worker `ingestOrder`).
 *
 * Pure function. Caller is expected to feed `incoming` envelopes already
 * built via the same shape as `onOrderReceived` (with trustedTs / effectiveTs
 * computed by the gateway) — this function does not derive timestamps.
 *
 * Note : les enveloppes `completed` sont **toujours en tête** quel que soit
 * leur `effectiveTs`. Le tableau retourné n'est donc PAS globalement trié
 * par `effectiveTs` — c'est acceptable parce que tous les consommateurs aval
 * (`buildSegments`, détection de capture WPT dans `tick.ts`, purge) ignorent
 * les enveloppes `completed`. Un futur lecteur qui voudrait
 * `result.find(o => o.effectiveTs > X)` doit filtrer les `completed` d'abord.
 *
 * Cf. spec `docs/superpowers/specs/2026-04-28-progpanel-redesign-design.md`
 * Phase 0 ("ORDER_REPLACE_QUEUE").
 */
export function replaceUserQueue(
  history: OrderEnvelope[],
  incoming: OrderEnvelope[],
): OrderEnvelope[] {
  const completed = history.filter((e) => e.order.completed === true);
  const sortedIncoming = incoming.slice().sort((a, b) => a.effectiveTs - b.effectiveTs);
  return [...completed, ...sortedIncoming];
}
