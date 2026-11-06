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
import { createAdmin } from './modules/admin';
import { registerAdminRoutes } from './modules/admin/routes';
import { createAnalytics, createMetrics } from './modules/analytics';
import { isSecureOrigin, sessionCookieName } from './modules/auth/cookies';
import { registerAuthRoutes } from './modules/auth/routes';
import { createAuthService } from './modules/auth/service';
import { createSessionService } from './modules/auth/sessions';
import { createChat, createLlmFromConfig, createRehearsal } from './modules/chat';
import { registerChatRoutes } from './modules/chat/routes';
import { createContent, createContentAdmin } from './modules/content';
import { createFeedback } from './modules/feedback';
import { registerFeedbackRoutes } from './modules/feedback/routes';
import { createSessionCloser } from './modules/sessions';
import { registerContentRoutes } from './modules/content/routes';
import { createConversations } from './modules/conversations';
import { createGlpiFromConfig, createTickets } from './modules/tickets';
import { createTranscripts } from './modules/transcripts';
import { registerTranscriptRoutes } from './modules/transcripts/routes';
import { registerTicketsRoutes } from './modules/tickets/routes';
import { createUsers } from './modules/users';
import { registerUsersRoutes } from './modules/users/routes';

declare module 'fastify' {
  interface FastifyInstance {
    /** Tarefas que rodam fora das requisições (RF-064). */
    jobs: { closeInactiveConversations: () => Promise<number> };
  }
}

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
  /** IA do painel (Análise IA e assistente de instruções). Por padrão vem da configuração. */
  insightsLlm?: LlmClient | null;
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
  const transcripts = createTranscripts({ orm: deps.db.orm });
  const tickets = createTickets({
    orm: deps.db.orm,
    conversations,
    content,
    analytics,
    transcripts,
    appOrigin: config.appOrigin,
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
  registerTranscriptRoutes(app, { transcripts });

  const feedback = createFeedback({
    orm: deps.db.orm,
    conversations,
    analytics,
    logger: deps.logger,
  });
  registerFeedbackRoutes(app, { feedback });

  const insightsLlm = deps.insightsLlm !== undefined ? deps.insightsLlm : configuredLlm.insightsLlm;
  const contentAdmin = createContentAdmin({
    orm: deps.db.orm,
    llm: insightsLlm,
    logger: deps.logger,
    now,
  });
  registerAdminRoutes(app, {
    admin: createAdmin({ orm: deps.db.orm, content, users, insightsLlm, logger: deps.logger, now }),
    metrics: createMetrics({ orm: deps.db.orm, now }),
    instructions: contentAdmin.instructions,
    categories: contentAdmin.categories,
    rehearsal: createRehearsal({
      llm: deps.llm !== undefined ? deps.llm : configuredLlm.llm,
      logger: deps.logger,
    }),
    now,
  });

  // Tarefas periódicas: o `server.ts` as agenda; os testes as chamam direto, com o tempo controlado.
  const closer = createSessionCloser({ conversations, analytics, logger: deps.logger });
  app.decorate('jobs', { closeInactiveConversations: () => closer.closeInactive() });

  return app;
}

/** Monta o Fastify pronto para uso, sem abrir porta (testável com `inject`). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = await createApp(deps);
  await app.ready();
  return app;
}
