/**
 * Marina — flotte du joueur. 1 bateau max par classe, soit 5 slots.
 * Les slots non encore débloqués affichent "À débloquer" + CTA pour
 * aller s'inscrire à une course de la classe correspondante.
 *
 * TODO Phase 4 : brancher sur /api/v1/players/me/boats.
 */

export type BoatClass = 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';

export interface UnlockedBoat {
  kind: 'unlocked';
  id: string;
  class: BoatClass;
  name: string;
  /** "En course · <Race>" | "Au port" | "Au port · neuf" */
  stateLabel: string;
  stateTone: 'inRace' | 'idle' | 'new';
  races: number;
  bestRank: number | null;
  upgrades: number;
  /** Couleur principale de la coque (hex) utilisée dans le mini SVG. */
  hullColor: string;
  /** Couleur secondaire (pont) */
  deckColor?: string;
  /** Numéro de coque (3 chiffres) affiché sur la voile + coque. */
  hullNumber: string;
  /** CTA custom, défaut "Détail bateau". */
  ctaLabel?: string;
}

export interface LockedBoat {
  kind: 'locked';
  class: BoatClass;
}

export type BoatSlot = UnlockedBoat | LockedBoat;

export const CLASS_LABEL: Record<BoatClass, string> = {
  FIGARO: 'Figaro III',
  CLASS40: 'Class40',
  OCEAN_FIFTY: 'Ocean Fifty',
  IMOCA60: 'IMOCA 60',
  ULTIM: 'Ultim',
};

/* =========================================================================
   Détail bateau — modèle + seed pour /marina/[boatId]
   Champs `name`, `boatClass`, `hullColor`, `deckColor`, `hullNumber`,
   `racesCount`, `wins`, `podiums`, `top10Finishes` correspondent à la table
   `boats` Drizzle. Les upgrades et l'historique s'appuient sur de futures
   tables (`boat_upgrades`, `boat_upgrade_variants`, join sur
   `race_participants` pour l'historique) — cf. memory
   `project_backend_schema_gaps`.
   ========================================================================= */

export type UpgradeCategoryKey =
  | 'HULL' | 'RIG' | 'SAILS' | 'FOILS' | 'KEEL' | 'ELECTRONICS';

export interface UpgradeEffect {
  tone: 'gain' | 'malus' | 'neutre' | 'risk';
  label: string;
}

export interface UpgradeMetrics {
  upwind: number;   // Près
  downwind: number; // Portant
  heavy: number;    // Gros temps
  wear: number;     // Usure (affichée en "bad")
}

export interface UpgradeVariant {
  id: string;
  name: string;
  description: string;
  effects: UpgradeEffect[];
  metrics: UpgradeMetrics;
  /** Coût en crédits. `null` = inclus d'origine. */
  costCredits: number | null;
  /** Statut spécial (R&D) — l'état 'equipped' est dérivé de equippedVariantId. */
  status?: 'research';
}

export interface UpgradeCategory {
  key: UpgradeCategoryKey;
  label: string;
  /** ID de la variante actuellement équipée. */
  equippedVariantId: string;
  /** Résumé affiché sur la carte compacte. */
  summaryEffects: UpgradeEffect[];
  variants: UpgradeVariant[];
}

export interface BoatRaceHistoryEntry {
  raceId: string;
  raceName: string;
  raceBoatClass: BoatClass;
  raceDate: string;          // ISO date
  raceDistanceNm: number;
  /** `race_participants.final_rank`. */
  finalRank: number;
  /** Durée course — dérivée de finishedAt - startedAt. */
  durationLabel: string;
  /** Crédits gagnés via cette course (futur `credit_transactions`). */
  creditsEarned: number;
}

export interface BoatDetail {
  id: string;
  boatClass: BoatClass;
  name: string;
  hullNumber: string;
  hullColor: string;
  deckColor: string;
  stateLabel: string;
  stateTone: 'inRace' | 'idle' | 'new';
  /** Phrase d'introduction (contexte d'acquisition, rôle sur le circuit). */
  tagline: string;
  racesCount: number;
  /** Meilleur classement (season + nom de course). */
  bestRank: { position: number; raceName: string; season: number } | null;
  totalNm: number;
  /** Nombre de modules "tuned" sur 6. */
  upgradesTuned: number;
  upgrades: UpgradeCategory[];
  history: BoatRaceHistoryEntry[];
}

