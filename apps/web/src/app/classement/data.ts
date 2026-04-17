/**
 * Données classement saison — seed temporaire côté client.
 *
 * Modèle aligné sur le schéma Drizzle (apps/game-engine/src/db/schema.ts) :
 *   - `username`, `rankingScore`, `racesFinished`, `podiums`, `wins`,
 *     `top10Finishes` viennent directement de la table `players`.
 *   - Les champs `boatClass`, `points`/races/podiums **par classe** ne
 *     sont pas encore en DB (cf. memory `feedback_mock_models_match_backend`)
 *     — ils nécessiteront une table `player_class_stats` Phase 4.
 *   - Les champs sociaux (`country`, `city`, `dpt`, `region`, `team`,
 *     `isFriend`) ne sont pas encore en DB non plus — ajouts schéma à
 *     prévoir avec la spec Profil + Équipe.
 *
 * Le DTO renvoyé par `/api/v1/rankings/season` aura la forme `SkipperRanking`
 * ci-dessous : on consomme ces données telles quelles côté composant pour
 * pouvoir basculer mock → vraie API en remplaçant uniquement la source.
 */

export type CountryCode = 'fr' | 'nl' | 'it' | 'uk' | 'no' | 'es' | 'ie' | 'pt' | 'cl';
export type BoatClass = 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
export type Trend = { dir: 'up' | 'down' | 'flat'; delta: number };

/** Identité sociale d'un joueur, indépendante des courses qu'il dispute.
 *  Mappe `players` (DB) + futurs champs Profile (country/city/team). */
export interface Player {
  /** `players.username` (DB). */
  username: string;
  /** Futur `profiles.city` (DB). */
  city: string;
  /** Futur `profiles.dpt` (DB) — code INSEE 2 chiffres, '—' si hors France. */
  dpt: string;
  /** Futur `profiles.region` (DB). */
  region: string;
  /** Futur `profiles.country` (DB). */
  country: CountryCode;
  /** Dérivé de `friendships` (à créer). */
  isFriend?: boolean;
  /** Dérivé de `team_members` (à créer). */
  team?: string;
  /** Vrai si le joueur courant — résolu côté front depuis la session. */
  isMe?: boolean;
}

/** Stats agrégées d'un joueur sur une classe. Mappe la future
 *  `player_class_stats` (player_id, boat_class, ranking_score, …). */
export interface PlayerClassStats {
  username: string;
  boatClass: BoatClass;
  rankingScore: number;
  racesFinished: number;
  podiums: number;
  /** Bateau favori du joueur sur cette classe. */
  favoriteBoatName: string;
  trend: Trend;
}

/** DTO renvoyé par `/api/v1/rankings/season` (et par classe).
 *  Le `rank` est calculé côté serveur ou recalculé localement après filtre. */
export interface SkipperRanking {
  rank: number;
  username: string;
  city: string;
  dpt: string;
  region: string;
  country: CountryCode;
  rankingScore: number;
  racesFinished: number;
  podiums: number;
  favoriteBoatName: string;
  trend: Trend;
  /** 'ALL' si cumul toutes classes. */
  boatClass: BoatClass | 'ALL';
  isFriend?: boolean;
  team?: string;
  isMe?: boolean;
}

/* =========================================================================
   PLAYERS — registre social (15 joueurs)
   ========================================================================= */
