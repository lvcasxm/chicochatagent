import type { Config } from '../../config';
import type { OrmClient } from '../../db/client';
import { createGlpiClient } from '../../integrations/glpi/client';
import { createDevGlpi } from '../../integrations/glpi/fake';
import type { GlpiClient } from '../../integrations/glpi/glpi';
import type { LlmClient } from '../../integrations/gemini/llm';
import type { Logger } from '../../lib/logger';
import type { AnalyticsService } from '../analytics';
import type { ContentService } from '../content';
import type { ConversationsService } from '../conversations';
import type { TranscriptsService } from '../transcripts';
import { createTicketsRepository } from './repository';
import { createTicketsService } from './service';

export type { TicketsService } from './service';

/** Escolhe o GLPI pela configuração; sem credenciais devolve nulo (abertura indisponível). */
export function createGlpiFromConfig(setting: Config['glpi']): GlpiClient | null {
  if (!setting) return null;
  return setting.provider === 'fake'
    ? createDevGlpi()
    : createGlpiClient({ config: setting.config });
}

/** Ponto de entrada do módulo: outros módulos só recebem o service. */
export function createTickets(deps: {
  orm: OrmClient;
  conversations: ConversationsService;
  content: ContentService;
  analytics: AnalyticsService;
  transcripts: TranscriptsService;
  appOrigin: string;
  glpi: GlpiClient | null;
  summaryLlm: LlmClient | null;
  ticketIpRegex: string;
  logger: Logger;
  now: () => Date;
}) {
  return createTicketsService({
    repository: createTicketsRepository(deps.orm),
    conversations: deps.conversations,
    content: deps.content,
    analytics: deps.analytics,
    transcripts: deps.transcripts,
    appOrigin: deps.appOrigin,
    glpi: deps.glpi,
    summaryLlm: deps.summaryLlm,
    ipPattern: new RegExp(deps.ticketIpRegex),
    logger: deps.logger,
    now: deps.now,
  });
}
