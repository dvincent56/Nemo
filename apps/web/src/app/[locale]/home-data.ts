/**
 * Modèle de news + seed mocké.
 *
 * En Phase 5 : table `news` en DB + endpoints Fastify `/api/v1/news` + admin
 * UI pour CRUD. Pour l'instant on sert ces seeds via le route handler Next
 * `/api/public/news` (et son /[slug]). Les noms de champs respectent la
 * convention Drizzle (camelCase TS → snake_case en DB).
 *
 * IMPORTANT — anticiper le modèle admin :
 *   - `body` est un tableau de blocs structurés (pas du markdown brut),
 *     pour qu'un éditeur block-based admin (type Notion/Editor.js) puisse
 *     produire ce JSON directement, sans passer par un parser markdown
 *     côté serveur. Chaque bloc a un `type` discriminant.
 *   - Le contenu inline supporte une mini-syntaxe markdown (**bold**,
 *     *italic*, [text](url)) parsée à l'affichage. L'admin la sanitisera
 *     avant stockage.
 */

export type NewsCategory = 'COURSE' | 'BALANCE' | 'INTERVIEW' | 'DEV';

export const CATEGORY_LABEL: Record<NewsCategory, string> = {
  COURSE: 'Course',
  BALANCE: 'Balance',
  INTERVIEW: 'Interview',
  DEV: 'Dev',
};

export type NewsBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'heading'; content: string }
  | { type: 'subheading'; content: string }
  | { type: 'pullquote'; content: string; attribution?: string }
  | { type: 'image'; src: string; alt?: string; caption?: string };

export interface NewsItem {
  id: string;
  slug: string;
  category: NewsCategory;
  title: string;
  /** Preview court (1-2 lignes) pour les cards et meta description. */
  excerpt: string;
  /** Chapeau d'article (2-4 lignes), affiché sous le titre dans la page article. */
  standfirst: string;
  /** Corps de l'article — tableau de blocs typés. */
  body: NewsBlock[];
  /** URL de l'image principale (utilisée à la fois pour les cards et le hero article). */
  imageUrl: string | null;
  imageAlt: string | null;
  imageCaption: string | null;
  /** Temps de lecture estimé en minutes (calculé manuellement à l'admin ou à partir du body). */
  readingTimeMin: number;
  authorName: string;
  authorInitials: string;
  /** Rôle éditorial : "Par", "Propos recueillis par", "Rédaction Nemo"… */
  authorRole: string;
  /** Date de publication ISO (YYYY-MM-DD). */
  publishedAt: string;
}

