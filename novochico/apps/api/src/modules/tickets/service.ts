import {
  isValidMachineIp,
  type CreateTicketRequest,
  type CreateTicketResponse,
  type TicketCheckResponse,
  type UserRole,
} from '@chicochat/shared';
import { GlpiError, type GlpiClient } from '../../integrations/glpi/glpi';
import type { LlmClient } from '../../integrations/gemini/llm';
import { AppError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import type { AnalyticsService } from '../analytics';
import type { ContentService } from '../content';
import type { ConversationRow, ConversationsService } from '../conversations';
import { buildTicketContent } from './description';
import {
  COLLECTIVE_MAX_TICKETS,
  COLLECTIVE_WINDOW_HOURS,
  PERSONAL_MAX_TICKETS,
  PERSONAL_WINDOW_DAYS,
  detectCollectiveIncident,
  findSimilarTickets,
  type CurrentCase,
  type PastTicket,
} from './duplicate-detection';
import { buildFallbackSummary, buildTestSummary } from './fallback-summary';
import type { TicketAttemptRow, TicketsRepository } from './repository';
import { summarizeWithLlm, type TicketSummary } from './summary';

export interface TicketActor {
  id: string;
  role: UserRole;
  fullName: string;
  email: string;
}

/** Textos para a pessoa (G.8): sempre seguros, sem detalhe técnico e sem promessa (B-13). */
export const TICKET_MESSAGES = {
  unavailable:
    'O sistema de chamados está indisponível. Você pode abrir o chamado direto pelo portal.',
  unknown:
    'Não conseguimos confirmar a abertura. Confira em Meus chamados antes de tentar de novo.',
  notUnlocked:
    'Para abrir um chamado, o ChicoChat+ primeiro precisa entender o problema. Continue a conversa.',
  inProgress: 'Este chamado já está sendo aberto. Aguarde alguns instantes.',
  invalidIp: 'O IP informado não tem o formato esperado.',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface TicketsServiceDeps {
  repository: TicketsRepository;
  conversations: ConversationsService;
  content: ContentService;
  analytics: AnalyticsService;
  /** Nulo: o GLPI não está configurado e a abertura fica indisponível. */
  glpi: GlpiClient | null;
  /** IA do resumo; nulo ou com falha, o resumo cai na contingência sem IA. */
  summaryLlm: LlmClient | null;
  /** Formato aceito do IP da máquina (PEND-13). */
  ipPattern: RegExp;
  logger: Logger;
  now: () => Date;
}

function successMessage(ticketId: string): string {
  // Sem prometer retorno nem notificação: isso depende de confirmação da SATD (PEND-18, B-13).
  return `Chamado nº ${ticketId} aberto.`;
}

/** Resposta de uma tentativa já finalizada, sem expor o detalhe técnico guardado. */
function responseFor(attempt: TicketAttemptRow): CreateTicketResponse {
  if (attempt.status === 'success') {
    return {
      status: 'success',
      ticketId: attempt.glpiTicketId,
      title: attempt.title,
      message: successMessage(attempt.glpiTicketId ?? ''),
    };
  }
  if (attempt.status === 'unknown') {
    return {
      status: 'unknown',
      ticketId: null,
      title: attempt.title,
      message: TICKET_MESSAGES.unknown,
    };
  }
  return {
    status: 'failed',
    ticketId: null,
    title: attempt.title,
    message: TICKET_MESSAGES.unavailable,
  };
}

export function createTicketsService(deps: TicketsServiceDeps) {
  const { repository, conversations, content, analytics, glpi, summaryLlm, logger, now } = deps;

  async function record(...args: Parameters<AnalyticsService['record']>): Promise<void> {
    try {
      await analytics.record(...args);
    } catch (error) {
      logger.warn({ err: error, eventType: args[0].eventType }, 'Falha ao registrar evento');
    }
  }

  /** Categoria travada pelo card (RF-041): o título do card, que é o nome da categoria do chamado. */
  async function lockedCategoryOf(row: ConversationRow): Promise<string | null> {
    if (!row.categoryKey) return null;
    const categories = await content.listChatCategories();
    return categories.find((category) => category.key === row.categoryKey)?.title ?? null;
  }

  async function currentCase(row: ConversationRow): Promise<CurrentCase> {
    const transcript = await conversations.transcript(row.id);
    return {
      category: await lockedCategoryOf(row),
      userMessages: transcript.filter((line) => line.role === 'user').map((line) => line.content),
    };
  }

  function toPast(attempt: TicketAttemptRow): PastTicket {
    return {
      ticketId: attempt.glpiTicketId ?? '',
      userId: attempt.userId,
      title: attempt.title ?? '',
      summary: attempt.summary,
      category: attempt.category,
      createdAt: attempt.createdAt,
    };
  }

  return {
    /** Último setor usado, para pré-preencher o formulário (RF-032). */
    lastSector: (userId: string) => repository.lastSector(userId),

    /**
     * Chamados parecidos e incidente coletivo (RF-036 a RF-038). Nunca bloqueia: falha na
     * checagem devolve vazio e a abertura segue (G.6).
     */
    async check(actor: TicketActor, conversationId: string): Promise<TicketCheckResponse> {
      const row = await conversations.requireOwned(conversationId, actor.id);
      try {
        const at = now();
        const current = await currentCase(row);
        const personal = (
          await repository.listUserSuccess(
            actor.id,
            new Date(at.getTime() - PERSONAL_WINDOW_DAYS * DAY_MS),
            PERSONAL_MAX_TICKETS,
          )
        ).map(toPast);
        const recent = (
          await repository.listRecentSuccess(
            new Date(at.getTime() - COLLECTIVE_WINDOW_HOURS * HOUR_MS),
            COLLECTIVE_MAX_TICKETS,
          )
        ).map(toPast);

        const similar = findSimilarTickets(current, personal, at).map((ticket) => ({
          ticketId: ticket.ticketId,
          title: ticket.title,
          category: ticket.category,
          ageMinutes: ticket.ageMinutes,
        }));
        const collective = detectCollectiveIncident(current, recent, actor.id, at);
        if (similar.length > 0 || collective) {
          await record({
            eventType: 'ticket_duplicate_warning_shown',
            userId: actor.id,
            conversationId,
            attendanceSessionId: row.attendanceSessionId,
            category: current.category,
            metadata: { similar: similar.length, collective: collective !== null },
          });
        }
        return { similar, collective };
      } catch (error) {
        logger.warn({ err: error, conversationId }, 'Falha ao checar chamados parecidos');
        return { similar: [], collective: null };
      }
    },

    /**
     * Abre o chamado no GLPI. A identidade vem da sessão. A mesma chave de idempotência nunca cria
     * dois chamados: repetir devolve o resultado já gravado (B-09).
     */
    async create(input: {
      actor: TicketActor;
      conversationId: string;
      idempotencyKey: string;
      request: CreateTicketRequest;
      signal: AbortSignal;
    }): Promise<{ response: CreateTicketResponse; created: boolean }> {
      const { actor, conversationId, idempotencyKey, request } = input;
      const isAdmin = actor.role === 'admin';

      if (!glpi) throw new AppError('GLPI_UNAVAILABLE', 503, TICKET_MESSAGES.unavailable);
      const row = await conversations.requireOwned(conversationId, actor.id);

      if (request.testMode && !isAdmin) {
        throw new AppError('FORBIDDEN', 403, 'Você não tem permissão para isso.');
      }
      // A liberação é decisão do servidor (ADR-012): só o administrador pula a triagem.
      if (!isAdmin && row.ticketFormUnlockedAt === null) {
        throw new AppError('TICKET_NOT_UNLOCKED', 403, TICKET_MESSAGES.notUnlocked);
      }
      if (request.machineIp !== undefined && !isValidMachineIp(request.machineIp, deps.ipPattern)) {
        throw new AppError('INVALID_IP', 422, TICKET_MESSAGES.invalidIp);
      }

      const isTest = request.testMode;
      const attempt = await repository.insertPending({
        conversationId,
        userId: actor.id,
        idempotencyKey,
        requesterName: actor.fullName,
        requesterEmail: actor.email,
        sector: request.sector,
        machineIp: request.ipUnavailable ? null : (request.machineIp ?? null),
        ipUnavailable: request.ipUnavailable,
        onBehalf: request.onBehalf,
        beneficiaryName: request.onBehalf ? (request.beneficiaryName ?? null) : null,
        beneficiaryRegistration: request.onBehalf
          ? (request.beneficiaryRegistration ?? null)
          : null,
        beneficiarySector: request.onBehalf ? (request.beneficiarySector ?? null) : null,
        isTest,
      });

      if (!attempt) {
        // Mesma chave: nada novo é criado. Enquanto a primeira ainda corre, a segunda espera.
        const existing = await repository.findByKey(conversationId, idempotencyKey);
        if (!existing || existing.status === 'pending') {
          throw new AppError('TICKET_IN_PROGRESS', 409, TICKET_MESSAGES.inProgress);
        }
        return { response: responseFor(existing), created: false };
      }

      const at = now();
      const transcript = await conversations.transcript(conversationId);
      const lockedCategory = await lockedCategoryOf(row);
      const cannedMessages = (await content.listChatCategories()).flatMap((category) =>
        category.cannedMessage ? [category.cannedMessage] : [],
      );

      let summary: TicketSummary;
      if (isTest) {
        summary = buildTestSummary({
          sector: request.sector,
          date: at.toLocaleDateString('pt-BR'),
        });
      } else {
        const fromLlm = summaryLlm
          ? await summarizeWithLlm({
              llm: summaryLlm,
              sector: request.sector,
              lockedCategory,
              transcript,
              signal: input.signal,
              onFailure: (n, error) =>
                logger.warn({ err: error, attempt: n, conversationId }, 'Resumo do chamado falhou'),
            })
          : null;
        summary =
          fromLlm ??
          buildFallbackSummary({
            sector: request.sector,
            lockedCategory,
            transcript,
            cannedMessages,
          });
      }

      const ticketContent = buildTicketContent({
        requesterName: actor.fullName,
        requesterEmail: actor.email,
        sector: request.sector,
        machineIp: request.ipUnavailable ? null : (request.machineIp ?? null),
        category: summary.category,
        onBehalf: request.onBehalf,
        beneficiaryName: request.beneficiaryName ?? null,
        beneficiaryRegistration: request.beneficiaryRegistration ?? null,
        beneficiarySector: request.beneficiarySector ?? null,
        description: summary.description,
      });

      // O solicitante é localizado pelo e-mail da sessão; não achar nunca bloqueia (RF-043).
      let requesterId: number | null = null;
      try {
        requesterId = await glpi.findRequesterId(actor.email);
      } catch (error) {
        logger.warn({ err: error, conversationId }, 'Falha ao buscar o solicitante no GLPI');
      }

      const base = {
        title: summary.title,
        category: summary.category,
        urgency: summary.urgency,
        summary: summary.description,
        summarySource: summary.source,
      };

      let created: { ticketId: string };
      try {
        created = await glpi.createTicket({
          title: summary.title,
          content: ticketContent,
          urgency: summary.urgency,
        });
      } catch (error) {
        const failure =
          error instanceof GlpiError ? error : new GlpiError('GLPI_UNAVAILABLE', { cause: error });
        // Detalhe técnico só no log e na tentativa; a pessoa recebe um texto seguro (S-12).
        logger.error(
          { code: failure.code, httpStatus: failure.httpStatus, conversationId },
          'Falha ao abrir chamado no GLPI',
        );
        const final = await repository.finalize(
          attempt.id,
          {
            ...base,
            status: failure.outcomeUnknown ? 'unknown' : 'failed',
            errorCode: failure.code,
            errorDetail: failure.message,
          },
          now(),
        );
        if (!isTest) {
          await record({
            eventType: 'ticket_failed',
            userId: actor.id,
            conversationId,
            attendanceSessionId: row.attendanceSessionId,
            category: summary.category,
            sector: request.sector,
            metadata: { code: failure.code },
          });
        }
        return {
          response: responseFor(final ?? { ...attempt, ...base, status: 'failed' }),
          created: false,
        };
      }

      if (requesterId !== null) {
        try {
          await glpi.attachRequester(created.ticketId, requesterId);
        } catch (error) {
          // O chamado já existe: falhar ao ligar o solicitante é só um aviso (G.4).
          logger.warn({ err: error, conversationId }, 'Falha ao ligar o solicitante ao chamado');
        }
      }

      const final = await repository.finalize(
        attempt.id,
        {
          ...base,
          status: 'success',
          glpiTicketId: created.ticketId,
          glpiRequesterId: requesterId,
        },
        now(),
      );
      const response = responseFor(
        final ?? { ...attempt, ...base, status: 'success', glpiTicketId: created.ticketId },
      );

      await conversations.addMessage({
        conversationId,
        role: 'notice',
        content: response.message,
        source: 'system',
      });
      await conversations.update(conversationId, {
        sector: request.sector,
        ...(isTest ? {} : { outcome: 'escalated' as const }),
      });

      // Chamado de teste fica fora das métricas e da duplicidade (RN, modo teste).
      if (!isTest) {
        await record({
          eventType: 'ticket_created',
          userId: actor.id,
          conversationId,
          attendanceSessionId: row.attendanceSessionId,
          category: summary.category,
          sector: request.sector,
          metadata: { summarySource: summary.source },
        });
        if (request.duplicateOverride) {
          await record({
            eventType: 'ticket_duplicate_overridden',
            userId: actor.id,
            conversationId,
            attendanceSessionId: row.attendanceSessionId,
            category: summary.category,
          });
        }
      }

      return { response, created: true };
    },
  };
}

export type TicketsService = ReturnType<typeof createTicketsService>;
