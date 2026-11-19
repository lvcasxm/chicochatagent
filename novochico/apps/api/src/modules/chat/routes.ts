import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  IMAGE_MAX_BYTES,
  createConversationRequestSchema,
  sendMessageRequestSchema,
  type ConversationDetail,
  type ConversationListResponse,
  type ConversationSummary,
} from '@chicochat/shared';
import { requireAuth } from '../../http/auth';
import { AppError } from '../../lib/errors';
import { parseInput } from '../../lib/validation';
import type { UserRateLimiter } from '../../http/user-rate-limit';
import type { ConversationsService } from '../conversations';
import type { ChatService } from './service';

const idParamSchema = z.object({ id: z.uuid() });
const imageParamSchema = z.object({ id: z.uuid(), messageId: z.uuid() });

/**
 * O envio de mensagem é a única rota que recebe imagem: o limite maior vale só aqui. Comporta a
 * imagem em base64 (um terço maior que o arquivo) mais o texto e o JSON em volta.
 */
const MESSAGE_BODY_LIMIT = Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 64 * 1024;

/** Identificador malformado e conversa de outro usuário recebem a mesma resposta: 404. */
function conversationId(params: unknown): string {
  const parsed = idParamSchema.safeParse(params);
  if (!parsed.success)
    throw new AppError('CONVERSATION_NOT_FOUND', 404, 'Conversa não encontrada.');
  return parsed.data.id;
}

export function registerChatRoutes(
  app: FastifyInstance,
  deps: { chat: ChatService; conversations: ConversationsService; limits: UserRateLimiter },
): void {
  // Tudo aqui exige login e o aceite do aviso de privacidade (RF-005).
  const guarded = { config: { requiresPrivacyAck: true } } as const;

  app.get('/api/conversations', guarded, async (request): Promise<ConversationListResponse> => {
    const { user } = requireAuth(request);
    return { conversations: await deps.conversations.list(user.id) };
  });

  app.post('/api/conversations', guarded, async (request, reply): Promise<ConversationSummary> => {
    const { user } = requireAuth(request);
    const input = parseInput(createConversationRequestSchema, request.body ?? {});
    const created = await deps.chat.startConversation(
      { id: user.id, role: user.role },
      input.categoryKey ?? null,
    );
    void reply.status(201);
    return created;
  });

  app.get('/api/conversations/:id', guarded, async (request): Promise<ConversationDetail> => {
    const { user } = requireAuth(request);
    return deps.conversations.detail(conversationId(request.params), user.id);
  });

  /** Imagem anexada a uma mensagem. Só o dono da conversa a vê; qualquer outro caso é 404. */
  app.get('/api/conversations/:id/messages/:messageId/image', guarded, async (request, reply) => {
    const { user } = requireAuth(request);
    const parsed = imageParamSchema.safeParse(request.params);
    if (!parsed.success) throw new AppError('IMAGE_NOT_FOUND', 404, 'Imagem não encontrada.');
    const image = await deps.conversations.image(parsed.data.id, parsed.data.messageId, user.id);
    return reply.header('content-type', image.mimeType).send(image.data);
  });

  app.delete('/api/conversations/:id', guarded, async (request, reply) => {
    const { user } = requireAuth(request);
    await deps.conversations.remove(conversationId(request.params), user.id);
    return reply.status(204).send();
  });

  /**
   * Envia uma mensagem e responde em SSE (SONNET_CONTEXT, seção E). Erros anteriores ao primeiro
   * trecho de resposta saem como HTTP normal; os posteriores, como evento `error` no stream.
   */
  app.post(
    '/api/conversations/:id/messages',
    { ...guarded, bodyLimit: MESSAGE_BODY_LIMIT, preHandler: deps.limits.guard('messages') },
    async (request, reply) => {
      const { user } = requireAuth(request);
      const id = conversationId(request.params);
      const input = parseInput(sendMessageRequestSchema, request.body);

      // Cliente que fecha a aba cancela a chamada à IA, para não gastar com quem foi embora.
      const abort = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableEnded) abort.abort();
      });

      const turn = await deps.chat.startTurn({
        actor: { id: user.id, role: user.role },
        conversationId: id,
        text: input.content,
        ...(input.image ? { image: Buffer.from(input.image, 'base64') } : {}),
        signal: abort.signal,
      });

      reply.hijack();
      const { raw } = reply;
      raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Sem isto, um proxy reverso seguraria o stream até o fim.
        'x-accel-buffering': 'no',
        'x-request-id': request.id,
      });

      try {
        // O laço roda até o fim mesmo sem cliente: a resposta parcial precisa ser gravada.
        for await (const { event, data } of turn.events) {
          if (!raw.destroyed && !raw.writableEnded) {
            raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          }
        }
      } catch (error) {
        request.log.error({ err: error }, 'Falha no stream da conversa');
        if (!raw.destroyed && !raw.writableEnded) {
          const body = {
            code: 'INTERNAL',
            message: 'Ocorreu um erro inesperado. Tente novamente.',
          };
          raw.write(`event: error\ndata: ${JSON.stringify(body)}\n\n`);
        }
      } finally {
        turn.dispose();
        if (!raw.destroyed && !raw.writableEnded) raw.end();
      }
    },
  );
}
