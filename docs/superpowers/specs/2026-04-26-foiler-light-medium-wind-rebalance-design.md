# Foiler light/medium-wind rebalance — Design

## Problem

Foiler boats (across all classes that can carry foils) were systematically beaten by non-foiler stock boats in light wind, AND beaten by light-air-specialised non-foilers in medium wind (10-20 kt — the typical trade-wind transat zone).

This contradicted both real-world ratios (foiler IMOCAs in trade winds reach ~22 kn vs ~14-15 kn for non-foilers) and game intent (foiler is supposed to be a meaningful investment with clear upside in its operating window).

## Diagnosis

Three independent issues compounded.

### 1 — Double-applied light-wind drag

Each foil item carried two negative `speedByTws[0]` values that both fired in light wind:
- `effects.speedByTws[0]` — applied because no foil had an `activation.minTws` gate, so the active drag was always on
- `passiveEffects.speedByTws[0]` — applied unconditionally by design

The two compounded multiplicatively: e.g. Class40 Foils Proto reached **−14%** in TWS<10 kt.

### 2 — Negligible medium-wind active gain

The `effects.speedByTws[1]` (medium wind, 10-20 kt) values were tuned conservatively (+0.01 to +0.04 across the catalog), while `passiveEffects.speedByTws[1]` carried significant negative residuals (down to −0.04). Net effect of foils in the most common transat conditions was −2% to +2%, while the optimised non-foiler stack (light-air sails + dedicated hull) was +12% to +17% in the same conditions.

### 3 — IMOCA foils had no TWA dimension

