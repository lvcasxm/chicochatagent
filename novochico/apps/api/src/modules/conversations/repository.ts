import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { conversations, messages } from '../../db/schema';

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

/** Campos que o servidor atualiza ao longo da conversa. */
export type ConversationPatch = Partial<
  Pick<
    ConversationRow,
    | 'title'
    | 'attendanceSessionId'
    | 'resolutionAttempts'
    | 'issuePersists'
    | 'ticketFormUnlockedAt'
    | 'ticketFormTestMode'
    | 'resolvedAt'
    | 'outcome'
    | 'lastMessageAt'
    | 'deletedAt'
  >
>;

/** SQL do módulo `conversations`. Só o `service.ts` do módulo deve usá-lo. */
export function createConversationsRepository(db: DbExecutor) {
  return {
    async insert(values: { userId: string; categoryKey: string | null }): Promise<ConversationRow> {
      const [row] = await db.insert(conversations).values(values).returning();
      if (!row) throw new Error('Falha ao criar a conversa');
      return row;
    },

    /** Conversas do usuário, da atividade mais recente para a mais antiga, sem as excluídas. */
    async listByUser(userId: string, limit: number): Promise<ConversationRow[]> {
      return db
        .select()
        .from(conversations)
        .where(and(eq(conversations.userId, userId), isNull(conversations.deletedAt)))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(limit);
    },

    /** A conversa só existe para o dono: de outro usuário ou excluída, devolve nulo. */
    async findOwned(id: string, userId: string): Promise<ConversationRow | null> {
      const [row] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, id),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async update(id: string, patch: ConversationPatch, now: Date): Promise<ConversationRow> {
      const [row] = await db
        .update(conversations)
        .set({ ...patch, updatedAt: now })
        .where(eq(conversations.id, id))
        .returning();
      if (!row) throw new Error('Conversa não encontrada para atualizar');
      return row;
    },

    /** Soma uma tentativa de resolução sem perder concorrência. */
    async incrementAttempts(id: string, now: Date): Promise<number> {
      const [row] = await db
        .update(conversations)
        .set({ resolutionAttempts: sql`${conversations.resolutionAttempts} + 1`, updatedAt: now })
        .where(eq(conversations.id, id))
        .returning({ attempts: conversations.resolutionAttempts });
      return row?.attempts ?? 0;
    },

    async insertMessage(values: NewMessage): Promise<MessageRow> {
      const [row] = await db.insert(messages).values(values).returning();
      if (!row) throw new Error('Falha ao gravar a mensagem');
      return row;
    },

    async listMessages(conversationId: string): Promise<MessageRow[]> {
      return db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt), asc(messages.id));
    },

    /** As últimas mensagens, da mais antiga para a mais nova. */
    async lastMessages(conversationId: string, limit: number): Promise<MessageRow[]> {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit);
      return rows.reverse();
    },

    async countMessages(conversationId: string): Promise<number> {
      const [row] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(messages)
        .where(eq(messages.conversationId, conversationId));
      return row?.total ?? 0;
    },
  };
}

export type ConversationsRepository = ReturnType<typeof createConversationsRepository>;
