import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  transpilePackages: ['@nemo/shared-types'],
  typedRoutes: true,
};

export default config;
