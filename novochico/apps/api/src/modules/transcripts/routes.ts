import type { FastifyInstance } from 'fastify';
import type { TranscriptResponse } from '@chicochat/shared';
import { requireAuth } from '../../http/auth';
import { AppError } from '../../lib/errors';
import type { TranscriptsService } from './index';

/** Token de 256 bits em base64url: 43 caracteres. Fora desse formato, é o mesmo 404 de inexistente. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function registerTranscriptRoutes(
  app: FastifyInstance,
  deps: { transcripts: TranscriptsService },
): void {
  // Exige login (o padrão da API) e o aceite do aviso; o papel é conferido no serviço, pois o dono
  // também pode ler, e quem não pode recebe a mesma resposta de uma transcrição inexistente.
  app.get(
    '/api/transcripts/:token',
    { config: { requiresPrivacyAck: true } },
    async (request): Promise<TranscriptResponse> => {
      const { user } = requireAuth(request);
      const { token } = request.params as { token: string };
      if (!TOKEN_FORMAT.test(token)) {
        throw new AppError('TRANSCRIPT_NOT_FOUND', 404, 'Conversa não encontrada.');
      }
      return deps.transcripts.view({ token, viewer: { id: user.id, role: user.role } });
    },
  );
}
