import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categories, instructionVersions } from '../schema';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../test/db';
import { CATEGORY_SEEDS } from './categories';
import { seedDatabase } from './index';
import { INITIAL_INSTRUCTIONS } from './initial-instructions';

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('seed', () => {
  let test: TestDatabase;
  const orm = () => test.db.orm;

  beforeAll(async () => {
    test = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await test.drop();
  }, 30_000);

  beforeEach(async () => {
    await orm().execute(
      sql`truncate table categories, instruction_versions restart identity cascade`,
    );
  });

  it('carrega os cards e a versão 1 publicada em banco vazio', async () => {
    const result = await seedDatabase(orm());
    expect(result).toEqual({
      categoriesInserted: CATEGORY_SEEDS.length,
      instructionsCreated: true,
    });

    expect(await orm().select().from(categories)).toHaveLength(CATEGORY_SEEDS.length);
    const versions = await orm().select().from(instructionVersions);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version: 1,
      status: 'published',
      content: INITIAL_INSTRUCTIONS,
      createdBy: null,
      publishedBy: null,
    });
    expect(versions[0]?.publishedAt).toBeInstanceOf(Date);
    expect(versions[0]?.changeSummary).toContain('três partes');
  });

  it('é idempotente: repetir não duplica nem altera nada', async () => {
    await seedDatabase(orm());
    const second = await seedDatabase(orm());
    const third = await seedDatabase(orm());
    expect(second).toEqual({ categoriesInserted: 0, instructionsCreated: false });
    expect(third).toEqual({ categoriesInserted: 0, instructionsCreated: false });
    expect(await orm().select().from(categories)).toHaveLength(CATEGORY_SEEDS.length);
    expect(await orm().select().from(instructionVersions)).toHaveLength(1);
  });

  it('não desfaz edições feitas depois pelo painel', async () => {
    await seedDatabase(orm());
    await orm()
      .update(categories)
      .set({ title: 'Título editado pelo admin', active: false })
      .where(eq(categories.key, 'hardware'));

    await seedDatabase(orm());

    const [card] = await orm().select().from(categories).where(eq(categories.key, 'hardware'));
    expect(card).toMatchObject({ title: 'Título editado pelo admin', active: false });
  });

  it('não recria a versão 1 quando já existem versões mais novas', async () => {
    await seedDatabase(orm());
    await orm().transaction(async (tx) => {
      await tx.update(instructionVersions).set({ status: 'archived' });
      await tx.insert(instructionVersions).values({
        version: 2,
        status: 'published',
        content: 'Instruções editadas pelo admin',
        publishedAt: new Date(),
      });
    });

    const result = await seedDatabase(orm());

    expect(result.instructionsCreated).toBe(false);
    const rows = await orm()
      .select()
      .from(instructionVersions)
      .orderBy(instructionVersions.version);
    expect(rows.map((row) => [row.version, row.status])).toEqual([
      [1, 'archived'],
      [2, 'published'],
    ]);
  });

  it('repõe só os cards que faltam', async () => {
    await seedDatabase(orm());
    await orm().delete(categories).where(eq(categories.key, 'sei'));

    const result = await seedDatabase(orm());

    expect(result.categoriesInserted).toBe(1);
    expect(await orm().select().from(categories)).toHaveLength(CATEGORY_SEEDS.length);
  });
});
