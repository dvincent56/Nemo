/**
 * Équipes — seed local Phase 3. Les équipes seront persistées en DB dans la
 * table `teams` (cf. memory `project_backend_schema_gaps`) avec membres,
 * rôles (capitaine / modérateur / membre) et invitations.
 *
 * Pour l'instant : PLAYERS.team est un texte libre partagé par les membres,
 * on dérive la liste des membres en filtrant sur ce champ.
 */

import {
  PLAYERS,
  PLAYER_CLASS_STATS,
  getRanking,
  COUNTRY_LABEL,
  type Player,
  type CountryCode,
} from '@/app/classement/data';

export type TeamRole = 'CAPTAIN' | 'MODERATOR' | 'MEMBER';

export interface TeamSeed {
  slug: string;
  name: string;
  baseCity: string;
  country: CountryCode;
  foundedYear: number;
  description: string;
  /** Username du capitaine (FK → players.username). */
  captainUsername: string;
  /** Modérateurs (en plus du capitaine). */
  moderatorUsernames: string[];
}

export const TEAMS: Record<string, TeamSeed> = {
  'la-rochelle-racing': {
    slug: 'la-rochelle-racing',
    name: 'La Rochelle Racing',
    baseCity: 'La Rochelle',
    country: 'fr',
    foundedYear: 2023,
    description:
      "Écurie fondée autour du port des Minimes pour mutualiser les routages et la logistique offshore. Trois membres actifs, une philosophie commune : la régate longue distance, disputée sans compromis sur la préparation.",
    captainUsername: 'laperouse',
    moderatorUsernames: [],
  },
};

export function getTeamSlugForName(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export interface TeamMember {
  username: string;
  city: string;
  country: CountryCode;
  role: TeamRole;
  /** Rang saison toutes classes — null si pas encore classé. */
  seasonRank: number | null;
  rankingScore: number;
  racesFinished: number;
  podiums: number;
  favoriteBoatName: string;
}

export interface TeamProfile {
  slug: string;
  name: string;
  baseCity: string;
  country: CountryCode;
  countryLabel: string;
  foundedYear: number;
  description: string;
  /** Membres triés : capitaine d'abord, puis modérateurs, puis par rangingScore descendant. */
  members: TeamMember[];
  /** Stats agrégées équipe. */
  totalMembers: number;
  totalRankingScore: number;
  totalRacesFinished: number;
  totalPodiums: number;
  /** Meilleur rang saison parmi les membres (ALL). */
  bestMemberRank: number | null;
  /** Rang équipe (dérivé : agrégation de tous les rankingScore membres,
   *  comparé aux autres équipes). null si équipe solo ou unique. */
  teamRank: number | null;
  /** Classes de bateaux disputées par au moins un membre. */
  activeClasses: Array<'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM'>;
}

export function getTeamProfile(slug: string): TeamProfile | null {
  const seed = TEAMS[slug];
  if (!seed) return null;

  const allRanking = getRanking('ALL');
  const rankByUsername = new Map(allRanking.map((r) => [r.username, r] as const));

  const roleFor = (p: Player): TeamRole => {
    if (p.username === seed.captainUsername) return 'CAPTAIN';
    if (seed.moderatorUsernames.includes(p.username)) return 'MODERATOR';
    return 'MEMBER';
  };

  const rawMembers = PLAYERS
    .filter((p) => p.team === seed.name)
    .map((p): TeamMember => {
      const r = rankByUsername.get(p.username);
      return {
        username: p.username,
        city: p.city,
        country: p.country,
        role: roleFor(p),
        seasonRank: r?.rank ?? null,
        rankingScore: r?.rankingScore ?? 0,
        racesFinished: r?.racesFinished ?? 0,
        podiums: r?.podiums ?? 0,
        favoriteBoatName: r?.favoriteBoatName ?? '—',
      };
    });

  const roleWeight = (role: TeamRole): number =>
    role === 'CAPTAIN' ? 0 : role === 'MODERATOR' ? 1 : 2;

  const members = rawMembers.sort((a, b) => {
    const roleDiff = roleWeight(a.role) - roleWeight(b.role);
    if (roleDiff !== 0) return roleDiff;
    return b.rankingScore - a.rankingScore;
  });

  const totalRankingScore = members.reduce((acc, m) => acc + m.rankingScore, 0);
  const totalRacesFinished = members.reduce((acc, m) => acc + m.racesFinished, 0);
  const totalPodiums = members.reduce((acc, m) => acc + m.podiums, 0);
  const bestMemberRank = members.reduce<number | null>((acc, m) => {
    if (m.seasonRank === null) return acc;
    return acc === null ? m.seasonRank : Math.min(acc, m.seasonRank);
  }, null);

  // Classes actives
  const usernames = new Set(members.map((m) => m.username));
  const activeClasses = Array.from(new Set(
    PLAYER_CLASS_STATS.filter((s) => usernames.has(s.username)).map((s) => s.boatClass),
  )) as TeamProfile['activeClasses'];

  return {
    slug: seed.slug,
    name: seed.name,
    baseCity: seed.baseCity,
    country: seed.country,
    countryLabel: COUNTRY_LABEL[seed.country],
    foundedYear: seed.foundedYear,
    description: seed.description,
    members,
    totalMembers: members.length,
    totalRankingScore,
    totalRacesFinished,
    totalPodiums,
    bestMemberRank,
    teamRank: 1, // Seed unique pour l'instant
    activeClasses,
  };
}
