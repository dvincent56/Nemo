import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  compress: true,
  transpilePackages: ['@nemo/shared-types'],
  typedRoutes: true,
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
