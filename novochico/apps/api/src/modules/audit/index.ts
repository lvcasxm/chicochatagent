import type { DbExecutor } from '../../db/client';
import { createAuditRepository, type AuditEntry } from './repository';

export type { AuditEntry };

/** Ponto de entrada do módulo. Aceita uma transação para auditar junto com a ação auditada. */
export function createAudit(db: DbExecutor) {
  const repository = createAuditRepository(db);
  return {
    record: (entry: AuditEntry) => repository.insert(entry),
  };
}

export type AuditService = ReturnType<typeof createAudit>;
