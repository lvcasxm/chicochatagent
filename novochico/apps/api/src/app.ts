import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Config } from './config';
import type { Database } from './db/client';
import { registerErrorHandling } from './http/error-handler';
import { registerHealthRoute } from './http/health';
import type { Logger } from './lib/logger';

export interface AppDeps {
  config: Config;
  logger: Logger;
  db: Database;
}

/**
 * Cria o Fastify com as opções, hooks e rotas de produção, mas ainda sem `ready()`.
 * Existe separado de `buildApp` para que os testes acrescentem rotas de apoio.
 */
export function createApp(deps: AppDeps): FastifyInstance {
  // Tipar como FastifyBaseLogger faz o Fastify inferir `FastifyInstance` padrão; com o
  // tipo concreto do pino 10 (que exige `msgPrefix`), a instância deixaria de ser atribuível.
  const logger: FastifyBaseLogger = deps.logger;
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    // O id é sempre gerado aqui: aceitar o do cliente permitiria injetar texto nos logs.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
  });

  app.addHook('onSend', (request, reply, _payload, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });

  registerErrorHandling(app);
  registerHealthRoute(app, { db: deps.db });

  return app;
}

/** Monta o Fastify pronto para uso, sem abrir porta (testável com `inject`). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = createApp(deps);
  await app.ready();
  return app;
}
