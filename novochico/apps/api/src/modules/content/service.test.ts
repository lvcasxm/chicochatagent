import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TICKET_CATEGORY, TICKET_CATEGORIES } from '@chicochat/shared';
import { categories } from '../../db/schema';
import { seedDatabase } from '../../db/seed';
import { INITIAL_INSTRUCTIONS } from '../../db/seed/initial-instructions';
import { AppError } from '../../lib/errors';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../test/db';
import { createContent } from './index';

// Precisa do PostgreSQL do Compose (`npm run db:up`) e de TEST_DATABASE_URL no .env.
describe.skipIf(!TEST_DATABASE_URL)('content service', () => {
  let test: TestDatabase;
  const orm = () => test.db.orm;
  const content = () => createContent(orm());

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

  describe('getPublishedInstructions', () => {
    it('devolve a versão publicada pelo seed', async () => {
      await seedDatabase(orm());
      const instructions = await content().getPublishedInstructions();
      expect(instructions.version).toBe(1);
      expect(instructions.content).toBe(INITIAL_INSTRUCTIONS);
      expect(instructions.publishedAt).toBeInstanceOf(Date);
    });

    it('falha de forma segura quando nada foi publicado', async () => {
      const error = await content()
        .getPublishedInstructions()
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'INSTRUCTIONS_NOT_PUBLISHED', statusCode: 503 });
    });

    it('ignora rascunhos e versões arquivadas', async () => {
      await seedDatabase(orm());
      await orm().execute(
        sql`insert into instruction_versions (version, status, content)
            values (2, 'draft', 'Rascunho que ainda não vale')`,
      );
      expect((await content().getPublishedInstructions()).version).toBe(1);
    });
  });

  describe('listHomeCards', () => {
    it('lista os dez cards visíveis, sem o card oculto', async () => {
      await seedDatabase(orm());
      const cards = await content().listHomeCards();
      expect(cards).toHaveLength(10);
      expect(cards.map((card) => card.key)).not.toContain('access');
      expect(cards.map((card) => card.title).sort()).toEqual(
        TICKET_CATEGORIES.filter((title) => title !== DEFAULT_TICKET_CATEGORY).sort(),
      );
    });

    it('segue a ordem de exibição, com SEI e "Outra coisa?" por último', async () => {
      await seedDatabase(orm());
      const keys = (await content().listHomeCards()).map((card) => card.key);
      expect(keys).toEqual([
        'hardware',
        'network',
        'email',
        'security',
        'install',
        'grp',
        'printer',
        'password',
        'sei',
        'other',
      ]);
    });

    it('não lista cards desativados', async () => {
      await seedDatabase(orm());
      await orm().update(categories).set({ active: false }).where(eq(categories.key, 'network'));
      const keys = (await content().listHomeCards()).map((card) => card.key);
      expect(keys).not.toContain('network');
      expect(keys).toHaveLength(9);
    });

    it('descreve a ação de cada card e o link secundário do GRP', async () => {
      await seedDatabase(orm());
      const cards = await content().listHomeCards();
      const byKey = Object.fromEntries(cards.map((card) => [card.key, card]));

      expect(byKey['hardware']).toMatchObject({
        action: 'chat',
        icon: 'Monitor',
        externalUrl: null,
        secondaryLink: null,
      });
      expect(byKey['hardware']?.cannedMessage).toMatch(/^Olá! /);
      expect(byKey['sei']).toMatchObject({
        action: 'external_link',
        externalUrl: 'https://joseias.pl.mg.gov.br',
        cannedMessage: null,
      });
      expect(byKey['grp']?.action).toBe('external_link');
      expect(byKey['grp']?.secondaryLink).toEqual({
        label: 'Ouvidoria aqui',
        url: expect.stringMatching(/^https:\/\/drive\.google\.com\//) as unknown,
      });
    });

    it('devolve lista vazia sem seed', async () => {
      expect(await content().listHomeCards()).toEqual([]);
    });
  });
});
