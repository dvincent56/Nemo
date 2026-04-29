import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import Redis from 'ioredis';
import { decode, encode } from '@msgpack/msgpack';
import pino from 'pino';
import type { Order, OrderEnvelope, OrderTrigger } from '@nemo/shared-types';

/**
 * ws-gateway — Phase 3 pipeline complet (implémentation `ws` standard npm).
 *
 * Choix d'implémentation : on a abandonné uWebSockets.js côté gateway à cause
 * de bugs de routage silencieux sur Windows (handler jamais appelé pour les
 * patterns dynamiques). `ws` + http natif = 100% standard, zero magie.
 *
 * Sortant : chaque client abonné à /race/:raceId reçoit les tick broadcasts
 * publiés par le game-engine sur Redis `race:{raceId}:tick`.
 *
 * Entrant : les messages binaires ORDER du client sont décodés, enrichis
 * (connectionId, trustedTs, effectiveTs) et publiés sur `boat:{boatId}:order`
 * pour que le game-engine les ingère.
 *
 * Auth : token via sub-protocol `bearer.<token>` (priorité) ou cookie
 * `nemo_access_token`. Phase 3 accepte les tokens stub `dev.<sub>.<username>`.
 */

const log = pino({ name: 'ws-gateway' });

const PORT = Number(process.env['WS_PORT'] ?? 3002);
const REDIS_URL = process.env['REDIS_URL'];

interface ClientCtx {
  connectionId: string;
  raceId: string;
  playerId: string;
  username: string;
  boatId: string | null;
  channel: string;
  subscribedAt: number;
}

function verifyToken(token: string): { sub: string; username: string } | null {
  if (token.startsWith('dev.')) {
    const [, sub, username] = token.split('.');
    if (sub && username) return { sub, username };
  }
  return null;
}

function extractTokenFromCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === 'nemo_access_token' && v) return decodeURIComponent(v);
  }
  return null;
}

