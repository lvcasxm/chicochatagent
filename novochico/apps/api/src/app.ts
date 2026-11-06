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
import type { LlmClient } from './integrations/gemini/llm';
import type { GlpiClient } from './integrations/glpi/glpi';
import type { Logger } from './lib/logger';
import { createAnalytics } from './modules/analytics';
import { isSecureOrigin, sessionCookieName } from './modules/auth/cookies';
import { registerAuthRoutes } from './modules/auth/routes';
import { createAuthService } from './modules/auth/service';
import { createSessionService } from './modules/auth/sessions';
import { createChat, createLlmFromConfig } from './modules/chat';
import { registerChatRoutes } from './modules/chat/routes';
import { createContent } from './modules/content';
import { registerContentRoutes } from './modules/content/routes';
import { createConversations } from './modules/conversations';
import { createGlpiFromConfig, createTickets } from './modules/tickets';
import { registerTicketsRoutes } from './modules/tickets/routes';
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
  /**
   * IA do chat. Por padrão vem da configuração (Gemini, o fake de desenvolvimento, ou nenhuma
   * quando falta a chave). Os testes passam um duplo com roteiro.
   */
  llm?: LlmClient | null;
  /** IA do resumo do chamado. Por padrão vem da configuração; os testes passam um duplo. */
  summaryLlm?: LlmClient | null;
  /** GLPI. Por padrão vem da configuração (nulo sem credenciais); os testes passam um fake. */
  glpi?: GlpiClient | null;
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

  const conversations = createConversations({ orm: deps.db.orm, now });
  const content = createContent(deps.db.orm);
  const configuredLlm = createLlmFromConfig(config.ai);
  const chat = createChat({
    orm: deps.db.orm,
    conversations,
    content,
    analytics: createAnalytics(deps.db.orm),
    llm: deps.llm !== undefined ? deps.llm : configuredLlm.llm,
    modelName: configuredLlm.modelName,
    cacheEnabled: config.chatCacheEnabled,
    logger: deps.logger,
    now,
  });
  const analytics = createAnalytics(deps.db.orm);
  const tickets = createTickets({
    orm: deps.db.orm,
    conversations,
    content,
    analytics,
    glpi: deps.glpi !== undefined ? deps.glpi : createGlpiFromConfig(config.glpi),
    summaryLlm: deps.summaryLlm !== undefined ? deps.summaryLlm : configuredLlm.summaryLlm,
    ticketIpRegex: config.ticketIpRegex,
    logger: deps.logger,
    now,
  });
  registerContentRoutes(app, {
    content,
    glpiPortalUrl: config.glpiPortalUrl,
    lastSector: (userId) => tickets.lastSector(userId),
  });
  registerChatRoutes(app, { chat, conversations });
  registerTicketsRoutes(app, { tickets });

  return app;
}

/** Monta o Fastify pronto para uso, sem abrir porta (testável com `inject`). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = await createApp(deps);
  await app.ready();
  return app;
}
