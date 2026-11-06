import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Config } from './config';
import type { Database } from './db/client';
import { registerAuth } from './http/auth';
import { registerCsrfProtection } from './http/csrf';
import { registerErrorHandling } from './http/error-handler';
import { registerHealthRoute } from './http/health';
import { registerRouteCatalog } from './http/route-catalog';
import { createGoogleOidcClient, type GoogleOidcClient } from './integrations/google/oidc';
import type { Logger } from './lib/logger';
import { isSecureOrigin, sessionCookieName } from './modules/auth/cookies';
import { registerAuthRoutes } from './modules/auth/routes';
import { createAuthService } from './modules/auth/service';
import { createSessionService } from './modules/auth/sessions';
import { createUsers } from './modules/users';
import { registerUsersRoutes } from './modules/users/routes';

export interface AppDeps {
  config: Config;
  logger: Logger;
  db: Database;
  /**
   * Cliente do Google. Por padrão é criado a partir da configuração; é nulo quando não há
   * credenciais (o login fica indisponível). Os testes passam um provedor local.
   */
  oidc?: GoogleOidcClient | null;
  /** Relógio, para os testes controlarem o tempo (expiração de sessão, por exemplo). */
  now?: () => Date;
}

/**
 * Cria o Fastify com as opções, plugins, ganchos e rotas de produção, mas ainda sem `ready()`.
 * Existe separado de `buildApp` para que os testes acrescentem rotas de apoio.
 *
 * A ordem importa: o cookie e o limite de requisições precisam estar carregados antes dos
 * ganchos de CSRF e de autenticação, que dependem deles.
 */
export async function createApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;

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
    // Só atrás de um proxy confiável: senão o IP do cliente seria falsificável por cabeçalho.
    trustProxy: config.trustProxy,
  });

  app.addHook('onSend', (request, reply, _payload, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });

  registerRouteCatalog(app);
  registerErrorHandling(app);

  await app.register(cookie, { secret: config.sessionSecret });
  // Limite geral por IP (seção K); as rotas de login têm um limite próprio, mais baixo.
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  registerCsrfProtection(app, { allowedOrigin: config.appOrigin });

  const now = deps.now ?? (() => new Date());
  const users = createUsers({ orm: deps.db.orm, now });
  const sessions = createSessionService({ orm: deps.db.orm, users, now });
  const oidc =
    deps.oidc !== undefined
      ? deps.oidc
      : config.google
        ? createGoogleOidcClient(config.google)
        : null;
  const auth = createAuthService({ oidc, users, sessions, config, logger: deps.logger, now });

  registerAuth(app, {
    sessions,
    cookieName: sessionCookieName(isSecureOrigin(config.appOrigin)),
  });

  registerHealthRoute(app, { db: deps.db });
  registerAuthRoutes(app, { auth, sessions, config });
  registerUsersRoutes(app, { users });

  return app;
}

/** Monta o Fastify pronto para uso, sem abrir porta (testável com `inject`). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = await createApp(deps);
  await app.ready();
  return app;
}
