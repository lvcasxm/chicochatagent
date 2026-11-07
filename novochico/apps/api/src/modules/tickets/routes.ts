import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createTicketRequestSchema,
  type CreateTicketResponse,
  type MyTicketsResponse,
  type TicketCheckResponse,
} from '@chicochat/shared';
import { requireAuth } from '../../http/auth';
import type { UserRateLimiter } from '../../http/user-rate-limit';
import { AppError } from '../../lib/errors';
import { parseInput } from '../../lib/validation';
import type { TicketsService } from './service';

const idParamSchema = z.object({ id: z.uuid() });
/** Chave escolhida pelo cliente: opaca, mas com tamanho e alfabeto limitados. */
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);

function conversationId(params: unknown): string {
  const parsed = idParamSchema.safeParse(params);
  if (!parsed.success)
    throw new AppError('CONVERSATION_NOT_FOUND', 404, 'Conversa não encontrada.');
  return parsed.data.id;
}

export function registerTicketsRoutes(
  app: FastifyInstance,
  deps: { tickets: TicketsService; limits: UserRateLimiter },
): void {
  const guarded = { config: { requiresPrivacyAck: true } } as const;

  /** Chamados do usuário logado, achados pelo e-mail da sessão (RF-050). Nada vem do cliente. */
  app.get(
    '/api/tickets/mine',
    { ...guarded, preHandler: deps.limits.guard('ticketsMine') },
    async (request): Promise<MyTicketsResponse> => {
      const { user } = requireAuth(request);
      return deps.tickets.listMine({ id: user.id, email: user.email });
    },
  );

  app.post(
    '/api/conversations/:id/ticket-check',
    { ...guarded, preHandler: deps.limits.guard('ticketCheck') },
    async (request): Promise<TicketCheckResponse> => {
      const { user } = requireAuth(request);
      return deps.tickets.check(
        { id: user.id, role: user.role, fullName: user.fullName, email: user.email },
        conversationId(request.params),
      );
    },
  );

  app.post(
    '/api/conversations/:id/tickets',
    { ...guarded, preHandler: deps.limits.guard('ticketCreate') },
    async (request, reply): Promise<CreateTicketResponse> => {
      const { user } = requireAuth(request);
      const id = conversationId(request.params);
      const key = idempotencyKeySchema.safeParse(request.headers['idempotency-key']);
      if (!key.success) {
        throw new AppError('INVALID_INPUT', 422, 'Os dados enviados são inválidos.');
      }
      // Nome e e-mail nunca vêm do corpo: o esquema é estrito e a identidade é a da sessão.
      const input = parseInput(createTicketRequestSchema, request.body);

      const abort = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableEnded) abort.abort();
      });

      const { response, created } = await deps.tickets.create({
        actor: { id: user.id, role: user.role, fullName: user.fullName, email: user.email },
        conversationId: id,
        idempotencyKey: key.data,
        request: input,
        signal: abort.signal,
      });
      void reply.status(created ? 201 : 200);
      return response;
    },
  );
}
