import type { NextConfig } from 'next';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  compress: true,
  transpilePackages: ['@nemo/shared-types', '@nemo/game-balance', '@nemo/game-engine-core'],
  typedRoutes: true,
  // Pin the workspace root so Turbopack doesn't walk up and pick a sibling
  // worktree's pnpm-workspace.yaml — keeps dev builds correct when running
  // from .worktrees/*.
  turbopack: {
    root: resolve(__dirname, '..', '..'),
  },
  async headers() {
    return [
      {
        source: '/data/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' },
        ],
      },
    ];
  },
};

export default config;
