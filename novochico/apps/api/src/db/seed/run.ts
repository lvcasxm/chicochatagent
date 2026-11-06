import { ConfigError, loadConfigFromProcess } from '../../config';
import { buildLogger } from '../../lib/logger';
import { createDatabase } from '../client';
import { seedDatabase } from './index';

/** `npm run db:seed`: carrega cards e instruções iniciais. Seguro para repetir. */
try {
  const config = loadConfigFromProcess();
  const logger = buildLogger(config);
  const db = createDatabase(config, logger);
  try {
    const result = await seedDatabase(db.orm);
    logger.info(result, 'Seed concluído');
  } finally {
    await db.close();
  }
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : 'Falha ao carregar o seed.');
  if (!(error instanceof ConfigError)) console.error(error);
  process.exit(1);
}
