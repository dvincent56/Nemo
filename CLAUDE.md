# Project Nemo — Claude instructions

## Runbooks

When tasked with one of the following, read the matching runbook BEFORE planning:

- **Adding a new boat class** → [docs/runbooks/adding-a-boat-class.md](docs/runbooks/adding-a-boat-class.md)

## Architecture pointers

- `BoatClass` is the single source of truth for boat class enumeration; it is derived from the `BOAT_CLASSES` tuple in `packages/shared-types/src/index.ts`. The Zod enum `BoatClassZ` (in `@nemo/game-balance`) is `z.enum(BOAT_CLASSES)` — they cannot diverge.
- Game balance is loaded from `packages/game-balance/game-balance.json` (engine source of truth) and a duplicate at `apps/web/public/data/game-balance.json` (web-served). They have a known pre-existing divergence on the `swell` block — do not sync without explicit scope approval.
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
