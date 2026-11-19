import { z } from 'zod';
import { CONVERSATION_OUTCOMES, MESSAGE_ROLES } from '../domain/conversation';

/** Tamanho máximo do que o usuário digita em uma mensagem. */
export const USER_MESSAGE_MAX_LENGTH = 2000;

export const createConversationRequestSchema = z.object({
  categoryKey: z.string().min(1).max(50).optional(),
});
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

/** Tamanho máximo do arquivo de imagem anexado, antes de o servidor reprocessá-lo. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Formatos de imagem aceitos no anexo. O servidor confere o conteúdo, não só o tipo declarado. */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Imagens por conversa: cada uma volta à IA a cada mensagem, então o limite segura o custo. */
export const IMAGES_PER_CONVERSATION_MAX = 3;

/**
 * O cliente só envia o texto e, se houver, uma imagem em base64: papéis, histórico e permissões
 * vêm do banco (ADR-011). O texto continua obrigatório: a imagem complementa a descrição.
 */
export const sendMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(USER_MESSAGE_MAX_LENGTH),
  image: z
    .base64()
    .max(Math.ceil(IMAGE_MAX_BYTES / 3) * 4)
    .optional(),
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
  /** A mensagem tem imagem anexada, servida em `/api/conversations/:id/messages/:messageId/image`. */
  hasImage: z.boolean(),
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
  /**
   * Avaliação do atendimento: `available` depois de um chamado aberto ou de uma resolução
   * confirmada, `given` quando já foi enviada (uma por conversa), `unavailable` antes disso.
   */
  feedback: z.enum(['unavailable', 'available', 'given']),
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
  /** Último setor usado em um chamado, para pré-preencher o formulário (RF-032). */
  lastSector: z.string().nullable(),
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
