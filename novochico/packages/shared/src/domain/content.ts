/** O que acontece ao clicar em um card da tela inicial (Anexo C). */
export const CATEGORY_ACTIONS = ['chat', 'external_link', 'hidden'] as const;
export type CategoryAction = (typeof CATEGORY_ACTIONS)[number];

/** Ciclo de vida de uma versão das instruções do agente (ADR-030). */
export const INSTRUCTION_STATUSES = ['draft', 'published', 'archived'] as const;
export type InstructionStatus = (typeof INSTRUCTION_STATUSES)[number];

export const INSTRUCTIONS_MAX_LENGTH = 20_000;
