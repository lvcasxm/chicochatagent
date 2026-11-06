import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  adminConversationsQuerySchema,
  adminUsersQuerySchema,
  auditQuerySchema,
  changeRoleRequestSchema,
  createCategoryRequestSchema,
  exportParamsSchema,
  insightsRequestSchema,
  periodQuerySchema,
  proposeInstructionsRequestSchema,
  publishDraftRequestSchema,
  rehearsalRequestSchema,
  saveDraftRequestSchema,
  updateCategoryRequestSchema,
  versionParamsSchema,
  type AdminCategoriesResponse,
  type AdminCategory,
  type AdminConversationDetail,
  type AdminConversationList,
  type AdminUsersResponse,
  type AuditResponse,
  type EffectivePrompt,
  type InsightsResponse,
  type InstructionVersion,
  type InstructionsState,
  type MetricsResponse,
} from '@chicochat/shared';
import { requireAuth } from '../../http/auth';
import { AppError } from '../../lib/errors';
import { parseInput } from '../../lib/validation';
import type { MetricsService } from '../analytics';
import type { RehearsalService } from '../chat';
import type { CategoriesAdmin, InstructionsAdmin } from '../content';
import type { AdminService } from './service';

const idParamSchema = z.object({ id: z.uuid() });

/** Todas as rotas daqui são só do administrador, com o aceite do aviso de privacidade. */
const adminOnly = { config: { roles: ['admin'], requiresPrivacyAck: true } } as const;

function idOf(params: unknown, code: string, message: string): string {
  const parsed = idParamSchema.safeParse(params);
  if (!parsed.success) throw new AppError(code, 404, message);
  return parsed.data.id;
}

