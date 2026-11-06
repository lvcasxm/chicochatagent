import { ConfigError, loadConfigFromProcess } from '../config';
import { buildLogger } from '../lib/logger';
import { createDatabase } from './client';
import { runMigrations } from './migrations';

/**
 * `npm run db:migrate`. Usa DATABASE_MIGRATION_URL (usuário com direito de alterar o schema)
 * quando definida; em desenvolvimento cai para DATABASE_URL. Nunca roda sozinho na partida da API.
 */
try {
  const config = loadConfigFromProcess();
  const logger = buildLogger(config);
  const db = createDatabase(
    { databaseUrl: config.databaseMigrationUrl ?? config.databaseUrl },
    logger,
  );
  try {
    await runMigrations(db.orm);
    logger.info('Migrations aplicadas');
  } finally {
    await db.close();
  }
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : 'Falha ao aplicar as migrations.');
  if (!(error instanceof ConfigError)) console.error(error);
  process.exit(1);
}
