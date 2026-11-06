import type { LoginErrorCode } from '@chicochat/shared';
import type { Config } from '../../config';
import { OidcError, type GoogleOidcClient } from '../../integrations/google/oidc';
import { AppError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import type { UsersService } from '../users';
import { LOGIN_TTL_MS, type PendingLogin } from './cookies';
import { evaluateIdentity } from './policy';
import type { SessionService } from './sessions';

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; redirectTo: string }
  | { ok: false; code: LoginErrorCode };

export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';

export function createAuthService(deps: {
  oidc: GoogleOidcClient | null;
  users: Pick<UsersService, 'upsertFromGoogle'>;
  sessions: Pick<SessionService, 'create'>;
  config: Pick<Config, 'appOrigin' | 'allowedEmailDomains'>;
  logger: Logger;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const redirectUri = `${deps.config.appOrigin}${GOOGLE_CALLBACK_PATH}`;

  return {
    /** Falso quando as credenciais do Google não foram configuradas. */
    get loginAvailable(): boolean {
      return deps.oidc !== null;
    },

    /** Começa o login: devolve o endereço do Google e o que precisa ser lembrado até a volta. */
    async startLogin(redirectTo: string): Promise<{ url: URL; pending: PendingLogin }> {
      if (!deps.oidc) throw new OidcError('unavailable', 'O login não está configurado');
      const { url, transaction } = await deps.oidc.createAuthorizationRequest({ redirectUri });
      return {
        url,
        pending: {
          ...transaction,
          redirectTo,
          expiresAt: now().getTime() + LOGIN_TTL_MS,
        },
      };
    },

    /**
     * Conclui o login. Nunca devolve detalhes da falha: só um código genérico, que a tela de
     * login transforma em mensagem. O motivo real fica no log, sem dados pessoais.
     */
    async finishLogin(input: { currentUrl: URL; pending: PendingLogin }): Promise<LoginResult> {
      const { pending } = input;
      if (!deps.oidc) return { ok: false, code: 'unavailable' };
      if (pending.expiresAt <= now().getTime()) return { ok: false, code: 'expired' };

      let claims;
      try {
        claims = await deps.oidc.completeLogin({
          currentUrl: input.currentUrl,
          transaction: pending,
        });
      } catch (err) {
        if (err instanceof OidcError && err.failure === 'unavailable') {
          deps.logger.warn({ err }, 'Login: provedor indisponível');
          return { ok: false, code: 'unavailable' };
        }
        deps.logger.warn({ err }, 'Login: resposta do provedor rejeitada');
        return { ok: false, code: 'failed' };
      }

      const decision = evaluateIdentity(claims, deps.config.allowedEmailDomains);
      if (!decision.ok) {
        deps.logger.info({ reason: decision.reason }, 'Login recusado pela política de identidade');
        return { ok: false, code: decision.reason };
      }

      let user;
      try {
        user = await deps.users.upsertFromGoogle(decision.identity);
      } catch (err) {
        if (err instanceof AppError) {
          deps.logger.info({ reason: err.code }, 'Login recusado ao localizar o usuário');
          return { ok: false, code: err.code === 'ACCOUNT_DISABLED' ? 'disabled' : 'failed' };
        }
        throw err;
      }

      const session = await deps.sessions.create(user.id);
      deps.logger.info({ userId: user.id }, 'Login concluído');
      return { ok: true, ...session, redirectTo: pending.redirectTo };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
