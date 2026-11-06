import { PRIVACY_NOTICE_VERSION, type UserRole } from '@chicochat/shared';
import type { OrmClient } from '../../db/client';
import { AppError } from '../../lib/errors';
import { createAudit } from '../audit';
import { createUsersRepository, type UserRow } from './repository';

/** O que o resto do sistema sabe sobre um usuário. */
export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  defaultSector: string | null;
  /** Versão do aviso de privacidade aceita, ou nulo se nunca aceitou. */
  privacyAckVersion: string | null;
}

/** Identidade já validada pela política de login; o e-mail está em minúsculas. */
export interface VerifiedIdentity {
  googleSub: string;
  email: string;
  fullName: string;
}

export interface RoleChange {
  userId: string;
  previousRole: UserRole;
  role: UserRole;
}

function toProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    defaultSector: row.defaultSector,
    privacyAckVersion: row.privacyAckVersion,
  };
}

export function hasAcceptedCurrentPrivacy(user: Pick<UserProfile, 'privacyAckVersion'>): boolean {
  return user.privacyAckVersion === PRIVACY_NOTICE_VERSION;
}

export function createUsersService(deps: { orm: OrmClient; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const repository = createUsersRepository(deps.orm);

  /** Conta já conhecida: confere se está ativa, atualiza nome e e-mail e registra o login. */
  async function updateExisting(
    existing: UserRow,
    identity: VerifiedIdentity,
    loginAt: Date,
  ): Promise<UserProfile> {
    if (existing.disabledAt) {
      throw new AppError('ACCOUNT_DISABLED', 403, 'Este acesso está desativado.');
    }
    if (identity.email !== existing.email) {
      const owner = await repository.findByEmail(identity.email);
      if (owner && owner.id !== existing.id) {
        throw new AppError('ACCOUNT_CONFLICT', 409, 'Não foi possível concluir o login.');
      }
    }
    const updated = await repository.recordLogin(existing.id, {
      email: identity.email,
      fullName: identity.fullName,
      now: loginAt,
    });
    return toProfile(updated ?? existing);
  }

  return {
    async getById(id: string): Promise<UserProfile | null> {
      const row = await repository.findById(id);
      return row ? toProfile(row) : null;
    },

    /** Como `getById`, mas ignora contas desativadas: uma sessão delas deixa de valer. */
    async getActiveById(id: string): Promise<UserProfile | null> {
      const row = await repository.findById(id);
      return row && !row.disabledAt ? toProfile(row) : null;
    },

    /**
     * Entra com uma identidade já validada. O usuário é criado no primeiro login, com papel
     * `user`, e reconhecido depois pelo `sub` do Google, que não muda mesmo se o e-mail mudar.
     */
    async upsertFromGoogle(identity: VerifiedIdentity): Promise<UserProfile> {
      const loginAt = now();
      const existing = await repository.findByGoogleSub(identity.googleSub);
      if (existing) return updateExisting(existing, identity, loginAt);

      // O mesmo e-mail com outro `sub` pode ser uma conta recriada ou um erro de cadastro.
      // Não se une a conta automaticamente: um administrador precisa decidir.
      if (await repository.findByEmail(identity.email)) {
        throw new AppError('ACCOUNT_CONFLICT', 409, 'Não foi possível concluir o login.');
      }

      const created = await repository.insertIfAbsent({ ...identity, now: loginAt });
      if (created) return toProfile(created);

      // Outro login do mesmo usuário criou a conta no mesmo instante: usa a que já existe.
      const concurrent = await repository.findByGoogleSub(identity.googleSub);
      if (!concurrent) {
        throw new AppError('ACCOUNT_CONFLICT', 409, 'Não foi possível concluir o login.');
      }
      return updateExisting(concurrent, identity, loginAt);
    },

    /** Registra que o usuário viu e aceitou o aviso de privacidade desta versão. */
    async acceptPrivacy(userId: string, version: string): Promise<void> {
      if (version !== PRIVACY_NOTICE_VERSION) {
        throw new AppError(
          'PRIVACY_VERSION_MISMATCH',
          422,
          'O aviso de privacidade foi atualizado. Recarregue a página e leia a nova versão.',
        );
      }
      await repository.setPrivacyAck(userId, version, now());
    },

    /**
     * Troca o papel de um usuário, registrando na auditoria na mesma transação. Nunca deixa o
     * sistema sem administrador. `actorId` é nulo quando a ação vem da linha de comando.
     */
    async changeRole(input: {
      email: string;
      role: UserRole;
      actorId: string | null;
      via: 'cli' | 'admin';
    }): Promise<RoleChange> {
      const email = input.email.trim().toLowerCase();
      return deps.orm.transaction(async (tx) => {
        const txRepository = createUsersRepository(tx);
        const target = await txRepository.findByEmail(email);
        if (!target) {
          throw new AppError(
            'USER_NOT_FOUND',
            404,
            'Usuário não encontrado. Ele precisa entrar ao menos uma vez com a conta institucional.',
          );
        }

        if (target.role === 'admin' && input.role !== 'admin') {
          const admins = await txRepository.lockActiveAdmins();
          const others = admins.filter((admin) => admin.id !== target.id);
          if (others.length === 0) {
            throw new AppError(
              'LAST_ADMIN',
              409,
              'Não é possível remover o último administrador do sistema.',
            );
          }
        }

        if (target.role !== input.role) {
          await txRepository.setRole(target.id, input.role, now());
          await createAudit(tx).record({
            actorId: input.actorId,
            action: 'user.role_changed',
            targetType: 'user',
            targetId: target.id,
            metadata: { from: target.role, to: input.role, via: input.via },
          });
        }
        return { userId: target.id, previousRole: target.role, role: input.role };
      });
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
