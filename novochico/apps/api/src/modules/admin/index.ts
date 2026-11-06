import type { OrmClient } from '../../db/client';
import type { LlmClient } from '../../integrations/gemini/llm';
import type { Logger } from '../../lib/logger';
import type { ContentService } from '../content';
import type { UsersService } from '../users';
import { createInsights } from './insights';
import { createAdminService } from './service';

export type { AdminService } from './service';

/** Ponto de entrada do módulo: leitura auditada, exportação, Análise IA, usuários e auditoria. */
export function createAdmin(deps: {
  orm: OrmClient;
  content: ContentService;
  users: UsersService;
  /** IA do painel; nula sem chave. */
  insightsLlm: LlmClient | null;
  logger: Logger;
  now: () => Date;
}) {
  return createAdminService({
    orm: deps.orm,
    content: deps.content,
    users: deps.users,
    insights: createInsights({ llm: deps.insightsLlm, logger: deps.logger }),
    now: deps.now,
  });
}
