import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from './schema.js';

const log = pino({ name: 'db' });

export type DbClient = PostgresJsDatabase<typeof schema>;

let cachedClient: DbClient | null = null;
let cachedSql: postgres.Sql | null = null;

export function getDb(): DbClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env['DATABASE_URL'];
  if (!url) {
    log.warn('DATABASE_URL not set — API tombera en fallback in-memory');
    return null;
  }
  try {
    cachedSql = postgres(url, { max: 4, idle_timeout: 30 });
    cachedClient = drizzle(cachedSql, { schema });
    log.info('drizzle connected');
    return cachedClient;
  } catch (err) {
    log.error({ err }, 'drizzle connection failed');
    return null;
  }
}

export async function closeDb(): Promise<void> {
  if (cachedSql) {
    await cachedSql.end();
    cachedSql = null;
    cachedClient = null;
  }
}
