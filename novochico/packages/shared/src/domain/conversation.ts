export const MESSAGE_ROLES = ['user', 'assistant', 'notice'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** De onde veio a resposta: modelo, cache de primeiro turno ou o próprio sistema. */
export const MESSAGE_SOURCES = ['llm', 'cache', 'system'] as const;
export type MessageSource = (typeof MESSAGE_SOURCES)[number];

/** Desfecho da conversa (ADR-018). Fica nulo enquanto ela está aberta. */
export const CONVERSATION_OUTCOMES = ['resolved', 'escalated', 'no_outcome'] as const;
export type ConversationOutcome = (typeof CONVERSATION_OUTCOMES)[number];

export const CONVERSATION_TITLE_MAX_LENGTH = 80;
export const MESSAGE_MAX_LENGTH = 20_000;
export const FEEDBACK_SUGGESTION_MAX_LENGTH = 1000;
/** Sessão de atendimento: 30 minutos sem atividade (RN-32). */
export const ATTENDANCE_SESSION_TIMEOUT_MINUTES = 30;
