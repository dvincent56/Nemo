# Classement Série — Plan d'implémentation Phase 1 (front mock-driven)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Ajouter un classement "Série" (bateaux sans options) dans la page `/ranking` et dans le panneau classement en course, en mode mock (sans modifications backend).

**Architecture :** Étendre le DTO `SkipperRanking` et la table mock `PLAYER_CLASS_STATS` avec deux champs `rankingScoreSeries` et `racesFinishedSeries`. Étendre la fonction de dérivation `getRanking()` avec un paramètre `config: 'all' | 'series'`. Ajouter un troisième groupe de filtres "Configuration" dans `RankingView`, et une option `Série` dans le `<select>` de `RankingPanel`. Aucune modif backend (les changements schéma + engine sont décrits dans le spec et seront intégrés au plan API à venir).

**Tech Stack :** Next.js 16 (App Router), React 19, TypeScript strict, Vitest + @testing-library/react.

**Référence spec :** [`docs/superpowers/specs/2026-05-01-classement-serie-design.md`](../specs/2026-05-01-classement-serie-design.md)

**Hors scope explicite :**
- Schéma DB (colonnes `rankingScoreSeries`, `racesFinishedSeries`, `wasSeriesConfig` ; table `player_class_stats` réelle).
- Logique de fin de course côté `apps/game-engine`.
- Endpoint API `/api/v1/rankings/season?config=...`.

Ces points sont documentés dans le spec et seront intégrés au plan API quand il sera écrit.

---

## File Structure

**Créés :**
- `apps/web/src/app/ranking/data.test.ts` — tests Vitest pour `getRanking()` avec le paramètre `config`.

**Modifiés :**
- `apps/web/src/app/ranking/data.ts` — extension des interfaces + mocks + signature `getRanking()`.
- `apps/web/src/app/ranking/RankingView.tsx` — ajout du 3ème groupe de filtres `Configuration`.
- `apps/web/src/app/ranking/page.module.css` — éventuel ajustement si la 3ème ligne de filtres ne tient pas (à ne faire que si visuellement nécessaire après essai).
- `apps/web/src/components/play/RankingPanel.tsx` — ajout de l'option `Série` dans le `<select>` + filtrage côté mock.
- `mockups/classement-v1.html` — ajout du 3ème groupe de filtres dans le mockup standalone (référence design).

Chaque fichier reste sous une responsabilité claire : `data.ts` = source mock + dérivation pure, `RankingView.tsx` = UI page, `RankingPanel.tsx` = UI panneau in-race, mockup HTML = référence visuelle hors code.

---

## Task 1 : Étendre les interfaces et les mocks dans `data.ts`

**Files :**
- Modify : `apps/web/src/app/ranking/data.ts`

Le but de cette task est uniquement la mise à jour de la couche données mock. La fonction `getRanking()` n'évolue pas encore (signature inchangée) — Task 2 s'en charge en TDD.

- [ ] **Step 1 : Étendre l'interface `PlayerClassStats`**

Dans `apps/web/src/app/ranking/data.ts`, ajouter deux champs au modèle interne (lignes 49-58 environ) :

```ts
/** Stats agrégées d'un joueur sur une classe. Mappe la future
 *  `player_class_stats` (player_id, boat_class, ranking_score, …). */
export interface PlayerClassStats {
  username: string;
  boatClass: BoatClass;
  rankingScore: number;
  racesFinished: number;
  /** ELO Série pour cette classe (mock — backend Phase 2). */
  rankingScoreSeries: number;
  /** Nombre de courses finies en config Série dans cette classe (mock). */
  racesFinishedSeries: number;
  podiums: number;
  favoriteBoatName: string;
  trend: Trend;
}
```

- [ ] **Step 2 : Étendre l'interface `SkipperRanking`**

Ajouter les deux mêmes champs au DTO (lignes 62-79 environ) :

```ts
export interface SkipperRanking {
  rank: number;
  username: string;
  city: string;
  dpt: string;
  region: string;
  country: CountryCode;
  rankingScore: number;
  racesFinished: number;
  rankingScoreSeries: number;
  racesFinishedSeries: number;
  podiums: number;
  favoriteBoatName: string;
  trend: Trend;
  boatClass: BoatClass | 'ALL';
  isFriend?: boolean;
  team?: string;
  isMe?: boolean;
}
```

