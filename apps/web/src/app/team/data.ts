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
  'north-sea-offshore': {
    slug: 'north-sea-offshore',
    name: 'North Sea Offshore',
    baseCity: 'Amsterdam',
    country: 'nl',
    foundedYear: 2022,
    description:
      'Collectif néerlando-britannique spécialisé dans les traversées de la mer du Nord et les classiques britanniques. Deux skippers de haut de classement, entraînés aux vents forts et aux marées.',
    captainUsername: 'northwind',
    moderatorUsernames: [],
  },
  'mediterraneo': {
    slug: 'mediterraneo',
    name: 'Mediterraneo',
    baseCity: 'Trieste',
    country: 'it',
    foundedYear: 2021,
    description:
      "Écurie pan-méditerranéenne rassemblant skippers italiens, français et espagnols autour d'un circuit dédié aux régates de golfe et de bassin fermé. Spécialistes du près serré et des brises thermiques.",
    captainUsername: 'bora_c',
    moderatorUsernames: ['mistral'],
  },
  'atlantic-drift': {
    slug: 'atlantic-drift',
    name: 'Atlantic Drift',
    baseCity: 'Galway',
    country: 'ie',
    foundedYear: 2024,
    description:
      "Trio irlando-portugais qui mutualise routage et météo pour les grandes traversées de la façade atlantique. Philosophie : prudence sur la préparation, audace sur le départ.",
    captainUsername: 'galway_bay',
    moderatorUsernames: [],
  },
  'cape-horners': {
    slug: 'cape-horners',
    name: 'Cape Horners',
    baseCity: 'Punta Arenas',
    country: 'cl',
    foundedYear: 2020,
    description:
      "Collectif de grands navigateurs du sud et des hautes latitudes. Réunit des skippers passés par le cap Horn, Tromsø et les Hébrides — formés aux quarantièmes rugissants et aux tempêtes sub-arctiques.",
    captainUsername: 'cap_horn',
    moderatorUsernames: ['hebrides'],
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
    teamRank: getTeamRankBySlug(seed.slug),
    activeClasses,
  };
}

/* =========================================================================
   CLASSEMENT DES ÉQUIPES
   -------------------------------------------------------------------------
   DTO projeté pour `/api/v1/rankings/teams`. Agrège les rankingScore des
   membres de chaque équipe (somme). Le rang est local au tri global.
   ========================================================================= */

export interface TeamRankingEntry {
  rank: number;
  slug: string;
  name: string;
  baseCity: string;
  country: CountryCode;
  countryLabel: string;
  captainUsername: string;
  totalMembers: number;
  totalRankingScore: number;
  totalRacesFinished: number;
  totalPodiums: number;
  bestMemberRank: number | null;
  /** Tendance agrégée — approximée en comptant les "up"/"down" des membres
   *  pour l'instant. À remplacer par un vrai diff semaine sur serveur. */
  trend: { dir: 'up' | 'down' | 'flat'; delta: number };
  /** Vrai si le joueur courant fait partie de cette équipe. */
  isMyTeam?: boolean;
}

/** Agrège puis trie les équipes par rankingScore cumulé descendant. */
export function getTeamsRanking(meUsername: string | null): TeamRankingEntry[] {
  const allPlayersRanking = getRanking('ALL');
  const scoreByUsername = new Map(
    allPlayersRanking.map((r) => [r.username, r] as const),
  );

  const myTeam = meUsername
    ? PLAYERS.find((p) => p.username === meUsername)?.team
    : undefined;

  const rows = Object.values(TEAMS).map((seed): Omit<TeamRankingEntry, 'rank'> => {
    const members = PLAYERS.filter((p) => p.team === seed.name);
    let totalRankingScore = 0;
    let totalRacesFinished = 0;
    let totalPodiums = 0;
    let bestMemberRank: number | null = null;
    let up = 0, down = 0;

    for (const m of members) {
      const r = scoreByUsername.get(m.username);
      if (r) {
        totalRankingScore += r.rankingScore;
        totalRacesFinished += r.racesFinished;
        totalPodiums += r.podiums;
        bestMemberRank = bestMemberRank === null
          ? r.rank
          : Math.min(bestMemberRank, r.rank);
        if (r.trend.dir === 'up') up += r.trend.delta;
        if (r.trend.dir === 'down') down += r.trend.delta;
      }
    }

    const trend: TeamRankingEntry['trend'] =
      up > down ? { dir: 'up', delta: up - down }
      : down > up ? { dir: 'down', delta: down - up }
      : { dir: 'flat', delta: 0 };

    return {
      slug: seed.slug,
      name: seed.name,
      baseCity: seed.baseCity,
      country: seed.country,
      countryLabel: COUNTRY_LABEL[seed.country],
      captainUsername: seed.captainUsername,
      totalMembers: members.length,
      totalRankingScore,
      totalRacesFinished,
      totalPodiums,
      bestMemberRank,
      trend,
      ...(myTeam === seed.name ? { isMyTeam: true } : {}),
    };
  });

  return rows
    .sort((a, b) => b.totalRankingScore - a.totalRankingScore)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Cherche le rang d'une équipe dans le classement agrégé. Null si inconnu. */
function getTeamRankBySlug(slug: string): number | null {
  const ranking = getTeamsRanking(null);
  const entry = ranking.find((r) => r.slug === slug);
  return entry?.rank ?? null;
}
