import type { OrmClient } from '../../db/client';
import type { LlmClient } from '../../integrations/gemini/llm';
import type { Logger } from '../../lib/logger';
import type { AnalyticsService } from '../analytics';
import type { ContentService } from '../content';
import type { ConversationsService } from '../conversations';
import { createResponseCache, disabledCache } from './response-cache';
import { createChatService } from './service';

export { createLlmFromConfig } from './llm';
export type { ChatService } from './service';

/** Ponto de entrada do módulo: monta o serviço do chat com o cache escolhido pela configuração. */
export function createChat(deps: {
  orm: OrmClient;
  conversations: ConversationsService;
  content: ContentService;
  analytics: AnalyticsService;
  llm: LlmClient | null;
  modelName: string | null;
  cacheEnabled: boolean;
  logger: Logger;
  now: () => Date;
}) {
  return createChatService({
    conversations: deps.conversations,
    content: deps.content,
    analytics: deps.analytics,
    llm: deps.llm,
    modelName: deps.modelName,
    cache: deps.cacheEnabled
      ? createResponseCache({ orm: deps.orm, now: deps.now })
      : disabledCache,
    logger: deps.logger,
    now: deps.now,
  });
}
