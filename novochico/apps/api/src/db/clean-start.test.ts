import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../test/db';
import { captureLogger, testConfig } from '../../test/helpers';
import { runMigrations } from './migrations';
import { seedDatabase } from './seed';

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'drizzle');

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('partida em banco limpo (F10, ADR-028)', () => {
  let test: TestDatabase;
  const orm = () => test.db.orm;

  beforeAll(async () => {
    // Banco sem nenhuma tabela: o que a implantação encontra na primeira vez.
    test = await createTestDatabase({ migrate: false });
  }, 30_000);

  afterAll(async () => {
    await test.drop();
  }, 30_000);

  const tables = async () => {
    const result = await orm().execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    return (result.rows as Array<{ table_name: string }>).map((row) => row.table_name);
  };

  it('começa sem tabelas', async () => {
    expect(await tables()).toEqual([]);
  });

  it('as migrations aplicam em ordem e só uma vez; repetir não muda nada', async () => {
    await runMigrations(orm());
    const first = await tables();
    expect(first).toEqual(
      expect.arrayContaining([
        'users',
        'sessions',
        'conversations',
        'messages',
        'ticket_attempts',
        'feedbacks',
        'categories',
        'instruction_versions',
        'audit_log',
      ]),
    );

    const applied = async () => {
      const result = await orm().execute(
        sql`select count(*)::int as total from drizzle.__drizzle_migrations`,
      );
      return (result.rows[0] as { total: number }).total;
    };
    const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).length;
    expect(await applied()).toBe(files);

    await runMigrations(orm());
    expect(await applied()).toBe(files);
    expect(await tables()).toEqual(first);
  });

  it('o seed carrega cards e uma única versão publicada, e é seguro repetir', async () => {
    const first = await seedDatabase(orm());
    expect(first.instructionsCreated).toBe(true);
    expect(first.categoriesInserted).toBeGreaterThan(5);

    const again = await seedDatabase(orm());
    expect(again).toEqual({ categoriesInserted: 0, instructionsCreated: false });

    const versions = await orm().execute(
      sql`select count(*)::int as total, count(*) filter (where status = 'published')::int as published from instruction_versions`,
    );
    expect(versions.rows[0]).toEqual({ total: 1, published: 1 });
  });

  it('o banco começa vazio de pessoas: nenhum usuário, conversa ou chamado vem junto', async () => {
    for (const table of [
      'users',
      'sessions',
      'conversations',
      'messages',
      'ticket_attempts',
      'feedbacks',
      'audit_log',
    ]) {
      const result = await orm().execute(sql.raw(`select count(*)::int as total from ${table}`));
      expect((result.rows[0] as { total: number }).total, table).toBe(0);
    }
  });

  it('a API sobe nesse banco e responde à checagem de saúde do contêiner', async () => {
    const app = await buildApp({
      config: testConfig,
      logger: captureLogger().logger,
      db: test.db,
      oidc: null,
    });
    const health = await app.inject('/api/health');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok', db: 'up' });
    await app.close();
  });
});
