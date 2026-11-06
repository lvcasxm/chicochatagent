import { randomUUID } from 'node:crypto';
import {
  ATTENDANCE_SESSION_TIMEOUT_MINUTES,
  type ChatEvent,
  type ConversationSummary,
  type UserRole,
} from '@chicochat/shared';
import { LlmError, type LlmChunk, type LlmClient } from '../../integrations/gemini/llm';
import { AppError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import type { AnalyticsService } from '../analytics';
import type { ChatCategory, ContentService } from '../content';
import {
  isCannedGreeting,
  isPlaceholderTitle,
  smartConversationTitle,
  type ConversationRow,
  type ConversationsService,
} from '../conversations';
import { buildSystemPrompt } from './prompt/build';
import { isCacheableAnswer, isCacheableQuestion, type ResponseCache } from './response-cache';
import { createMarkerFilter, stripMarkers } from './stream-filter';
import {
  detectUserSignal,
  hasEscalationPhrase,
  isAdminTestShortcut,
  type UserSignal,
} from './triage';

export interface ChatActor {
  id: string;
  role: UserRole;
}

/** Um turno em andamento: os eventos do stream e a liberação da trava da conversa. */
export interface Turn {
  events: AsyncGenerator<ChatEvent, void, undefined>;
  /** Idempotente. A rota chama sempre, mesmo se o stream não for lido até o fim. */
  dispose(): void;
}

export const MESSAGES = {
  aiUnavailable: 'Serviço de IA indisponível no momento.',
  rateLimited: 'Muitas solicitações. Tente novamente em alguns instantes.',
  busy: 'Alta demanda no momento. Aguarde alguns segundos e tente novamente — você não perdeu a conversa.',
  interrupted: 'A resposta foi interrompida. Você pode tentar de novo.',
  turnInProgress: 'Aguarde a resposta anterior terminar.',
  testShortcut: 'Modo de teste: o formulário de chamado foi liberado para você, administrador.',
} as const;

/** Mensagens por minuto, por usuário. Passar disso é quase sempre um erro de programa, não uso. */
const MESSAGES_PER_MINUTE = 20;
/** Respostas do cache saem em blocos curtos, como um stream de verdade. */
const CACHE_CHUNK_SIZE = 48;

export interface ChatServiceDeps {
  conversations: ConversationsService;
  content: ContentService;
  analytics: AnalyticsService;
  /** Nulo quando não há como falar com a IA (sem chave): o chat responde que está indisponível. */
  llm: LlmClient | null;
  /** Nome do modelo, gravado em cada resposta. */
  modelName: string | null;
  cache: ResponseCache;
  logger: Logger;
  now: () => Date;
}

function toAppError(error: unknown): AppError {
  const failure = error instanceof LlmError ? error : new LlmError('unavailable', { cause: error });
  switch (failure.kind) {
    case 'rate_limited':
      return new AppError('RATE_LIMITED', 429, MESSAGES.rateLimited, { cause: failure });
    case 'busy':
      return new AppError('BUSY', 503, MESSAGES.busy, { cause: failure, retryAfterSeconds: 5 });
    default:
      return new AppError('AI_UNAVAILABLE', 503, MESSAGES.aiUnavailable, { cause: failure });
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function* cachedChunks(answer: string): AsyncGenerator<LlmChunk> {
  for (let i = 0; i < answer.length; i += CACHE_CHUNK_SIZE) {
    yield { type: 'text', text: answer.slice(i, i + CACHE_CHUNK_SIZE) };
  }
  yield { type: 'end', finishReason: 'CACHE' };
}

export function createChatService(deps: ChatServiceDeps) {
  const { conversations, content, analytics, llm, cache, logger, now } = deps;

  /** Conversas com um turno em andamento: duas respostas ao mesmo tempo se embaralhariam. */
  const busyConversations = new Set<string>();
  const recentByUser = new Map<string, number[]>();

  function checkRateLimit(userId: string): void {
    const at = now().getTime();
    const recent = (recentByUser.get(userId) ?? []).filter((time) => at - time < 60_000);
    if (recent.length >= MESSAGES_PER_MINUTE) {
      recentByUser.set(userId, recent);
      throw new AppError('RATE_LIMITED', 429, MESSAGES.rateLimited, { retryAfterSeconds: 10 });
    }
    recent.push(at);
    recentByUser.set(userId, recent);
  }

  /** Falha em registrar métrica nunca derruba o atendimento. */
  async function record(...args: Parameters<AnalyticsService['record']>): Promise<void> {
    try {
      await analytics.record(...args);
    } catch (error) {
      logger.warn({ err: error, eventType: args[0].eventType }, 'Falha ao registrar evento');
    }
  }

  function categoryFor(row: ConversationRow, categories: ChatCategory[]): ChatCategory | undefined {
    return categories.find((category) => category.key === row.categoryKey);
  }

  /** Título provisório pelo rótulo do card, ou o título inteligente do que a pessoa escreveu. */
  function chooseTitle(
    row: ConversationRow,
    text: string,
    isFirstMessage: boolean,
    categories: ChatCategory[],
  ): string | null {
    const canned = isCannedGreeting(
      text,
      categories.flatMap((category) => (category.cannedMessage ? [category.cannedMessage] : [])),
    );
    if (canned) {
      if (!isFirstMessage) return null;
      const matching =
        categoryFor(row, categories) ??
        categories.find((category) => category.cannedMessage?.trim() === text.trim());
      return matching?.shortLabel ?? smartConversationTitle(text);
    }
    const shortLabels = categories.flatMap((category) =>
      category.shortLabel ? [category.shortLabel] : [],
    );
    if (isFirstMessage || isPlaceholderTitle(row.title, shortLabels)) {
      return smartConversationTitle(text) || text.slice(0, 50);
    }
    return null;
  }

  return {
    /** Cria a conversa, com a categoria do card se a pessoa partiu de um (RF-010). */
    async startConversation(
      actor: ChatActor,
      categoryKey: string | null,
    ): Promise<ConversationSummary> {
      if (categoryKey !== null) {
        const categories = await content.listChatCategories();
        if (!categories.some((category) => category.key === categoryKey)) {
          throw new AppError('INVALID_INPUT', 422, 'Os dados enviados são inválidos.');
        }
      }
      const row = await conversations.createRecord(actor.id, categoryKey);
      await record({
        eventType: 'conversation_started',
        userId: actor.id,
        conversationId: row.id,
        attendanceSessionId: row.attendanceSessionId,
        category: categoryKey,
      });
      if (categoryKey !== null) {
        await record({
          eventType: 'category_detected',
          userId: actor.id,
          conversationId: row.id,
          attendanceSessionId: row.attendanceSessionId,
          category: categoryKey,
        });
      }
      return {
        id: row.id,
        title: row.title,
        categoryKey: row.categoryKey,
        outcome: row.outcome,
        lastMessageAt: row.lastMessageAt.toISOString(),
      };
    },

    /**
     * Valida, grava a mensagem e abre a conexão com a IA. Tudo o que pode falhar antes do primeiro
     * trecho de resposta falha aqui, como erro HTTP normal; depois disso, a falha vira evento
     * `error` no stream (SONNET_CONTEXT, seção E).
     */
    async startTurn(input: {
      actor: ChatActor;
      conversationId: string;
      text: string;
      signal: AbortSignal;
    }): Promise<Turn> {
      const { actor, conversationId, text, signal } = input;
      const isAdmin = actor.role === 'admin';

      let row = await conversations.requireOwned(conversationId, actor.id);
      checkRateLimit(actor.id);

      if (busyConversations.has(conversationId)) {
        throw new AppError('TURN_IN_PROGRESS', 409, MESSAGES.turnInProgress);
      }
      busyConversations.add(conversationId);
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        busyConversations.delete(conversationId);
      };

      try {
        const at = now();
        const categories = await content.listChatCategories();
        const previous = await conversations.lastMessage(conversationId);
        const isFirstMessage = previous === null;

        // Repetir o envio depois de uma falha (RF-028): a mensagem já gravada, sem resposta, é reaproveitada.
        const isRetry = previous?.role === 'user' && previous.content === text;
        if (!isRetry) {
          await conversations.addMessage({ conversationId, role: 'user', content: text });
        }

        // Sessão de atendimento: 30 minutos sem atividade abrem uma nova (RN-32).
        const idleMs = at.getTime() - row.lastMessageAt.getTime();
        const newSession = !isFirstMessage && idleMs > ATTENDANCE_SESSION_TIMEOUT_MINUTES * 60_000;

        const userSignal: UserSignal = detectUserSignal(text);
        const title = chooseTitle(row, text, isFirstMessage, categories);
        row = await conversations.update(conversationId, {
          lastMessageAt: at,
          // Voltou a conversar: a sessão anterior já tinha sido fechada por inatividade; começa outra.
          finishedAt: null,
          ...(row.outcome === 'no_outcome' ? { outcome: null } : {}),
          ...(title ? { title } : {}),
          ...(newSession ? { attendanceSessionId: randomUUID() } : {}),
          ...(userSignal === 'persists' ? { issuePersists: true } : {}),
          ...(userSignal === 'resolved' ? { resolvedAt: at, outcome: 'resolved' as const } : {}),
        });
        const resolvedNow = userSignal === 'resolved';
        const persistsNow = userSignal === 'persists';
        if (resolvedNow) {
          await record({
            eventType: 'resolved_without_ticket',
            userId: actor.id,
            conversationId,
            attendanceSessionId: row.attendanceSessionId,
            category: row.categoryKey,
          });
        }

        // Atalho de teste do administrador: libera o formulário sem chamar a IA (RF-025).
        if (isAdmin && isAdminTestShortcut(text)) {
          return await openTestShortcut();
        }

        if (!llm) throw new AppError('AI_UNAVAILABLE', 503, MESSAGES.aiUnavailable);

        const instructions = await content.getPublishedInstructions();
        const prompt = buildSystemPrompt({ instructions: instructions.content, isAdmin });
        const history = await conversations.history(conversationId);

        const cacheable = isCacheableQuestion({ text, isFirstMessage, isAdmin });
        const cachedAnswer = cacheable ? await cache.lookup(prompt.version, text) : null;

        let source: AsyncIterator<LlmChunk>;
        let first: IteratorResult<LlmChunk>;
        const mode: 'normal' | 'cache' = cachedAnswer === null ? 'normal' : 'cache';
        if (cachedAnswer !== null) {
          source = cachedChunks(cachedAnswer)[Symbol.asyncIterator]();
        } else {
          const stream = llm.streamChat({ system: prompt.text, messages: history, signal });
          source = stream[Symbol.asyncIterator]();
        }
        try {
          first = await source.next();
        } catch (error) {
          if (error instanceof LlmError && error.kind === 'aborted') throw error;
          logger.warn({ err: error, conversationId }, 'Falha ao iniciar a resposta da IA');
          throw toAppError(error);
        }

        const events = streamAnswer({
          row,
          source,
          first,
          mode,
          promptVersion: prompt.version,
          question: text,
          cacheable,
          resolvedNow,
          persistsNow,
          signal,
          dispose,
        });
        return { events, dispose };
      } catch (error) {
        dispose();
        throw error;
      }

      async function openTestShortcut(): Promise<Turn> {
        const notice = await conversations.addMessage({
          conversationId,
          role: 'notice',
          content: MESSAGES.testShortcut,
          source: 'system',
        });
        await conversations.update(conversationId, {
          ticketFormUnlockedAt: now(),
          ticketFormTestMode: true,
        });
        // eslint-disable-next-line @typescript-eslint/require-await
        async function* events(): AsyncGenerator<ChatEvent, void, undefined> {
          try {
            yield { event: 'meta', data: { messageId: notice.id, mode: 'normal' } };
            yield { event: 'delta', data: { text: MESSAGES.testShortcut } };
            yield { event: 'ticket_form', data: { testMode: true } };
            yield { event: 'done', data: { messageId: notice.id, title: null } };
          } finally {
            dispose();
          }
        }
        return { events: events(), dispose };
      }
    },
  };

  /** Lê a resposta da IA (ou do cache), filtra os marcadores, grava e atualiza a triagem. */
  async function* streamAnswer(args: {
    row: ConversationRow;
    source: AsyncIterator<LlmChunk>;
    first: IteratorResult<LlmChunk>;
    mode: 'normal' | 'cache';
    promptVersion: string;
    question: string;
    cacheable: boolean;
    resolvedNow: boolean;
    persistsNow: boolean;
    signal: AbortSignal;
    dispose: () => void;
  }): AsyncGenerator<ChatEvent, void, undefined> {
    const { row, source, mode, signal } = args;
    const filter = createMarkerFilter();
    const assistantId = randomUUID();
    let raw = '';
    let finishReason: string | undefined;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let failure: unknown;

    try {
      yield { event: 'meta', data: { messageId: assistantId, mode } };

      try {
        let current = args.first;
        while (!current.done) {
          const chunk = current.value;
          if (chunk.type === 'text') {
            raw += chunk.text;
            const safe = filter.push(chunk.text);
            if (safe) yield { event: 'delta', data: { text: safe } };
          } else {
            finishReason = chunk.finishReason;
            promptTokens = chunk.promptTokens;
            completionTokens = chunk.completionTokens;
          }
          current = await source.next();
        }
      } catch (error) {
        failure = error;
      }

      const { rest, text: finalText, markers } = filter.finish();
      const aborted = signal.aborted || (failure instanceof LlmError && failure.kind === 'aborted');
      const incomplete = failure !== undefined;

      if (rest && !aborted) yield { event: 'delta', data: { text: rest } };

      // Sem texto nenhum não há o que gravar; com o cliente já desconectado, só encerra.
      if (finalText === '') {
        if (failure !== undefined && !aborted) {
          logger.warn(
            { err: failure, conversationId: row.id },
            'Resposta da IA vazia ou interrompida',
          );
        }
        if (!aborted) {
          yield {
            event: 'error',
            data: { code: 'AI_INTERRUPTED', message: MESSAGES.interrupted },
          };
        }
        return;
      }

      const saved = await conversations.addMessage({
        id: assistantId,
        conversationId: row.id,
        role: 'assistant',
        content: finalText,
        source: mode === 'cache' ? 'cache' : 'llm',
        incomplete,
        model: mode === 'cache' ? null : deps.modelName,
        finishReason: finishReason ?? null,
        promptTokens: promptTokens ?? null,
        completionTokens: completionTokens ?? null,
        promptVersion: args.promptVersion,
      });

      // A resposta inteira, e só ela, pode ser reaproveitada por outras pessoas (H.7).
      if (!incomplete && mode === 'normal' && args.cacheable && isCacheableAnswer(raw)) {
        try {
          await cache.store(args.promptVersion, args.question, raw);
        } catch (error) {
          logger.warn({ err: error }, 'Falha ao gravar o cache de resposta');
        }
      }

      // Marcadores vistos valem; o escalonamento por frase só vale numa resposta completa.
      const attemptSeen = markers.resolutionAttempt;
      const openForm =
        markers.openTicketForm || (!incomplete && hasEscalationPhrase(stripMarkers(raw)));

      const patch: Parameters<ConversationsService['update']>[1] = { lastMessageAt: now() };
      let attempts = row.resolutionAttempts;
      if (attemptSeen) attempts = await conversations.incrementAttempts(row.id);
      const newlyUnlocked = openForm && row.ticketFormUnlockedAt === null;
      if (newlyUnlocked) {
        patch.ticketFormUnlockedAt = now();
        patch.ticketFormTestMode = false;
      }
      const updated = await conversations.update(row.id, patch);

      if (aborted) return;

      if (failure !== undefined) {
        logger.warn({ err: failure, conversationId: row.id }, 'Resposta da IA interrompida');
        yield { event: 'error', data: { code: 'AI_INTERRUPTED', message: MESSAGES.interrupted } };
        return;
      }

      if (attemptSeen || args.persistsNow) {
        yield {
          event: 'triage',
          data: { resolutionAttempts: attempts, issuePersists: updated.issuePersists },
        };
      }
      if (openForm) {
        yield { event: 'ticket_form', data: { testMode: updated.ticketFormTestMode } };
      }
      if (args.resolvedNow) yield { event: 'feedback_prompt', data: {} };
      yield { event: 'done', data: { messageId: saved.id, title: updated.title } };
    } finally {
      args.dispose();
      // Cliente que desistiu (ou erro): encerra a origem para o upstream cancelar.
      await source.return?.(undefined);
    }
  }
}

export type ChatService = ReturnType<typeof createChatService>;