export function registerAdminRoutes(
  app: FastifyInstance,
  deps: {
    admin: AdminService;
    metrics: MetricsService;
    instructions: InstructionsAdmin;
    categories: CategoriesAdmin;
    rehearsal: RehearsalService;
    now: () => Date;
  },
): void {
  const actor = (request: Parameters<typeof requireAuth>[0]) => requireAuth(request).user.id;

  /* ------------------------------------------------------------------ indicadores */

  app.get('/api/admin/metrics', adminOnly, async (request): Promise<MetricsResponse> => {
    const { period } = parseInput(periodQuerySchema, request.query);
    return deps.metrics.overview(period);
  });

  app.post('/api/admin/insights', adminOnly, async (request): Promise<InsightsResponse> => {
    const input = parseInput(insightsRequestSchema, request.body ?? {});
    return deps.admin.analyze(actor(request), input.period);
  });

  /* ------------------------------------------------------------------ conversas e exportação */

  app.get(
    '/api/admin/conversations',
    adminOnly,
    async (request): Promise<AdminConversationList> => {
      const query = parseInput(adminConversationsQuerySchema, request.query);
      return deps.admin.listConversations(query.q || undefined, query.page);
    },
  );

  app.get(
    '/api/admin/conversations/:id',
    adminOnly,
    async (request): Promise<AdminConversationDetail> => {
      const id = idOf(request.params, 'CONVERSATION_NOT_FOUND', 'Conversa não encontrada.');
      return deps.admin.readConversation(actor(request), id);
    },
  );

  app.get('/api/admin/export/:type', adminOnly, async (request, reply) => {
    const { type } = parseInput(exportParamsSchema, request.params);
    const { period } = parseInput(periodQuerySchema, request.query);
    const lines = await deps.admin.exportCsv(actor(request), type, period);
    const stamp = deps.now().toISOString().slice(0, 10).replaceAll('-', '');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="chicochat-${type}-${stamp}.csv"`)
      .header('cache-control', 'no-store')
      .send(Readable.from(lines));
  });

  /* ------------------------------------------------------------------ cards */

  app.get('/api/admin/categories', adminOnly, async (): Promise<AdminCategoriesResponse> => {
    return { categories: await deps.categories.list() };
  });

  app.post('/api/admin/categories', adminOnly, async (request, reply): Promise<AdminCategory> => {
    const input = parseInput(createCategoryRequestSchema, request.body);
    const created = await deps.categories.create(actor(request), input);
    void reply.status(201);
    return created;
  });

  app.put('/api/admin/categories/:id', adminOnly, async (request): Promise<AdminCategory> => {
    const id = idOf(request.params, 'CATEGORY_NOT_FOUND', 'Card não encontrado.');
    const input = parseInput(updateCategoryRequestSchema, request.body);
    return deps.categories.update(actor(request), id, input);
  });

  app.delete('/api/admin/categories/:id', adminOnly, async (request, reply) => {
    const id = idOf(request.params, 'CATEGORY_NOT_FOUND', 'Card não encontrado.');
    await deps.categories.remove(actor(request), id);
    return reply.status(204).send();
  });

  /* ------------------------------------------------------------------ instruções do agente */

  app.get('/api/admin/instructions', adminOnly, (): Promise<InstructionsState> => {
    return deps.instructions.state();
  });

  app.get(
    '/api/admin/instructions/versions/:version',
    adminOnly,
    async (request): Promise<InstructionVersion> => {
      const parsed = versionParamsSchema.safeParse(request.params);
      if (!parsed.success) throw new AppError('VERSION_NOT_FOUND', 404, 'Versão não encontrada.');
      return deps.instructions.version(parsed.data.version);
    },
  );

  app.post(
    '/api/admin/instructions/propose',
    adminOnly,
    async (request): Promise<InstructionVersion> => {
      const input = parseInput(proposeInstructionsRequestSchema, request.body);
      return deps.instructions.propose(actor(request), input.request);
    },
  );

  app.put(
    '/api/admin/instructions/draft',
    adminOnly,
    async (request): Promise<InstructionVersion> => {
      const input = parseInput(saveDraftRequestSchema, request.body);
      return deps.instructions.saveDraft(actor(request), input.content);
    },
  );

  app.post('/api/admin/instructions/draft/publish', adminOnly, async (request) => {
    const input = parseInput(publishDraftRequestSchema, request.body);
    return deps.instructions.publish(actor(request), input.version);
  });

  app.post('/api/admin/instructions/:version/restore', adminOnly, async (request) => {
    const parsed = versionParamsSchema.safeParse(request.params);
    if (!parsed.success) throw new AppError('VERSION_NOT_FOUND', 404, 'Versão não encontrada.');
    return deps.instructions.restore(actor(request), parsed.data.version);
  });

  /**
   * Ensaio do rascunho em SSE (RF-088). Nada é gravado. Erros anteriores ao primeiro trecho saem
   * como HTTP normal, como no chat.
   */
  app.post('/api/admin/instructions/draft/rehearse', adminOnly, async (request, reply) => {
    const input = parseInput(rehearsalRequestSchema, request.body);
    const draft = await deps.instructions.draftContent();
    if (!draft) {
      throw new AppError('NO_DRAFT', 409, 'Crie um rascunho antes de ensaiar.');
    }

    const abort = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) abort.abort();
    });

    const rehearsal = await deps.rehearsal.start({
      instructions: draft.content,
      messages: input.messages,
      signal: abort.signal,
    });

    reply.hijack();
    const { raw } = reply;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-request-id': request.id,
    });
    try {
      for await (const { event, data } of rehearsal.events) {
        if (!raw.destroyed && !raw.writableEnded) {
          raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      }
    } finally {
      if (!raw.destroyed && !raw.writableEnded) raw.end();
    }
  });

  app.get('/api/admin/prompt', adminOnly, (): Promise<EffectivePrompt> => {
    return deps.admin.effectivePrompt();
  });

  /* ------------------------------------------------------------------ usuários e auditoria */

  app.get('/api/admin/users', adminOnly, async (request): Promise<AdminUsersResponse> => {
    const query = parseInput(adminUsersQuerySchema, request.query);
    return deps.admin.listUsers(query.q || undefined, query.page);
  });

  app.patch('/api/admin/users/:id/role', adminOnly, async (request, reply) => {
    const id = idOf(request.params, 'USER_NOT_FOUND', 'Usuário não encontrado.');
    const input = parseInput(changeRoleRequestSchema, request.body);
    await deps.admin.changeRole(actor(request), id, input.role);
    return reply.status(204).send();
  });

  app.get('/api/admin/audit', adminOnly, async (request): Promise<AuditResponse> => {
    const query = parseInput(auditQuerySchema, request.query);
    return deps.admin.listAudit(query.action || undefined, query.page);
  });
}
