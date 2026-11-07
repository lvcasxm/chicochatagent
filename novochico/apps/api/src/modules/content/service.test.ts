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
    it('a tela inicial mostra só os quatro atalhos principais, sem o card oculto', async () => {
      await seedDatabase(orm());
      const cards = await content().listHomeCards();
      expect(cards).toHaveLength(4);
      expect(cards.map((card) => card.key)).not.toContain('access');
      // Os demais ficam cadastrados (e desativados), com título válido de chamado.
      const all = await orm().select().from(categories);
      expect(
        all
          .filter((card) => card.action !== 'hidden')
          .map((card) => card.title)
          .sort(),
      ).toEqual(TICKET_CATEGORIES.filter((title) => title !== DEFAULT_TICKET_CATEGORY).sort());
    });

    it('segue a ordem: computador, senha, GRP Sonner e rede', async () => {
      await seedDatabase(orm());
      const keys = (await content().listHomeCards()).map((card) => card.key);
      expect(keys).toEqual(['hardware', 'password', 'grp', 'network']);
    });

    it('a administração reativa um card que não está na tela inicial', async () => {
      await seedDatabase(orm());
      await orm().update(categories).set({ active: true }).where(eq(categories.key, 'printer'));
      const keys = (await content().listHomeCards()).map((card) => card.key);
      expect(keys).toContain('printer');
      expect(keys).toHaveLength(5);
    });

    it('não lista cards desativados', async () => {
      await seedDatabase(orm());
      await orm().update(categories).set({ active: false }).where(eq(categories.key, 'network'));
      const keys = (await content().listHomeCards()).map((card) => card.key);
      expect(keys).not.toContain('network');
      expect(keys).toHaveLength(3);
    });

    it('descreve a ação de cada card; o do GRP abre conversa, sem link', async () => {
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
      expect(byKey['grp']).toMatchObject({
        action: 'chat',
        externalUrl: null,
        secondaryLink: null,
      });
      expect(byKey['grp']?.cannedMessage).toContain('GRP/Sonner');
    });

    it('devolve lista vazia sem seed', async () => {
      expect(await content().listHomeCards()).toEqual([]);
    });
  });
});
