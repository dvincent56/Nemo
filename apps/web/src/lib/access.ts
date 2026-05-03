import type { RaceSummary } from './api';

/**
 * Rôle de la session courante. VISITOR = pas authentifié (lecture seule
 * sur les courses LIVE et FINISHED). PLAYER/ADMIN = authentifié.
 *
 * Source de vérité : cookie `nemo_access_token`. En dev, le token stub
 * `dev.<sub>.<username>` encode un rôle PLAYER par défaut. Pour tester
 * ADMIN, le token sera étendu en Phase 4 (`dev.<sub>.<username>.admin`).
 */
export type Role = 'VISITOR' | 'PLAYER' | 'ADMIN';

export interface SessionContext {
  role: Role;
  username: string | null;
  sub: string | null;
}

export const ANONYMOUS: SessionContext = {
  role: 'VISITOR',
  username: null,
  sub: null,
};

/**
 * Parse le token stub dev. En prod on remplacera par une vérification JWT
 * signée (Cognito), côté serveur exclusivement.
 */
export function parseDevToken(token: string | null | undefined): SessionContext {
  if (!token || !token.startsWith('dev.')) return ANONYMOUS;
  const parts = token.split('.');
  const sub = parts[1];
  const username = parts[2];
  const role = parts[3]?.toUpperCase() as Role | undefined;
  if (!sub || !username) return ANONYMOUS;
  const validRole: Role = role === 'ADMIN' ? 'ADMIN' : 'PLAYER';
  return { role: validRole, username, sub };
}

// ---------------------------------------------------------------------------
// Règles d'accès par écran
// ---------------------------------------------------------------------------

export type AccessMode =
  | { kind: 'play' }           // le joueur peut interagir (orders, sail changes)
  | { kind: 'spectate'; reason: 'not-registered' | 'visitor' | 'finished' }
  | { kind: 'blocked'; reason: 'draft' | 'archived' | 'admin-only' };

export interface AccessDecisionInput {
  race: Pick<RaceSummary, 'status' | 'tierRequired'>;
  session: SessionContext;
  /** A-t-il un `race_participants` pour cette course ? */
  isRegistered: boolean;
}

/**
 * Décide ce qu'un utilisateur peut faire sur une course donnée.
 *
 * Règles :
 *   - DRAFT / ARCHIVED  → bloqué sauf admin
 *   - FINISHED          → spectate ouvert à tous (replay read-only)
 *   - LIVE              → play si inscrit, spectate sinon (y compris visiteur)
 *   - BRIEFING / PUBLISHED → play si inscrit, spectate sinon
 */
export function decideRaceAccess(input: AccessDecisionInput): AccessMode {
  const { race, session, isRegistered } = input;

  if (session.role === 'ADMIN') return { kind: 'play' };

  if (race.status === 'DRAFT') return { kind: 'blocked', reason: 'draft' };
  if (race.status === 'ARCHIVED') return { kind: 'blocked', reason: 'archived' };

  if (race.status === 'FINISHED') {
    return { kind: 'spectate', reason: 'finished' };
  }

  if (isRegistered) return { kind: 'play' };

  if (session.role === 'VISITOR') return { kind: 'spectate', reason: 'visitor' };
  return { kind: 'spectate', reason: 'not-registered' };
}

/**
 * Renvoie un code i18n pour le bandeau spectateur, ou null si inactif.
 * Le composant résout via t(`play.spectate.banner.${code}`).
 */
export function spectateBannerCode(mode: AccessMode): 'visitor' | 'notRegistered' | 'finished' | null {
  if (mode.kind !== 'spectate') return null;
  switch (mode.reason) {
    case 'visitor':        return 'visitor';
    case 'not-registered': return 'notRegistered';
    case 'finished':       return 'finished';
  }
}

// ---------------------------------------------------------------------------
// Lecture du cookie côté client (pour le Topbar / nav adaptatif)
// ---------------------------------------------------------------------------

export function readClientSession(): SessionContext {
  if (typeof document === 'undefined') return ANONYMOUS;
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('nemo_access_token='));
  if (!match) return ANONYMOUS;
  const token = decodeURIComponent(match.slice('nemo_access_token='.length));
  return parseDevToken(token);
}
