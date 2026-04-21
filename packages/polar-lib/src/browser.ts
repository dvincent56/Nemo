// Browser-safe entry for @nemo/polar-lib. Exposes the pure numerical helpers
// (no fs, no node:* imports). The main entry adds loadPolar() which reads
// polar JSON files from disk and is only usable on the Node side.

export {
  getPolarSpeed,
  advancePosition,
  haversineNM,
  computeTWA,
} from './pure';
