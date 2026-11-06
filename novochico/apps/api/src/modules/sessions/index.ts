import type { Logger } from '../../lib/logger';
import type { AnalyticsService } from '../analytics';
import type { ConversationsService } from '../conversations';

/**
 * Encerra as sessões de atendimento inativas (RF-064): a conversa sem atividade há 30 minutos é
 * fechada e gera o evento `conversation_finished`, com o desfecho (resolvida, escalada ou sem
 * desfecho, ADR-018). Roda por tarefa periódica; cada execução é segura de repetir.
 */
export function createSessionCloser(deps: {
  conversations: ConversationsService;
  analytics: AnalyticsService;
  logger: Logger;
}) {
  const { conversations, analytics, logger } = deps;

  return {
    /** Devolve quantas conversas foram fechadas. Um evento que falhe não impede o fechamento. */
    async closeInactive(): Promise<number> {
      const closed = await conversations.closeInactive();
      for (const row of closed) {
        try {
          await analytics.record({
            eventType: 'conversation_finished',
            userId: row.userId,
            conversationId: row.id,
            attendanceSessionId: row.attendanceSessionId,
            category: row.categoryKey,
            sector: row.sector,
            metadata: { outcome: row.outcome },
          });
        } catch (error) {
          logger.warn(
            { err: error, conversationId: row.id },
            'Falha ao registrar o fim da conversa',
          );
        }
      }
      if (closed.length > 0)
        logger.info({ closed: closed.length }, 'Conversas inativas encerradas');
      return closed.length;
    },
  };
}

export type SessionCloser = ReturnType<typeof createSessionCloser>;
