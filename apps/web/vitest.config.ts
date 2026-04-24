import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Scoped to weather/projection/hooks tests. src/workers/simulator.worker.test.ts
    // is a pre-existing TDD-failing test on main (dev-simulator branch scope);
    // revisit when that branch lands.
    include: [
      'src/lib/**/*.test.ts',
      'src/hooks/**/*.test.ts',
      'src/components/**/*.test.ts',
    ],
  },
});
