import { and, eq, isNull } from 'drizzle-orm';
import type { UserRole } from '@chicochat/shared';
import type { DbExecutor } from '../../db/client';
import { users } from '../../db/schema';

export type UserRow = typeof users.$inferSelect;

/** SQL do módulo `users`. Só o `service.ts` do módulo deve usá-lo. */
export function createUsersRepository(db: DbExecutor) {
  return {
    async findById(id: string): Promise<UserRow | null> {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ?? null;
    },

    async findByGoogleSub(googleSub: string): Promise<UserRow | null> {
      const [row] = await db.select().from(users).where(eq(users.googleSub, googleSub)).limit(1);
      return row ?? null;
    },

    /** O e-mail é sempre gravado em minúsculas; quem consulta deve normalizar. */
    async findByEmail(email: string): Promise<UserRow | null> {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return row ?? null;
    },

    /** Cria o usuário; se outro login simultâneo já criou, devolve `null`. */
    async insertIfAbsent(values: {
      googleSub: string;
      email: string;
      fullName: string;
      now: Date;
    }): Promise<UserRow | null> {
      const [row] = await db
        .insert(users)
        .values({
          googleSub: values.googleSub,
          email: values.email,
          fullName: values.fullName,
          lastLoginAt: values.now,
        })
        .onConflictDoNothing({ target: users.googleSub })
        .returning();
      return row ?? null;
    },

    async recordLogin(
      id: string,
      values: { email: string; fullName: string; now: Date },
    ): Promise<UserRow | null> {
      const [row] = await db
        .update(users)
        .set({
          email: values.email,
          fullName: values.fullName,
          lastLoginAt: values.now,
          updatedAt: values.now,
        })
        .where(eq(users.id, id))
        .returning();
      return row ?? null;
    },

    async setRole(id: string, role: UserRole, now: Date): Promise<void> {
      await db.update(users).set({ role, updatedAt: now }).where(eq(users.id, id));
    },

    /**
     * Administradores ativos, com bloqueio de linha. Dentro de uma transação, impede que duas
     * remoções simultâneas deixem o sistema sem nenhum administrador.
     */
    async lockActiveAdmins(): Promise<Array<{ id: string }>> {
      return db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
        .for('update');
    },

    async setPrivacyAck(id: string, version: string, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ privacyAckAt: now, privacyAckVersion: version, updatedAt: now })
        .where(eq(users.id, id));
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