- [ ] **Step 3 : Étendre les entrées mock `PLAYER_CLASS_STATS`**

Mettre à jour chaque entrée du tableau `PLAYER_CLASS_STATS` (lignes 105-137 environ). Logique :

- Pour ~60 % des entrées : ajouter `rankingScoreSeries` à environ 30-50 % du score Open (joueurs qui ont fait quelques courses en stock), et `racesFinishedSeries` à environ 20-40 % de `racesFinished`.
- Pour ~40 % des entrées : `rankingScoreSeries: 1500` (placement neutre) et `racesFinishedSeries: 0` (jamais couru en Série) — ces joueurs ne doivent PAS apparaître dans le classement Série.
- Le joueur `vous` doit apparaître en Série pour au moins une classe (sinon "Ta position" disparaît dans la vue Série).

Exemple de mise à jour pour les premières entrées :

```ts
export const PLAYER_CLASS_STATS: PlayerClassStats[] = [
  // ── IMOCA 60 ─────────────────────────────────────────────────────
  { username: 'laperouse', boatClass: 'IMOCA60', rankingScore: 4318, racesFinished: 30, rankingScoreSeries: 1820, racesFinishedSeries: 11, podiums: 12, favoriteBoatName: 'Finisterre',  trend: { dir: 'flat', delta: 0 } },
  { username: 'northwind', boatClass: 'IMOCA60', rankingScore: 4082, racesFinished: 28, rankingScoreSeries: 1500, racesFinishedSeries:  0, podiums: 11, favoriteBoatName: 'Noordster',   trend: { dir: 'up',   delta: 1 } },
  { username: 'cascais',   boatClass: 'IMOCA60', rankingScore: 2608, racesFinished: 21, rankingScoreSeries: 1640, racesFinishedSeries:  6, podiums:  4, favoriteBoatName: 'Atlantico',   trend: { dir: 'up',   delta: 4 } },
  { username: 'vous',      boatClass: 'IMOCA60', rankingScore:  720, racesFinished:  8, rankingScoreSeries: 1380, racesFinishedSeries:  3, podiums:  1, favoriteBoatName: 'Nemo I',      trend: { dir: 'up',   delta: 2 } },
  { username: 'finistère', boatClass: 'IMOCA60', rankingScore: 1840, racesFinished: 14, rankingScoreSeries: 1500, racesFinishedSeries:  0, podiums:  3, favoriteBoatName: 'Iroise II',   trend: { dir: 'flat', delta: 0 } },

  // ── CLASS40 ──────────────────────────────────────────────────────
  { username: 'bora_c',    boatClass: 'CLASS40', rankingScore: 3947, racesFinished: 28, rankingScoreSeries: 1720, racesFinishedSeries:  9, podiums:  9, favoriteBoatName: 'Tramontana',  trend: { dir: 'down', delta: 1 } },
  { username: 'tradewind', boatClass: 'CLASS40', rankingScore: 3384, racesFinished: 26, rankingScoreSeries: 1500, racesFinishedSeries:  0, podiums:  7, favoriteBoatName: 'Solent',      trend: { dir: 'flat', delta: 0 } },
  { username: 'hebrides',  boatClass: 'CLASS40', rankingScore: 2984, racesFinished: 24, rankingScoreSeries: 1610, racesFinishedSeries:  7, podiums:  5, favoriteBoatName: 'Lewis',       trend: { dir: 'flat', delta: 0 } },
  { username: 'vous',      boatClass: 'CLASS40', rankingScore: 1420, racesFinished: 22, rankingScoreSeries: 1500, racesFinishedSeries:  0, podiums:  4, favoriteBoatName: 'Nemo',        trend: { dir: 'flat', delta: 0 } },
  { username: 'narvik',    boatClass: 'CLASS40', rankingScore: 2011, racesFinished: 18, rankingScoreSeries: 1490, racesFinishedSeries:  4, podiums:  3, favoriteBoatName: 'Hurtig',      trend: { dir: 'down', delta: 2 } },
  { username: 'laperouse', boatClass: 'CLASS40', rankingScore: 1280, racesFinished: 12, rankingScoreSeries: 1500, racesFinishedSeries:  0, podiums:  2, favoriteBoatName: 'Trinité 40', trend: { dir: 'up',   delta: 1 } },

  // ── FIGARO III ───────────────────────────────────────────────────
  { username: 'finistère',  boatClass: 'FIGARO', rankingScore: 3512, racesFinished: 26, rankingScoreSeries: 1690, racesFinishedSeries:  8, podiums:  8, favoriteBoatName: 'Iroise',      trend: { dir: 'up',   delta: 3 } },
  { username: 'mistral',    boatClass: 'FIGARO', rankingScore: 3221, racesFinished: 24, rankingScoreSeries: 1580, racesFinishedSeries:  6, podiums:  6, favoriteBoatName: 'Bandol',      trend: { dir: 'down', delta: 2 } },
  { username: 'galway_bay', boatClass: 'FIGARO', rankingScore: 2842, racesFinished: 22, rankingScoreSeries: 1500, racesFinishedSeries:  0, podiums:  4, favoriteBoatName: 'Claddagh',    trend: { dir: 'up',   delta: 1 } },
  { username: 'balearic',   boatClass: 'FIGARO', rankingScore: 1988, racesFinished: 18, rankingScoreSeries: 1620, racesFinishedSeries:  9, podiums:  3, favoriteBoatName: 'Mediterra',   trend: { dir: 'flat', delta: 0 } },
  { username: 'vous',       boatClass: 'FIGARO', rankingScore:    0, racesFinished:  6, rankingScoreSeries: 1500, racesFinishedSeries:  0, podiums:  0, favoriteBoatName: 'Nemo Solo',   trend: { dir: 'up',   delta: 0 } },
  { username: 'tradewind',  boatClass: 'FIGARO', rankingScore: 1100, racesFinished: 10, rankingScoreSeries: 1430, racesFinishedSeries:  3, podiums:  1, favoriteBoatName: 'Cowes Solo',  trend: { dir: 'flat', delta: 0 } },

  // ── OCEAN FIFTY ──────────────────────────────────────────────────
  { username: 'portofino', boatClass: 'OCEAN_FIFTY', rankingScore: 2721, racesFinished: 18, rankingScoreSeries: 1500, racesFinishedSeries: 0, podiums: 4, favoriteBoatName: 'Ligure',   trend: { dir: 'down', delta: 1 } },
  { username: 'donegal',   boatClass: 'OCEAN_FIFTY', rankingScore: 1902, racesFinished: 14, rankingScoreSeries: 1540, racesFinishedSeries: 5, podiums: 2, favoriteBoatName: 'Swilly',   trend: { dir: 'up',   delta: 2 } },
  { username: 'bora_c',    boatClass: 'OCEAN_FIFTY', rankingScore: 1240, racesFinished:  9, rankingScoreSeries: 1500, racesFinishedSeries: 0, podiums: 1, favoriteBoatName: 'Adriatic', trend: { dir: 'flat', delta: 0 } },

  // ── ULTIM ────────────────────────────────────────────────────────
  { username: 'cap_horn',  boatClass: 'ULTIM', rankingScore: 3102, racesFinished: 22, rankingScoreSeries: 1660, racesFinishedSeries: 7, podiums: 6, favoriteBoatName: 'Magellan',     trend: { dir: 'up',   delta: 2 } },
  { username: 'laperouse', boatClass: 'ULTIM', rankingScore: 2010, racesFinished: 16, rankingScoreSeries: 1500, racesFinishedSeries: 0, podiums: 3, favoriteBoatName: 'Trinité Max',  trend: { dir: 'flat', delta: 0 } },
];
```

