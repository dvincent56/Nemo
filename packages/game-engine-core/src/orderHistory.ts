import type { OrderEnvelope } from '@nemo/shared-types';

/**
 * Supersession des intentions de cap (heading-intent supersession).
 *
 * Contexte : les ordres WPT persistent dans `orderHistory` à travers les
 * ticks tant qu'ils ne sont pas capturés (cf. `tick.ts` purge filter). Les
 * ordres CAP / TWA, eux, sont consommés et purgés dès qu'un tick a passé
 * leur `effectiveTs`.
 *
 * Conséquence du bug : un joueur qui applique une route WPT puis une route
 * CAP voyait les WPT précédents continuer à imposer le cap après que le
 * dernier CAP ait été consommé. Au tick suivant, plus de CAP en orderHistory
 * mais 16 WPT toujours actifs → le segmenter applique tous les WPT à
 * tickStartMs et le DERNIER (par ordre d'insertion = effectiveTs ASC)
 * écrase le cap : heading = bearing-vers-WPT-final au lieu du CAP voulu.
 *
 * Règle adoptée : un ordre CAP ou TWA *neuf* (effectiveTs strictement
 * postérieur) supersède toutes les intentions de cap antérieures non
 * capturées (WPT non complétés). Ces WPT sont marqués `completed: true`
 * à l'ingestion, ce qui les fait sortir du segmenter ET de la file de
 * détection de capture (cf. `tick.ts` :291 `if (env.order.completed)
 * continue`). Ils restent en historique pour audit, et seront purgés
 * naturellement au tick suivant car la purge ne conserve plus que les
 * WPT *non* complétés.
 *
 * Symétriquement, l'arrivée d'un nouveau WPT (effectiveTs supérieur)
 * écrase déjà naturellement les CAP / TWA antérieurs : ces derniers seront
 * appliqués dans `buildSegments` AVANT le WPT (ordre par effectiveTs ASC),
 * donc le WPT gagne. Pas de marquage requis dans ce sens.
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
