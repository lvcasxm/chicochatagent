/**
 * Regras de triagem do turno (H.4 e H.5), todas puras. O que a IA diz é dado não confiável:
 * aqui o servidor decide, com padrões fixos, o que a conversa passa a significar.
 */

/** O usuário diz que o problema continua. Tem precedência sobre "resolvido" (RF-023). */
const PERSISTS =
  /(nao resolveu|não resolveu|nao funcionou|não funcionou|continua|persiste|ainda com problema|ainda com erro|segue com problema)/i;

/** O usuário confirma que resolveu. */
const RESOLVED =
  /(resolveu|resolvido|funcionou|deu certo|solucionado|ok agora|agora foi|já está funcionando)/i;

export type UserSignal = 'persists' | 'resolved' | null;

/** Lê a mensagem do usuário em busca de "persiste" ou "resolvido"; persistência vence. */
export function detectUserSignal(text: string): UserSignal {
  if (PERSISTS.test(text)) return 'persists';
  if (RESOLVED.test(text)) return 'resolved';
  return null;
}

/** Atalho do administrador para abrir o formulário em modo teste, sem chamar a IA (RF-025). */
const ADMIN_TEST_SHORTCUT = /^sou\s+admin[,.\s]+chamado\s+de\s+teste/i;

export function isAdminTestShortcut(text: string): boolean {
  return ADMIN_TEST_SHORTCUT.test(text.trim());
}

/**
 * Frases de escalonamento. Se a IA se esqueceu do marcador mas anunciou o chamado, o
 * formulário abre do mesmo jeito (fallback do legado).
 */
const ESCALATION_PHRASE =
  /(vou abrir (um )?chamado|abrir (um )?chamado para o suporte|encaminhar para o suporte t[eé]cnico|abrir uma solicita[cç][aã]o)/i;

export function hasEscalationPhrase(text: string): boolean {
  return ESCALATION_PHRASE.test(text);
}
