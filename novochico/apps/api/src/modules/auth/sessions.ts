import { createHash, randomBytes } from 'node:crypto';
import type { OrmClient } from '../../db/client';
import type { UserProfile, UsersService } from '../users';
import { createSessionsRepository } from './repository';

/** Sem atividade por tanto tempo, a sessão expira (SONNET_CONTEXT, seção K). */
export const SESSION_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
/** Mesmo com atividade contínua, a sessão acaba depois disso. */
export const SESSION_ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
/** Evita gravar no banco a cada requisição: a última atividade é atualizada no máximo por minuto. */
const TOUCH_INTERVAL_MS = 60 * 1000;

/** 32 bytes aleatórios em base64url têm sempre 43 caracteres. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export interface AuthenticatedSession {
  sessionId: string;
  user: UserProfile;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

/** Só o hash do identificador é guardado: um vazamento do banco não entrega sessões válidas. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionService(deps: {
  orm: OrmClient;
  users: Pick<UsersService, 'getActiveById'>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const repository = createSessionsRepository(deps.orm);

  return {
    /** Cria uma sessão nova. Cada login gera um identificador novo. */
    async create(userId: string): Promise<CreatedSession> {
      const token = randomBytes(32).toString('base64url');
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS);
      await repository.insert({ userId, tokenHash: hashToken(token), expiresAt, now: createdAt });
      return { token, expiresAt };
    },

    /**
     * Valida o identificador recebido no cookie. Devolve `null` se ele não existir, tiver sido
     * revogado, expirado (por tempo total ou por inatividade) ou se o usuário foi desativado.
     */
    async authenticate(token: string): Promise<AuthenticatedSession | null> {
      if (!TOKEN_FORMAT.test(token)) return null;

      const session = await repository.findByTokenHash(hashToken(token));
      if (!session || session.revokedAt) return null;

      const current = now();
      if (current >= session.expiresAt) return null;
      const idleFor = current.getTime() - session.lastSeenAt.getTime();
      if (idleFor >= SESSION_IDLE_TIMEOUT_MS) return null;

      const user = await deps.users.getActiveById(session.userId);
      if (!user) return null;

      if (idleFor >= TOUCH_INTERVAL_MS) await repository.touch(session.id, current);
      return { sessionId: session.id, user };
    },

    async revoke(sessionId: string): Promise<void> {
      await repository.revoke(sessionId, now());
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
