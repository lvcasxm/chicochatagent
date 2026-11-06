import { buildApp } from './app';
import { ConfigError, loadConfigFromProcess, type Config } from './config';
import { createDatabase } from './db/client';
import { buildLogger } from './lib/logger';

let config: Config;
try {
  config = loadConfigFromProcess();
} catch (error) {
  // Sem logger ainda: a configuração é justamente o que o define.
  console.error(error instanceof ConfigError ? error.message : 'Falha ao ler a configuração.');
  process.exit(1);
}

const logger = buildLogger(config);
const db = createDatabase(config, logger);
const app = await buildApp({ config, logger, db });

/** Intervalo da tarefa que encerra conversas inativas (a sessão de atendimento dura 30 min). */
const SESSION_SWEEP_MS = 5 * 60_000;
let sweeping = false;
async function sweepSessions(): Promise<void> {
  // Uma varredura por vez: se uma demorar, a próxima espera.
  if (sweeping) return;
  sweeping = true;
  try {
    await app.jobs.closeInactiveConversations();
  } catch (err) {
    logger.error({ err }, 'Falha ao encerrar conversas inativas');
  } finally {
    sweeping = false;
  }
}
const sweepTimer = setInterval(() => void sweepSessions(), SESSION_SWEEP_MS);
sweepTimer.unref();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Encerrando');
  // Se o encerramento travar, força a saída em vez de ficar pendurado.
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    clearInterval(sweepTimer);
    await app.close();
    await db.close();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Falha ao encerrar');
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  void sweepSessions();
} catch (err) {
  logger.fatal({ err }, 'Não foi possível abrir a porta');
  process.exit(1);
}
