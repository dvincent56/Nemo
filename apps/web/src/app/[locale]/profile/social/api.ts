/**
 * Stubs API de la page Social. Signatures calquées sur les futurs endpoints
 * Phase 4 (cf. `project_backend_schema_gaps` → tables `friendships`,
 * `invitations`).
 *
 * Les implémentations sont volontairement naïves (filtrage local sur PLAYERS)
 * et introduisent un petit délai pour que l'UX reflète une vraie latence.
 * Le jour où on branche les vrais endpoints, seul le corps change —
 * les composants consommateurs n'ont rien à modifier.
 */

import { PLAYERS, type CountryCode, type Player } from '@/app/[locale]/ranking/data';

export interface SkipperSearchResult {
  username: string;
  city: string;
  country: CountryCode;
  isFriend: boolean;
  /** Est-ce déjà le joueur courant (exclu des résultats). */
  isMe: boolean;
}

async function simulateLatency(ms = 220): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** GET /api/v1/players/search?q=… — recherche floue sur username + city.
 *  Exclut le joueur courant. `meUsername` est nécessaire tant que le BE
 *  ne fait pas l'exclusion via le token. */
export async function searchPlayers(
  q: string,
  meUsername: string | null,
): Promise<SkipperSearchResult[]> {
  await simulateLatency();
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];
  return PLAYERS
    .filter((p: Player) => {
      const name = p.username.toLowerCase();
      const city = p.city.toLowerCase();
      return name.includes(query) || city.includes(query);
    })
    .map((p: Player): SkipperSearchResult => ({
      username: p.username,
      city: p.city,
      country: p.country,
      isFriend: p.isFriend === true,
      isMe: p.isMe === true || p.username === meUsername,
    }))
    .filter((r) => !r.isMe)
    .slice(0, 8);
}

/** POST /api/v1/friendships — envoi une demande d'ami. */
export async function addFriend(_username: string): Promise<void> {
  await simulateLatency();
}

/** DELETE /api/v1/friendships/:username — supprime un ami. */
export async function removeFriend(_username: string): Promise<void> {
  await simulateLatency();
}

/** POST /api/v1/invitations/:id/accept. */
export async function acceptInvitation(_id: string): Promise<void> {
  await simulateLatency();
}

/** POST /api/v1/invitations/:id/refuse. */
export async function refuseInvitation(_id: string): Promise<void> {
  await simulateLatency();
}

/** DELETE /api/v1/invitations/:id — annule une invitation sortante. */
export async function cancelInvitation(_id: string): Promise<void> {
  await simulateLatency();
}
