import { categories, instructionVersions } from '../schema';
import type { OrmClient } from '../client';
import { CATEGORY_SEEDS } from './categories';
import { INITIAL_INSTRUCTIONS, INITIAL_INSTRUCTIONS_SUMMARY } from './initial-instructions';

export interface SeedResult {
  categoriesInserted: number;
  instructionsCreated: boolean;
}

/**
 * Conteúdo inicial: cards e a versão 1 das instruções. Idempotente e **não destrutivo**:
 * o que já existe nunca é sobrescrito, para não desfazer edições feitas pelo painel.
 * Não contém dados de pessoas nem de produção.
 */
export async function seedDatabase(orm: OrmClient): Promise<SeedResult> {
  return orm.transaction(async (tx) => {
    const insertedCategories = await tx
      .insert(categories)
      .values(CATEGORY_SEEDS)
      .onConflictDoNothing({ target: categories.key })
      .returning({ key: categories.key });

    // A versão 1 só nasce se ainda não houver nenhuma versão, de qualquer estado.
    const existing = await tx
      .select({ id: instructionVersions.id })
      .from(instructionVersions)
      .limit(1);
    let instructionsCreated = false;
    if (existing.length === 0) {
      const inserted = await tx
        .insert(instructionVersions)
        .values({
          version: 1,
          status: 'published',
          content: INITIAL_INSTRUCTIONS,
          changeSummary: INITIAL_INSTRUCTIONS_SUMMARY,
          publishedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: instructionVersions.id });
      instructionsCreated = inserted.length > 0;
    }

    return { categoriesInserted: insertedCategories.length, instructionsCreated };
  });
}
