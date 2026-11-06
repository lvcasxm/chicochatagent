import { and, asc, eq, ne } from 'drizzle-orm';
import type { OrmClient } from '../../db/client';
import { categories, instructionVersions } from '../../db/schema';

/** SQL do módulo `content`. Só o `service.ts` do módulo deve usá-lo. */
export function createContentRepository(orm: OrmClient) {
  return {
    /** A versão publicada das instruções; no máximo uma existe (índice único parcial). */
    async findPublishedInstructions() {
      const [row] = await orm
        .select()
        .from(instructionVersions)
        .where(eq(instructionVersions.status, 'published'))
        .limit(1);
      return row ?? null;
    },

    /** Cards ativos e visíveis da tela inicial, na ordem de exibição. */
    async listHomeCards() {
      return orm
        .select()
        .from(categories)
        .where(and(eq(categories.active, true), ne(categories.action, 'hidden')))
        .orderBy(asc(categories.sortOrder), asc(categories.key));
    },
  };
}

export type ContentRepository = ReturnType<typeof createContentRepository>;
