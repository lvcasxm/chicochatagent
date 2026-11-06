import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@chicochat/shared';
import type { Database } from '../db/client';

/**
 * GET /api/health: usado pelo proxy e pelo contêiner. Público e sem dados sensíveis;
 * o motivo da falha fica no log, nunca na resposta.
 */
export function registerHealthRoute(app: FastifyInstance, deps: { db: Database }): void {
  app.get('/api/health', async (request, reply) => {
    try {
      await deps.db.ping();
    } catch (err) {
      request.log.warn({ err }, 'Verificação de saúde: banco indisponível');
      const body: HealthResponse = { status: 'degraded', db: 'down' };
      return reply.status(503).send(body);
    }
    const body: HealthResponse = { status: 'ok', db: 'up' };
    return body;
  });
}
