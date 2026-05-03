# Project Nemo — Claude instructions

## Runbooks

When tasked with one of the following, read the matching runbook BEFORE planning:

- **Adding a new boat class** → [docs/runbooks/adding-a-boat-class.md](docs/runbooks/adding-a-boat-class.md)

## Architecture pointers

- `BoatClass` is the single source of truth for boat class enumeration; it is derived from the `BOAT_CLASSES` tuple in `packages/shared-types/src/index.ts`. The Zod enum `BoatClassZ` (in `@nemo/game-balance`) is `z.enum(BOAT_CLASSES)` — they cannot diverge.
- Game balance is loaded from `packages/game-balance/game-balance.json` (engine source of truth) and a duplicate at `apps/web/public/data/game-balance.json` (web-served). Both must stay in sync.
- Polar JSON files exist in two locations: `apps/web/public/data/polars/` (browser-fetched) and `packages/polar-lib/polars/` (engine filesystem-read). Both must stay in sync.
- `MARINA_BOAT_CLASSES` in `apps/web/src/lib/boat-classes.ts` is a manually maintained array (not typed). When adding a boat class, update it if the class has at least one non-`"absent"` upgrade slot.

## Conventions

- TypeScript strict everywhere.
- Prefer typed `Record<BoatClass, X>` over `Record<string, X>` so adding a new class triggers typecheck failures at every site needing an update.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- **Only use graphify when the user explicitly requests an architecture session or asks `/graphify`** — do NOT read graphify-out/GRAPH_REPORT.md proactively on every architecture question
- When graphify is requested: read graphify-out/wiki/index.md if it exists, otherwise graphify-out/GRAPH_REPORT.md
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — only when in an explicit architecture session
- After modifying code files in a graphify session, run `graphify update .` to keep the graph current (AST-only, no API cost)

## i18n

Ce projet utilise `next-intl` v4 pour l'internationalisation. 4 locales : `fr` (source), `en`, `es`, `de` (stubs jusqu'à traduction).

**Règle absolue** : aucune string littérale en dur dans le code UI. Tout texte affiché à l'utilisateur passe par une clé de traduction.

- Côté UI : `const t = useTranslations('namespace')` + `t('key')`. Server components : `await getTranslations('namespace')`.
- Côté événements backend : `tEvent('event-code')` qui résout `events.{code}` dans les messages.
- Fichiers de messages : [apps/web/messages/{fr,en,es,de}.json](apps/web/messages/), structure namespacée 1:1 avec les routes.
- Garde-fou local : `pnpm --filter @nemo/web lint` (règle ESLint `react/jsx-no-literals` active sur `src/app/[locale]/**`).
- Garde-fou CI : `pnpm --filter @nemo/web i18n:check` vérifie que toutes les clés référencées existent dans les 4 locales et flag les clés orphelines.
- Quand tu ajoutes/édites un wording : crée la clé dans `messages/fr.json` ET copie-la dans `en.json`, `es.json`, `de.json` (mêmes valeurs, traduction différée).

Spec design : [docs/superpowers/specs/2026-04-28-i18n-design.md](docs/superpowers/specs/2026-04-28-i18n-design.md).