(Reproduire ces valeurs telles quelles. Les entrées avec `racesFinishedSeries: 0` rendent le filtre Série visible : ces joueurs disparaîtront du classement Série.)

- [ ] **Step 4 : Vérifier que le typecheck passe sans modifier `getRanking()`**

```bash
pnpm --filter @nemo/web typecheck
```

Attendu : succès. La fonction `getRanking()` actuelle continue de produire des `SkipperRanking` valides — TypeScript se plaindra qu'il manque `rankingScoreSeries` et `racesFinishedSeries` dans les objets renvoyés. Les fixer dans cette task aussi : dans `getRanking()`, ajouter ces deux champs aux objets construits, en propageant les valeurs des stats sources.

Dans le bloc `if (boatClass === 'ALL')` (lignes ~236-272), ajouter à l'agrégat :

```ts
const cur = agg.get(r.username) ?? {
  rankingScore: 0, racesFinished: 0, podiums: 0,
  rankingScoreSeries: 0, racesFinishedSeries: 0,
  bestBoat: r.favoriteBoatName, bestBoatScore: -1, trend: r.trend,
};
cur.rankingScore += r.rankingScore;
cur.racesFinished += r.racesFinished;
cur.rankingScoreSeries += r.rankingScoreSeries;
cur.racesFinishedSeries += r.racesFinishedSeries;
cur.podiums += r.podiums;
```

