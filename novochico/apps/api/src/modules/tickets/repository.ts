import { and, desc, eq, gte } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { ticketAttempts } from '../../db/schema';

export type TicketAttemptRow = typeof ticketAttempts.$inferSelect;
export type NewTicketAttempt = typeof ticketAttempts.$inferInsert;

/** Resultado final de uma tentativa; só se grava uma vez. */
export type AttemptOutcome = Partial<
  Pick<
    TicketAttemptRow,
    | 'status'
    | 'glpiTicketId'
    | 'glpiRequesterId'
    | 'title'
    | 'category'
    | 'urgency'
    | 'summary'
    | 'summarySource'
    | 'errorCode'
    | 'errorDetail'
  >
>;

/** SQL do módulo `tickets`. Só o `service.ts` do módulo deve usá-lo. */
export function createTicketsRepository(db: DbExecutor) {
  return {
    /**
     * Registra a tentativa como `pending`. Se a chave já existe nesta conversa, nada é gravado e
     * devolve `null`: quem chama busca a tentativa existente (idempotência, B-09).
     */
    async insertPending(values: NewTicketAttempt): Promise<TicketAttemptRow | null> {
      const [row] = await db
        .insert(ticketAttempts)
        .values(values)
        .onConflictDoNothing({
          target: [ticketAttempts.conversationId, ticketAttempts.idempotencyKey],
        })
        .returning();
      return row ?? null;
    },

    async findByKey(
      conversationId: string,
      idempotencyKey: string,
    ): Promise<TicketAttemptRow | null> {
      const [row] = await db
        .select()
        .from(ticketAttempts)
        .where(
          and(
            eq(ticketAttempts.conversationId, conversationId),
            eq(ticketAttempts.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    /** `pending` só muda uma vez (F.3): a atualização ignora tentativas já finalizadas. */
    async finalize(
      id: string,
      outcome: AttemptOutcome,
      now: Date,
    ): Promise<TicketAttemptRow | null> {
      const [row] = await db
        .update(ticketAttempts)
        .set({ ...outcome, updatedAt: now })
        .where(and(eq(ticketAttempts.id, id), eq(ticketAttempts.status, 'pending')))
        .returning();
      return row ?? null;
    },

    /** Chamados abertos do usuário (sem os de teste), do mais recente para o mais antigo. */
    async listUserSuccess(userId: string, since: Date, limit: number): Promise<TicketAttemptRow[]> {
      return db
        .select()
        .from(ticketAttempts)
        .where(
          and(
            eq(ticketAttempts.userId, userId),
            eq(ticketAttempts.status, 'success'),
            eq(ticketAttempts.isTest, false),
            gte(ticketAttempts.createdAt, since),
          ),
        )
        .orderBy(desc(ticketAttempts.createdAt))
        .limit(limit);
    },

    /** Chamados abertos por qualquer usuário desde `since` (sem os de teste), para o incidente coletivo. */
    async listRecentSuccess(since: Date, limit: number): Promise<TicketAttemptRow[]> {
      return db
        .select()
        .from(ticketAttempts)
        .where(
          and(
            eq(ticketAttempts.status, 'success'),
            eq(ticketAttempts.isTest, false),
            gte(ticketAttempts.createdAt, since),
          ),
        )
        .orderBy(desc(ticketAttempts.createdAt))
        .limit(limit);
    },

    /** O último setor informado pelo usuário em um chamado aberto. */
    async lastSector(userId: string): Promise<string | null> {
      const [row] = await db
        .select({ sector: ticketAttempts.sector })
        .from(ticketAttempts)
        .where(and(eq(ticketAttempts.userId, userId), eq(ticketAttempts.isTest, false)))
        .orderBy(desc(ticketAttempts.createdAt))
        .limit(1);
      return row?.sector ?? null;
    },
  };
}

export type TicketsRepository = ReturnType<typeof createTicketsRepository>;
