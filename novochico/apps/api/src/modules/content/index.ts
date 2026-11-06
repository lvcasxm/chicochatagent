import type { OrmClient } from '../../db/client';
import type { LlmClient } from '../../integrations/gemini/llm';
import type { Logger } from '../../lib/logger';
import { createCategoriesAdmin } from './categories-admin';
import { createInstructionsAdmin } from './instructions';
import { createContentRepository } from './repository';
import { createContentService } from './service';

export type { CategoriesAdmin } from './categories-admin';
export type { InstructionsAdmin } from './instructions';
export type { ChatCategory, ContentService, HomeCard, PublishedInstructions } from './service';

/** Ponto de entrada do módulo: outros módulos só recebem o service. */
export function createContent(orm: OrmClient) {
  return createContentService(createContentRepository(orm));
}

/** Administração do conteúdo: instruções do agente e cards da tela inicial. */
export function createContentAdmin(deps: {
  orm: OrmClient;
  llm: LlmClient | null;
  logger: Logger;
  now: () => Date;
}) {
  return {
    instructions: createInstructionsAdmin(deps),
    categories: createCategoriesAdmin(deps),
  };
}
