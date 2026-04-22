// packages/routing/src/index.ts
export * from './types';
export { PRESETS } from './presets';
export { computeRoute } from './isochrones';
// Re-export the coastline class so workers can build the index without
// taking a direct dependency on @nemo/game-engine-core. If they did, the
// bundler (Turbopack) could duplicate the module graph, giving the worker
// a different GameBalance singleton than the one computeRoute sees — which
// breaks GameBalance.load() invisibly.
export { CoastlineIndex } from '@nemo/game-engine-core/browser';