export const UPGRADE_LABEL: Record<UpgradeCategoryKey, string> = {
  HULL:        'Carène',
  RIG:         'Mât & gréement',
  SAILS:       'Voiles',
  FOILS:       'Foils & appendices',
  KEEL:        'Quille',
  ELECTRONICS: 'Électronique',
};

export const MARINA_SEED = {
  unlockedCount: 3,
  totalSlots: 5,
  races: 42,
  bestRankSeason: { position: 4, raceName: 'Fastnet Sprint', season: 2025 },
  credits: 12480,
  fleet: [
    {
      kind: 'unlocked', id: 'b-albatros', class: 'FIGARO', name: 'Albatros',
      stateLabel: 'En course · Vendée Express', stateTone: 'inRace',
      races: 24, bestRank: 12, upgrades: 3,
      hullColor: '#1a2840', deckColor: '#c9a227', hullNumber: '208',
    },
    {
      kind: 'unlocked', id: 'b-mistral', class: 'CLASS40', name: 'Mistral',
      stateLabel: 'Au port', stateTone: 'idle',
      races: 12, bestRank: 4, upgrades: 4,
      hullColor: '#1a4d7a', deckColor: '#f5f0e8', hullNumber: '114',
    },
    {
      kind: 'unlocked', id: 'b-sirocco', class: 'OCEAN_FIFTY', name: 'Sirocco',
      stateLabel: 'Au port · neuf', stateTone: 'new',
      races: 0, bestRank: null, upgrades: 0,
      hullColor: '#7b6f5c', deckColor: '#a8a08e', hullNumber: '042',
      ctaLabel: 'Personnaliser',
    },
    { kind: 'locked', class: 'IMOCA60' },
    { kind: 'locked', class: 'ULTIM' },
  ] satisfies BoatSlot[],
};

/* =========================================================================
   BOAT_DETAILS — un enregistrement par bateau débloqué.
   Clés alignées sur `MARINA_SEED.fleet[*].id`.
   ========================================================================= */
