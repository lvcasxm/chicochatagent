import type {
  ChatMessage,
  ConversationDetail,
  ConversationSummary,
  TriageState,
} from '@chicochat/shared';
import { ATTENDANCE_SESSION_TIMEOUT_MINUTES } from '@chicochat/shared';
import { AppError } from '../../lib/errors';
import type {
  ConversationPatch,
  ConversationRow,
  ConversationsRepository,
  MessageRow,
} from './repository';

/** Histórico enviado à IA: as 16 últimas mensagens, cada uma com no máximo 2000 caracteres (H.2). */
const HISTORY_LIMIT = 16;
const HISTORY_MESSAGE_MAX_LENGTH = 2000;
const LIST_LIMIT = 100;
const TRANSCRIPT_LIMIT = 60;

export type { ConversationRow, MessageRow };

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    categoryKey: row.categoryKey,
    outcome: row.outcome,
    lastMessageAt: row.lastMessageAt.toISOString(),
  };
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    incomplete: row.incomplete,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A avaliação só se abre depois de um chamado aberto ou de uma resolução confirmada (RF-060). */
function feedbackStatus(row: ConversationRow, given: boolean): TriageState['feedback'] {
  if (given) return 'given';
  return row.outcome === 'resolved' || row.outcome === 'escalated' ? 'available' : 'unavailable';
}

export function toTriageState(row: ConversationRow, feedbackGiven = false): TriageState {
  return {
    resolutionAttempts: row.resolutionAttempts,
    issuePersists: row.issuePersists,
    ticketFormUnlocked: row.ticketFormUnlockedAt !== null,
    testMode: row.ticketFormUnlockedAt !== null && row.ticketFormTestMode,
    resolved: row.resolvedAt !== null,
    feedback: feedbackStatus(row, feedbackGiven),
  };
}

/** Corta o texto no limite, com reticências, sem partir em meio a um par substituto. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${Array.from(text)
    .slice(0, max - 1)
    .join('')}…`;
}

export function createConversationsService(deps: {
  repository: ConversationsRepository;
  now: () => Date;
}) {
  const { repository, now } = deps;

  /**
   * A conversa é do usuário que a criou. De outro usuário, excluída ou inexistente, a resposta é
   * a mesma (404), para não revelar que o identificador existe (ADR-010).
   */
  async function requireOwned(id: string, userId: string): Promise<ConversationRow> {
    const row = await repository.findOwned(id, userId);
    if (!row) throw new AppError('CONVERSATION_NOT_FOUND', 404, 'Conversa não encontrada.');
    return row;
  }

  return {
    requireOwned,

    async create(userId: string, categoryKey: string | null): Promise<ConversationSummary> {
      return toSummary(await repository.insert({ userId, categoryKey }));
    },

    /** Linha completa da conversa criada, para quem precisa do estado interno (o serviço do chat). */
    async createRecord(userId: string, categoryKey: string | null): Promise<ConversationRow> {
      return repository.insert({ userId, categoryKey });
    },

    async list(userId: string): Promise<ConversationSummary[]> {
      return (await repository.listByUser(userId, LIST_LIMIT)).map(toSummary);
    },

    async detail(id: string, userId: string): Promise<ConversationDetail> {
      const row = await requireOwned(id, userId);
      const rows = await repository.listMessages(id);
      return {
        ...toSummary(row),
        messages: rows.map(toMessage),
        triage: toTriageState(row, await repository.hasFeedback(id)),
      };
    },

    /** Exclusão lógica: some da visão do usuário, mas continua para métricas e auditoria (RF-018). */
    async remove(id: string, userId: string): Promise<void> {
      await requireOwned(id, userId);
      await repository.update(id, { deletedAt: now() }, now());
    },

    /** Mensagens que a IA enxerga: só `user` e `assistant` completas, as 16 últimas, cada uma limitada. */
    async history(id: string): Promise<HistoryMessage[]> {
      const rows = await repository.lastMessages(id, HISTORY_LIMIT * 2);
      return rows
        .filter(
          (row): row is MessageRow & { role: 'user' | 'assistant' } =>
            (row.role === 'user' || row.role === 'assistant') && !row.incomplete,
        )
        .slice(-HISTORY_LIMIT)
        .map((row) => ({ role: row.role, content: clip(row.content, HISTORY_MESSAGE_MAX_LENGTH) }));
    },

    /** A conversa para o resumo do chamado: user e assistant completas, as 60 últimas, cada uma limitada. */
    async transcript(id: string): Promise<HistoryMessage[]> {
      const rows = await repository.lastMessages(id, TRANSCRIPT_LIMIT * 2);
      return rows
        .filter(
          (row): row is MessageRow & { role: 'user' | 'assistant' } =>
            (row.role === 'user' || row.role === 'assistant') && !row.incomplete,
        )
        .slice(-TRANSCRIPT_LIMIT)
        .map((row) => ({ role: row.role, content: clip(row.content, HISTORY_MESSAGE_MAX_LENGTH) }));
    },

    /**
     * Fecha as conversas sem atividade há 30 minutos (RF-064): marca o fim da sessão de
     * atendimento e, sem desfecho (nem resolvida nem escalada), o desfecho vira `no_outcome`.
     * O fim é o instante em que a sessão expirou, não o da varredura. Devolve o que fechou.
     */
    async closeInactive(limit = 200): Promise<ConversationRow[]> {
      const at = now();
      const timeoutMs = ATTENDANCE_SESSION_TIMEOUT_MINUTES * 60_000;
      const inactive = await repository.listInactive(new Date(at.getTime() - timeoutMs), limit);
      const closed: ConversationRow[] = [];
      for (const row of inactive) {
        closed.push(
          await repository.update(
            row.id,
            {
              finishedAt: new Date(row.lastMessageAt.getTime() + timeoutMs),
              ...(row.outcome === null ? { outcome: 'no_outcome' as const } : {}),
            },
            at,
          ),
        );
      }
      return closed;
    },

    async lastMessage(id: string): Promise<MessageRow | null> {
      const rows = await repository.lastMessages(id, 1);
      return rows[0] ?? null;
    },

    countMessages: (id: string) => repository.countMessages(id),

    addMessage: (values: Parameters<ConversationsRepository['insertMessage']>[0]) =>
      repository.insertMessage(values),

    update: (id: string, patch: ConversationPatch) => repository.update(id, patch, now()),

    incrementAttempts: (id: string) => repository.incrementAttempts(id, now()),
  };
}

export type ConversationsService = ReturnType<typeof createConversationsService>;