export const NEWS_SEED: NewsItem[] = [
  {
    id: 'n-001',
    slug: 'transat-double-2026-inscriptions',
    category: 'COURSE',
    title: 'Transat en Double 2026 : inscriptions ouvertes',
    excerpt:
      "Départ le 12 mai depuis Concarneau. 40 binômes Class40 attendus sur une route de 4 200 NM.",
    standfirst:
      "La nouvelle édition de la **Transat en Double** ouvre ses inscriptions. " +
      "Au menu : 40 binômes en Class40, départ Concarneau le 12 mai 2026, arrivée prévue à Saint-François (Guadeloupe).",
    body: [
      {
        type: 'paragraph',
        content:
          "La **Transat en Double 2026** revient avec un format inédit : **40 binômes** au lieu des 30 habituels, et un changement de port d'arrivée. " +
          "Les organisateurs ont confirmé l'inscription officielle ce matin.",
      },
      {
        type: 'heading',
        content: 'Nouveau format, même exigence',
      },
      {
        type: 'paragraph',
        content:
          "Les binômes auront **18 jours** pour rejoindre la Guadeloupe, avec une fenêtre météo qui s'annonce serrée selon les premières analyses GFS. " +
          "La route obligatoire passera par les Açores, avec un waypoint de contrôle au large de Faial.",
      },
      {
        type: 'paragraph',
        content:
          "Les inscriptions sont ouvertes jusqu'au **02 mai 2026**. Tier requis : *Carrière*. La pré-qualification se fait via deux courses Class40 de la saison.",
      },
    ],
    imageUrl:
      'https://images.unsplash.com/photo-1527847263472-aa5338d178b8?auto=format&fit=crop&w=1600&q=80',
    imageAlt: 'Voilier Class40 en navigation',
    imageCaption: "Class40 en route vers Concarneau, mars 2026.",
    readingTimeMin: 3,
    authorName: 'Rédaction Nemo',
    authorInitials: 'RN',
    authorRole: 'Par',
    publishedAt: '2026-04-14',
  },
  {
    id: 'n-002',
    slug: 'v23-ajustement-polaires-imoca',
    category: 'BALANCE',
    title: 'v2.3 — ajustement polaires IMOCA foils',
    excerpt:
      'Réglage du rendement aérodynamique dans la zone 12-14 nds. Changelog complet et données brutes disponibles.',
    standfirst:
      "La version **2.3** affine le comportement des IMOCA à foils dans la zone de transition 12-14 nds. " +
      "Les fichiers polaires bruts restent publics et téléchargeables.",
    body: [
      {
        type: 'paragraph',
        content:
          "Les retours des skippers de la **Vendée Express** ont mis en évidence une légère sur-performance des IMOCA à foils dans la zone 12-14 nds, qui ne correspondait pas aux mesures terrain remontées par les constructeurs.",
      },
      {
        type: 'heading',
        content: 'Ce qui change',
      },
      {
        type: 'paragraph',
        content:
          "Réduction de **0.3 nd** sur le **VMG cible** entre 12 et 14 nds de vent réel, dans les angles 130-150°. Aucun changement en-dessous de 12 nds ni au-dessus de 14 nds.",
      },
      {
        type: 'paragraph',
        content:
          "Les fichiers polaires v2.3 sont disponibles dès maintenant. La courbe complète est consultable [ici](https://nemo.sail/balance/polars).",
      },
    ],
    imageUrl: null,
    imageAlt: null,
    imageCaption: null,
    readingTimeMin: 2,
    authorName: 'Équipe Balance',
    authorInitials: 'EB',
    authorRole: 'Par',
    publishedAt: '2026-04-08',
  },
  {
    id: 'n-003',
    slug: 'laperouse-la-meteo-nest-pas-une-loterie',
    category: 'INTERVIEW',
    title: "Laperouse : « La météo n'est pas une loterie »",
    excerpt:
      'Rencontre avec la n°1 saison 2026 — 7 podiums en 9 courses. Stratégie de routage et lecture des fronts.',
    standfirst:
      "Rencontre avec **Laperouse**, numéro 1 de la saison 2026 — **7 podiums en 9 courses**. " +
      "Stratégie de routage, lecture des fronts, et cette manière très particulière d'attaquer les dépressions au vent.",
    body: [
      {
        type: 'paragraph',
        content:
          "On l'attendait à l'embarcadère, elle est arrivée en avance, sextant sous le bras. Laperouse — **Juliette Pérignon** pour l'état civil — termine sa neuvième course de la saison. Sept podiums dont quatre victoires. Quand on lui demande son secret, elle soupire. *« Il n'y a pas de secret. Juste des fichiers. »*",
      },
      {
        type: 'paragraph',
        content:
          "Dans le cockpit du *Finisterre*, un IMOCA 60 qu'elle skippe depuis le début de la saison 2026, trois écrans : polaire du bateau, GRIB GFS en live, carte tactique. **Les mêmes outils que tous les autres skippers** engagés sur la Vendée Express.",
      },
      {
        type: 'heading',
        content: 'Les fronts, pas les chiffres',
      },
      {
        type: 'paragraph',
        content:
          "Sa lecture de la météo ne commence pas par les chiffres, dit-elle, mais par les **fronts**. *« Tu regardes où ça bouge, où ça meurt, où ça renaît. Un fichier GRIB, c'est une photo — tu dois comprendre le film derrière. »*",
      },
      {
        type: 'pullquote',
        content: "Un fichier GRIB, c'est une photo — tu dois comprendre le film derrière.",
        attribution: 'Laperouse',
      },
      {
        type: 'paragraph',
        content:
          "Elle ouvre son carnet de bord, une application Nemo qu'elle complète manuellement entre les quarts. Chaque décision de routage y est notée avec le **fichier GRIB de référence** au moment du choix. *« Comme ça, si je perds trois heures sur une option, je peux relire : est-ce que j'ai mal lu le fichier, ou est-ce que le fichier a bougé ? »*",
      },
      {
        type: 'image',
        src: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=1400&q=80',
        alt: "Régate — flotte sous spi au large",
        caption: "Vendée Express, J+3 — Laperouse attaque le front au large des Açores.",
      },
      {
        type: 'heading',
        content: 'La saison qui se construit',
      },
      {
        type: 'paragraph',
        content:
          "Avec 7 podiums en 9 courses, elle mène le classement général de la saison, toutes classes confondues. Mais son podium d'**Ocean Fifty** de février a été *« une galère »*, confesse-t-elle. *« J'ai confondu deux dépressions sur la même carte. Je les ai lues comme une seule. J'ai perdu une demi-journée. »*",
      },
      {
        type: 'subheading',
        content: 'Prochaine étape',
      },
      {
        type: 'paragraph',
        content:
          "Son objectif de la fin de saison : un podium sur **Ultim**, la classe la plus exigeante du circuit. *« L'Ultim, c'est autre chose. La polaire est tellement tendue que tu ne peux pas te permettre de te tromper. Ce sera ma Transat en double de juin, avec Rémi. »*",
      },
      {
        type: 'paragraph',
        content:
          "On lui demande, pour finir, ce qu'elle dirait à un nouveau skipper qui débute sur le circuit Nemo. Elle hésite, puis sourit : *« Lis tes fichiers. Pas tes rêves. »*",
      },
    ],
    imageUrl:
      'https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=2400&q=80',
    imageAlt: "Gréement et voiles d'un monocoque offshore",
    imageCaption: "Laperouse à la barre du *Finisterre*, Vendée Express, avril 2026.",
    readingTimeMin: 6,
    authorName: 'Claire Lemay',
    authorInitials: 'CL',
    authorRole: 'Propos recueillis par',
    publishedAt: '2026-04-02',
  },
  {
    id: 'n-004',
    slug: 'nouveau-sextant-tactique',
    category: 'DEV',
    title: 'Nouveau sextant tactique disponible',
    excerpt:
      'Overlay de routage longue distance, intégration directe aux grib GFS et ECMWF. Disponible pour tous les tiers.',
    standfirst:
      "Le **sextant tactique** débarque dans le HUD : routage longue distance, comparaison de modèles GFS / ECMWF, et export des waypoints. " +
      "Disponible pour tous les tiers, sans frais additionnels.",
    body: [
      {
        type: 'paragraph',
        content:
          "Vous l'avez réclamé, le voilà. Le **sextant tactique** est désormais accessible depuis le HUD de toutes les courses du circuit, en mode Libre comme en mode Carrière.",
      },
      {
        type: 'heading',
        content: 'Ce que tu peux faire',
      },
      {
        type: 'paragraph',
        content:
          "Tracer ta route prévisionnelle sur **48 h glissantes**, comparer deux modèles météo (GFS et ECMWF), et exporter ta route en GPX pour la partager avec ton co-skipper.",
      },
      {
        type: 'paragraph',
        content:
          "Aucune fonction n'est cachée derrière un paywall. Le sextant fait partie du tronc commun du jeu.",
      },
    ],
    imageUrl: null,
    imageAlt: null,
    imageCaption: null,
    readingTimeMin: 2,
    authorName: 'Équipe Dev',
    authorInitials: 'ED',
    authorRole: 'Par',
    publishedAt: '2026-03-28',
  },
];

/**
 * Stats hero. Les `liveRaces` et `racersOnWater` seront calculés à partir de
 * `fetchRaces()` en Phase 5 (endpoint `/api/v1/stats/summary`). En attendant :
 * valeurs mock cohérentes avec les seeds existants.
 */
export const HERO_STATS = {
  liveRaces: 3,
  racersOnWater: 428,
  totalRegistered: 12874,
};

/**
 * Formatte une date ISO en `DD MMM YYYY` éditorial français
 * (pas de `toLocaleDateString` ici — on veut un contrôle total du casing).
 */
export function formatNewsDate(iso: string): string {
  const d = new Date(iso);
  const month = d
    .toLocaleDateString('fr-FR', { month: 'short', timeZone: 'Europe/Paris' })
    .replace('.', '');
  return `${String(d.getDate()).padStart(2, '0')} ${month} ${d.getFullYear()}`;
}
