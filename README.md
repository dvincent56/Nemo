# Nemo

Jeu de voile offshore en ligne — PWA, concurrent éthique de Virtual Regatta.

## Stack

- **Monorepo** : Turborepo + pnpm workspaces
- **Node** : 22 LTS (CI builde sur Node 22)
- **Frontend** : Next.js 16.2.3, React 19.2, TypeScript strict, CSS Modules, MapLibre GL 5
- **Game Engine** : Node.js + Fastify + Worker Threads, tick 1 Hz event-sourced
- **Engine Core** : `@nemo/game-engine-core` — logique pure (tick, voiles, zones, wear, segments, speed-model) extraite pour être testable et exécutable côté simulateur navigateur
- **Routing** : `@nemo/routing` — isochrones, élagage, polyline, weatherSampler (worker dédié)
- **WS Gateway** : Node.js + `ws` (npm) — sharding par course
- **Weather Engine** : Python (cfgrib / xarray) → Redis (NOAA GFS)
- **DB** : PostgreSQL 16 + Drizzle ORM
- **Cache / pub-sub** : Redis 7

## Priorité des specs

En cas de conflit :
```
V3 > UX/UI V2 > addendum V2 > addendum HUD/Balance > spec V1
```
La version la plus récente prévaut toujours.

## Layout monorepo

```
apps/
  web/                       # Next.js — frontend joueur + backoffice
  game-engine/               # Fastify + Worker Threads + tick loop + Drizzle
  ws-gateway/                # WebSocket (ws) — sharding par course
  weather-engine/            # Python — ingest NOAA GFS → Redis
packages/
  shared-types/              # Types TypeScript partagés
  polar-lib/                 # Polaires 4 classes + interpolation bilinéaire
  game-balance/              # game-balance.json (seule source de vérité gameplay)
  game-engine-core/          # Logique tick pure (bands, sails, zones, wear, segments, speed-model, weather)
  routing/                   # Isochrones + élagage + weatherSampler (worker)
mockups/                     # HTML de référence design (validés avant intégration)
docs/runbooks/               # Procédures pas-à-pas (ex. ajouter une classe de bateau)
scripts/                     # Outils dev (sync-game-balance.mjs, etc.)
```

---

## Routes frontend (`apps/web/src/app/`)

| Route | Page | État |
|---|---|---|
| `/` | Home éditoriale (hero + actus + CTA) | ✅ |
| `/login` | Connexion dev (cookie `nemo_access_token`) | ✅ |
| `/news` · `/news/[slug]` | Index actus + page article | ✅ |
| `/races` | Liste des courses, filtres classe, CTA inscription | ✅ API réelle |
| `/marina` | Flotte du joueur (5 slots max, 1 par classe) | ✅ API réelle |
| `/marina/inventory` | Inventaire pièces / upgrades | ✅ |
| `/marina/[boatId]` | Détail bateau + 6 catégories d'upgrades | ✅ API réelle |
| `/marina/[boatId]/customize` | Personnalisation coque/mât/voiles/marquages | ✅ |
| `/ranking` | Classement saison (filtres classe + périmètre) | ✅ |
| `/ranking/courses` | Liste des courses en cours / terminées | ✅ |
| `/ranking/[raceId]` | Classement d'une course précise | ✅ |
| `/ranking/teams` | Classement des équipes | ✅ |
| `/profile` | Profil du joueur connecté (stats, palmarès, flotte) | ✅ |
| `/profile/[username]` | Profil public d'un autre skipper | ✅ |
| `/profile/settings` | Identité, compte, préférences, notifications | ✅ |
| `/profile/social` | Amis, équipe, invitations reçues/envoyées | ✅ |
| `/team/[slug]` | Profil public d'une équipe (roster paginé) | ✅ |
| `/play/[raceId]` | Écran de course (MapLibre + HUD + ProgPanel + timeline météo) | ✅ refonte structurelle terminée — `ProgPanel` en cours (Phase 2b) |
| `/dev/simulator` | Simulateur local engine-core (sans WS) | 🛠 outil interne |
| `/cgu` · `/privacy` · `/cookies` · `/legal` | Pages légales | ✅ |

> Le préfixe `[locale]` (i18n `next-intl`) n'est **pas encore en place** — il sera introduit en Phase 4.

---

## Environnement de développement — WSL2

**⚠ Le projet doit être cloné et exécuté depuis WSL2 Linux FS** (`~/projets/`) et **pas depuis `/mnt/c/`**. L'I/O sur `/mnt/c/` divise les performances par 10–50× sur les projets Node.

