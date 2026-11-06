import type { OrmClient } from '../../db/client';
import { createContentRepository } from './repository';
import { createContentService } from './service';

export type { ChatCategory, ContentService, HomeCard, PublishedInstructions } from './service';

/** Ponto de entrada do módulo: outros módulos só recebem o service. */
export function createContent(orm: OrmClient) {
  return createContentService(createContentRepository(orm));
}
