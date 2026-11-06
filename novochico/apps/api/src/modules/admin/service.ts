import {
  ADMIN_PAGE_SIZE,
  type AdminConversationDetail,
  type AdminConversationList,
  type AdminPeriod,
  type AdminUsersResponse,
  type AuditResponse,
  type EffectivePrompt,
  type ExportType,
  type InsightsResponse,
  type UserRole,
} from '@chicochat/shared';
import type { OrmClient } from '../../db/client';
import { AppError } from '../../lib/errors';
import { periodRange } from '../analytics';
import { createAudit } from '../audit';
import { ADMIN_BYPASS_BLOCK, buildSystemPrompt } from '../chat';
import type { ContentService } from '../content';
import type { UsersService } from '../users';
import { CSV_BOM, csvLine } from './csv';
import {
  buildInsightsSample,
  INSIGHTS_MAX_CONVERSATIONS,
  INSIGHTS_MESSAGES_PER_CONVERSATION,
  type InsightsService,
} from './insights';
import { createAdminRepository, EXPORT_SOURCES, type ExportCursor } from './repository';

/** Linhas lidas do banco por vez ao exportar: a memória não cresce com o tamanho do período. */
const EXPORT_BATCH = 1000;

const iso = (value: Date) => value.toISOString();

export function createAdminService(deps: {
  orm: OrmClient;
  content: ContentService;
  users: UsersService;
  insights: InsightsService;
  now: () => Date;
}) {
  const repository = createAdminRepository(deps.orm);
  const audit = createAudit(deps.orm);

  const pageOf = <T>(rows: T[]) => ({
    items: rows.slice(0, ADMIN_PAGE_SIZE),
    hasMore: rows.length > ADMIN_PAGE_SIZE,
  });

  return {
    async listConversations(
      term: string | undefined,
      page: number,
    ): Promise<AdminConversationList> {
      const { items, hasMore } = pageOf(await repository.searchConversations(term, page));
      return {
        conversations: items.map((row) => ({
          ...row,
          createdAt: iso(row.createdAt),
          lastMessageAt: iso(row.lastMessageAt),
        })),
        page,
        pageSize: ADMIN_PAGE_SIZE,
        hasMore,
      };
    },

    /**
     * Lê uma conversa. A leitura só acontece depois de a auditoria ser gravada: sem registro, sem
     * acesso (S-14). O registro leva só o identificador, nunca o conteúdo.
     */
    async readConversation(actorId: string, id: string): Promise<AdminConversationDetail> {
      const conversation = await repository.findConversation(id);
      if (!conversation) {
        throw new AppError('CONVERSATION_NOT_FOUND', 404, 'Conversa não encontrada.');
      }
      await audit.record({
        actorId,
        action: 'conversation.read',
        targetType: 'conversation',
        targetId: id,
      });
      const [messages, tickets, feedback] = await Promise.all([
        repository.conversationMessages(id),
        repository.conversationTickets(id),
        repository.conversationFeedback(id),
      ]);
      return {
        ...conversation,
        createdAt: iso(conversation.createdAt),
        lastMessageAt: iso(conversation.lastMessageAt),
        messages: messages.map((message) => ({
          id: message.id,
          role: message.role,
          source: message.source,
          content: message.content,
          incomplete: message.incomplete,
          createdAt: iso(message.createdAt),
        })),
        tickets: tickets.map((ticket) => ({ ...ticket, createdAt: iso(ticket.createdAt) })),
        feedback,
      };
    },

    /**
     * Exportação em CSV (RF-079). A auditoria é gravada antes de qualquer linha sair; os dados vêm
     * em lotes, na ordem (data, id), e o texto de cada célula é protegido contra fórmula.
     */
    async exportCsv(
      actorId: string,
      type: ExportType,
      period: AdminPeriod,
    ): Promise<AsyncGenerator<string, void, undefined>> {
      const source = EXPORT_SOURCES[type];
      if (!source) throw new AppError('EXPORT_UNKNOWN', 404, 'Tipo de exportação desconhecido.');
      const range = periodRange(period, deps.now());
      await audit.record({
        actorId,
        action: 'export.created',
        targetType: 'export',
        targetId: type,
        metadata: { period },
      });

      async function* lines(): AsyncGenerator<string, void, undefined> {
        yield CSV_BOM + csvLine(source!.header);
        let cursor: ExportCursor | null = null;
        for (;;) {
          const batch = await repository.exportBatch(source!, range, cursor, EXPORT_BATCH);
          if (batch.length === 0) return;
          yield batch.map((row) => csvLine(source!.cells(row))).join('');
          const last = batch.at(-1) as { cursor_at: string; id: string };
          cursor = { at: last.cursor_at, id: last.id };
          if (batch.length < EXPORT_BATCH) return;
        }
      }
      return lines();
    },

    /** Análise por IA do período (RF-077). Envia só as falas da pessoa. */
    async analyze(actorId: string, period: AdminPeriod): Promise<InsightsResponse> {
      const range = periodRange(period, deps.now());
      const { rows, total } = await repository.insightConversations(
        range,
        INSIGHTS_MAX_CONVERSATIONS,
      );
      const spoken = await repository.firstUserMessages(
        rows.map((row) => row.id),
        INSIGHTS_MESSAGES_PER_CONVERSATION,
      );
      const byConversation = new Map<string, string[]>();
      for (const message of spoken) {
        const list = byConversation.get(message.conversationId) ?? [];
        list.push(message.content);
        byConversation.set(message.conversationId, list);
      }
      const sample = buildInsightsSample(
        rows
          .map((row) => ({
            title: row.title,
            sector: row.sector,
            messages: byConversation.get(row.id) ?? [],
          }))
          .filter((conversation) => conversation.messages.length > 0),
      );
      const cutByCount = total > rows.length;

      await audit.record({
        actorId,
        action: 'insights.generated',
        targetType: 'insights',
        metadata: { period, conversations: sample.included },
      });
      const result = await deps.insights.analyze(sample);
      return { ...result, truncated: result.truncated || cutByCount };
    },

    /** Prompt como o agente o recebe (RF-084), somente leitura. */
    async effectivePrompt(): Promise<EffectivePrompt> {
      const instructions = await deps.content.getPublishedInstructions();
      const prompt = buildSystemPrompt({ instructions: instructions.content, isAdmin: false });
      return {
        text: prompt.text,
        adminExtra: ADMIN_BYPASS_BLOCK,
        version: prompt.version,
        instructionsVersion: instructions.version,
      };
    },

    async listUsers(term: string | undefined, page: number): Promise<AdminUsersResponse> {
      const { items, hasMore } = pageOf(await repository.searchUsers(term, page));
      return {
        users: items.map((row) => ({
          id: row.id,
          email: row.email,
          fullName: row.fullName,
          role: row.role,
          lastLoginAt: row.lastLoginAt ? iso(row.lastLoginAt) : null,
          disabled: row.disabledAt !== null,
        })),
        page,
        pageSize: ADMIN_PAGE_SIZE,
        hasMore,
      };
    },

    /** Troca o papel; o `users` audita e impede remover o último administrador. */
    async changeRole(actorId: string, userId: string, role: UserRole): Promise<void> {
      const email = await repository.findUserEmail(userId);
      if (!email) throw new AppError('USER_NOT_FOUND', 404, 'Usuário não encontrado.');
      await deps.users.changeRole({ email, role, actorId, via: 'admin' });
    },

    async listAudit(action: string | undefined, page: number): Promise<AuditResponse> {
      const { items, hasMore } = pageOf(await repository.listAudit(action, page));
      return {
        entries: items.map((row) => ({
          id: row.id,
          createdAt: iso(row.createdAt),
          action: row.action,
          actorName: row.actorName,
          targetType: row.targetType,
          targetId: row.targetId,
          metadata: (row.metadata ?? {}) as Record<string, string | number | boolean | null>,
        })),
        page,
        pageSize: ADMIN_PAGE_SIZE,
        hasMore,
      };
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
