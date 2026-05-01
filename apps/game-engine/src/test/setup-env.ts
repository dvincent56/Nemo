/**
 * Test env bootstrap. Loaded via --import in the test script so it runs
 * before any test imports the DB client.
 *
 * Falls back to the local docker-compose Postgres URL (matching
 * drizzle.config.ts) if no DATABASE_URL is set in the shell or .env.
 * This keeps `pnpm test` self-sufficient on a freshly-started dev box
 * without forcing the developer to maintain a root .env file.
 *
 * In CI / prod, DATABASE_URL is always provided by the orchestrator,
 * so this fallback is dev-only in practice.
 */
if (!process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = 'postgresql://nemo:nemo@localhost:5432/nemo';
}