`foils-imoca60-mk2` and `foils-imoca60-proto` had `speedByTwa: [0, 0, 0, 0, 0]` — zero boost on any TWA bin. The intended foiler advantage was meant to come entirely from `speedByTws`, which (per issue #2) was too weak. Compared to Class40 foils-proto which gives **+22%** on TWA bin 3 (broad reach), the IMOCA foils gave nothing on the very angle where foilers shine. This was a catalogue inconsistency, not a calibration choice.

## Solution

Three coordinated levers applied to all foil items + one targeted catalogue fix on IMOCA foils + one simulator preset improvement.

### Lever A — Add `activation.minTws` to every foil

Real foilers retract their foils in light air. The `effects` block (which carries the active drag/lift profile) should only fire when the foil is deployed. Below the gate, only `passiveEffects` (residual hull/housing drag) applies. Mechanism is already wired in [packages/game-engine-core/src/loadout.ts:46-103](packages/game-engine-core/src/loadout.ts#L46-L103) — only catalogue values change.

Thresholds calibrated by aggressiveness:
- Modest foils (Bronze, Mini lateral, Figaro série): `minTws = 8`
- Aggressive foils (Silver, Ocean Fifty série): `minTws = 10`
- Extreme foils (Proto, Ultim série): `minTws = 12`

### Lever B — Recalibrate `passiveEffects.speedByTws` toward zero/slightly-positive on bins 0 and 1

Make residual drag near-neutral so the gated `effects.speedByTws` is the dominant signal once foils deploy.

### Lever C — Boost `effects.speedByTws[1]` (medium-wind active gain)

Bring foils in line with their physical role: in 10-20 kt, foils provide a real forward gain when deployed.

### Catalogue fix — Add `speedByTwa` profile to IMOCA foils

Mirror Class40's structure: penalty on close-hauled / close-reach (foils don't fly), big gain on broad reach (foils fly), moderate gain on run.

### Simulator preset improvement

The `imoca60-foiler` preset previously installed only `foils-imoca60-proto` — no sail upgrade — while the `imoca60-light-air` preset was full-spec with light-air sails + non-foiler hull. Comparing them was unfair. Update the foiler preset to also equip `sails-imoca60-light-air` (catalogue-compatible with IMOCA60 regardless of foil choice).

## Final values

All values below are the **new** values after change. Items unchanged from the original catalogue are not listed.

### Foil items — all classes

Format: `[bin0, bin1, bin2]` for `speedByTws`, `[twa0, twa1, twa2, twa3, twa4]` for `speedByTwa`.

| Item | `effects.speedByTws` | `passiveEffects.speedByTws` | `activation.minTws` | `effects.speedByTwa` (only if changed) |
|---|---|---|---|---|
| `foils-class40-c` (Bronze) | `[-0.01, +0.03, +0.04]` | `[+0.02, 0, 0]` | 8 | unchanged |
| `foils-class40-s` (Silver) | `[-0.02, +0.06, +0.10]` | `[0, -0.01, 0]` | 10 | unchanged |
| `foils-class40-proto` (Proto) | `[-0.03, +0.08, +0.14]` | `[-0.01, -0.01, 0]` | 12 | unchanged |
| `foils-figaro-monotype` (Série) | `[0, +0.03, +0.02]` | `[+0.01, 0, 0]` | 8 | unchanged |
| `foils-ocean-fifty-inbuilt` (Série) | `[-0.01, +0.06, +0.04]` | `[0, 0, 0]` | 10 | unchanged |
| `foils-ultim-standard` (Série) | `[-0.02, +0.08, +0.10]` | `[-0.01, -0.01, 0]` | 12 | unchanged |
| `foils-mini650-lateral` (Bronze) | `[-0.01, +0.02, +0.02]` | `[+0.01, 0, 0]` | 8 | unchanged |
| `foils-imoca60-mk2` (Bronze) | `[-0.01, +0.05, +0.07]` | `[+0.02, 0, 0]` *(new block)* | 8 | `[-0.02, -0.01, +0.06, +0.12, +0.05]` *(was zeros)* |
| `foils-imoca60-proto` (Silver) | `[-0.03, +0.08, +0.12]` | `[0, 0, 0]` *(new block)* | 10 | `[-0.03, -0.02, +0.10, +0.22, +0.10]` *(was zeros)* |

### Items NOT touched

- `foils-class40-none`, `foils-mini650-none` — pure no-foils options, already neutral
- `foils-imoca60-standard` — represents the IMOCA archimédien stock hull penalty, intentionally retained as the upgrade-incentive mechanism (compensated by `hull-imoca60-non-foiler` upgrade)
- All `wearMul` blocks across foil items — wear is out of scope
- All `speedByTws` bin 2 (strong wind) values — foiler dominance in heavy weather was already correct
- All `speedByTwa` values on Class40/Mini/Figaro/Ocean Fifty/Ultim foils — these were already structured correctly

### Simulator preset

In [apps/web/src/app/dev/simulator/presets.ts](apps/web/src/app/dev/simulator/presets.ts):

`imoca60-foiler.upgradeIds`: `['foils-imoca60-proto']` → `['foils-imoca60-proto', 'sails-imoca60-light-air']`

Description updated accordingly.

## Expected behavior after change

Comparison setups: IMOCA Foiler Proto preset (with new light-air sails) vs IMOCA Non-foiler Petit Temps preset.

At TWS = 15 kt, TWA = 130° (broad reach in trade winds), including the stock canting keel contribution that both presets share:

| Setup | TWA mul | TWS mul | Total |
|---|---|---|---|
| Foiler Proto + light-air | sails(+3%) × foils(+22%) = **1.257** | sails(+9%) × foils-active(+8%) × keel(+1%) = **1.189** | **+49.4%** |
| Non-foiler petit-temps | hull(+2%) × sails(+3%) = **1.051** | hull(+4%) × sails(+9%) × foil-stock-passive(−2%) × keel(+1%) = **1.122** | **+17.9%** |

Foiler ahead by ~31 percentage points in trade-wind broad-reach conditions, validated by user testing on Atlantic descent simulation. Roughly proportional to the real-world Vendée Globe ratio (~1.5x).

At TWS = 6 kt (light wind, foils retracted because TWS < 10 minTws):

| Class40 setup | Total mul |
|---|---|
| Stock series (no upgrades, no foils) | 1.0 (reference) |
| Foils Proto, sails stock | ≈ +0% (foils retracted, only passive residual) |
| Sans foils + carène déplacement + sails light-air | ≈ +37% |

→ Light-air specialist still dominates light wind (the spec investment remains valuable), but foilers no longer get crushed. Foiler stock is roughly at parity with stock series boat in light wind.

At TWS ≥ 20 kt (strong wind, broad reach):

Unchanged from before. Foilers retain their dominance.

## Implementation impact

### Files to modify (canonical, beyond what's already done in the web mirror)

- [packages/game-balance/game-balance.json](packages/game-balance/game-balance.json) — propagate the same 9 foil item edits made to the web mirror

### No engine code changes required

The `activation.minTws` gating + `passiveEffects` always-on mechanism is already implemented in [packages/game-engine-core/src/loadout.ts:46-103](packages/game-engine-core/src/loadout.ts#L46-L103). Only catalogue data changes.

### Tests to verify / update

- [packages/game-engine-core/src/loadout.test.ts](packages/game-engine-core/src/loadout.test.ts) — verify aggregation tests still pass; add a test asserting the activation gate behavior on a foil-like fixture if not already covered
- Run the broader monorepo test suite to confirm no snapshot tests assert on the old foil values

### Out of scope (not addressed by this design)

- Wear multipliers (`foils_hull`, `foils_rig`) on foils — could amplify foiler degradation on long simulations; not investigated in this iteration
- Routing engine speed evaluation (whether the router picks optimal headings for foilers as well as for non-foilers); not investigated
- TWA bin 1 (close-reach 60-90°) penalty on non-IMOCA foils — could still hurt foilers when the router forces close-reach segments, but no user complaint on this dimension yet

## Validation

User tested the staged changes via the dev simulator, comparing IMOCA Proto vs IMOCA Petit Temps presets on an Atlantic descent route. After this design's three-lever intervention, the foiler proto clearly outpaces the non-foiler in trade-wind conditions, matching the intended game balance.
