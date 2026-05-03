import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  compress: true,
  transpilePackages: ['@nemo/shared-types', '@nemo/game-balance', '@nemo/game-engine-core', '@nemo/routing'],
  // typedRoutes désactivé en PR 2 i18n : tous les `<Link href="/...">`
  // existants pointent vers des paths non-localisés (/marina, /races) qui
  // n'existent plus dans le graphe de routes (tout est sous /[locale]/...).
  // Re-activation prévue en Plans 3-6 après migration des Link vers le
  // helper localisé next-intl (createNavigation dans @/i18n/routing).
  typedRoutes: false,
  // Pin the workspace root so Turbopack doesn't walk up and pick a sibling
  // worktree's pnpm-workspace.yaml — keeps dev builds correct when running
  // from .worktrees/*. cwd is apps/web when invoked via pnpm --filter.
  turbopack: {
    root: resolve(process.cwd(), '..', '..'),
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

export default withNextIntl(config);
