import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabase, type Database } from '../src/db/client';
import { runMigrations } from '../src/db/migrations';
import { captureLogger } from './helpers';

/** Os testes de integração só rodam com um PostgreSQL de teste configurado. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export interface TestDatabase {
  db: Database;
  /** Nome do banco criado, útil em mensagens. */
  name: string;
  drop(): Promise<void>;
}

/**
 * Cria um banco novo e vazio, só para o teste que o pediu, e o apaga no fim. Cada arquivo
 * de teste parte do zero e nenhum interfere em outro nem nos dados de desenvolvimento.
 *
 * Trava de segurança: o banco em TEST_DATABASE_URL precisa terminar em `_test`.
 */
export async function createTestDatabase(
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL não está definida.');

  const adminUrl = new URL(TEST_DATABASE_URL);
  const baseName = adminUrl.pathname.slice(1);
  if (!baseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL deve apontar para um banco terminado em "_test".');
  }

  // O sufixo é hexadecimal, então o nome é seguro para usar como identificador SQL.
  const name = `${baseName}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const db = createDatabase({ databaseUrl: url.toString() }, captureLogger().logger);
  if (options.migrate ?? true) await runMigrations(db.orm);

  return {
    db,
    name,
    async drop() {
      await db.close();
      const cleaner = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await cleaner.connect();
      try {
        await cleaner.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleaner.end();
      }
    },
  };
}

/** Extrai o código de erro do PostgreSQL, que o Drizzle guarda em `cause`. */
function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    if ('code' in current && typeof current.code === 'string') {
      // Os códigos SQLSTATE do PostgreSQL têm 5 caracteres; outros códigos (ex.: de rede) são ignorados.
      if (/^[0-9A-Z]{5}$/.test(current.code)) return current.code;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

/** Códigos do PostgreSQL usados nos testes de restrição. */
export const PG = {
  uniqueViolation: '23505',
  checkViolation: '23514',
  invalidEnumValue: '22P02',
} as const;

/** Garante que a operação falhou com o código do PostgreSQL esperado, e não por outro motivo. */
export async function expectPgError(operation: PromiseLike<unknown>, code: string): Promise<void> {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  if (failure === undefined) throw new Error(`A operação deveria falhar com o código ${code}.`);
  const actual = pgErrorCode(failure);
  if (actual !== code) {
    throw new Error(`Esperava o código ${code} do PostgreSQL, mas veio ${String(actual)}.`, {
      cause: failure,
    });
  }
}
