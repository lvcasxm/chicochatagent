import type { AnalyticsEventType } from '@chicochat/shared';
import type { DbExecutor } from '../../db/client';
import { analyticsEvents } from '../../db/schema';

export interface AnalyticsEvent {
  eventType: AnalyticsEventType;
  userId: string;
  conversationId: string;
  attendanceSessionId: string;
  category?: string | null;
  sector?: string | null;
  /** Só valores simples. Nunca conteúdo de conversa nem dados pessoais (ADR-018). */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Registra eventos gerados pelo servidor (ADR-018). Falhar em registrar nunca pode derrubar o
 * atendimento: o erro é devolvido a quem chamou, que decide registrar em log e seguir.
 */
export function createAnalytics(db: DbExecutor) {
  return {
    async record(event: AnalyticsEvent): Promise<void> {
      await db.insert(analyticsEvents).values({
        eventType: event.eventType,
        userId: event.userId,
        conversationId: event.conversationId,
        attendanceSessionId: event.attendanceSessionId,
        category: event.category ?? null,
        sector: event.sector ?? null,
        metadata: event.metadata ?? {},
      });
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalytics>;
