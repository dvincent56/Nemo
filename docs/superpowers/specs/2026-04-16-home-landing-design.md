# Home landing page — Design spec

**Date** : 2026-04-16
**Statut** : validé (brainstorming)
**Auteur** : dvincent
**Prochain step** : mockup HTML standalone `mockups/home-v1.html` → validation → plan d'implémentation code

---

## Contexte

Aujourd'hui la racine `/` du site redirige vers `/races` (cf. `apps/web/src/app/page.tsx`). Il n'existe pas de page de présentation du produit. Le visiteur qui arrive par lien direct atterrit dans la liste des courses, sans pitch ni proposition de valeur. Le mode spectateur public vient d'être câblé (cf. `project_spectator_mode.md`), ce qui rend nécessaire une vraie landing pour convertir les curieux.

## Objectifs

1. Convertir le visiteur anonyme vers la création de compte gratuite.
2. Laisser les curieux tester en spectateur sans friction (CTA secondaire).
3. Pousser le mode carrière payant via un récit produit, sans exposer de pricing sur la home (le pricing vit sur `/subscribe`).
4. Animer la page avec des **actualités éditoriales** gérées par un admin (catégories : `COURSE`, `BALANCE`, `INTERVIEW`, `DEV`).
5. Rompre avec l'austérité éditoriale actuelle par une direction **photo + SVG + captures gameplay** (voir section "Direction visuelle").

## Hors scope (explicite)

- Back-office admin pour créer/éditer des news → **Phase 5** (les mockups `admin-races-*` serviront de base).
- Route `/news` (index complet des actualités) → **Phase 5**.
- Page `/subscribe` (détail pricing du mode carrière) → existe en spec séparée (`project_subscription.md`), pas touchée ici.
- Newsletter (form dans le footer) → le champ existe visuellement mais le POST n'est pas câblé dans ce spec.

## Direction visuelle

- Style **Nautical Luxury** confirmé : ivory (`--ivory`), navy (`--navy`), gold (`--gold`), pas de cyan/néon/glow (cf. `feedback_no_neon.md`).
- Fonts imposées : Bebas Neue (display), Space Grotesk (body), Space Mono (data).
- **Photo hero bichromique** (voilier offshore 3/4 arrière, navy/ivory), placeholder Unsplash dans le mockup.
- **Captures de jeu** en bichromie dans la section "Voici Nemo".
- **SVG signatures** : boussole (reprise du `/login`), silhouettes de bateaux, mini-cartes de course.

## Sections de la page (ordre)

### 1. Hero

- Photo pleine largeur (bichromie navy/ivory), voile dégradé navy pour contraste texte.
- Eyebrow gold : `Saison 2026 · Circuit Nemo`.
- Titre Bebas Neue 96-120px : `Un bateau. / Ta carrière. / Mille à mille.`
- Lede Space Grotesk : pitch produit (polaires réelles fournies par les constructeurs, météo GFS mise à jour toutes les 6 h, bateau persistant façonné par les victoires). **Pas** de slogan "zéro pay-to-win" ni de pique à la concurrence (cf. `feedback_positioning_vs_vr.md`).
- **Double CTA** :
  - Primaire (`Button variant="primary"`) : `Créer un compte →`
  - Secondaire (`Button variant="secondary"`) : `Voir les courses en direct →` (vers `/races`)
- Mini-bandeau status en bas : `🟢 N courses en direct · N skippers en mer · N inscrits` (valeurs seed pour mockup, `fetchRaces` + stats en prod).
- Boussole SVG filigrane animée (rotation lente 0.5°/5s).

### 2. "Voici Nemo" — 3 piliers produit

Grille 3 colonnes, cartes sur fond paper :

