import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { OrmClient } from './client';

/** Pasta gerada por `npm run db:generate` (drizzle-kit). */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Aplica as migrations pendentes, em ordem. É seguro repetir: as já aplicadas são ignoradas.
 * As migrations são só para frente (SONNET_CONTEXT, F.5).
 */
export async function runMigrations(orm: OrmClient): Promise<void> {
  await migrate(orm, { migrationsFolder: MIGRATIONS_FOLDER });
}
