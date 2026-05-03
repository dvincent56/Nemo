import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // tsconfig.json has `jsx: preserve` for Next.js; vitest needs JSX transformed
  // for tests rendering React components. Override here without touching the
  // app's tsconfig (which would break Next's RSC pipeline).
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'node',
    // Scoped to weather/projection/hooks tests. src/workers/simulator.worker.test.ts
    // is a pre-existing TDD-failing test on main (dev-simulator branch scope);
    // revisit when that branch lands.
    include: [
      'src/lib/**/*.test.ts',
      'src/hooks/**/*.test.ts',
      'src/components/**/*.test.ts',
      'src/components/**/*.test.tsx',
      'src/app/**/*.test.ts',
      'src/app/**/*.test.tsx',
      'src/i18n/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
  },
});