export const PLAYERS: Player[] = [
  { username: 'laperouse',  city: 'La Trinité',   dpt: '56', region: 'Bretagne',                       country: 'fr', isFriend: true, team: 'La Rochelle Racing' },
  { username: 'northwind',  city: 'Amsterdam',    dpt: '—',  region: 'Hollande-Septentrionale',        country: 'nl', team: 'North Sea Offshore' },
  { username: 'bora_c',     city: 'Trieste',      dpt: '—',  region: 'Frioul-Vénétie julienne',        country: 'it', isFriend: true, team: 'Mediterraneo' },
  { username: 'finistère',  city: 'Brest',        dpt: '29', region: 'Bretagne',                       country: 'fr', team: 'La Rochelle Racing' },
  { username: 'tradewind',  city: 'Cowes',        dpt: '—',  region: 'Île de Wight',                   country: 'uk', isFriend: true, team: 'North Sea Offshore' },
  { username: 'mistral',    city: 'Marseille',    dpt: '13', region: "Provence-Alpes-Côte d'Azur",     country: 'fr', team: 'Mediterraneo' },
  { username: 'cap_horn',   city: 'Punta Arenas', dpt: '—',  region: 'Magallanes',                     country: 'cl', team: 'Cape Horners' },
  { username: 'hebrides',   city: 'Stornoway',    dpt: '—',  region: 'Hébrides extérieures',           country: 'uk', team: 'Cape Horners' },
  { username: 'galway_bay', city: 'Galway',       dpt: '—',  region: 'Connacht',                       country: 'ie', team: 'Atlantic Drift' },
  { username: 'portofino',  city: 'Portofino',    dpt: '—',  region: 'Ligurie',                        country: 'it', team: 'Mediterraneo' },
  { username: 'cascais',    city: 'Cascais',      dpt: '—',  region: 'Lisbonne',                       country: 'pt', team: 'Atlantic Drift' },
  { username: 'vous',       city: 'La Rochelle',  dpt: '17', region: 'Nouvelle-Aquitaine',             country: 'fr', isMe: true, team: 'La Rochelle Racing' },
  { username: 'narvik',     city: 'Narvik',       dpt: '—',  region: 'Nordland',                       country: 'no', team: 'Cape Horners' },
  { username: 'balearic',   city: 'Palma',        dpt: '—',  region: 'Îles Baléares',                  country: 'es', team: 'Mediterraneo' },
  { username: 'donegal',    city: 'Letterkenny',  dpt: '—',  region: 'Ulster',                         country: 'ie', team: 'Atlantic Drift' },
];

/* =========================================================================
   PLAYER_CLASS_STATS — un joueur peut courir dans plusieurs classes.
   ========================================================================= */
