import { z } from 'zod';
import { CONVERSATION_OUTCOMES, MESSAGE_ROLES } from '../domain/conversation';

/** Tamanho máximo do que o usuário digita em uma mensagem. */
export const USER_MESSAGE_MAX_LENGTH = 2000;

export const createConversationRequestSchema = z.object({
  categoryKey: z.string().min(1).max(50).optional(),
});
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

/** O cliente só envia o texto: papéis, histórico e permissões vêm do banco (ADR-011). */
export const sendMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(USER_MESSAGE_MAX_LENGTH),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const conversationSummarySchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  categoryKey: z.string().nullable(),
  outcome: z.enum(CONVERSATION_OUTCOMES).nullable(),
  lastMessageAt: z.iso.datetime(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

export const chatMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(MESSAGE_ROLES),
  content: z.string(),
  /** Resposta que parou no meio (a conexão caiu ou a IA falhou). */
  incomplete: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Estado da triagem, que a interface usa para mostrar o formulário de chamado. */
export const triageStateSchema = z.object({
  resolutionAttempts: z.number().int().nonnegative(),
  issuePersists: z.boolean().nullable(),
  /** O servidor liberou o formulário de chamado nesta conversa. */
  ticketFormUnlocked: z.boolean(),
  /** O formulário foi liberado pelo atalho de teste do administrador. */
  testMode: z.boolean(),
  resolved: z.boolean(),
});
export type TriageState = z.infer<typeof triageStateSchema>;

export const conversationDetailSchema = conversationSummarySchema.extend({
  messages: z.array(chatMessageSchema),
  triage: triageStateSchema,
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const homeCardSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  action: z.enum(['chat', 'external_link']),
  externalUrl: z.string().nullable(),
  secondaryLink: z.object({ label: z.string(), url: z.string() }).nullable(),
  cannedMessage: z.string().nullable(),
});
export type HomeCardView = z.infer<typeof homeCardSchema>;

/** O que a tela inicial precisa saber, em uma chamada só. */
export const bootstrapResponseSchema = z.object({
  cards: z.array(homeCardSchema),
  /** Portal do GLPI para quem prefere abrir o chamado direto; nulo se não configurado. */
  glpiPortalUrl: z.string().nullable(),
  /** O administrador pode usar o atalho de chamado de teste. */
  canUseTestMode: z.boolean(),
});
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;

/** Eventos do stream de `POST /api/conversations/:id/messages` (SONNET_CONTEXT, seção E). */
export const chatEventSchemas = {
  meta: z.object({ messageId: z.uuid(), mode: z.enum(['normal', 'cache']) }),
  delta: z.object({ text: z.string() }),
  triage: z.object({
    resolutionAttempts: z.number().int().nonnegative(),
    issuePersists: z.boolean().nullable(),
  }),
  ticket_form: z.object({ testMode: z.boolean() }),
  feedback_prompt: z.object({}),
  done: z.object({ messageId: z.uuid(), title: z.string().nullable() }),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryAfterMs: z.number().int().positive().optional(),
  }),
} as const;

export type ChatEventName = keyof typeof chatEventSchemas;
export type ChatEvent = {
  [K in ChatEventName]: { event: K; data: z.infer<(typeof chatEventSchemas)[K]> };
}[ChatEventName];
