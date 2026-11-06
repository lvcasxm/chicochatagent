import type { OrmClient } from '../../db/client';
import { createConversationsRepository } from './repository';
import { createConversationsService } from './service';

export type { ConversationRow, ConversationsService, HistoryMessage, MessageRow } from './service';
export { toTriageState } from './service';
export { isCannedGreeting, isPlaceholderTitle, smartConversationTitle } from './title';

/** Ponto de entrada do módulo: outros módulos só recebem o service. */
export function createConversations(deps: { orm: OrmClient; now: () => Date }) {
  return createConversationsService({
    repository: createConversationsRepository(deps.orm),
    now: deps.now,
  });
}
