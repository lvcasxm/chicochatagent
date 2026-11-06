import { desc, eq, inArray, max } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { instructionVersions, users } from '../../db/schema';

export type InstructionRow = typeof instructionVersions.$inferSelect;

export interface InstructionWithAuthors extends InstructionRow {
  createdByName: string | null;
  publishedByName: string | null;
}

/** SQL das versões das instruções para o painel. Só o service do módulo deve usá-lo. */
export function createInstructionsRepository(db: DbExecutor) {
  return {
    async findByStatus(status: 'draft' | 'published', options: { lock?: boolean } = {}) {
      const query = db
        .select()
        .from(instructionVersions)
        .where(eq(instructionVersions.status, status))
        .limit(1);
      const [row] = options.lock ? await query.for('update') : await query;
      return row ?? null;
    },

    async findByVersion(version: number) {
      const [row] = await db
        .select()
        .from(instructionVersions)
        .where(eq(instructionVersions.version, version))
        .limit(1);
      return row ?? null;
    },

    /** Autor e publicador de uma versão, para a tela mostrar nomes e não identificadores. */
    async authorNames(ids: string[]): Promise<Map<string, string>> {
      if (ids.length === 0) return new Map();
      const rows = await db
        .select({ id: users.id, name: users.fullName })
        .from(users)
        .where(inArray(users.id, ids));
      return new Map(rows.map((row) => [row.id, row.name]));
    },

    /** Todas as versões, da mais nova à mais antiga. O texto vem junto: o service decide o que enviar. */
    async listAll(): Promise<InstructionRow[]> {
      return db.select().from(instructionVersions).orderBy(desc(instructionVersions.version));
    },

    async nextVersion(): Promise<number> {
      const [row] = await db
        .select({ latest: max(instructionVersions.version) })
        .from(instructionVersions);
      return (row?.latest ?? 0) + 1;
    },

    async insertDraft(values: {
      version: number;
      content: string;
      changeRequest: string | null;
      changeSummary: string | null;
      aiConflicts: unknown;
      createdBy: string;
    }) {
      const [row] = await db
        .insert(instructionVersions)
        .values({ ...values, status: 'draft' })
        .returning();
      return row;
    },

    async updateDraft(
      id: string,
      values: {
        content: string;
        changeRequest?: string | null;
        changeSummary?: string | null;
        aiConflicts?: unknown;
      },
    ) {
      const [row] = await db
        .update(instructionVersions)
        .set(values)
        .where(eq(instructionVersions.id, id))
        .returning();
      return row;
    },

    async archive(id: string) {
      await db
        .update(instructionVersions)
        .set({ status: 'archived' })
        .where(eq(instructionVersions.id, id));
    },

    async markPublished(id: string, by: string, at: Date) {
      const [row] = await db
        .update(instructionVersions)
        .set({ status: 'published', publishedBy: by, publishedAt: at })
        .where(eq(instructionVersions.id, id))
        .returning();
      return row;
    },
  };
}

export type InstructionsRepository = ReturnType<typeof createInstructionsRepository>;
