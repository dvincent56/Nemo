// Browser-safe entry: no fs, no path, no Node built-ins.
// Nothing currently lives only on the Node side — the core is already pure — but
// we keep this separate export path to make future bifurcation explicit.
export * from './index.js';
