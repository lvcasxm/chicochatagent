import {
  INSTRUCTIONS_MAX_LENGTH,
  instructionProposalSchema,
  type InstructionVersion,
  type InstructionsState,
} from '@chicochat/shared';
import type { OrmClient } from '../../db/client';
import { LlmError, type LlmClient } from '../../integrations/gemini/llm';
import { AppError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import { createAudit } from '../audit';
import { buildAssistantRequest, INSTRUCTION_ASSISTANT_PROMPT } from './assistant-prompt';
import {
  createInstructionsRepository,
  type InstructionRow,
  type InstructionsRepository,
} from './instructions-repository';

/** A IA tem este tempo para devolver o documento revisado. */
const ASSISTANT_TIMEOUT_MS = 90_000;

interface AiNotes {
  conflicts: string[];
  questions: string[];
}

function readNotes(value: unknown): AiNotes {
  const notes = (value ?? {}) as Partial<AiNotes>;
  const strings = (list: unknown) =>
    Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
  return { conflicts: strings(notes.conflicts), questions: strings(notes.questions) };
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** Erro de unicidade do PostgreSQL: duas pessoas mexeram no rascunho ao mesmo tempo. */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } }).code;
  const causeCode = (error as { cause?: { code?: string } }).cause?.code;
  return code === '23505' || causeCode === '23505';
}

function conflictError(): AppError {
  return new AppError(
    'DRAFT_CONFLICT',
    409,
    'Outra alteração do rascunho aconteceu ao mesmo tempo. Recarregue a página e tente de novo.',
  );
}

/**
 * Instruções de atendimento do agente (ADR-030): rascunho, proposta da IA, publicação,
 * histórico e restauração. A IA só escreve o rascunho; quem publica é sempre uma pessoa.
 */
