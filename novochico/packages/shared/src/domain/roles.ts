/** Papéis de usuário (SONNET_CONTEXT, seção F.4). `tecnico` lê transcrições (ADR-016). */
export const USER_ROLES = ['user', 'tecnico', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
