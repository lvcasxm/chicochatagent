import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { submitFeedbackRequestSchema } from '@chicochat/shared';
import { requireAuth } from '../../http/auth';
import { AppError } from '../../lib/errors';
import { parseInput } from '../../lib/validation';
import type { FeedbackService } from './index';

const idParamSchema = z.object({ id: z.uuid() });

export function registerFeedbackRoutes(
  app: FastifyInstance,
  deps: { feedback: FeedbackService },
): void {
  /** Envia a avaliação da conversa. O dono, e só uma vez (RF-060). */
  app.post(
    '/api/conversations/:id/feedback',
    { config: { requiresPrivacyAck: true } },
    async (request, reply) => {
      const { user } = requireAuth(request);
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError('CONVERSATION_NOT_FOUND', 404, 'Conversa não encontrada.');
      }
      const input = parseInput(submitFeedbackRequestSchema, request.body);
      await deps.feedback.submit({
        userId: user.id,
        conversationId: params.data.id,
        request: input,
      });
      return reply.status(204).send();
    },
  );
}
