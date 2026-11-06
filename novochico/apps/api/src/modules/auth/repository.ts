import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { sessions } from '../../db/schema';

export type SessionRow = typeof sessions.$inferSelect;

/** SQL do módulo `auth` (tabela `sessions`). Só o service do módulo deve usá-lo. */
export function createSessionsRepository(db: DbExecutor) {
  return {
    async insert(values: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      now: Date;
    }): Promise<void> {
      await db.insert(sessions).values({
        userId: values.userId,
        tokenHash: values.tokenHash,
        expiresAt: values.expiresAt,
        createdAt: values.now,
        lastSeenAt: values.now,
      });
    },

    async findByTokenHash(tokenHash: string): Promise<SessionRow | null> {
      const [row] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);
      return row ?? null;
    },

    async touch(id: string, now: Date): Promise<void> {
      await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
    },

    async revoke(id: string, now: Date): Promise<void> {
      await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, id));
    },
  };
}

export type SessionsRepository = ReturnType<typeof createSessionsRepository>;
