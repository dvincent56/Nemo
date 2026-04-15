import Redis from 'ioredis';
import pino from 'pino';

const log = pino({ name: 'redis' });

export interface RedisPair {
  pub: Redis;
  sub: Redis;
  close(): Promise<void>;
}

/**
 * Crée deux clients ioredis : un pour publish/commands, un pour subscribe.
 * La séparation est nécessaire car un client en mode subscribe ne peut plus
 * faire de commandes classiques.
 *
 * Retourne null si REDIS_URL n'est pas défini — le game-engine peut tourner
 * sans Redis (fallback in-memory + simulateur local côté client).
 */
export function connectRedis(): RedisPair | null {
  const url = process.env['REDIS_URL'];
  if (!url) {
    log.warn('REDIS_URL not set — broadcast pipeline disabled');
    return null;
  }
  const pub = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  const sub = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  pub.on('error', (err) => log.error({ err }, 'redis pub error'));
  sub.on('error', (err) => log.error({ err }, 'redis sub error'));
  pub.once('connect', () => log.info('redis pub connected'));
  sub.once('connect', () => log.info('redis sub connected'));
  return {
    pub,
    sub,
    close: async () => { await pub.quit(); await sub.quit(); },
  };
}

export const CHANNELS = {
  raceTick:  (raceId: string) => `race:${raceId}:tick`,
  boatOrder: (boatId: string) => `boat:${boatId}:order`,
  /** Canal global pour que game-engine écoute TOUS les ordres via pattern. */
  boatOrderPattern: 'boat:*:order',
};
