import type { FastifyInstance } from 'fastify';
import { privacyAckRequestSchema, type MeResponse } from '@chicochat/shared';
import { requireAuth } from '../../http/auth';
import { parseInput } from '../../lib/validation';
import { hasAcceptedCurrentPrivacy, type UsersService } from './service';

export function registerUsersRoutes(app: FastifyInstance, deps: { users: UsersService }): void {
  /** O usuário logado e se ele já aceitou a versão atual do aviso de privacidade. */
  app.get('/api/me', (request): MeResponse => {
    const { user } = requireAuth(request);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      defaultSector: user.defaultSector,
      privacyAccepted: hasAcceptedCurrentPrivacy(user),
    };
  });

  /** Registra, no servidor, o aceite do aviso. Só vale para a versão atual (RF-005). */
  app.post('/api/me/privacy-ack', async (request, reply) => {
    const { user } = requireAuth(request);
    const input = parseInput(privacyAckRequestSchema, request.body);
    await deps.users.acceptPrivacy(user.id, input.version);
    return reply.status(204).send();
  });
}
