import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { LoginErrorCode } from '@chicochat/shared';
import type { Config } from '../../config';
import { OidcError } from '../../integrations/google/oidc';
import { requireAuth } from '../../http/auth';
import {
  isSecureOrigin,
  LOGIN_COOKIE_NAME,
  LOGIN_COOKIE_PATH,
  LOGIN_TTL_MS,
  pendingLoginSchema,
  sessionCookieName,
  type PendingLogin,
} from './cookies';
import { safeRedirectPath } from './redirect';
import { GOOGLE_CALLBACK_PATH, type AuthService } from './service';
import type { SessionService } from './sessions';

/** Limite de SONNET_CONTEXT, seção K: 30 por 15 minutos, por IP, no início e na volta do login. */
const LOGIN_RATE_LIMIT = { max: 30, timeWindow: '15 minutes' } as const;

function loginErrorLocation(code: LoginErrorCode): string {
  return `/login?error=${code}`;
}

/** Lê e confere o cookie temporário do login. Qualquer defeito vira `null`, nunca erro. */
function readPendingLogin(request: FastifyRequest): PendingLogin | null {
  const raw = request.cookies[LOGIN_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) return null;
  try {
    return pendingLoginSchema.parse(JSON.parse(unsigned.value));
  } catch {
    return null;
  }
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    sessions: Pick<SessionService, 'revoke'>;
    config: Pick<Config, 'appOrigin'>;
  },
): void {
  const { auth, sessions, config } = deps;
  const secure = isSecureOrigin(config.appOrigin);
  const sessionCookie = sessionCookieName(secure);
  const baseCookie = { httpOnly: true, secure, sameSite: 'lax' } as const;

  /** Início do login: guarda state, nonce e PKCE em cookie assinado e envia ao Google. */
  app.get<{ Querystring: { redirect?: unknown } }>(
    '/api/auth/google',
    { config: { public: true, rateLimit: LOGIN_RATE_LIMIT } },
    async (request, reply) => {
      if (!auth.loginAvailable) return reply.redirect(loginErrorLocation('unavailable'));

      try {
        const { url, pending } = await auth.startLogin(safeRedirectPath(request.query.redirect));
        reply.setCookie(LOGIN_COOKIE_NAME, JSON.stringify(pending), {
          ...baseCookie,
          signed: true,
          path: LOGIN_COOKIE_PATH,
          maxAge: LOGIN_TTL_MS / 1000,
        });
        return reply.redirect(url.toString());
      } catch (err) {
        if (!(err instanceof OidcError)) throw err;
        request.log.warn({ err }, 'Login: não foi possível iniciar');
        return reply.redirect(loginErrorLocation('unavailable'));
      }
    },
  );

  /** Volta do Google: confere tudo, cria a sessão e leva o usuário ao destino. */
  app.get<{ Querystring: { error?: unknown } }>(
    GOOGLE_CALLBACK_PATH,
    { config: { public: true, rateLimit: LOGIN_RATE_LIMIT } },
    async (request, reply) => {
      const pending = readPendingLogin(request);
      // O cookie temporário vale uma única tentativa, qualquer que seja o resultado.
      reply.clearCookie(LOGIN_COOKIE_NAME, { ...baseCookie, path: LOGIN_COOKIE_PATH });

      if (!pending) return reply.redirect(loginErrorLocation('expired'));
      if (request.query.error !== undefined) return reply.redirect(loginErrorLocation('cancelled'));

      // O endereço é remontado a partir do caminho fixo, sem confiar no que veio na linha da
      // requisição, e usa a origem pública configurada, nunca o cabeçalho Host.
      const queryStart = request.url.indexOf('?');
      const search = queryStart === -1 ? '' : request.url.slice(queryStart);
      const currentUrl = new URL(`${GOOGLE_CALLBACK_PATH}${search}`, config.appOrigin);

      const result = await auth.finishLogin({ currentUrl, pending });
      if (!result.ok) return reply.redirect(loginErrorLocation(result.code));

      reply.setCookie(sessionCookie, result.token, {
        ...baseCookie,
        path: '/',
        expires: result.expiresAt,
      });
      return reply.redirect(safeRedirectPath(result.redirectTo));
    },
  );

  /** Encerra a sessão: ela é revogada no banco, então o cookie antigo deixa de valer. */
  app.post('/api/auth/logout', async (request, reply) => {
    const { sessionId } = requireAuth(request);
    await sessions.revoke(sessionId);
    reply.clearCookie(sessionCookie, { ...baseCookie, path: '/' });
    return reply.status(204).send();
  });
}
