import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from '../config';
import type { Logger } from '../lib/logger';
import * as schema from './schema';

export type OrmClient = NodePgDatabase<typeof schema>;

/**
 * O que um repositório precisa para consultar: serve tanto para o cliente normal quanto para
 * uma transação aberta com `orm.transaction(...)`, de modo que a mesma lógica rode nos dois.
 */
export type DbExecutor = Pick<OrmClient, 'select' | 'insert' | 'update' | 'delete'>;

/** Superfície do banco usada fora de `db/`. Só os repositórios dos módulos usam `orm`. */
export interface Database {
  orm: OrmClient;
  /** Rejeita se o banco não responder em até `PING_TIMEOUT_MS`. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

const PING_TIMEOUT_MS = 2000;

export function createDatabase(config: Pick<Config, 'databaseUrl'>, logger: Logger): Database {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: PING_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
  });

  // Sem este ouvinte, um erro em conexão ociosa derruba o processo.
  pool.on('error', (err) => {
    logger.warn({ err }, 'Erro em conexão ociosa do pool do PostgreSQL');
  });

  return {
    orm: drizzle(pool, { schema }),
    async ping() {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Tempo esgotado ao consultar o banco')),
          PING_TIMEOUT_MS,
        );
      });
      try {
        await Promise.race([pool.query('select 1'), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      await pool.end();
    },
  };
}
