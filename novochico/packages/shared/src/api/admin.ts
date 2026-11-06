import { z } from 'zod';
import { CATEGORY_ACTIONS, INSTRUCTIONS_MAX_LENGTH, INSTRUCTION_STATUSES } from '../domain/content';
import { CONVERSATION_OUTCOMES, MESSAGE_ROLES, MESSAGE_SOURCES } from '../domain/conversation';
import { USER_ROLES } from '../domain/roles';
import { TICKET_STATUSES } from '../domain/ticket';

/* ------------------------------------------------------------------ período e indicadores */

export const ADMIN_PERIODS = ['today', '7d', '30d', '90d', 'all'] as const;
export type AdminPeriod = (typeof ADMIN_PERIODS)[number];
export const DEFAULT_ADMIN_PERIOD: AdminPeriod = '30d';

export const periodQuerySchema = z.object({
  period: z.enum(ADMIN_PERIODS).default(DEFAULT_ADMIN_PERIOD),
});

const countSchema = z.number().int().nonnegative();

/** Indicadores do período. Conversas de teste ficam de fora de tudo (RF-065). */
export const metricsResponseSchema = z.object({
  period: z.enum(ADMIN_PERIODS),
  /** Início do período em ISO 8601; nulo em "tudo". */
  from: z.iso.datetime().nullable(),
  to: z.iso.datetime(),
  indicators: z.object({
    users: countSchema,
    sessions: countSchema,
    messages: countSchema,
    tickets: countSchema,
    failures: countSchema,
    averageRating: z.number().nullable(),
    ratingCount: countSchema,
    averageConversationMinutes: z.number().nullable(),
  }),
  /** Conversas criadas no período, por desfecho (ADR-018). `open` ainda não foi encerrada. */
  outcomes: z.object({
    resolved: countSchema,
    escalated: countSchema,
    noOutcome: countSchema,
    open: countSchema,
  }),
  series: z.array(
    z.object({
      date: z.string(),
      sessions: countSchema,
      users: countSchema,
      tickets: countSchema,
    }),
  ),
  funnel: z.object({
    users: countSchema,
    sessions: countSchema,
    answered: countSchema,
    escalated: countSchema,
    tickets: countSchema,
  }),
  topCategories: z.array(z.object({ key: z.string(), count: countSchema })),
  topSectors: z.array(z.object({ sector: z.string(), count: countSchema })),
  ratingDistribution: z.array(z.object({ rating: z.number().int(), count: countSchema })),
  recentSessions: z.array(
    z.object({
      conversationId: z.uuid(),
      title: z.string().nullable(),
      categoryKey: z.string().nullable(),
      outcome: z.enum(CONVERSATION_OUTCOMES).nullable(),
      lastMessageAt: z.iso.datetime(),
    }),
  ),
  recentFailures: z.array(
    z.object({
      id: z.uuid(),
      createdAt: z.iso.datetime(),
      status: z.enum(TICKET_STATUSES),
      errorCode: z.string().nullable(),
      conversationId: z.uuid(),
    }),
  ),
});
export type MetricsResponse = z.infer<typeof metricsResponseSchema>;

/* ------------------------------------------------------------------ análise por IA */

export const insightsRequestSchema = periodQuerySchema.strict();
export type InsightsRequest = z.infer<typeof insightsRequestSchema>;

export const INSIGHT_SEVERITIES = ['baixa', 'media', 'alta'] as const;

export const insightsResponseSchema = z.object({
  summary: z.string(),
  insights: z.array(
    z.object({
      theme: z.string(),
      description: z.string(),
      estimatedConversations: countSchema,
      severity: z.enum(INSIGHT_SEVERITIES),
      examples: z.array(z.string()),
      recommendation: z.string().nullable(),
    }),
  ),
  /** Conversas que entraram na análise. */
  analyzedConversations: countSchema,
  /** A amostra foi cortada (limite de conversas ou de tamanho). */
  truncated: z.boolean(),
});
export type InsightsResponse = z.infer<typeof insightsResponseSchema>;

/* ------------------------------------------------------------------ conversas */

export const ADMIN_CONVERSATIONS_PAGE_SIZE = 25;

export const adminConversationsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const adminConversationRowSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  categoryKey: z.string().nullable(),
  outcome: z.enum(CONVERSATION_OUTCOMES).nullable(),
  sector: z.string().nullable(),
  userName: z.string(),
  userEmail: z.string(),
  isTest: z.boolean(),
  createdAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime(),
});
export type AdminConversationRow = z.infer<typeof adminConversationRowSchema>;

