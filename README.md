# Nemo

Jeu de voile offshore en ligne — PWA, concurrent éthique de Virtual Regatta.

## Stack

- **Monorepo** : Turborepo + pnpm workspaces
- **Frontend** : Next.js 16.2, React 19.2, TypeScript strict, CSS Modules
- **Game Engine** : Node.js + Fastify + Worker Threads, tick 30 s
- **WS Gateway** : uWebSockets.js
- **Weather Engine** : Python (cfgrib / xarray) → Redis
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
  web/             # Next.js — frontend joueur + backoffice
  game-engine/     # Fastify + Worker Threads + tick loop + Drizzle
  ws-gateway/      # uWebSockets.js
  weather-engine/  # Python — ingest NOAA GFS (Phase 4 fin)
packages/
  shared-types/    # TypeScript partagés
  polar-lib/       # Polaires 4 classes + interpolation bilinéaire
  game-balance/    # game-balance.json (seule source de vérité gameplay)
```

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
  Vérifier : `wsl --version` doit afficher une version ≥ 2.0.
- **Docker Desktop** avec WSL2 backend activé (Settings → Resources → WSL integration : cocher Ubuntu-22.04).
- **VS Code + extension WSL** (ms-vscode-remote.remote-wsl) — ouvre la fenêtre directement dans le FS Linux.

### 2. Prérequis dans WSL2 Ubuntu

```bash
# Dans le terminal WSL2 (pas PowerShell) :

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs build-essential git python3 python3-pip

# pnpm via Corepack (bundled avec Node 22)
corepack enable
corepack prepare pnpm@9.12.0 --activate

# Vérif
node --version   # v22.x
pnpm --version   # 9.12.0
docker --version # idéalement accessible via l'intégration Docker Desktop
```

### 3. Cloner le repo dans le FS Linux

```bash
mkdir -p ~/projets
cd ~/projets
git clone <url-du-repo> nemo
cd nemo

# Dans VS Code :
code .
# → doit afficher en bas à gauche "WSL: Ubuntu-22.04"
```

---

## Démarrage local (sans AWS, sans Cognito)

### Phase 3 — strict minimum

```bash
# 1. Installer les deps
pnpm install

# 2. (Optionnel) Copier le .env racine
cp .env.example .env

# 3. (Optionnel Phase 3) Générer la fixture météo si pas déjà faite
pnpm fixture

# 4. Lancer les 3 apps en parallèle (Turborepo orchestre les 3 workspaces)
pnpm dev
```

Services exposés :
- [http://localhost:3000](http://localhost:3000) — Next.js (pages `/`, `/login`, `/races`, `/play/:id`)
- [http://localhost:3001](http://localhost:3001) — game-engine Fastify (`/health`, `/api/v1/*`)
- `ws://localhost:3002/race/:id` — ws-gateway uWebSockets.js

Flow de test minimal :
1. Ouvrir [http://localhost:3000](http://localhost:3000) → landing.
2. Aller sur `/login`, saisir un nom (ex. `skipper`) → cookie `nemo_access_token` posé, redirigé vers `/races`.
3. Cliquer sur une course → `/play/:raceId` avec MapLibre, HUD, compas, Sail Panel en mode simulateur local.

### Phase 4 — avec infra Postgres/Redis

```bash
# 1. Démarrer Postgres 16 + Redis 7 via Docker Desktop (WSL2 backend)
pnpm infra:up
# vérif : docker compose -f docker-compose.dev.yml ps

# 2. Pousser le schéma Drizzle (dev, sans migrations versionnées)
pnpm db:push
# ou générer une migration versionnée : pnpm db:generate puis pnpm db:migrate

# 3. Lancer les apps
pnpm dev

# Pour inspecter la DB :
pnpm db:studio
```

Arrêt propre : `pnpm infra:down` (les volumes persistent dans `pgdata` / `redisdata`).

---

## Mode Cognito production

Par défaut, `COGNITO_*` vide → l'endpoint `/api/v1/auth/dev-login` émet des tokens stub `dev.<sub>.<username>` sans vérif, et les vrais boutons Google/Apple OAuth sont désactivés sur `/login`.

Quand tu veux brancher Cognito réel, ajouter dans `.env` :

```
COGNITO_REGION=eu-west-3
COGNITO_USER_POOL_ID=eu-west-3_XXXXXXXXX
COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXX
```

Le backend bascule automatiquement sur `jose` + JWKS distant (vérification signature + issuer + audience). Le flow Hosted UI OAuth est à implémenter côté Next.js en Phase 4 (route `/auth/callback` qui appelle `POST /api/v1/auth/exchange`).

---

## Commandes utiles

| Commande | Effet |
|---|---|
| `pnpm dev` | Lance web + game-engine + ws-gateway (Turborepo `persistent`) |
| `pnpm typecheck` | Typecheck tous les workspaces (strict) |
| `pnpm build` | Build prod tous les workspaces |
| `pnpm e2e:tick` | Test tick loop Phase 1 (10 ticks, 0.5 NM est) |
| `pnpm e2e:phase2` | Test validation Phase 2 (1h sim, zones + sails + wear) |
| `pnpm fixture` | Regénère `apps/game-engine/fixtures/weather-grid.json` |
| `pnpm infra:up` / `:down` / `:logs` | Compose dev (Postgres + Redis) |
| `pnpm db:push` / `:migrate` / `:studio` | Drizzle Kit |

---

## Règles absolues

1. **Zéro valeur de gameplay hardcodée** — tout passe par `packages/game-balance/game-balance.json`.
2. **TypeScript strict partout** — pas de `any`, pas de `@ts-ignore`. `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` actifs.
3. **CSS Modules uniquement** — pas de Tailwind, pas de styled-components.
4. **Polices** : Space Grotesk (corps), Bebas Neue (display), Space Mono (données/HUD).
5. **`proxy.ts`** pour l'auth Next.js, jamais `middleware.ts`.
6. **Anti-P2W** : `computeBoatSpeed()` ne doit jamais prendre `tier`, `stripeCustomerId`, `hasPaid`.

---

## Build natif — uWebSockets.js

`uWebSockets.js` n'est pas publié sur npm : il est installé depuis GitHub et compile des bindings natifs.

### Docker

Le `Dockerfile.base` de `apps/ws-gateway` installe `python3`, `make`, `g++`. Voir `apps/ws-gateway/Dockerfile.base`.

### CI

Les runners GitHub `ubuntu-latest` ont déjà `python3`, `make`, `g++` — aucune action requise. Sur `windows-latest`, installer Visual Studio Build Tools.

### WSL2

`build-essential` (installé au step 2 ci-dessus) couvre les trois binaires requis.

### Fallback

Si `uWebSockets.js` bloque, il est possible de basculer temporairement sur `ws` (npm, zero build deps). Non activé actuellement — à envisager en Phase 4 si nécessaire.

---

## Troubleshooting WSL2

| Symptôme | Solution |
|---|---|
| `pnpm install` très lent | Tu es probablement dans `/mnt/c/…`. Cloner dans `~/projets/`. |
| `docker compose` ne trouve pas le daemon | Docker Desktop → Settings → Resources → WSL integration : activer ta distro. |
| Port 3000 déjà utilisé | `lsof -i :3000` puis `kill -9 <pid>`, ou changer `PORT=3000` dans `.env`. |
| MapLibre blanc dans le navigateur | Vérifier la console : probablement pas d'accès à tiles.openfreemap.org. |
| Chemins Windows dans les erreurs | Vérifier que tu exécutes bien depuis le terminal WSL2, pas PowerShell. |
