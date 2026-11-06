import { and, desc, eq } from 'drizzle-orm';
import type { SubmitFeedbackRequest } from '@chicochat/shared';
import type { OrmClient } from '../../db/client';
import { feedbacks, ticketAttempts } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import type { AnalyticsService } from '../analytics';
import type { ConversationsService } from '../conversations';

/** Código do erro do PostgreSQL para violação de restrição única. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  // O Drizzle embrulha o erro do driver; o código pode estar no próprio erro ou em `cause`.
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null) ?? {};
  return code.code === UNIQUE_VIOLATION || code.cause?.code === UNIQUE_VIOLATION;
}

/**
 * Avaliação do atendimento (F7, RF-060 e RF-061). Uma por conversa, garantida pela restrição única
 * do banco, e só depois de um chamado aberto ou de uma resolução confirmada.
 */
export function createFeedback(deps: {
  orm: OrmClient;
  conversations: ConversationsService;
  analytics: AnalyticsService;
  logger: Logger;
}) {
  const { orm, conversations, analytics, logger } = deps;

  return {
    async submit(input: {
      userId: string;
      conversationId: string;
      request: { rating: number; suggestion: string | undefined };
    }): Promise<void> {
      const row = await conversations.requireOwned(input.conversationId, input.userId);
      if (row.outcome !== 'resolved' && row.outcome !== 'escalated') {
        throw new AppError(
          'FEEDBACK_NOT_AVAILABLE',
          409,
          'A avaliação fica disponível depois que o atendimento termina.',
        );
      }

      // Liga a avaliação ao chamado, quando houve (o mais recente aberto de verdade).
      const [attempt] = await orm
        .select({ id: ticketAttempts.id })
        .from(ticketAttempts)
        .where(
          and(
            eq(ticketAttempts.conversationId, row.id),
            eq(ticketAttempts.status, 'success'),
            eq(ticketAttempts.isTest, false),
          ),
        )
        .orderBy(desc(ticketAttempts.createdAt))
        .limit(1);

      try {
        await orm.insert(feedbacks).values({
          conversationId: row.id,
          userId: input.userId,
          ticketAttemptId: attempt?.id ?? null,
          rating: input.request.rating,
          suggestion: input.request.suggestion ?? null,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('FEEDBACK_ALREADY_SENT', 409, 'Você já avaliou este atendimento.');
        }
        throw error;
      }

      // O evento nunca leva o texto da sugestão: só a nota (ADR-018). Falhar aqui não desfaz a avaliação.
      try {
        await analytics.record({
          eventType: 'rating_received',
          userId: input.userId,
          conversationId: row.id,
          attendanceSessionId: row.attendanceSessionId,
          category: row.categoryKey,
          sector: row.sector,
          metadata: {
            rating: input.request.rating,
            hasSuggestion: input.request.suggestion !== undefined,
          },
        });
      } catch (error) {
        logger.warn(
          { err: error, conversationId: row.id },
          'Falha ao registrar a avaliação como evento',
        );
      }
    },
  };
}

export type FeedbackService = ReturnType<typeof createFeedback>;
export type { SubmitFeedbackRequest };