Et dans la projection finale :

```ts
return [{
  ...p, rank: 0,
  rankingScore: a.rankingScore,
  racesFinished: a.racesFinished,
  rankingScoreSeries: a.rankingScoreSeries,
  racesFinishedSeries: a.racesFinishedSeries,
  podiums: a.podiums,
  favoriteBoatName: a.bestBoat,
  trend: a.trend,
  boatClass: 'ALL',
}];
```

Dans la branche par classe (lignes ~274-291), ajouter pareillement :

```ts
return [{
  ...p, rank: 0,
  rankingScore: r.rankingScore,
  racesFinished: r.racesFinished,
  rankingScoreSeries: r.rankingScoreSeries,
  racesFinishedSeries: r.racesFinishedSeries,
  podiums: r.podiums,
  favoriteBoatName: r.favoriteBoatName,
  trend: r.trend,
  boatClass: r.boatClass,
}];
```

Re-lancer le typecheck :

```bash
pnpm --filter @nemo/web typecheck
```

Attendu : succès.

- [ ] **Step 5 : Vérifier le rendu local**

```bash
pnpm --filter @nemo/web dev
```

Ouvrir `http://localhost:3000/ranking` (ou le port indiqué). La page doit s'afficher exactement comme avant l'extension (les nouveaux champs sont présents en mémoire mais pas encore consommés par l'UI).

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/app/ranking/data.ts
git commit -m "feat(ranking): extend mock data with Série fields (rankingScoreSeries, racesFinishedSeries)"
```

---

## Task 2 : TDD — paramètre `config` sur `getRanking()`

**Files :**
- Create : `apps/web/src/app/ranking/data.test.ts`
- Modify : `apps/web/src/app/ranking/data.ts`

- [ ] **Step 1 : Écrire le test qui échoue (filtre Série par classe)**

Créer `apps/web/src/app/ranking/data.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { getRanking } from './data';

describe('getRanking — filtre Configuration', () => {
  it('config="all" par défaut : renvoie tous les joueurs avec des stats dans la classe, triés par rankingScore', () => {
    const rows = getRanking('IMOCA60');
    expect(rows.length).toBeGreaterThan(0);
    // tri décroissant par rankingScore
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].rankingScore).toBeGreaterThanOrEqual(rows[i].rankingScore);
    }
  });

  it('config="series" : ne renvoie que les joueurs avec racesFinishedSeries > 0, triés par rankingScoreSeries', () => {
    const rows = getRanking('IMOCA60', 'series');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.racesFinishedSeries).toBeGreaterThan(0);
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].rankingScoreSeries).toBeGreaterThanOrEqual(rows[i].rankingScoreSeries);
    }
  });

  it('config="series" sur "ALL" : agrège rankingScoreSeries + racesFinishedSeries toutes classes', () => {
    const rows = getRanking('ALL', 'series');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.racesFinishedSeries).toBeGreaterThan(0);
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].rankingScoreSeries).toBeGreaterThanOrEqual(rows[i].rankingScoreSeries);
    }
  });

  it('config="series" exclut les joueurs avec racesFinishedSeries === 0', () => {
    const rowsAll = getRanking('IMOCA60', 'all');
    const rowsSeries = getRanking('IMOCA60', 'series');
    // Au moins un joueur (mock) a racesFinishedSeries === 0 sur IMOCA60 → la liste Série est plus courte
    expect(rowsSeries.length).toBeLessThan(rowsAll.length);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @nemo/web test data.test
```

Attendu : `getRanking('IMOCA60', 'series')` lève une erreur TypeScript ou échoue en runtime parce que la signature ne prend pas encore de second paramètre.

- [ ] **Step 3 : Étendre la signature et la logique de `getRanking()`**

Dans `apps/web/src/app/ranking/data.ts`, modifier la signature et le corps :

```ts
export type RankingConfig = 'all' | 'series';

export function getRanking(
  boatClass: BoatClass | 'ALL',
  config: RankingConfig = 'all',
): SkipperRanking[] {
  if (boatClass === 'ALL') {
    // … (agrégation inchangée — déjà ajouté en Task 1)

    const rows = PLAYERS.flatMap((p): SkipperRanking[] => {
      const a = agg.get(p.username);
      if (!a) return [];
      return [{
        ...p, rank: 0,
        rankingScore: a.rankingScore,
        racesFinished: a.racesFinished,
        rankingScoreSeries: a.rankingScoreSeries,
        racesFinishedSeries: a.racesFinishedSeries,
        podiums: a.podiums,
        favoriteBoatName: a.bestBoat,
        trend: a.trend,
        boatClass: 'ALL',
      }];
    });

    const filtered = config === 'series'
      ? rows.filter((r) => r.racesFinishedSeries > 0)
      : rows;
    const scoreKey: keyof SkipperRanking = config === 'series'
      ? 'rankingScoreSeries'
      : 'rankingScore';

    return filtered
      .sort((x, y) => (y[scoreKey] as number) - (x[scoreKey] as number))
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
        rankingScoreSeries: r.rankingScoreSeries,
        racesFinishedSeries: r.racesFinishedSeries,
        podiums: r.podiums,
        favoriteBoatName: r.favoriteBoatName,
        trend: r.trend,
        boatClass: r.boatClass,
      }];
    });

  const filtered = config === 'series'
    ? rows.filter((r) => r.racesFinishedSeries > 0)
    : rows;
  const scoreKey: keyof SkipperRanking = config === 'series'
    ? 'rankingScoreSeries'
    : 'rankingScore';

  return filtered
    .sort((x, y) => (y[scoreKey] as number) - (x[scoreKey] as number))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