export const BOAT_DETAILS: Record<string, BoatDetail> = {
  'b-mistral': {
    id: 'b-mistral',
    boatClass: 'CLASS40',
    name: 'Mistral',
    hullNumber: '114',
    hullColor: '#1a4d7a',
    deckColor: '#f5f0e8',
    stateLabel: 'Au port',
    stateTone: 'idle',
    tagline:
      "Acquis après le podium de Lorient, ton Class40 a parcouru 3 482 milles et reste ton bateau de prédilection sur les transats moyennes.",
    racesCount: 12,
    bestRank: { position: 4, raceName: 'Fastnet Sprint', season: 2025 },
    totalNm: 3482,
    upgradesTuned: 4,
    upgrades: [
      {
        key: 'HULL', label: UPGRADE_LABEL.HULL,
        equippedVariantId: 'hull-standard',
        summaryEffects: [{ tone: 'neutre', label: 'Polyvalente' }],
        variants: [
          { id: 'hull-standard', name: 'Standard', description: "Carène série d'origine. Compromis rigoureux, pensé pour durer.",
            effects: [{ tone: 'neutre', label: 'Polyvalente' }],
            metrics: { upwind: 62, downwind: 58, heavy: 66, wear: 22 }, costCredits: null },
          { id: 'hull-optim', name: 'Optimisée', description: 'Carène allégée et lissée en chantier. Gain sec au près.',
            effects: [{ tone: 'gain', label: 'Près +4%' }, { tone: 'malus', label: 'Usure +8%' }],
            metrics: { upwind: 70, downwind: 60, heavy: 62, wear: 38 }, costCredits: 5400 },
          { id: 'hull-scow', name: 'Scow',        description: 'Étrave large. Impressionnante en reaching, délicate au près.',
            effects: [{ tone: 'gain', label: 'Portant +8%' }, { tone: 'malus', label: 'Près −3%' }],
            metrics: { upwind: 50, downwind: 78, heavy: 58, wear: 45 }, costCredits: 9200 },
          { id: 'hull-proto', name: 'Prototype',  description: 'Carène de compétition issue du bureau d\'études.',
            effects: [{ tone: 'gain', label: 'Toutes allures +6%' }, { tone: 'risk', label: 'Fragilité' }],
            metrics: { upwind: 78, downwind: 80, heavy: 50, wear: 80 }, costCredits: 18600, status: 'research' },
        ],
      },
      {
        key: 'RIG', label: UPGRADE_LABEL.RIG,
        equippedVariantId: 'rig-carbon-hm',
        summaryEffects: [{ tone: 'gain', label: 'Vitesse +3%' }, { tone: 'gain', label: 'Roll −12%' }],
        variants: [
          { id: 'rig-alu', name: 'Aluminium',  description: 'Gréement série. Fiable, sans exigence.',
            effects: [{ tone: 'neutre', label: 'Série' }],
            metrics: { upwind: 58, downwind: 56, heavy: 70, wear: 18 }, costCredits: null },
          { id: 'rig-carbon', name: 'Carbone',  description: 'Mât carbone standard. Gain de raideur et de poids.',
            effects: [{ tone: 'gain', label: 'Vitesse +2%' }],
            metrics: { upwind: 64, downwind: 62, heavy: 64, wear: 30 }, costCredits: 6200 },
          { id: 'rig-carbon-hm', name: 'Carbone HM', description: 'Carbone haut module. Contrôle supérieur dans la brise.',
            effects: [{ tone: 'gain', label: 'Vitesse +3%' }, { tone: 'gain', label: 'Roll −12%' }],
            metrics: { upwind: 70, downwind: 68, heavy: 66, wear: 40 }, costCredits: 11800 },
        ],
      },
      {
        key: 'SAILS', label: UPGRADE_LABEL.SAILS,
        equippedVariantId: 'sails-mylar',
        summaryEffects: [{ tone: 'gain', label: 'Forme stable' }, { tone: 'malus', label: 'Usure +20%' }],
        variants: [
          { id: 'sails-dacron',  name: 'Dacron',       description: 'Voiles de série. Tolérantes, lourdes.',
            effects: [{ tone: 'neutre', label: 'Polyvalent' }],
            metrics: { upwind: 55, downwind: 58, heavy: 70, wear: 20 }, costCredits: null },
          { id: 'sails-mylar',   name: 'Mylar',        description: 'Forme stable sur tout le cadran, très bon pilotage automatique.',
            effects: [{ tone: 'gain', label: 'Forme stable' }, { tone: 'malus', label: 'Usure +20%' }],
            metrics: { upwind: 66, downwind: 64, heavy: 62, wear: 48 }, costCredits: 7800 },
          { id: 'sails-3di',     name: '3Di',          description: 'Membrane thermoformée. Référence absolue, exigeante en entretien.',
            effects: [{ tone: 'gain', label: 'Rendement +8%' }, { tone: 'malus', label: 'Usure +30%' }],
            metrics: { upwind: 74, downwind: 72, heavy: 58, wear: 66 }, costCredits: 14500 },
          { id: 'sails-north',   name: 'Custom North', description: 'Set North Sails sur mesure, optimisé pour ta polaire.',
            effects: [{ tone: 'gain', label: 'Rendement +12%' }],
            metrics: { upwind: 78, downwind: 76, heavy: 56, wear: 70 }, costCredits: 22000, status: 'research' },
        ],
      },
      {
        key: 'FOILS', label: UPGRADE_LABEL.FOILS,
        equippedVariantId: 'foils-c',
        summaryEffects: [{ tone: 'gain', label: 'Vitesse +6% reaching' }, { tone: 'malus', label: 'Près −2%' }],
        variants: [
          { id: 'foils-none',  name: 'Sans foils',     description: "Configuration d'origine. Coque seule dans l'eau, comportement classique.",
            effects: [{ tone: 'neutre', label: 'Série' }],
            metrics: { upwind: 60, downwind: 50, heavy: 65, wear: 25 }, costCredits: null },
          { id: 'foils-c',     name: 'Foils en C',     description: 'Profil polyvalent. Sortie partielle de coque dès 12 nds, gain net au reaching.',
            effects: [{ tone: 'gain', label: 'Vitesse +6%' }, { tone: 'malus', label: 'Près −2%' }],
            metrics: { upwind: 56, downwind: 68, heavy: 55, wear: 42 }, costCredits: 4500 },
          { id: 'foils-s',     name: 'Foils en S',     description: 'Profil agressif type IMOCA. Vol franc dès 14 nds.',
            effects: [{ tone: 'gain', label: 'Portant +14%' }, { tone: 'malus', label: 'Gros temps −10%' }],
            metrics: { upwind: 50, downwind: 82, heavy: 38, wear: 70 }, costCredits: 9800 },
          { id: 'foils-proto', name: 'Foils prototype', description: "Issus de la recherche d'écurie. Performance maximale connue, sollicitation extrême.",
            effects: [{ tone: 'gain', label: 'Portant +22%' }, { tone: 'risk', label: 'Fragilité' }],
            metrics: { upwind: 42, downwind: 96, heavy: 28, wear: 92 }, costCredits: 18000, status: 'research' },
        ],
      },
      {
        key: 'KEEL', label: UPGRADE_LABEL.KEEL,
        equippedVariantId: 'keel-pendulum',
        summaryEffects: [{ tone: 'gain', label: 'Couple redresseur +18%' }, { tone: 'malus', label: 'Usure +12%' }],
        variants: [
          { id: 'keel-fixed',    name: 'Fixe',        description: 'Quille fixe série. Robuste, simple, lente.',
            effects: [{ tone: 'neutre', label: 'Série' }],
            metrics: { upwind: 58, downwind: 54, heavy: 72, wear: 18 }, costCredits: null },
          { id: 'keel-pendulum', name: 'Pendulaire',  description: 'Quille basculante. Gain massif de stabilité et de puissance.',
            effects: [{ tone: 'gain', label: 'Couple +18%' }, { tone: 'malus', label: 'Usure +12%' }],
            metrics: { upwind: 70, downwind: 64, heavy: 66, wear: 44 }, costCredits: 8400 },
          { id: 'keel-canting',  name: 'Canting',     description: 'Quille basculante hydraulique. Réservée aux budgets sérieux.',
            effects: [{ tone: 'gain', label: 'Couple +26%' }, { tone: 'malus', label: 'Usure +18%' }],
            metrics: { upwind: 76, downwind: 70, heavy: 62, wear: 58 }, costCredits: 15200 },
        ],
      },
      {
        key: 'ELECTRONICS', label: UPGRADE_LABEL.ELECTRONICS,
        equippedVariantId: 'elec-race',
        summaryEffects: [{ tone: 'gain', label: 'Cibles polaires précises' }],
        variants: [
          { id: 'elec-base',   name: 'Pack standard',  description: "Instrumentation de base. Lisible, sans analyse.",
            effects: [{ tone: 'neutre', label: 'Série' }],
            metrics: { upwind: 55, downwind: 55, heavy: 60, wear: 10 }, costCredits: null },
          { id: 'elec-race',   name: 'Pack régate',    description: 'Cibles polaires en live, ajustement fin des angles.',
            effects: [{ tone: 'gain', label: 'Cibles polaires' }],
            metrics: { upwind: 66, downwind: 64, heavy: 60, wear: 14 }, costCredits: 5600 },
          { id: 'elec-pro',    name: 'Pack offshore',  description: 'Suite complète B&G H5000 avec routage embarqué.',
            effects: [{ tone: 'gain', label: 'Routage local' }, { tone: 'gain', label: 'Alertes fatigue' }],
            metrics: { upwind: 72, downwind: 70, heavy: 60, wear: 18 }, costCredits: 11200 },
        ],
      },
    ],
    history: [
      { raceId: 'r-fastnet-2025',  raceName: 'Fastnet Sprint',        raceBoatClass: 'CLASS40', raceDate: '2025-08-06', raceDistanceNm:  608, finalRank:  4, durationLabel: '2 j 18 h 42 min', creditsEarned: 1240 },
      { raceId: 'r-tjv-2025',      raceName: 'Transat Jacques Vabre', raceBoatClass: 'CLASS40', raceDate: '2025-11-12', raceDistanceNm: 4350, finalRank: 12, durationLabel: '11 j 04 h 17 min', creditsEarned:  820 },
      { raceId: 'r-cafe-2026',     raceName: 'Route du Café',         raceBoatClass: 'CLASS40', raceDate: '2026-03-24', raceDistanceNm: 2850, finalRank:  7, durationLabel: '8 j 02 h 51 min',  creditsEarned: 1080 },
      { raceId: 'r-drheam-2026',   raceName: 'Drheam Cup',            raceBoatClass: 'CLASS40', raceDate: '2026-02-02', raceDistanceNm: 1062, finalRank: 18, durationLabel: '4 j 14 h 22 min',  creditsEarned:  540 },
      { raceId: 'r-lizard-2026',   raceName: 'Cap Lizard Trophy',     raceBoatClass: 'CLASS40', raceDate: '2026-01-18', raceDistanceNm:  412, finalRank:  9, durationLabel: '1 j 22 h 08 min',  creditsEarned:  720 },
      { raceId: 'r-solitaire-2025',raceName: 'Solitaire du Figaro',   raceBoatClass: 'CLASS40', raceDate: '2025-09-14', raceDistanceNm: 2100, finalRank: 11, durationLabel: '6 j 03 h 44 min',  creditsEarned:  660 },
      { raceId: 'r-armen-2025',    raceName: 'Trophée Armen',         raceBoatClass: 'CLASS40', raceDate: '2025-07-04', raceDistanceNm:  384, finalRank:  6, durationLabel: '1 j 18 h 22 min',  creditsEarned:  860 },
    ],
  },

  'b-albatros': {
    id: 'b-albatros',
    boatClass: 'FIGARO',
    name: 'Albatros',
    hullNumber: '208',
    hullColor: '#1a2840',
    deckColor: '#c9a227',
    stateLabel: 'En course · Vendée Express',
    stateTone: 'inRace',
    tagline: "Ton Figaro III de référence sur les courses sprint. 24 courses à son actif depuis l'acquisition.",
    racesCount: 24,
    bestRank: { position: 12, raceName: 'Solo Maître Coq', season: 2025 },
    totalNm: 5820,
    upgradesTuned: 3,
    upgrades: [
      { key: 'HULL', label: UPGRADE_LABEL.HULL, equippedVariantId: 'hull-standard',
        summaryEffects: [{ tone: 'neutre', label: 'Polyvalente' }],
        variants: [
          { id: 'hull-standard', name: 'Standard', description: 'Carène Figaro série. Monotype strict.',
            effects: [{ tone: 'neutre', label: 'Série' }], metrics: { upwind: 62, downwind: 58, heavy: 66, wear: 22 }, costCredits: null },
        ] },
      { key: 'RIG', label: UPGRADE_LABEL.RIG, equippedVariantId: 'rig-standard',
        summaryEffects: [{ tone: 'neutre', label: 'Série' }],
        variants: [
          { id: 'rig-standard', name: 'Monotype', description: 'Gréement monotype Figaro — non modifiable en Classe.',
            effects: [{ tone: 'neutre', label: 'Série' }], metrics: { upwind: 64, downwind: 62, heavy: 66, wear: 20 }, costCredits: null },
        ] },
      { key: 'SAILS', label: UPGRADE_LABEL.SAILS, equippedVariantId: 'sails-north',
        summaryEffects: [{ tone: 'gain', label: 'Rendement +4%' }],
        variants: [
          { id: 'sails-north', name: 'North Monotype', description: 'Jeu de voiles North certifié Classe Figaro.',
            effects: [{ tone: 'gain', label: 'Rendement +4%' }], metrics: { upwind: 68, downwind: 66, heavy: 62, wear: 40 }, costCredits: 3200 },
        ] },
      { key: 'FOILS', label: UPGRADE_LABEL.FOILS, equippedVariantId: 'foils-none',
        summaryEffects: [{ tone: 'neutre', label: 'Non autorisés' }],
        variants: [
          { id: 'foils-none', name: 'Sans foils', description: 'Les foils sont interdits en Classe Figaro.',
            effects: [{ tone: 'neutre', label: 'Non autorisés' }], metrics: { upwind: 62, downwind: 52, heavy: 66, wear: 22 }, costCredits: null },
        ] },
      { key: 'KEEL', label: UPGRADE_LABEL.KEEL, equippedVariantId: 'keel-fixed',
        summaryEffects: [{ tone: 'neutre', label: 'Série' }],
        variants: [
          { id: 'keel-fixed', name: 'Fixe', description: 'Quille fixe monotype.',
            effects: [{ tone: 'neutre', label: 'Série' }], metrics: { upwind: 60, downwind: 56, heavy: 70, wear: 18 }, costCredits: null },
        ] },
      { key: 'ELECTRONICS', label: UPGRADE_LABEL.ELECTRONICS, equippedVariantId: 'elec-race',
        summaryEffects: [{ tone: 'gain', label: 'Cibles polaires' }],
        variants: [
          { id: 'elec-base', name: 'Pack standard', description: 'Pack de base.',
            effects: [{ tone: 'neutre', label: 'Série' }], metrics: { upwind: 55, downwind: 55, heavy: 60, wear: 10 }, costCredits: null },
          { id: 'elec-race', name: 'Pack régate', description: 'Cibles polaires en live.',
            effects: [{ tone: 'gain', label: 'Cibles polaires' }], metrics: { upwind: 66, downwind: 64, heavy: 60, wear: 14 }, costCredits: 5600 },
        ] },
    ],
    history: [
      { raceId: 'r-solo-mc-2025',  raceName: 'Solo Maître Coq', raceBoatClass: 'FIGARO', raceDate: '2025-05-14', raceDistanceNm: 300, finalRank: 12, durationLabel: '1 j 11 h 48 min', creditsEarned: 580 },
      { raceId: 'r-vendee-2026',   raceName: 'Vendée Express',  raceBoatClass: 'FIGARO', raceDate: '2026-04-12', raceDistanceNm: 240, finalRank: 18, durationLabel: 'En cours',         creditsEarned:   0 },
    ],
  },

  'b-sirocco': {
    id: 'b-sirocco',
    boatClass: 'OCEAN_FIFTY',
    name: 'Sirocco',
    hullNumber: '042',
    hullColor: '#7b6f5c',
    deckColor: '#a8a08e',
    stateLabel: 'Au port · neuf',
    stateTone: 'new',
    tagline: "Trimaran fraîchement livré. Aucune course disputée — à toi de le personnaliser et de l'engager.",
    racesCount: 0,
    bestRank: null,
    totalNm: 0,
    upgradesTuned: 0,
    upgrades: [
      { key: 'HULL', label: UPGRADE_LABEL.HULL, equippedVariantId: 'hull-standard',
        summaryEffects: [{ tone: 'neutre', label: 'Polyvalente' }],
        variants: [
          { id: 'hull-standard', name: 'Standard', description: 'Plateforme OCEAN FIFTY série.',
            effects: [{ tone: 'neutre', label: 'Série' }], metrics: { upwind: 58, downwind: 72, heavy: 54, wear: 22 }, costCredits: null },
        ] },
      { key: 'RIG', label: UPGRADE_LABEL.RIG, equippedVariantId: 'rig-standard',
        summaryEffects: [{ tone: 'neutre', label: 'Série' }],
        variants: [
          { id: 'rig-standard', name: 'Aile rigide', description: "Aile série de l'OCEAN FIFTY.",
            effects: [{ tone: 'neutre', label: 'Série' }], metrics: { upwind: 60, downwind: 74, heavy: 60, wear: 24 }, costCredits: null },
        ] },
      { key: 'SAILS', label: UPGRADE_LABEL.SAILS, equippedVariantId: 'sails-standard',
        summaryEffects: [{ tone: 'neutre', label: 'Série' }],
        variants: [
          { id: 'sails-standard', name: 'Série', description: 'Garde-robe livrée avec le bateau.',
            effects: [{ tone: 'neutre', label: 'Série' }], metrics: { upwind: 58, downwind: 72, heavy: 60, wear: 20 }, costCredits: null },
        ] },
      { key: 'FOILS', label: UPGRADE_LABEL.FOILS, equippedVariantId: 'foils-inbuilt',
        summaryEffects: [{ tone: 'gain', label: 'Vol dès 12 nds' }],
        variants: [
          { id: 'foils-inbuilt', name: 'Foils intégrés', description: 'Foils de série des flotteurs.',
            effects: [{ tone: 'gain', label: 'Vol dès 12 nds' }], metrics: { upwind: 56, downwind: 86, heavy: 48, wear: 52 }, costCredits: null },
        ] },
      { key: 'KEEL', label: UPGRADE_LABEL.KEEL, equippedVariantId: 'keel-none',
        summaryEffects: [{ tone: 'neutre', label: 'Sans quille' }],
        variants: [
          { id: 'keel-none', name: 'Sans quille', description: "Architecture multicoque — pas de quille.",
            effects: [{ tone: 'neutre', label: 'Sans quille' }], metrics: { upwind: 54, downwind: 80, heavy: 50, wear: 15 }, costCredits: null },
        ] },
      { key: 'ELECTRONICS', label: UPGRADE_LABEL.ELECTRONICS, equippedVariantId: 'elec-base',
        summaryEffects: [{ tone: 'neutre', label: 'Standard' }],
        variants: [
          { id: 'elec-base', name: 'Pack standard', description: 'Instrumentation livrée avec le bateau.',
            effects: [{ tone: 'neutre', label: 'Série' }], metrics: { upwind: 55, downwind: 55, heavy: 60, wear: 10 }, costCredits: null },
        ] },
    ],
    history: [],
  },
};

export function getBoatDetail(boatId: string): BoatDetail | null {
  return BOAT_DETAILS[boatId] ?? null;
}
