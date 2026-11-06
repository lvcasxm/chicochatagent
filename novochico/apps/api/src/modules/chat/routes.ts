import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createConversationRequestSchema,
  sendMessageRequestSchema,
  type ConversationDetail,
  type ConversationListResponse,
  type ConversationSummary,
} from '@chicochat/shared';
import { requireAuth } from '../../http/auth';
import { AppError } from '../../lib/errors';
import { parseInput } from '../../lib/validation';
import type { ConversationsService } from '../conversations';
import type { ChatService } from './service';

const idParamSchema = z.object({ id: z.uuid() });

/** Identificador malformado e conversa de outro usuário recebem a mesma resposta: 404. */
function conversationId(params: unknown): string {
  const parsed = idParamSchema.safeParse(params);
  if (!parsed.success)
    throw new AppError('CONVERSATION_NOT_FOUND', 404, 'Conversa não encontrada.');
  return parsed.data.id;
}

export function registerChatRoutes(
  app: FastifyInstance,
  deps: { chat: ChatService; conversations: ConversationsService },
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

  app.delete('/api/conversations/:id', guarded, async (request, reply) => {
    const { user } = requireAuth(request);
    await deps.conversations.remove(conversationId(request.params), user.id);
    return reply.status(204).send();
  });

  /**
   * Envia uma mensagem e responde em SSE (SONNET_CONTEXT, seção E). Erros anteriores ao primeiro
   * trecho de resposta saem como HTTP normal; os posteriores, como evento `error` no stream.
   */
  app.post('/api/conversations/:id/messages', guarded, async (request, reply) => {
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
        const body = { code: 'INTERNAL', message: 'Ocorreu um erro inesperado. Tente novamente.' };
        raw.write(`event: error\ndata: ${JSON.stringify(body)}\n\n`);
      }
    } finally {
      turn.dispose();
      if (!raw.destroyed && !raw.writableEnded) raw.end();
    }
  });
}
