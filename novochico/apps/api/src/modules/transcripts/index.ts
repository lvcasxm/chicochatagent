import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { TranscriptResponse, UserRole } from '@chicochat/shared';
import type { OrmClient } from '../../db/client';
import { ticketAttempts, ticketTranscripts } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { createAudit } from '../audit';

/** Só o hash do token vai ao banco; o token em si só existe no link (ADR-016). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const NOT_FOUND = () => new AppError('TRANSCRIPT_NOT_FOUND', 404, 'Conversa não encontrada.');

export interface TranscriptSnapshot {
  ticketAttemptId: string;
  title: string | null;
  summary: string | null;
  requesterName: string | null;
  sector: string | null;
  messages: Array<{ role: 'user' | 'assistant'; content: string; at: string }>;
}

/**
 * Transcrição do chamado (F6, ADR-016): um retrato da conversa no momento da abertura, com link
 * que exige login. O token tem 256 bits e só o hash é guardado. Cada acesso gera auditoria.
 */
export function createTranscripts(deps: { orm: OrmClient }) {
  const { orm } = deps;

  return {
    /** Grava o retrato e devolve o token (mostrado uma única vez, no link do chamado). */
    async create(snapshot: TranscriptSnapshot): Promise<{ token: string; id: string }> {
      const token = randomBytes(32).toString('base64url');
      const [row] = await orm
        .insert(ticketTranscripts)
        .values({
          ticketAttemptId: snapshot.ticketAttemptId,
          tokenHash: hashToken(token),
          title: snapshot.title,
          summary: snapshot.summary,
          requesterName: snapshot.requesterName,
          sector: snapshot.sector,
          messages: snapshot.messages,
        })
        .returning({ id: ticketTranscripts.id });
      if (!row) throw new Error('Falha ao gravar a transcrição');
      return { token, id: row.id };
    },

    /** Chamado que não chegou a ser criado não deixa retrato da conversa para trás. */
    async remove(ticketAttemptId: string): Promise<void> {
      await orm
        .delete(ticketTranscripts)
        .where(eq(ticketTranscripts.ticketAttemptId, ticketAttemptId));
    },

    /**
     * Lê a transcrição pelo token. Dono, `tecnico` e `admin` podem; qualquer outro caso (token
     * desconhecido, malformado ou de outra pessoa) recebe a mesma resposta (RF-059). Todo acesso
     * é auditado, sem conteúdo nem dados pessoais.
     */
    async view(input: {
      token: string;
      viewer: { id: string; role: UserRole };
    }): Promise<TranscriptResponse> {
      const [row] = await orm
        .select({
          transcriptId: ticketTranscripts.id,
          title: ticketTranscripts.title,
          summary: ticketTranscripts.summary,
          requesterName: ticketTranscripts.requesterName,
          sector: ticketTranscripts.sector,
          messages: ticketTranscripts.messages,
          createdAt: ticketTranscripts.createdAt,
          ownerId: ticketAttempts.userId,
          glpiTicketId: ticketAttempts.glpiTicketId,
        })
        .from(ticketTranscripts)
        .innerJoin(ticketAttempts, eq(ticketAttempts.id, ticketTranscripts.ticketAttemptId))
        .where(eq(ticketTranscripts.tokenHash, hashToken(input.token)))
        .limit(1);
      if (!row) throw NOT_FOUND();

      const isOwner = row.ownerId === input.viewer.id;
      const isStaff = input.viewer.role === 'tecnico' || input.viewer.role === 'admin';
      if (!isOwner && !isStaff) throw NOT_FOUND();

      await createAudit(orm).record({
        actorId: input.viewer.id,
        action: 'transcript.view',
        targetType: 'transcript',
        targetId: row.transcriptId,
        metadata: { role: input.viewer.role, owner: isOwner },
      });

      return {
        ticketId: row.glpiTicketId,
        title: row.title,
        summary: row.summary,
        requesterName: row.requesterName,
        sector: row.sector,
        openedAt: row.createdAt.toISOString(),
        messages: row.messages as TranscriptSnapshot['messages'],
      };
    },
  };
}

export type TranscriptsService = ReturnType<typeof createTranscripts>;