export const PLAYER_CLASS_STATS: PlayerClassStats[] = [
  // ── IMOCA 60 ─────────────────────────────────────────────────────
  { username: 'laperouse', boatClass: 'IMOCA60', rankingScore: 4318, racesFinished: 30, podiums: 12, favoriteBoatName: 'Finisterre',  trend: { dir: 'flat', delta: 0 } },
  { username: 'northwind', boatClass: 'IMOCA60', rankingScore: 4082, racesFinished: 28, podiums: 11, favoriteBoatName: 'Noordster',   trend: { dir: 'up',   delta: 1 } },
  { username: 'cascais',   boatClass: 'IMOCA60', rankingScore: 2608, racesFinished: 21, podiums:  4, favoriteBoatName: 'Atlantico',   trend: { dir: 'up',   delta: 4 } },
  { username: 'vous',      boatClass: 'IMOCA60', rankingScore:  720, racesFinished:  8, podiums:  1, favoriteBoatName: 'Nemo I',      trend: { dir: 'up',   delta: 2 } },
  { username: 'finistère', boatClass: 'IMOCA60', rankingScore: 1840, racesFinished: 14, podiums:  3, favoriteBoatName: 'Iroise II',   trend: { dir: 'flat', delta: 0 } },

  // ── CLASS40 ──────────────────────────────────────────────────────
  { username: 'bora_c',    boatClass: 'CLASS40', rankingScore: 3947, racesFinished: 28, podiums:  9, favoriteBoatName: 'Tramontana',  trend: { dir: 'down', delta: 1 } },
  { username: 'tradewind', boatClass: 'CLASS40', rankingScore: 3384, racesFinished: 26, podiums:  7, favoriteBoatName: 'Solent',      trend: { dir: 'flat', delta: 0 } },
  { username: 'hebrides',  boatClass: 'CLASS40', rankingScore: 2984, racesFinished: 24, podiums:  5, favoriteBoatName: 'Lewis',       trend: { dir: 'flat', delta: 0 } },
  { username: 'vous',      boatClass: 'CLASS40', rankingScore: 1420, racesFinished: 22, podiums:  4, favoriteBoatName: 'Nemo',        trend: { dir: 'flat', delta: 0 } },
  { username: 'narvik',    boatClass: 'CLASS40', rankingScore: 2011, racesFinished: 18, podiums:  3, favoriteBoatName: 'Hurtig',      trend: { dir: 'down', delta: 2 } },
  { username: 'laperouse', boatClass: 'CLASS40', rankingScore: 1280, racesFinished: 12, podiums:  2, favoriteBoatName: 'Trinité 40', trend: { dir: 'up',   delta: 1 } },

  // ── FIGARO III ───────────────────────────────────────────────────
  { username: 'finistère',  boatClass: 'FIGARO', rankingScore: 3512, racesFinished: 26, podiums:  8, favoriteBoatName: 'Iroise',      trend: { dir: 'up',   delta: 3 } },
  { username: 'mistral',    boatClass: 'FIGARO', rankingScore: 3221, racesFinished: 24, podiums:  6, favoriteBoatName: 'Bandol',      trend: { dir: 'down', delta: 2 } },
  { username: 'galway_bay', boatClass: 'FIGARO', rankingScore: 2842, racesFinished: 22, podiums:  4, favoriteBoatName: 'Claddagh',    trend: { dir: 'up',   delta: 1 } },
  { username: 'balearic',   boatClass: 'FIGARO', rankingScore: 1988, racesFinished: 18, podiums:  3, favoriteBoatName: 'Mediterra',   trend: { dir: 'flat', delta: 0 } },
  { username: 'vous',       boatClass: 'FIGARO', rankingScore:    0, racesFinished:  6, podiums:  0, favoriteBoatName: 'Nemo Solo',   trend: { dir: 'up',   delta: 0 } },
  { username: 'tradewind',  boatClass: 'FIGARO', rankingScore: 1100, racesFinished: 10, podiums:  1, favoriteBoatName: 'Cowes Solo',  trend: { dir: 'flat', delta: 0 } },

  // ── OCEAN FIFTY ──────────────────────────────────────────────────
  { username: 'portofino', boatClass: 'OCEAN_FIFTY', rankingScore: 2721, racesFinished: 18, podiums: 4, favoriteBoatName: 'Ligure',   trend: { dir: 'down', delta: 1 } },
  { username: 'donegal',   boatClass: 'OCEAN_FIFTY', rankingScore: 1902, racesFinished: 14, podiums: 2, favoriteBoatName: 'Swilly',   trend: { dir: 'up',   delta: 2 } },
  { username: 'bora_c',    boatClass: 'OCEAN_FIFTY', rankingScore: 1240, racesFinished:  9, podiums: 1, favoriteBoatName: 'Adriatic', trend: { dir: 'flat', delta: 0 } },

  // ── ULTIM ────────────────────────────────────────────────────────
  { username: 'cap_horn',  boatClass: 'ULTIM', rankingScore: 3102, racesFinished: 22, podiums: 6, favoriteBoatName: 'Magellan',     trend: { dir: 'up',   delta: 2 } },
  { username: 'laperouse', boatClass: 'ULTIM', rankingScore: 2010, racesFinished: 16, podiums: 3, favoriteBoatName: 'Trinité Max',  trend: { dir: 'flat', delta: 0 } },
];

/** Le contexte du joueur courant (utilisé par le filtre Périmètre). */
export const ME_CONTEXT = {
  city: 'La Rochelle',
  dpt: '17',
  region: 'Nouvelle-Aquitaine',
  country: 'fr' as CountryCode,
  team: 'La Rochelle Racing',
};

export const TOTAL_SKIPPERS = 1287;

export const COUNTRY_LABEL: Record<CountryCode, string> = {
  fr: 'France', nl: 'Pays-Bas', it: 'Italie', uk: 'Royaume-Uni',
  no: 'Norvège', es: 'Espagne', ie: 'Irlande', pt: 'Portugal', cl: 'Chili',
};

/** Profil public consolidé — DTO projeté pour `/api/v1/players/:username`.
 *  Agrège Player + PLAYER_CLASS_STATS + calcul du rang saison. */
export interface PublicProfile {
  username: string;
  city: string;
  country: CountryCode;
  countryLabel: string;
  team?: string;
  memberSince: string;
  tagline?: string;
  isMe?: boolean;
  isFriend?: boolean;
  /** Rang cumulé sur le classement 'ALL' — null si le joueur n'a encore
      aucun résultat. */
  seasonRank: number | null;
  totalRankingScore: number;
  totalRacesFinished: number;
  totalPodiums: number;
  favoriteBoatName: string;
  classes: Array<{
    boatClass: BoatClass;
    rank: number | null;
    rankingScore: number;
    racesFinished: number;
    podiums: number;
    favoriteBoatName: string;
  }>;
}

