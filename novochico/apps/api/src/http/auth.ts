import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { UserRole } from '@chicochat/shared';
import { AppError } from '../lib/errors';
import type { AuthenticatedSession, SessionService } from '../modules/auth/sessions';
import { hasAcceptedCurrentPrivacy } from '../modules/users';

/**
 * Configuração de acesso de cada rota, declarada em `config` na própria rota.
 *
 * O padrão é **exigir login**. Uma rota só é pública se disser `public: true` de forma
 * explícita; esquecer a configuração nunca abre uma rota.
 */
declare module 'fastify' {
  interface FastifyContextConfig {
    /** Aberta a qualquer pessoa, sem login. Use só onde for inevitável (saúde, início do login). */
    public?: boolean;
    /** Papéis que podem acessar. Sem isso, qualquer usuário logado acessa. */
    roles?: readonly UserRole[];
    /** Exige que o usuário já tenha aceitado a versão atual do aviso de privacidade. */
    requiresPrivacyAck?: boolean;
  }

  interface FastifyRequest {
    /** Preenchido pelo gancho de autenticação em toda rota que não é pública. */
    auth: AuthenticatedSession | null;
  }
}

export function registerAuth(
  app: FastifyInstance,
  deps: { sessions: Pick<SessionService, 'authenticate'>; cookieName: string },
): void {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request) => {
    // Rota inexistente: quem responde é o tratador de 404, sem depender de login.
    if (request.is404) return;

    const config = request.routeOptions.config;
    if (config.public === true) return;

    const token = request.cookies[deps.cookieName];
    const session = token ? await deps.sessions.authenticate(token) : null;
    if (!session) {
      throw new AppError('UNAUTHENTICATED', 401, 'É preciso entrar para continuar.');
    }
    request.auth = session;

    if (config.roles && !config.roles.includes(session.user.role)) {
      throw new AppError('FORBIDDEN', 403, 'Você não tem permissão para isso.');
    }
    if (config.requiresPrivacyAck && !hasAcceptedCurrentPrivacy(session.user)) {
      throw new AppError(
        'PRIVACY_NOT_ACCEPTED',
        403,
        'É preciso aceitar o aviso de privacidade para continuar.',
      );
    }
  });
}

/**
 * Para uso dentro de rotas protegidas. O gancho já garante a sessão; esta função só entrega
 * o resultado com o tipo certo e falha de forma segura se alguém marcar uma rota como pública
 * e mesmo assim tentar usar o usuário.
 */
export function requireAuth(request: FastifyRequest): AuthenticatedSession {
  if (!request.auth) {
    throw new AppError('UNAUTHENTICATED', 401, 'É preciso entrar para continuar.');
  }
  return request.auth;
}
