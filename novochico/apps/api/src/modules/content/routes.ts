import type { FastifyInstance } from 'fastify';
import type { BootstrapResponse } from '@chicochat/shared';
import { requireAuth } from '../../http/auth';
import type { ContentService } from './service';

export function registerContentRoutes(
  app: FastifyInstance,
  deps: {
    content: ContentService;
    glpiPortalUrl: string | null;
    /** Último setor do usuário em um chamado, para pré-preencher o formulário. */
    lastSector: (userId: string) => Promise<string | null>;
  },
): void {
  /** O que a tela inicial precisa, em uma chamada: cards ativos, portal e se há modo de teste. */
  app.get(
    '/api/bootstrap',
    { config: { requiresPrivacyAck: true } },
    async (request): Promise<BootstrapResponse> => {
      const { user } = requireAuth(request);
      return {
        cards: await deps.content.listHomeCards(),
        glpiPortalUrl: deps.glpiPortalUrl,
        canUseTestMode: user.role === 'admin',
        lastSector: await deps.lastSector(user.id),
      };
    },
  );
}
