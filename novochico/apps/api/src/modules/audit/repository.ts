import type { DbExecutor } from '../../db/client';
import { auditLog } from '../../db/schema';

export interface AuditEntry {
  /** Quem agiu; nulo para ações feitas pelo sistema ou pela linha de comando. */
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Nunca inclua conteúdo de conversa, e-mail ou nome: só identificadores e valores simples. */
  metadata?: Record<string, string | number | boolean | null>;
}

/** Só inserção: o registro de auditoria nunca é atualizado nem apagado pela aplicação. */
export function createAuditRepository(db: DbExecutor) {
  return {
    async insert(entry: AuditEntry): Promise<void> {
      await db.insert(auditLog).values({
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ?? {},
      });
    },
  };
}