export const adminConversationListSchema = z.object({
  conversations: z.array(adminConversationRowSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  hasMore: z.boolean(),
});
export type AdminConversationList = z.infer<typeof adminConversationListSchema>;

export const adminConversationDetailSchema = adminConversationRowSchema.extend({
  messages: z.array(
    z.object({
      id: z.uuid(),
      role: z.enum(MESSAGE_ROLES),
      source: z.enum(MESSAGE_SOURCES).nullable(),
      content: z.string(),
      incomplete: z.boolean(),
      createdAt: z.iso.datetime(),
    }),
  ),
  tickets: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(TICKET_STATUSES),
      glpiTicketId: z.string().nullable(),
      isTest: z.boolean(),
      createdAt: z.iso.datetime(),
    }),
  ),
  feedback: z.object({ rating: z.number().int(), suggestion: z.string().nullable() }).nullable(),
});
export type AdminConversationDetail = z.infer<typeof adminConversationDetailSchema>;

/* ------------------------------------------------------------------ exportação */

export const EXPORT_TYPES = [
  'conversations',
  'messages',
  'tickets',
  'events',
  'feedbacks',
] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export const exportParamsSchema = z.object({ type: z.enum(EXPORT_TYPES) });

/* ------------------------------------------------------------------ cards (categorias) */

export const CATEGORY_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .refine((value) => !/\s/.test(value), 'sem espaços');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

/** Mensagem pronta enviada ao clicar no card: cabe na mensagem do usuário. */
const USER_CANNED_MAX = 600;

const categoryFields = {
  title: z.string().trim().min(1).max(80),
  cardDescription: optionalText(200),
  /** Nome do ícone da biblioteca da interface; a tela ignora o que não conhecer. */
  icon: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/)
    .nullable(),
  action: z.enum(CATEGORY_ACTIONS),
  externalUrl: httpUrl.nullable(),
  secondaryLinkLabel: optionalText(60),
  secondaryLinkUrl: httpUrl.nullable(),
  cannedMessage: optionalText(USER_CANNED_MAX),
  shortLabel: optionalText(40),
  sortOrder: z.number().int().min(0).max(10_000),
  active: z.boolean(),
};