function randomConnectionId(): string {
  return `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractRaceId(url: string | undefined): string | null {
  if (!url) return null;
  const m = /^\/race\/([^/?#]+)/.exec(url);
  return m?.[1] ?? null;
}

const CLIENT_TS_TOLERANCE_MS = 2000;

function computeEffectiveTs(trigger: OrderTrigger, trustedTs: number): number {
  if (trigger.type === 'AT_TIME' && typeof (trigger as { time: number }).time === 'number') {
    return (trigger as { time: number }).time * 1000;
  }
  return trustedTs;
}

function buildEnvelope(args: {
  rawOrder: Record<string, unknown>;
  clientTs: number;
  clientSeq: number;
  connectionId: string;
  serverNow: number;
}): OrderEnvelope | null {
  const { rawOrder, clientTs, clientSeq, connectionId, serverNow } = args;
  if (typeof rawOrder['type'] !== 'string') return null;
  const trustedTs = Math.abs(serverNow - clientTs) < CLIENT_TS_TOLERANCE_MS ? clientTs : serverNow;
  const trigger = (rawOrder['trigger'] as OrderTrigger) ?? { type: 'IMMEDIATE' };
  const effectiveTs = computeEffectiveTs(trigger, trustedTs);
  const order: Order = {
    id: (rawOrder['id'] as string) ?? `${connectionId}-${clientSeq}`,
    type: rawOrder['type'] as Order['type'],
    value: (rawOrder['value'] as Record<string, unknown>) ?? {},
    trigger,
  };
  return {
    order,
    clientTs,
    clientSeq,
    trustedTs,
    effectiveTs,
    receivedAt: serverNow,
    connectionId,
  };
}

async function main(): Promise<void> {
  let pub: Redis | null = null;
  let sub: Redis | null = null;
  const subbedChannels = new Set<string>();

  if (REDIS_URL) {
    pub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    sub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    pub.on('error', (err) => log.error({ err }, 'redis pub error'));
    sub.on('error', (err) => log.error({ err }, 'redis sub error'));
    log.info({ url: REDIS_URL.replace(/:[^:@]+@/, ':***@') }, 'redis connecté');
  } else {
    log.warn('REDIS_URL absent — gateway ne forwarde rien');
  }

  // --- Serveur HTTP minimal (health + upgrade handler) -------------------
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'ws-gateway', redis: !!REDIS_URL }));
      return;
    }
    res.writeHead(404).end('not found');
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const raceId = extractRaceId(req.url);
    log.info({ url: req.url, raceId }, 'upgrade attempt');
    if (!raceId) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // --- Auth : bearer sub-protocol prioritaire, fallback cookie ---
    let token: string | null = null;
    const protoHeader = req.headers['sec-websocket-protocol'];
    if (typeof protoHeader === 'string') {
      for (const p of protoHeader.split(',')) {
        const t = p.trim();
        if (t.startsWith('bearer.')) { token = t.slice(7); break; }
      }
    }
    if (!token && typeof req.headers.cookie === 'string') {
      token = extractTokenFromCookie(req.headers.cookie);
    }

    const user = token ? verifyToken(token) : null;
    if (!user) {
      log.warn({ raceId, hasProtocol: !!protoHeader, hasCookie: !!req.headers.cookie }, 'auth invalide');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const ctx: ClientCtx = {
        connectionId: randomConnectionId(),
        raceId,
        playerId: user.sub,
        username: user.username,
        boatId: 'demo-boat-1',   // Phase 3 hardcoded ; Phase 4 : lookup boats.active_race_id
        channel: `race:${raceId}:tick`,
        subscribedAt: Date.now(),
      };
      (ws as WebSocket & { ctx: ClientCtx }).ctx = ctx;

      log.info({ conn: ctx.connectionId, raceId, player: ctx.username }, 'ws open');

      // Abonnement Redis partagé au niveau process pour ce canal
      if (sub && !subbedChannels.has(ctx.channel)) {
        sub.subscribe(ctx.channel).catch((err) => log.error({ err, channel: ctx.channel }, 'redis subscribe failed'));
        subbedChannels.add(ctx.channel);
      }

      ws.on('message', (data, isBinary) => {
        if (!isBinary) return;
        const buf = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
        let decoded: Record<string, unknown>;
        try {
          decoded = decode(new Uint8Array(buf)) as Record<string, unknown>;
        } catch (err) {
          log.warn({ err, conn: ctx.connectionId }, 'invalid msgpack frame');
          return;
        }
        if (decoded['type'] === 'ORDER') {
          const payload = (decoded['payload'] as Record<string, unknown>) ?? {};
          const clientTs = Number(payload['clientTs'] ?? payload['ts'] ?? Date.now());
          const clientSeq = Number(payload['clientSeq'] ?? 0);
          const rawOrder = payload['order'] as Record<string, unknown> | undefined;
          if (!rawOrder) {
            log.warn({ conn: ctx.connectionId }, 'malformed ORDER payload');
            return;
          }
          const envelope = buildEnvelope({
            rawOrder,
            clientTs,
            clientSeq,
            connectionId: ctx.connectionId,
            serverNow: Date.now(),
          });
          if (!envelope) {
            log.warn({ conn: ctx.connectionId }, 'malformed ORDER payload');
            return;
          }
          if (!ctx.boatId || !pub) {
            log.warn({ conn: ctx.connectionId, hasBoat: !!ctx.boatId, hasRedis: !!pub }, 'order dropped');
            return;
          }
          pub.publish(`boat:${ctx.boatId}:order`, Buffer.from(encode(envelope)))
            .catch((err) => log.error({ err, boatId: ctx.boatId }, 'publish order failed'));
          log.info({ conn: ctx.connectionId, boat: ctx.boatId, type: envelope.order.type, clientSeq }, 'order forwarded');
          return;
        }

        if (decoded['type'] === 'ORDER_REPLACE_QUEUE') {
          const payload = (decoded['payload'] as Record<string, unknown>) ?? {};
          const clientTs = Number(payload['clientTs'] ?? Date.now());
          const clientSeq = Number(payload['clientSeq'] ?? 0);
          const rawOrders = payload['orders'];
          if (!Array.isArray(rawOrders)) {
            log.warn({ conn: ctx.connectionId }, 'malformed ORDER_REPLACE_QUEUE payload');
            return;
          }
          if (!ctx.boatId || !pub) {
            log.warn({ conn: ctx.connectionId, hasBoat: !!ctx.boatId, hasRedis: !!pub }, 'replace-queue dropped');
            return;
          }
          const serverNow = Date.now();
          const envelopes: OrderEnvelope[] = [];
          for (let i = 0; i < rawOrders.length; i++) {
            const env = buildEnvelope({
              rawOrder: rawOrders[i] as Record<string, unknown>,
              clientTs,
              clientSeq: clientSeq + i, // unique per envelope inside the batch
              connectionId: ctx.connectionId,
              serverNow,
            });
            if (env) envelopes.push(env);
          }
          pub.publish(
            `boat:${ctx.boatId}:replace-queue`,
            Buffer.from(encode({ envelopes })),
          ).catch((err) => log.error({ err, boatId: ctx.boatId }, 'publish replace-queue failed'));
          log.info(
            { conn: ctx.connectionId, boat: ctx.boatId, count: envelopes.length, clientSeq },
            'replace-queue forwarded',
          );
          return;
        }
      });

      ws.on('close', (code) => {
        log.info({ conn: ctx.connectionId, code }, 'ws close');
      });
    });
  });

  // --- Relai Redis → clients WS abonnés au canal --------------------------
  if (sub) {
    sub.on('messageBuffer', (channelBuf, messageBuf) => {
      const channel = channelBuf.toString();
      for (const client of wss.clients) {
        const ctx = (client as WebSocket & { ctx?: ClientCtx }).ctx;
        if (!ctx) continue;
        if (ctx.channel !== channel) continue;
        if (client.readyState !== WebSocket.OPEN) continue;
        client.send(messageBuf, { binary: true });
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    log.info({ port: PORT }, 'ws-gateway listening');
  });
}

main().catch((err) => {
  log.error({ err }, 'fatal');
  process.exit(1);
});