export function createInstructionsAdmin(deps: {
  orm: OrmClient;
  /** Nulo sem IA configurada: a edição manual e a publicação seguem funcionando. */
  llm: LlmClient | null;
  logger: Logger;
  now: () => Date;
}) {
  const { orm, llm, logger } = deps;
  const repository = createInstructionsRepository(orm);

  async function toView(
    repo: InstructionsRepository,
    rows: InstructionRow[],
  ): Promise<InstructionVersion[]> {
    const ids = [...new Set(rows.flatMap((row) => [row.createdBy, row.publishedBy]))].filter(
      (id): id is string => id !== null,
    );
    const names = await repo.authorNames(ids);
    const author = (id: string | null) => {
      const name = id ? names.get(id) : undefined;
      return name === undefined ? null : { name };
    };
    return rows.map((row) => {
      const notes = readNotes(row.aiConflicts);
      return {
        version: row.version,
        status: row.status,
        content: row.content,
        changeRequest: row.changeRequest,
        changeSummary: row.changeSummary,
        conflicts: notes.conflicts,
        questions: notes.questions,
        createdBy: author(row.createdBy),
        createdAt: row.createdAt.toISOString(),
        publishedBy: author(row.publishedBy),
        publishedAt: iso(row.publishedAt),
      };
    });
  }

  /** Grava o texto no rascunho existente ou cria o rascunho (no máximo um existe). */
  async function writeDraft(
    repo: InstructionsRepository,
    actorId: string,
    values: {
      content: string;
      changeRequest?: string | null;
      changeSummary?: string | null;
      notes?: AiNotes;
    },
  ): Promise<InstructionRow> {
    const existing = await repo.findByStatus('draft', { lock: true });
    const aiConflicts = values.notes === undefined ? undefined : values.notes;
    if (existing) {
      const updated = await repo.updateDraft(existing.id, {
        content: values.content,
        ...(values.changeRequest !== undefined ? { changeRequest: values.changeRequest } : {}),
        ...(values.changeSummary !== undefined ? { changeSummary: values.changeSummary } : {}),
        ...(aiConflicts !== undefined ? { aiConflicts } : {}),
      });
      if (!updated) throw conflictError();
      return updated;
    }
    const created = await repo.insertDraft({
      version: await repo.nextVersion(),
      content: values.content,
      changeRequest: values.changeRequest ?? null,
      changeSummary: values.changeSummary ?? null,
      aiConflicts: aiConflicts ?? { conflicts: [], questions: [] },
      createdBy: actorId,
    });
    if (!created) throw conflictError();
    return created;
  }

  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) throw conflictError();
      throw error;
    }
  }

  return {
    aiAvailable: llm !== null,

    /** Versão publicada, rascunho e histórico (sem o texto das versões antigas). */
    async state(): Promise<InstructionsState> {
      const rows = await repository.listAll();
      const published = rows.find((row) => row.status === 'published');
      if (!published) {
        throw new AppError(
          'INSTRUCTIONS_NOT_PUBLISHED',
          503,
          'Não há instruções publicadas. Rode o seed do banco.',
        );
      }
      const draft = rows.find((row) => row.status === 'draft');
      const views = await toView(repository, rows);
      const byVersion = new Map(views.map((view) => [view.version, view]));
      const publishedView = byVersion.get(published.version);
      if (!publishedView) throw new Error('Versão publicada ausente da lista');
      return {
        published: publishedView,
        draft: draft ? (byVersion.get(draft.version) ?? null) : null,
        history: views
          .filter((view) => view.status !== 'draft')
          .map(({ content: _content, ...rest }) => rest),
        maxLength: INSTRUCTIONS_MAX_LENGTH,
        aiAvailable: llm !== null,
      };
    },

    /** Uma versão com o texto, para comparar ou restaurar. */
    async version(version: number): Promise<InstructionVersion> {
      const row = await repository.findByVersion(version);
      if (!row) throw new AppError('VERSION_NOT_FOUND', 404, 'Versão não encontrada.');
      const [view] = await toView(repository, [row]);
      if (!view) throw new AppError('VERSION_NOT_FOUND', 404, 'Versão não encontrada.');
      return view;
    },

    /** Rascunho atual, se existir, com o texto. */
    async draftContent(): Promise<{ version: number; content: string } | null> {
      const draft = await repository.findByStatus('draft');
      return draft ? { version: draft.version, content: draft.content } : null;
    },

    /** Edição manual: o conteúdo já chega validado. */
    saveDraft(actorId: string, content: string): Promise<InstructionVersion> {
      return guarded(() =>
        orm.transaction(async (tx) => {
          const repo = createInstructionsRepository(tx);
          const row = await writeDraft(repo, actorId, { content });
          const [view] = await toView(repo, [row]);
          if (!view) throw new Error('Rascunho ausente depois de gravar');
          return view;
        }),
      );
    },

    /**
     * Pedido em linguagem natural (H.10). Parte do rascunho, se houver, ou da versão publicada.
     * Se a IA falhar ou devolver algo inválido, nada é gravado.
     */
    async propose(actorId: string, request: string): Promise<InstructionVersion> {
      if (!llm) {
        throw new AppError(
          'AI_UNAVAILABLE',
          503,
          'A IA não está disponível. Edite o rascunho à mão ou tente mais tarde.',
        );
      }
      const base =
        (await repository.findByStatus('draft')) ?? (await repository.findByStatus('published'));
      if (!base) throw new AppError('INSTRUCTIONS_NOT_PUBLISHED', 503, 'Não há instruções.');

      let raw: unknown;
      try {
        raw = await llm.generateJson({
          system: INSTRUCTION_ASSISTANT_PROMPT,
          user: buildAssistantRequest(base.content, request),
          signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
        });
      } catch (error) {
        logger.warn({ err: error }, 'Falha ao pedir a proposta de instruções à IA');
        if (error instanceof LlmError && error.kind === 'rate_limited') {
          throw new AppError(
            'RATE_LIMITED',
            429,
            'Muitas solicitações. Tente em alguns instantes.',
          );
        }
        throw new AppError(
          'AI_UNAVAILABLE',
          503,
          'A IA não respondeu. Nenhum rascunho foi alterado; tente de novo ou edite à mão.',
        );
      }

      const parsed = instructionProposalSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn(
          { issues: parsed.error.issues.map((issue) => issue.message) },
          'Proposta inválida',
        );
        throw new AppError(
          'PROPOSAL_INVALID',
          502,
          'A IA devolveu um documento que não pode ser usado (vazio, grande demais ou com marcadores técnicos). Nenhum rascunho foi alterado; reescreva o pedido e tente de novo.',
        );
      }

      const proposal = parsed.data;
      return guarded(() =>
        orm.transaction(async (tx) => {
          const repo = createInstructionsRepository(tx);
          const row = await writeDraft(repo, actorId, {
            content: proposal.content,
            changeRequest: request,
            changeSummary: proposal.summary,
            notes: { conflicts: proposal.conflicts, questions: proposal.questions },
          });
          const [view] = await toView(repo, [row]);
          if (!view) throw new Error('Rascunho ausente depois de gravar');
          return view;
        }),
      );
    },

    /** Cria o rascunho a partir de uma versão anterior (RF-089). Nada muda até publicar. */
    async restore(actorId: string, version: number): Promise<InstructionVersion> {
      const source = await repository.findByVersion(version);
      if (!source || source.status === 'draft') {
        throw new AppError('VERSION_NOT_FOUND', 404, 'Versão não encontrada.');
      }
      return guarded(() =>
        orm.transaction(async (tx) => {
          const repo = createInstructionsRepository(tx);
          const row = await writeDraft(repo, actorId, {
            content: source.content,
            changeRequest: null,
            changeSummary: `Restaurada da versão ${source.version}.`,
            notes: { conflicts: [], questions: [] },
          });
          await createAudit(tx).record({
            actorId,
            action: 'instructions.restored_to_draft',
            targetType: 'instruction_version',
            targetId: String(source.version),
            metadata: { draftVersion: row.version },
          });
          const [view] = await toView(repo, [row]);
          if (!view) throw new Error('Rascunho ausente depois de gravar');
          return view;
        }),
      );
    },

    /**
     * Publica o rascunho. É a única porta para o texto chegar ao agente e exige uma pessoa.
     * `version` é a do rascunho que ela viu: se mudou, a publicação é recusada. Duas publicações
     * simultâneas: a segunda não encontra rascunho e falha, sem criar uma segunda versão.
     */
    async publish(actorId: string, version: number): Promise<{ version: number }> {
      return guarded(() =>
        orm.transaction(async (tx) => {
          const repo = createInstructionsRepository(tx);
          const draft = await repo.findByStatus('draft', { lock: true });
          if (!draft) {
            throw new AppError('NO_DRAFT', 409, 'Não há rascunho para publicar.');
          }
          if (draft.version !== version) {
            throw new AppError(
              'DRAFT_CHANGED',
              409,
              'O rascunho mudou desde que você o abriu. Recarregue e confira antes de publicar.',
            );
          }
          const previous = await repo.findByStatus('published', { lock: true });
          if (previous) await repo.archive(previous.id);
          await repo.markPublished(draft.id, actorId, deps.now());
          await createAudit(tx).record({
            actorId,
            action: 'instructions.published',
            targetType: 'instruction_version',
            targetId: String(draft.version),
            metadata: { version: draft.version, previousVersion: previous?.version ?? null },
          });
          return { version: draft.version };
        }),
      );
    },
  };
}

export type InstructionsAdmin = ReturnType<typeof createInstructionsAdmin>;