/** Regras entre campos: link externo exige endereço, o link secundário vem completo ou não vem. */
function refineCategory(
  value: {
    action?: string | undefined;
    externalUrl?: string | null | undefined;
    secondaryLinkLabel?: string | null | undefined;
    secondaryLinkUrl?: string | null | undefined;
    cannedMessage?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
) {
  if (value.action === 'external_link' && !value.externalUrl) {
    ctx.addIssue({ code: 'custom', path: ['externalUrl'], message: 'Informe o endereço do link.' });
  }
  if (value.action !== undefined && value.action !== 'chat' && value.cannedMessage) {
    ctx.addIssue({
      code: 'custom',
      path: ['cannedMessage'],
      message: 'A mensagem pronta só vale para cards que abrem conversa.',
    });
  }
  if (Boolean(value.secondaryLinkLabel) !== Boolean(value.secondaryLinkUrl)) {
    ctx.addIssue({
      code: 'custom',
      path: ['secondaryLinkUrl'],
      message: 'O link secundário precisa de rótulo e endereço.',
    });
  }
}

export const createCategoryRequestSchema = z
  .object({ key: z.string().regex(CATEGORY_KEY_PATTERN), ...categoryFields })
  .strict()
  .superRefine(refineCategory);
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

/** Na edição todos os campos são enviados: o cartão é substituído por inteiro. */
export const updateCategoryRequestSchema = z
  .object(categoryFields)
  .strict()
  .superRefine(refineCategory);
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

export const adminCategorySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  title: z.string(),
  cardDescription: z.string().nullable(),
  icon: z.string().nullable(),
  action: z.enum(CATEGORY_ACTIONS),
  externalUrl: z.string().nullable(),
  secondaryLinkLabel: z.string().nullable(),
  secondaryLinkUrl: z.string().nullable(),
  cannedMessage: z.string().nullable(),
  shortLabel: z.string().nullable(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type AdminCategory = z.infer<typeof adminCategorySchema>;

export const adminCategoriesResponseSchema = z.object({ categories: z.array(adminCategorySchema) });
export type AdminCategoriesResponse = z.infer<typeof adminCategoriesResponseSchema>;

/* ------------------------------------------------------------------ instruções do agente */

export const INSTRUCTION_REQUEST_MAX_LENGTH = 2000;
export const REHEARSAL_MAX_MESSAGES = 20;

const instructionAuthorSchema = z.object({ name: z.string() }).nullable();

export const instructionVersionSchema = z.object({
  version: z.number().int(),
  status: z.enum(INSTRUCTION_STATUSES),
  content: z.string(),
  changeRequest: z.string().nullable(),
  changeSummary: z.string().nullable(),
  /** Contradições e partes recusadas apontadas pela IA. */
  conflicts: z.array(z.string()),
  /** O que a IA precisou saber e não estava no pedido. */
  questions: z.array(z.string()),
  createdBy: instructionAuthorSchema,
  createdAt: z.iso.datetime(),
  publishedBy: instructionAuthorSchema,
  publishedAt: z.iso.datetime().nullable(),
});
export type InstructionVersion = z.infer<typeof instructionVersionSchema>;

export const instructionsStateSchema = z.object({
  published: instructionVersionSchema,
  draft: instructionVersionSchema.nullable(),
  /** Versões antigas, da mais recente à mais antiga, sem o texto (a tela busca uma de cada vez). */
  history: z.array(instructionVersionSchema.omit({ content: true })),
  maxLength: z.number().int(),
  /** A IA está configurada. Sem ela, a edição manual e a publicação continuam funcionando. */
  aiAvailable: z.boolean(),
});
export type InstructionsState = z.infer<typeof instructionsStateSchema>;

export const instructionDocumentSchema = z
  .string()
  .refine((value) => value.trim().length > 0, 'O documento não pode ficar vazio.')
  .refine(
    (value) => value.length <= INSTRUCTIONS_MAX_LENGTH,
    `O documento passa de ${INSTRUCTIONS_MAX_LENGTH} caracteres.`,
  )
  .refine(
    (value) => !value.includes('<<'),
    'O documento não pode conter marcadores técnicos (<<...>>): eles são fixos do sistema.',
  );

export const proposeInstructionsRequestSchema = z
  .object({ request: z.string().trim().min(1).max(INSTRUCTION_REQUEST_MAX_LENGTH) })
  .strict();
export type ProposeInstructionsRequest = z.infer<typeof proposeInstructionsRequestSchema>;

export const saveDraftRequestSchema = z.object({ content: instructionDocumentSchema }).strict();
export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>;

/** Resposta da IA ao pedido de mudança (Anexo F), antes de gravar o rascunho. */
export const instructionProposalSchema = z.object({
  content: instructionDocumentSchema,
  summary: z.string().trim().min(1).max(600),
  conflicts: z.array(z.string().trim().min(1).max(600)).max(20),
  questions: z.array(z.string().trim().min(1).max(600)).max(20),
});
export type InstructionProposal = z.infer<typeof instructionProposalSchema>;

/** Publicar exige dizer qual versão do rascunho foi vista, para não publicar outra. */
export const publishDraftRequestSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export type PublishDraftRequest = z.infer<typeof publishDraftRequestSchema>;

export const versionParamsSchema = z.object({ version: z.coerce.number().int().positive() });

export const rehearsalRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().trim().min(1).max(2000),
        }),
      )
      .min(1)
      .max(REHEARSAL_MAX_MESSAGES),
  })
  .strict()
  .refine((value) => value.messages.at(-1)?.role === 'user', 'A última mensagem é da pessoa.');
export type RehearsalRequest = z.infer<typeof rehearsalRequestSchema>;

/** Eventos do stream do ensaio. Os marcadores viram avisos; nada é gravado. */
export type RehearsalEvent =
  | { event: 'delta'; data: { text: string } }
  | { event: 'marker'; data: { kind: 'resolution_attempt' | 'open_ticket_form' } }
  | { event: 'done'; data: Record<string, never> }
  | { event: 'error'; data: { code: string; message: string } };

export const effectivePromptSchema = z.object({
  /** Prompt que o agente recebe para um servidor comum. */
  text: z.string(),
  /** Bloco adicional que só administradores recebem. */
  adminExtra: z.string(),
  version: z.string(),
  instructionsVersion: z.number().int(),
});
export type EffectivePrompt = z.infer<typeof effectivePromptSchema>;

/* ------------------------------------------------------------------ usuários e auditoria */

export const adminUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(USER_ROLES),
  lastLoginAt: z.iso.datetime().nullable(),
  disabled: z.boolean(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUsersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  hasMore: z.boolean(),
});
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

export const changeRoleRequestSchema = z.object({ role: z.enum(USER_ROLES) }).strict();
export type ChangeRoleRequest = z.infer<typeof changeRoleRequestSchema>;

export const auditQuerySchema = z.object({
  action: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const auditEntrySchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  action: z.string(),
  actorName: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type AuditEntryView = z.infer<typeof auditEntrySchema>;

export const auditResponseSchema = z.object({
  entries: z.array(auditEntrySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  hasMore: z.boolean(),
});
export type AuditResponse = z.infer<typeof auditResponseSchema>;

export const ADMIN_PAGE_SIZE = 25;