### 1. Prérequis Windows

- **Windows 11** (ou 10 21H2+)
- **WSL2 + Ubuntu 22.04** :
  ```powershell
  wsl --install -d Ubuntu-22.04
  wsl --set-default-version 2
  ```
- **Docker Desktop** avec WSL2 backend activé (Settings → Resources → WSL integration).
- **VS Code + extension WSL** (ms-vscode-remote.remote-wsl).

### 2. Prérequis dans WSL2 Ubuntu

```bash
# Node.js 22 LTS (requis — la CI builde en 22, le test runner s'appuie sur l'expansion native des globs)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs build-essential git python3 python3-pip

# pnpm via Corepack
corepack enable
corepack prepare pnpm@9.12.0 --activate

# Vérif
node --version   # v22.x
pnpm --version   # 9.12.0
docker --version
```

### 3. Cloner le repo dans le FS Linux

```bash
mkdir -p ~/projets
cd ~/projets
git clone <url-du-repo> nemo
cd nemo
code .   # ouvre VS Code en mode WSL
```

---

## Démarrage local

### Mode stub (sans Postgres/Redis/Cognito)

```bash
pnpm install
cp .env.example .env

# Fixture météo (une seule fois — bascule NEMO_WEATHER_MODE=fixture dans .env)
pnpm fixture

# Lancer web + game-engine + ws-gateway en parallèle
pnpm dev
```

> `pnpm dev` côté `apps/web` exécute `predev` qui synchronise `game-balance.json` vers `apps/web/public/data/` via `scripts/sync-game-balance.mjs`.