| Pilier | Visuel (mockup) | Accroche |
|---|---|---|
| Polaires réelles | SVG stylisé : diagramme polaire + numéros bichromiques (placeholder ; à remplacer par capture HUD réelle à l'intégration si dispo) | *Les mêmes fichiers pour tous. Du Figaro III à l'Ultim. Ton bateau se comporte exactement comme dans la vraie vie.* |
| Météo réelle | SVG stylisé : tracés de vents + isobares (placeholder ; à remplacer par capture GRIB réelle à l'intégration si dispo) | *GFS toutes les 6 h. Mêmes fichiers que les skippers en vraie course.* |
| Ton bateau, ta carrière | Rendu SVG évolutif (vierge → customisé → trophée) — entièrement SVG, pas de placeholder photo | *Il te suit de course en course. Upgrades financées par tes podiums.* |

### 3. "En direct" — courses en cours

Bandeau horizontal, 3 cartes de course :
- Mini-carte SVG de la route (réutilise `minify()` de `RaceList.tsx`)
- Nom + classe + leader actuel + nb skippers
- Chip `🟢 En direct`
- Clic → `/play/<raceId>` (mode spectateur)

CTA bas : `Voir toutes les courses →` (vers `/races`).

### 4. "Le mode carrière" — narratif

Section contrastée **fond navy, texte ivory** (polarité inversée pour marquer le tier premium).

- Gauche : éditorial dense. Eyebrow gold `Carrière skipper`. Titre Bebas Neue `Une seule coque. Mille milles.` Paragraphes sur la persistance du bateau, la progression saison, les upgrades financées par les podiums. **Important** : affirmation positive uniquement (cf. `feedback_positioning_vs_vr.md`) — pas de "zéro pay-to-win", pas de "pas de raccourci par la caisse", pas d'attaque frontale à VR. L'abonnement donne accès au mode Carrière (persistance bateau + palmarès officiel), **pas** à des courses ou classes supplémentaires.
- "Tu démarres avec un bateau récent mais vierge d'équipement" — la classe (Figaro/Class40/IMOCA/Ultim) est dictée par la 1re course à laquelle on s'inscrit, pas figée au Figaro.
- Droite : capture Marina + micro-timeline progression (crédits, upgrades, podiums).
- CTA gold `Rejoindre le circuit →` (vers `/subscribe`).
- **Pas de prix affiché.**

### 5. Actualités — "Journal de bord"

Section ivory, 4 cartes éditoriales en grille.

Structure d'une carte :
- Image en haut (photo ou capture)
- Chip catégorie gold (`COURSE` / `BALANCE` / `INTERVIEW` / `DEV`)
- Titre Bebas Neue moyen
- Date Space Mono (`14 AVR 2026`)
- Extrait 2 lignes
- Lien `Lire →`

CTA bas : `Toutes les actualités →` (vers `/news`, route Phase 5).

Seed mockup : 4 news fictives couvrant les 4 catégories.

### 6. "Ils sont en tête" — preuve sociale

Bandeau court : **podium saison en cours** (top 3 général, reprend le style des PodiumCard de `/classement`), lien vers `/classement`.

Valeur : prouve la vitalité et valorise les joueurs top.

### 7. Footer enrichi

Remplace le `SiteFooter` actuel minimal. **3 colonnes** + bas minimal :

| Colonne 1 | Colonne 2 | Colonne 3 |
|---|---|---|
| **Produit** | **Légal** | **Contact** |
| Courses | CGU | hello@nemo.sail |
| Classement | Confidentialité | |
| Marina | Mentions légales | |
| Mode carrière | Cookies | |
| Mode spectateur | | |

Bas : logo Nemo, `© 2026 Nemo · Hébergé en Europe`. **Pas** de sélecteur de langue dans le footer (le switcher du topbar suffit). **Pas** de baseline "Zéro pay-to-win" (cf. `feedback_positioning_vs_vr.md`).

**Pas inventer** (cf. `feedback_no_invented_features.md`) :
- Pas de colonne "À propos" (Le projet / Presse / Roadmap publique / Manifeste n'existent pas).
- Pas de form newsletter (feature non prévue dans ROADMAP).

**Propagation** : ce nouveau footer remplace [apps/web/src/components/ui/SiteFooter.tsx](apps/web/src/components/ui/SiteFooter.tsx) → apparaîtra automatiquement sur toutes les pages utilisant `<SiteShell>` (13 pages).

## Variation spectateur vs connecté

La page `/` devient accessible à tous (plus de redirect vers `/races`).

- **Spectateur (pas de cookie)** :
  - CTA hero primaire : `Créer un compte →` → `/register` (Phase 4) ou `/login` en attendant
  - CTA hero secondaire : `Voir les courses en direct →` → `/races`
  - Topbar déjà câblé en mode visiteur (cf. `project_spectator_mode.md`) : `Courses` + `Classement` + bouton `Se connecter`
- **Connecté (cookie `nemo_access_token`)** :
  - CTA hero primaire : `Reprendre ma carrière →` → `/marina`
  - CTA hero secondaire : `Voir les courses →` → `/races`
  - Topbar inchangé (mode player)

Le reste de la page (sections 2-7) est identique pour les deux publics — un joueur régulier revient aussi consulter les news.

## Routes et fichiers impactés

### Nouveaux

- `apps/web/src/app/HomeView.tsx` (client component, logique CTA adaptative)
- `apps/web/src/app/home-data.ts` (seed news + stats, à remplacer par API en Phase 5)
- `apps/web/src/components/home/` : composants `Hero.tsx`, `Pillars.tsx`, `LiveRaces.tsx`, `CareerBand.tsx`, `NewsGrid.tsx`, `SeasonPodium.tsx`
- `mockups/home-v1.html` (livrable workflow projet)

### Modifiés

- `apps/web/src/app/page.tsx` : supprimer le redirect, lire cookie, rendre `<HomeView isVisitor={...} />`
- `apps/web/src/components/ui/SiteFooter.tsx` + `.module.css` : refonte enrichie 4 colonnes

### Non impactés

- `proxy.ts` — la racine `/` est déjà publique dans les `PUBLIC_PATHS`
- Topbar — déjà adapté au mode visiteur

## Données

Pour le mockup et la phase initiale post-intégration, on travaille avec des **seeds statiques** côté front :

- **News** : tableau en dur dans `home-data.ts`, 4-6 entrées. Contrat TypeScript `NewsItem { id, category, title, date, image, excerpt, slug }`.
- **Stats hero** : `fetchRaces()` pour compter les `LIVE` + valeurs mock pour "skippers en mer" et "inscrits" (à remplacer par endpoint `/api/v1/stats/summary` en Phase 5).
- **Podium saison** : réutilise `getRanking('ALL')` de `classement/data.ts`, top 3.

La table `news` en DB et les endpoints `/api/v1/news` arrivent en Phase 5 (hors scope).

## Workflow de livraison

1. **Mockup HTML standalone** — `mockups/home-v1.html` avec tous les composants inlinés (CSS vars, SVG, placeholders Unsplash). Validation visuelle par dvincent avant toute ligne de code Next.js.
2. **Plan d'implémentation** — une fois le mockup validé, rédaction du plan d'implémentation via `writing-plans`.
3. **Implémentation** — découpage en composants React, intégration data (seeds), responsive, tests visuels.

## Risques et décisions ouvertes

- **Photo hero** : placeholder Unsplash dans le mockup. En prod, soit acheter une licence (iStock, Getty), soit commander un shoot. À trancher avant déploiement. **Décision** : dvincent tranchera à l'intégration.
- **Performances hero** : image WebP, `<Image priority>` de Next, fallback solid color navy. Mesurer LCP.
- **Accessibilité** : contraste texte sur photo → voile navy dégradé + `text-shadow` subtil. Alt text explicite sur la photo.
- **i18n** : la page est en `fr` uniquement dans le mockup. Les contenus textuels (titres, lede, accroches, catégories) devront être traduits via `next-intl` (cf. `project_i18n.md`) à l'intégration.
- **Analytics** : prévoir des events `home_hero_cta_click` (valeur = primary/secondary), `home_news_click` (slug), `home_career_cta_click`. Hors scope spec — à ajouter au plan d'implémentation.

## Critères de succès

- Mockup validé par dvincent sans aller-retour majeur sur la direction visuelle.
- TTI < 2s, LCP < 2.5s en prod (hero photo optimisée).
- Tous les CTAs routent correctement selon le rôle (visiteur/player).
- Code compile propre (`pnpm build` sans erreur).
- Footer enrichi utilisé partout (pas de régression sur les 13 pages existantes).
