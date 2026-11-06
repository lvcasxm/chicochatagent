import { createHash } from 'node:crypto';
import { ADMIN_BYPASS_BLOCK, FIXED_RULES, PRIORITY_CLAUSE } from './fixed-rules';

export interface SystemPrompt {
  /** Texto enviado ao modelo como instrução de sistema. */
  text: string;
  /** Hash das regras fixas e das instruções publicadas; identifica qual prompt gerou a resposta. */
  version: string;
}

/**
 * Hash do que define o comportamento do agente: regras fixas mais instruções editáveis. O bloco
 * de bypass fica de fora, pois só muda para quem é administrador e não deve invalidar o cache.
 */
export function promptVersion(instructions: string): string {
  return createHash('sha256').update(FIXED_RULES).update('\n').update(instructions).digest('hex');
}

/**
 * Monta o prompt do sistema (H.3): regras fixas, cláusula de prioridade, instruções publicadas
 * e, só para administrador validado pelo servidor, o bloco de bypass. A identidade do usuário
 * nunca entra, e as mensagens dele vão em papel `user`, jamais concatenadas aqui.
 */
export function buildSystemPrompt(input: { instructions: string; isAdmin: boolean }): SystemPrompt {
  const parts = [
    FIXED_RULES,
    PRIORITY_CLAUSE,
    `## Instruções de atendimento\n\n${input.instructions.trim()}`,
  ];
  if (input.isAdmin) parts.push(ADMIN_BYPASS_BLOCK);

  return { text: parts.join('\n\n'), version: promptVersion(input.instructions) };
}
