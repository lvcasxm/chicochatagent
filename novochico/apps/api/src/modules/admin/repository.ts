import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { ADMIN_PAGE_SIZE } from '@chicochat/shared';
import type { OrmClient } from '../../db/client';
import {
  auditLog,
  conversations,
  feedbacks,
  messages,
  ticketAttempts,
  users,
} from '../../db/schema';

export interface Range {
  from: Date | null;
  to: Date;
}

/** Escapa `%`, `_` e `\` para a busca tratar o texto digitado como texto, não como padrão. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Linha de exportação: valores simples, na ordem das colunas. */
export type ExportCell = string | number | boolean | Date | null;

export interface ExportCursor {
  /** Instante com a precisão total do banco (microssegundos), como texto. */
  at: string;
  id: string;
}

export interface ExportSource {
  header: string[];
  /** Cinco colunas fixas à frente: a ordem é (data, id) para paginar sem repetir nem pular. */
  query(range: Range, cursor: ExportCursor | null, limit: number): SQL;
  cells(row: Record<string, unknown>): ExportCell[];
}

const rangeSql = (range: Range) =>
  sql`(${range.from}::timestamptz is null or t.created_at >= ${range.from}::timestamptz) and t.created_at <= ${range.to}::timestamptz`;

const afterSql = (cursor: ExportCursor | null) =>
  cursor ? sql`and (t.created_at, t.id) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : sql``;

const dateCell = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string | Date);
const textCell = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
};

/** O que cada tipo de CSV seleciona (RF-079). Sempre `t.created_at` e `t.id` na paginação. */
export const EXPORT_SOURCES: Record<string, ExportSource> = {
  conversations: {
    header: [
      'id',
      'criada_em',
      'ultima_mensagem_em',
      'email_do_usuario',
      'setor',
      'categoria',
      'desfecho',
      'tentativas_de_resolucao',
      'teste',
    ],
    query: (range, cursor, limit) => sql`
      select t.id, t.created_at::text as cursor_at, t.created_at, t.last_message_at, u.email,
             t.sector, t.category_key, t.outcome::text as outcome, t.resolution_attempts,
             t.ticket_form_test_mode as is_test
      from conversations t join users u on u.id = t.user_id
      where ${rangeSql(range)} ${afterSql(cursor)}
      order by t.created_at, t.id limit ${limit}`,
    cells: (r) => [
      textCell(r.id),
      dateCell(r.created_at),
      dateCell(r.last_message_at),
      textCell(r.email),
      textCell(r.sector),
      textCell(r.category_key),
      textCell(r.outcome),
      r.resolution_attempts as number,
      Boolean(r.is_test),
    ],
  },
  messages: {
    header: [
      'id',
      'criada_em',
      'conversa_id',
      'papel',
      'origem',
      'conteudo',
      'incompleta',
      'teste',
    ],
    query: (range, cursor, limit) => sql`
      select t.id, t.created_at::text as cursor_at, t.created_at, t.conversation_id,
             t.role::text as role, t.source::text as source, t.content, t.incomplete,
             c.ticket_form_test_mode as is_test
      from messages t join conversations c on c.id = t.conversation_id
      where ${rangeSql(range)} ${afterSql(cursor)}
      order by t.created_at, t.id limit ${limit}`,
    cells: (r) => [
      textCell(r.id),
      dateCell(r.created_at),
      textCell(r.conversation_id),
      textCell(r.role),
      textCell(r.source),
      textCell(r.content),
      Boolean(r.incomplete),
      Boolean(r.is_test),
    ],
  },
  tickets: {
    header: [
      'id',
      'criado_em',
      'conversa_id',
      'situacao',
      'chamado_glpi',
      'categoria',
      'urgencia',
      'setor',
      'origem_do_resumo',
      'codigo_de_erro',
      'teste',
    ],
    query: (range, cursor, limit) => sql`
      select t.id, t.created_at::text as cursor_at, t.created_at, t.conversation_id,
             t.status::text as status, t.glpi_ticket_id, t.category, t.urgency, t.sector,
             t.summary_source::text as summary_source, t.error_code, t.is_test
      from ticket_attempts t
      where ${rangeSql(range)} ${afterSql(cursor)}
      order by t.created_at, t.id limit ${limit}`,
    cells: (r) => [
      textCell(r.id),
      dateCell(r.created_at),
      textCell(r.conversation_id),
      textCell(r.status),
      textCell(r.glpi_ticket_id),
      textCell(r.category),
      r.urgency === null ? null : (r.urgency as number),
      textCell(r.sector),
      textCell(r.summary_source),
      textCell(r.error_code),
      Boolean(r.is_test),
    ],
  },
  events: {
    header: ['id', 'criado_em', 'tipo', 'conversa_id', 'categoria', 'setor', 'metadados'],
    query: (range, cursor, limit) => sql`
      select t.id, t.created_at::text as cursor_at, t.created_at, t.event_type::text as event_type,
             t.conversation_id, t.category, t.sector, t.metadata::text as metadata
      from analytics_events t
      where ${rangeSql(range)} ${afterSql(cursor)}
      order by t.created_at, t.id limit ${limit}`,
    cells: (r) => [
      textCell(r.id),
      dateCell(r.created_at),
      textCell(r.event_type),
      textCell(r.conversation_id),
      textCell(r.category),
      textCell(r.sector),
      textCell(r.metadata),
    ],
  },
  feedbacks: {
    header: ['id', 'criada_em', 'conversa_id', 'nota', 'sugestao', 'teste'],
    query: (range, cursor, limit) => sql`
      select t.id, t.created_at::text as cursor_at, t.created_at, t.conversation_id, t.rating,
             t.suggestion, c.ticket_form_test_mode as is_test
      from feedbacks t join conversations c on c.id = t.conversation_id
      where ${rangeSql(range)} ${afterSql(cursor)}
      order by t.created_at, t.id limit ${limit}`,
    cells: (r) => [
      textCell(r.id),
      dateCell(r.created_at),
      textCell(r.conversation_id),
      r.rating as number,
      textCell(r.suggestion),
      Boolean(r.is_test),
    ],
  },
};

/** Consultas de leitura do painel (conversas, exportação, usuários, auditoria, amostra da IA). */
export function createAdminRepository(orm: OrmClient) {
  return {
    /** Conversas para a busca do painel. As que o usuário apagou não aparecem (ADR-040). */
    async searchConversations(term: string | undefined, page: number) {
      const filters: SQL[] = [isNull(conversations.deletedAt)];
      if (term) {
        const pattern = likePattern(term);
        const match = or(
          ilike(conversations.title, pattern),
          ilike(conversations.sector, pattern),
          ilike(users.fullName, pattern),
          ilike(users.email, pattern),
        );
        if (match) filters.push(match);
      }
      return orm
        .select({
          id: conversations.id,
          title: conversations.title,
          categoryKey: conversations.categoryKey,
          outcome: conversations.outcome,
          sector: conversations.sector,
          isTest: conversations.ticketFormTestMode,
          createdAt: conversations.createdAt,
          lastMessageAt: conversations.lastMessageAt,
          userName: users.fullName,
          userEmail: users.email,
        })
        .from(conversations)
        .innerJoin(users, eq(users.id, conversations.userId))
        .where(and(...filters))
        .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
        .limit(ADMIN_PAGE_SIZE + 1)
        .offset((page - 1) * ADMIN_PAGE_SIZE);
    },

    async findConversation(id: string) {
      const [row] = await orm
        .select({
          id: conversations.id,
          title: conversations.title,
          categoryKey: conversations.categoryKey,
          outcome: conversations.outcome,
          sector: conversations.sector,
          isTest: conversations.ticketFormTestMode,
          createdAt: conversations.createdAt,
          lastMessageAt: conversations.lastMessageAt,
          userName: users.fullName,
          userEmail: users.email,
        })
        .from(conversations)
        .innerJoin(users, eq(users.id, conversations.userId))
        .where(and(eq(conversations.id, id), isNull(conversations.deletedAt)))
        .limit(1);
      return row ?? null;
    },

    conversationMessages(conversationId: string) {
      return orm
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt), asc(messages.id));
    },

    conversationTickets(conversationId: string) {
      return orm
        .select({
          id: ticketAttempts.id,
          status: ticketAttempts.status,
          glpiTicketId: ticketAttempts.glpiTicketId,
          isTest: ticketAttempts.isTest,
          createdAt: ticketAttempts.createdAt,
        })
        .from(ticketAttempts)
        .where(eq(ticketAttempts.conversationId, conversationId))
        .orderBy(asc(ticketAttempts.createdAt));
    },

    async conversationFeedback(conversationId: string) {
      const [row] = await orm
        .select({ rating: feedbacks.rating, suggestion: feedbacks.suggestion })
        .from(feedbacks)
        .where(eq(feedbacks.conversationId, conversationId))
        .limit(1);
      return row ?? null;
    },

    /** Um lote de exportação, na ordem (data, id). */
    async exportBatch(
      source: ExportSource,
      range: Range,
      cursor: ExportCursor | null,
      limit: number,
    ): Promise<Array<Record<string, unknown>>> {
      const result = await orm.execute(source.query(range, cursor, limit));
      return result.rows;
    },

    async searchUsers(term: string | undefined, page: number) {
      const match = term
        ? or(ilike(users.fullName, likePattern(term)), ilike(users.email, likePattern(term)))
        : undefined;
      return orm
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role,
          lastLoginAt: users.lastLoginAt,
          disabledAt: users.disabledAt,
        })
        .from(users)
        .where(match)
        .orderBy(asc(users.fullName), asc(users.id))
        .limit(ADMIN_PAGE_SIZE + 1)
        .offset((page - 1) * ADMIN_PAGE_SIZE);
    },

    async findUserEmail(id: string) {
      const [row] = await orm.select({ email: users.email }).from(users).where(eq(users.id, id));
      return row?.email ?? null;
    },

    async listAudit(action: string | undefined, page: number) {
      return orm
        .select({
          id: auditLog.id,
          createdAt: auditLog.createdAt,
          action: auditLog.action,
          actorName: users.fullName,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          metadata: auditLog.metadata,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorId))
        .where(action ? eq(auditLog.action, action) : undefined)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(ADMIN_PAGE_SIZE + 1)
        .offset((page - 1) * ADMIN_PAGE_SIZE);
    },

    /** Conversas do período para a Análise IA: as mais recentes, sem teste e sem as apagadas. */
    async insightConversations(range: Range, limit: number) {
      const rangeFilter = and(
        isNull(conversations.deletedAt),
        eq(conversations.ticketFormTestMode, false),
        range.from ? sql`${conversations.createdAt} >= ${range.from}` : undefined,
        sql`${conversations.createdAt} <= ${range.to}`,
      );
      const rows = await orm
        .select({
          id: conversations.id,
          title: conversations.title,
          sector: conversations.sector,
        })
        .from(conversations)
        .where(rangeFilter)
        .orderBy(desc(conversations.createdAt))
        .limit(limit);
      const [total] = await orm
        .select({ total: sql<number>`count(*)::int` })
        .from(conversations)
        .where(rangeFilter);
      return { rows, total: total?.total ?? rows.length };
    },

    /** As primeiras falas da pessoa (só as dela) em cada conversa. */
    async firstUserMessages(conversationIds: string[], perConversation: number) {
      if (conversationIds.length === 0) return [];
      const ranked = orm
        .select({
          conversationId: messages.conversationId,
          content: messages.content,
          position:
            sql<number>`row_number() over (partition by ${messages.conversationId} order by ${messages.createdAt}, ${messages.id})`.as(
              'position',
            ),
        })
        .from(messages)
        .where(and(eq(messages.role, 'user'), inArray(messages.conversationId, conversationIds)))
        .as('ranked');
      return orm
        .select({ conversationId: ranked.conversationId, content: ranked.content })
        .from(ranked)
        .where(sql`${ranked.position} <= ${perConversation}`)
        .orderBy(asc(ranked.conversationId), asc(ranked.position));
    },
  };
}

export type AdminRepository = ReturnType<typeof createAdminRepository>;