```bash
pnpm --filter @nemo/web test data.test
```

Attendu : 4 tests passent.

- [ ] **Step 5 : Vérifier que `getPublicProfile()` continue de fonctionner**

`getPublicProfile()` appelle `getRanking('ALL')` et `getRanking(bc)` sans second argument — le défaut `'all'` doit préserver le comportement existant. Lancer toute la suite test pour confirmer aucune régression :

```bash
pnpm --filter @nemo/web test
pnpm --filter @nemo/web typecheck
```

Attendu : tous les tests passent, typecheck passe.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/app/ranking/data.ts apps/web/src/app/ranking/data.test.ts
git commit -m "feat(ranking): add config param to getRanking() for Série filtering"
```

---

## Task 3 : Ajouter le filtre Configuration dans `RankingView`

**Files :**
- Modify : `apps/web/src/app/ranking/RankingView.tsx`

- [ ] **Step 1 : Importer le type `RankingConfig` et ajouter les options Configuration**

Dans `apps/web/src/app/ranking/RankingView.tsx`, étendre l'import depuis `./data` (ligne 7) pour récupérer le type `RankingConfig` défini en Task 2 :

```ts
import { ME_CONTEXT, getRanking, type BoatClass, type RankingConfig, type SkipperRanking } from './data';
```

Puis, après la déclaration de `SCOPE_OPTIONS` (ligne ~32), ajouter :

```ts
const CONFIG_OPTIONS: { value: RankingConfig; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'series', label: 'Série' },
];
```

- [ ] **Step 2 : Ajouter l'état `config` au composant**

Au début du composant `RankingView`, après `const [scope, setScope]` (ligne ~66), ajouter :

```ts
const [config, setConfig] = useState<RankingConfig>('all');
```

- [ ] **Step 3 : Passer `config` à `getRanking()`**

Modifier la dépendance de `useMemo` qui calcule `rows` (ligne ~77) :

```ts
const rows = useMemo(() => {
  const base = getRanking(classFilter, config);
  const filtered = base.filter((r) => {
    // … (inchangé, switch sur scope)
  });
  return filtered.map((r, i) => ({ ...r, rank: i + 1 }));
}, [classFilter, scope, config]);
```

- [ ] **Step 4 : Reset de la pagination sur changement de `config`**

Modifier le `useEffect` de reset page (ligne ~95) :

```ts
useEffect(() => { setPage(1); }, [classFilter, scope, config]);
```

- [ ] **Step 5 : Rendre le 3ème groupe de filtres**

Dans le bloc `<div className={styles.filters}>` (ligne ~160), ajouter un troisième `<div className={styles.filterGroup}>` après celui de Périmètre :

```tsx
<div className={styles.filters}>
  <div className={styles.filterGroup}>
    <p className={styles.filterLabel}>Classe</p>
    {/* … inchangé … */}
  </div>
  <div className={styles.filterGroup}>
    <p className={styles.filterLabel}>Périmètre</p>
    {/* … inchangé … */}
  </div>
  <div className={styles.filterGroup}>
    <p className={styles.filterLabel}>Configuration</p>
    {CONFIG_OPTIONS.map((c) => (
      <button
        key={c.value}
        type="button"
        className={`${styles.filterTab} ${c.value === config ? styles.filterTabActive : ''}`}
        onClick={() => setConfig(c.value)}
      >
        {c.label}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 6 : Adapter le sous-titre de section quand `config === 'series'`**

Modifier le paragraphe `<p className={styles.heroMeta}>` (ligne ~115) pour distinguer Open et Série :

```tsx
<p className={styles.heroMeta}>
  {config === 'series' ? (
    <>
      Classement <strong>Série</strong> — uniquement les performances réalisées
      avec un bateau strictement au défaut. <strong>{rows.length.toLocaleString('fr-FR')} skippers</strong> éligibles
      sur le sous-classement courant.
    </>
  ) : (
    <>
      Rang cumulé sur l'ensemble des courses de la saison, toutes classes
      confondues. <strong>{totalSkippers.toLocaleString('fr-FR')} skippers</strong> actifs
      sur le circuit.
    </>
  )}
</p>
```

- [ ] **Step 7 : Vérifier le typecheck et le lint**

```bash
pnpm --filter @nemo/web typecheck
pnpm --filter @nemo/web lint
```

Attendu : pas d'erreur. (Warnings acceptables — cf. mémoire `feedback_lint_warnings_acceptable`.)

- [ ] **Step 8 : Vérifier visuellement le rendu**

```bash
pnpm --filter @nemo/web dev
```

Ouvrir `http://localhost:3000/ranking` :
- Le 3ème groupe de filtres "Configuration" est visible avec deux onglets `Toutes` (actif) et `Série`.
- Cliquer `Série` → la liste se met à jour, le sous-titre change, les joueurs avec `racesFinishedSeries: 0` disparaissent.
- Combiner avec `Classe = IMOCA 60` et `Périmètre = Amis` → la liste est filtrée correctement.
- Le podium et "Ta position" se recalculent sur le sous-classement Série.
- Pagination revient à la page 1 quand on change de Configuration.

- [ ] **Step 9 : Commit**

```bash
git add apps/web/src/app/ranking/RankingView.tsx
git commit -m "feat(ranking): add Configuration filter (Toutes / Série) to RankingView"
```

---

## Task 4 : Ajouter l'option Série dans le `<select>` de `RankingPanel`

**Files :**
- Modify : `apps/web/src/components/play/RankingPanel.tsx`

- [ ] **Step 1 : Étendre le mock `MOCK_RANKING` avec un flag `isSeriesConfig`**

Dans `apps/web/src/components/play/RankingPanel.tsx` (lignes 8-24), ajouter le flag à chaque entrée. Logique : ~50 % des bateaux sont en config Série dans le mock. Le bateau `@vous` doit être en Série pour que l'utilisateur se voie dans la liste filtrée.

```ts
const MOCK_RANKING = [
  { pos:  1, name: '@laperouse',  flag: '🇫🇷', dtf: 1524, isSeriesConfig: false },
  { pos:  2, name: '@northwind',  flag: '🇳🇱', dtf: 1538, isSeriesConfig: true  },
  { pos:  3, name: '@bora_c',     flag: '🇮🇹', dtf: 1552, isSeriesConfig: false },
  { pos:  4, name: '@finistere',  flag: '🇫🇷', dtf: 1561, isSeriesConfig: true  },
  { pos:  5, name: '@tradewind',  flag: '🇬🇧', dtf: 1574, isSeriesConfig: false },
  { pos:  6, name: '@mistral',    flag: '🇫🇷', dtf: 1588, isSeriesConfig: true  },
  { pos:  7, name: '@cap_horn',   flag: '🇨🇱', dtf: 1601, isSeriesConfig: false },
  { pos:  8, name: '@hebrides',   flag: '🇬🇧', dtf: 1612, isSeriesConfig: true  },
  { pos:  9, name: '@galway_bay', flag: '🇮🇪', dtf: 1624, isSeriesConfig: true  },
  { pos: 10, name: '@portofino',  flag: '🇮🇹', dtf: 1631, isSeriesConfig: false },
  { pos: 11, name: '@bay_biscay', flag: '🇪🇸', dtf: 1638, isSeriesConfig: true  },
  { pos: 12, name: '@vous',       flag: '🇫🇷', dtf: 1642, isMe: true, isSeriesConfig: true },
  { pos: 13, name: '@aurora',     flag: '🇳🇴', dtf: 1651, isSeriesConfig: false },
  { pos: 14, name: '@south_wind', flag: '🇵🇹', dtf: 1668, isSeriesConfig: true  },
  { pos: 15, name: '@meridian',   flag: '🇫🇷', dtf: 1682, isSeriesConfig: false },
];
```

- [ ] **Step 2 : Étendre le filtrage pour inclure le mode Série**

Modifier la dérivation `filtered` (ligne ~31) :

```ts
const filtered = (() => {
  let base = MOCK_RANKING;
  if (filter === 'series') {
    base = base.filter((r) => r.isSeriesConfig);
  }
  if (search) {
    base = base.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
  }
  return base;
})();
```

- [ ] **Step 3 : Ajouter l'option `Série` dans le `<select>` avec un séparateur**

Modifier le `<select>` (lignes 51-57) :

```tsx
<select className={styles.filterSelect} value={filter} onChange={(e) => setFilter(e.target.value)}>
  <option value="general">Général · {MOCK_RANKING.length} skippers</option>
  <option value="friends">Mes amis</option>
  <option value="team">Mon équipe</option>
  <option value="city">Ma ville</option>
  <option value="country">Mon pays</option>
  <option disabled>──────</option>
  <option value="series">Série · {MOCK_RANKING.filter((r) => r.isSeriesConfig).length} skippers</option>
</select>
```

- [ ] **Step 4 : Vérifier le typecheck et le lint**

```bash
pnpm --filter @nemo/web typecheck
pnpm --filter @nemo/web lint
```

Attendu : pas d'erreur.

- [ ] **Step 5 : Vérifier visuellement dans le jeu**

```bash
pnpm --filter @nemo/web dev
```

Ouvrir une course en local (`/play/<raceId>`), ouvrir le panneau Classement :
- Le `<select>` contient bien une option `Série · N skippers` après un séparateur.
- Sélectionner `Série` → la liste se réduit aux bateaux marqués `isSeriesConfig: true`. `@vous` est toujours visible.
- Repasser à `Général` → la liste complète revient.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/components/play/RankingPanel.tsx
git commit -m "feat(play): add Série option to in-race ranking filter"
```

---

## Task 5 : Mettre à jour le mockup de référence `classement-v1.html`

**Files :**
- Modify : `mockups/classement-v1.html`

Le projet pratique le workflow "mockups validés → intégration". Cette task aligne le mockup standalone avec ce qu'on vient d'intégrer en code, pour que `classement-v1.html` reste la référence à jour pour de futures itérations.

- [ ] **Step 1 : Ajouter le 3ème groupe de filtres dans le mockup**

Dans `mockups/classement-v1.html`, après le bloc `<div class="filter-group">` Périmètre (vers la ligne 853-854), ajouter :

```html
<div class="filter-group">
  <p class="filter-label">Configuration</p>
  <button class="filter-tab active">Toutes</button>
  <button class="filter-tab">Série</button>
</div>
```

(Reproduire exactement les deux boutons. Aucune modif CSS nécessaire — la classe `.filter-group` gère déjà le wrap responsive.)

- [ ] **Step 2 : Ouvrir le mockup dans le navigateur pour vérifier le rendu**

Ouvrir `mockups/classement-v1.html` directement dans le navigateur (file://) ou via un serveur statique. Vérifier que les trois groupes de filtres s'affichent bien sur desktop et mobile (resize).

- [ ] **Step 3 : Commit**

```bash
git add mockups/classement-v1.html
git commit -m "docs(mockups): add Configuration filter group to classement-v1"
```

---

## Task 6 : Vérification finale + smoke test cross-feature

**Files :** aucun fichier modifié — vérifications uniquement.

- [ ] **Step 1 : Lancer toute la suite de tests web**

```bash
pnpm --filter @nemo/web test
```

Attendu : tous les tests passent (incluant les 4 nouveaux de `data.test.ts`, plus les tests existants comme `TimeStepper.test`).

- [ ] **Step 2 : Lancer le typecheck du repo entier**

```bash
pnpm typecheck
```

Attendu : succès (le `Record<BoatClass, X>` strict du projet ne devrait pas être impacté — aucune nouvelle classe de bateau ajoutée).

- [ ] **Step 3 : Lancer le lint web**

```bash
pnpm --filter @nemo/web lint
```

Attendu : pas d'erreur.

- [ ] **Step 4 : Smoke test manuel — flow complet utilisateur**

```bash
pnpm --filter @nemo/web dev
```

Vérifier dans cet ordre :

1. **Page `/ranking` saison** :
   - Toggle `Configuration = Série` change la liste, le podium, et "Ta position".
   - `Classe = IMOCA 60` × `Configuration = Série` → ne montre que les joueurs avec stats Série en IMOCA 60.
   - `Classe = Toutes` × `Configuration = Série` → agrégat toutes classes en mode Série.
   - `Périmètre = Amis` × `Configuration = Série` → uniquement les amis ayant des stats Série.
   - Pagination revient à 1 quand on change de Configuration.
2. **Panneau classement in-race** (`/play/<raceId>`) :
   - L'option `Série · N skippers` apparaît dans le `<select>` après un séparateur.
   - La sélection filtre la liste aux bateaux Série.
   - `@vous` reste visible en mode Série.
3. **Visiteur non authentifié** :
   - Se déconnecter, ouvrir `/ranking` → le filtre Configuration reste accessible (visiteur peut voir les deux classements). Pas de "Ta position".

- [ ] **Step 5 : Si le smoke test échoue**

Documenter le problème, créer une nouvelle task de fix, ne pas marquer Task 6 comme completed tant que le smoke test ne passe pas.

- [ ] **Step 6 : Mettre à jour `ROADMAP.md` ou la mémoire `project_phases_state` si pertinent**

Si la mémoire `project_phases_state.md` mentionne le classement Série comme à faire, la mettre à jour pour refléter la livraison de la Phase 1 (front mock-driven). La Phase 2 backend reste à intégrer dans le plan API.

```bash
git add C:/Users/damie/.claude/projects/c--Users-damie-Workspace-Project-Nemo/memory/project_phases_state.md
git commit -m "docs(memory): mark classement Série Phase 1 (front mock) as delivered"
```

(Optionnel — à faire uniquement si le contenu actuel de la mémoire le justifie.)

---

## Critères de succès du plan

- ✅ Sur `/ranking`, un nouveau groupe de filtres `Configuration` (Toutes / Série) coexiste avec les groupes Classe et Périmètre, combinables.
- ✅ Le sous-titre de section et la liste se mettent à jour selon le mode Série.
- ✅ Le panneau classement in-race a une option `Série` dans son `<select>`.
- ✅ La fonction `getRanking()` accepte un paramètre `config` et est testée par 4 tests Vitest.
- ✅ Aucune régression de typecheck, lint, ou test existant.
- ✅ Le mockup `classement-v1.html` reflète le 3ème groupe de filtres.
- ✅ Tous les commits passent les hooks pre-commit (pas de `--no-verify`).