Services exposés :
- [http://localhost:3000](http://localhost:3000) — Next.js
- [http://localhost:3001](http://localhost:3001) — game-engine (`/health`, `/api/v1/*`)
- `ws://localhost:3002/race/:id` — ws-gateway

Flow minimal :
1. [http://localhost:3000](http://localhost:3000) → home + entrée vers `/races`
2. `/login`, saisir un pseudo → cookie posé, redirigé vers la home
3. `/races` → cliquer sur une course → `/play/:raceId`

### Avec infra Postgres + Redis (mode "complet")

```bash
pnpm infra:up                # Postgres 16 + Redis 7 via Docker
pnpm db:push                 # push schéma Drizzle (dev, sans migrations versionnées)
pnpm dev                     # lance web + game-engine + ws-gateway
pnpm db:studio               # GUI Drizzle pour inspecter la DB
pnpm infra:down              # arrêt propre (volumes pgdata / redisdata persistent)
```

---

## Mode Cognito production

Par défaut, `COGNITO_*` vide → l'endpoint `/api/v1/auth/dev-login` émet des tokens stub `dev.<sub>.<username>` sans vérif, et les vrais boutons OAuth sont désactivés sur `/login`.

Pour brancher Cognito, ajouter dans `.env` :

```
COGNITO_REGION=eu-west-3
COGNITO_USER_POOL_ID=eu-west-3_XXXXXXXXX
COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXX
```

Le backend bascule automatiquement sur `jose` + JWKS distant.

---

## Design system — Nautical Luxury

Direction éditoriale inspirée de **North Sails / SailGP / Rolex Yacht-Master / site Roland-Garros**. **Pas** de cyan néon, de glow, de backdrop-blur.

**Palette** (tokens CSS dans `apps/web/src/app/globals.css`) :
- Ivory `#f5f0e8` · Navy `#1a2840` · Gold `#c9a227`
- Paper `#fbf7f0` · Live green `#2d8a4e` · Danger `#9e2a2a` · Past `#7b6f5c`

**Typographie** (3 familles imposées) :
- **Bebas Neue** — display / titres géants
- **Space Grotesk** — corps de texte
- **Space Mono** — données, nombres, HUD

**Primitives UI** dans `apps/web/src/components/ui/` : `Button`, `Field`, `Chip`, `Eyebrow`, `Card`, `Pagination`, `SiteShell`, `SiteFooter`, `Topbar`, `Drawer`.

### Workflow mockup-first

Tout nouvel écran commence par un HTML standalone dans `mockups/`. Une fois validé visuellement, il est transposé en composants React (`page.tsx` + `View.tsx` + `page.module.css`). La palette et les patterns viennent de `mockups/races-v1.html` qui fait référence.

Mockups actuels (18) : `home`, `races`, `login`, `play`, `marina`, `marina-boat`, `marina-customize`, `profile`, `profile-settings`, `profile-social`, `classement`, `classement-race`, `admin-races`, `admin-races-edit`, `news-detail`, `not-found`, `router-panel`, `timeline`.

---

## Commandes utiles

| Commande | Effet |
|---|---|
| `pnpm dev` | Lance web + game-engine + ws-gateway (Turborepo `persistent`) |
| `pnpm typecheck` | Typecheck tous les workspaces (strict) |
| `pnpm lint` | ESLint sur tous les workspaces |
| `pnpm test` | Tests unitaires (Vitest côté web, `node --test` côté core) |
| `pnpm build` | Build prod tous les workspaces |
| `pnpm e2e:tick` | Test tick loop Phase 1 (10 ticks) |
| `pnpm e2e:phase2` | Test Phase 2 (1 h sim, zones + sails + wear) |
| `pnpm fixture` | Regénère `apps/game-engine/fixtures/weather-grid.json` |
| `pnpm infra:up` / `:down` / `:logs` | Docker compose dev (Postgres + Redis) |
| `pnpm db:push` / `:migrate` / `:studio` | Drizzle Kit |

---

## Règles absolues

1. **Zéro valeur de gameplay hardcodée** — tout passe par `packages/game-balance/game-balance.json`.
2. **TypeScript strict partout** — pas de `any`, pas de `@ts-ignore`. `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` actifs.
3. **CSS Modules uniquement** — pas de Tailwind, pas de styled-components, pas d'inline styles.
4. **Polices imposées** — Space Grotesk / Bebas Neue / Space Mono exclusivement.
5. **`proxy.ts`** pour l'auth Next.js, jamais `middleware.ts`.
6. **Anti-P2W** — `computeBoatSpeed()` ne doit jamais prendre `tier`, `stripeCustomerId`, `hasPaid`. Jamais de crédits achetés en €.
7. **Mocks alignés backend** — les seed `data.ts` utilisent les mêmes noms de champs que le schéma Drizzle (username, rankingScore, racesFinished…) pour faciliter le basculement mock → vraie API.
8. **i18n anticipé** — 4 langues prévues (fr/en/es/de) via `next-intl`. Ne jamais hardcoder un texte UI — passer par `useTranslations()`.

---

## État des phases

> Source de vérité détaillée : [ROADMAP.md](ROADMAP.md). Résumé ci-dessous.

- ✅ **Phase 1** — tick loop + polaires + Fastify + fixtures météo
- ✅ **Phase 2** — sails + zones + wear + segments + e2e 1h
- 🟢 **Phase 3 (~75 %)** — backend live (Redis pub/sub + ws-gateway + orders RPC + DB hydration), refonte design Nautical Luxury terminée sur toutes les pages publiques. **Reste** : démock progressif (rankings, profile, team, social toujours sur seed), refonte ergonomie `ProgPanel` (Phases 0 → 2b livrées : ORDER_REPLACE_QUEUE wire, primitives Compass/TimeStepper extraites, schéma typed-draft, projection 2 couches commit/draft, intégration carte avec markers + drag), affichage des bateaux adverses, mode replay multi-bateaux
- ⏳ **Phase 4** — i18n `next-intl` (priorité, routing `[locale]/`), Stripe abonnement, marina DB (cosmétique persistée + upgrades + crédits anti-P2W), Cognito Hosted UI, finalisation routeur (cache Redis, ETA, gate Carrière), NOAA prod
- ⏳ **Phase 5** — Admin (`/admin/system` super-admin : maintenance, bandeaux, kill-switches sans redeploy)
- ⏳ **Phase 6** — Schémas backend social (friendships, teams, invitations, player_class_stats, user_settings, profiles), push notifications, deploy AWS, charge
- ⏳ **Phase 7** — calibration vs joueurs VR réels, V2, légal

**Cible de charge** : 1M joueurs sur 1–10 courses, mono-course massive possible. Bench tick OK jusqu'à 500k bateaux — goulot actuel : payload broadcast dès 100k (3 optims identifiées : delta diff, quantization, visibility).

---

## Troubleshooting WSL2

| Symptôme | Solution |
|---|---|
| `pnpm install` très lent | Tu es probablement dans `/mnt/c/…`. Cloner dans `~/projets/`. |
| `docker compose` ne trouve pas le daemon | Docker Desktop → Settings → Resources → WSL integration. |
| Port 3000 déjà utilisé | `lsof -i :3000` puis `kill -9 <pid>`, ou changer `PORT` dans `.env`. |
| MapLibre blanc | Console : probablement pas d'accès à `tiles.openfreemap.org`. |
| Chemins Windows dans les erreurs | Vérifier que tu exécutes bien depuis WSL2, pas PowerShell. |