export function getPublicProfile(username: string): PublicProfile | null {
  const player = PLAYERS.find((p) => p.username === username);
  if (!player) return null;

  const all = getRanking('ALL');
  const overall = all.find((r) => r.username === username);

  const classes: PublicProfile['classes'] = (
    ['FIGARO', 'CLASS40', 'OCEAN_FIFTY', 'IMOCA60', 'ULTIM'] as const
  ).flatMap((bc) => {
    const ranking = getRanking(bc);
    const entry = ranking.find((r) => r.username === username);
    if (!entry) return [];
    return [{
      boatClass: bc,
      rank: entry.rank,
      rankingScore: entry.rankingScore,
      racesFinished: entry.racesFinished,
      podiums: entry.podiums,
      favoriteBoatName: entry.favoriteBoatName,
    }];
  });

  return {
    username: player.username,
    city: player.city,
    country: player.country,
    countryLabel: COUNTRY_LABEL[player.country],
    ...(player.team ? { team: player.team } : {}),
    memberSince: 'mars 2024',
    ...(player.isMe
      ? { tagline: "« Je n'ai jamais autant appris à perdre que depuis ce circuit. »" }
      : {}),
    ...(player.isMe ? { isMe: true } : {}),
    ...(player.isFriend ? { isFriend: true } : {}),
    seasonRank: overall?.rank ?? null,
    totalRankingScore: overall?.rankingScore ?? 0,
    totalRacesFinished: overall?.racesFinished ?? 0,
    totalPodiums: overall?.podiums ?? 0,
    favoriteBoatName: overall?.favoriteBoatName ?? '—',
    classes,
  };
}

/* =========================================================================
   getRanking — dérive le DTO `SkipperRanking[]` depuis le modèle.
   - Pour une classe précise : tri par rankingScore décroissant sur les
     joueurs ayant des résultats dans cette classe.
   - Pour 'ALL' : agrégat par joueur (somme rankingScore/racesFinished/
     podiums). Le bateau favori et la tendance sont ceux de la classe
     dominante du joueur (où il marque le plus de points).
   Le rang renvoyé est local au sous-classement (1, 2, 3 …).
   ========================================================================= */
export function getRanking(boatClass: BoatClass | 'ALL'): SkipperRanking[] {
  if (boatClass === 'ALL') {
    const agg = new Map<string, {
      rankingScore: number; racesFinished: number; podiums: number;
      bestBoat: string; bestBoatScore: number; trend: Trend;
    }>();
    for (const r of PLAYER_CLASS_STATS) {
      const cur = agg.get(r.username) ?? {
        rankingScore: 0, racesFinished: 0, podiums: 0,
        bestBoat: r.favoriteBoatName, bestBoatScore: -1, trend: r.trend,
      };
      cur.rankingScore += r.rankingScore;
      cur.racesFinished += r.racesFinished;
      cur.podiums += r.podiums;
      if (r.rankingScore > cur.bestBoatScore) {
        cur.bestBoatScore = r.rankingScore;
        cur.bestBoat = r.favoriteBoatName;
        cur.trend = r.trend;
      }
      agg.set(r.username, cur);
    }
    const rows = PLAYERS.flatMap((p): SkipperRanking[] => {
      const a = agg.get(p.username);
      if (!a) return [];
      return [{
        ...p, rank: 0,
        rankingScore: a.rankingScore,
        racesFinished: a.racesFinished,
        podiums: a.podiums,
        favoriteBoatName: a.bestBoat,
        trend: a.trend,
        boatClass: 'ALL',
      }];
    });
    return rows
      .sort((x, y) => y.rankingScore - x.rankingScore)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }

  const rows = PLAYER_CLASS_STATS
    .filter((r) => r.boatClass === boatClass)
    .flatMap((r): SkipperRanking[] => {
      const p = PLAYERS.find((x) => x.username === r.username);
      if (!p) return [];
      return [{
        ...p, rank: 0,
        rankingScore: r.rankingScore,
        racesFinished: r.racesFinished,
        podiums: r.podiums,
        favoriteBoatName: r.favoriteBoatName,
        trend: r.trend,
        boatClass: r.boatClass,
      }];
    });
  return rows
    .sort((x, y) => y.rankingScore - x.rankingScore)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
