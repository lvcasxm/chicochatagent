import { CONVERSATION_TITLE_MAX_LENGTH } from '@chicochat/shared';

/**
 * Títulos das conversas (RF-019), a partir da mensagem real do usuário, no lugar de "Olá! Estou
 * com um problema...". Porte de `conversation-title.ts` do sistema anterior.
 */

/** Frases de abertura que não dizem nada sobre o problema. */
const STRIP_PATTERNS: readonly RegExp[] = [
  /^(ol[áa]|oi|e\s*a[ií]|hello|hi|hey)[!,.\s-]+/i,
  /^(bom\s*dia|boa\s*tarde|boa\s*noite)[!,.\s-]+/i,
  /^(por\s*favor|pfvr|pfv)[,.\s-]+/i,
  /^(eu\s+)?(estou|to|tô)\s+com\s+(um\s+|uma\s+|uns\s+|umas\s+)?(probleminha|problema|dificuldade|dúvida|duvida|erro)s?\s+(em|no|na|nos|nas|com|de|do|da|dos|das|para|pra)\s+/i,
  /^(eu\s+)?(estou|to|tô)\s+com\s+(um\s+|uma\s+)?(probleminha|problema|dificuldade|dúvida|duvida|erro)s?[,.\s-]+/i,
  /^(eu\s+)?preciso\s+de\s+ajuda\s+(com|para|pra)\s+/i,
  /^(eu\s+)?preciso\s+de\s+ajuda[,.\s-]+/i,
  /^(eu\s+)?gostaria\s+de\s+(saber|pedir|solicitar)\s+/i,
  /^(você\s+)?(pode|poderia)\s+me\s+ajudar\s+(com|a)\s+/i,
  /^como\s+(eu\s+)?(faço|posso|consigo)\s+(para|pra)\s+/i,
  /^tenho\s+(uma\s+|um\s+)?(dúvida|duvida|demanda|problema)\s+(sobre|com|em|no|na|de)\s+/i,
  /^minha\s+/i,
  /^meu\s+/i,
];

const TRAILING_PUNCTUATION = /[\s.,;:!?\-–—]+$/;
const GENERIC_CATEGORY_GREETING =
  /^Olá!\s*Estou com um problema relacionado a .+\. Pode me ajudar\?$/i;

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Título curto e descritivo: tira a abertura, fica com a primeira frase e limita o tamanho. */
export function smartConversationTitle(text: string, maxLength = 50): string {
  const original = text.trim().replace(/\s+/g, ' ');
  let title = original;
  if (!title) return '';

  // Aceita prefixos empilhados ("Oi, bom dia, estou com um problema no..."), com limite de voltas.
  for (let round = 0; round < 5; round++) {
    const before = title;
    for (const pattern of STRIP_PATTERNS) title = title.replace(pattern, '').trim();
    if (title === before) break;
  }
  if (!title) title = original;

  title = title.split(/[.!?\n]/)[0]?.trim() || title;
  if (title.length > maxLength) {
    title = `${title
      .slice(0, maxLength)
      .replace(/\s+\S*$/, '')
      .trim()}…`;
  }
  title = title.replace(TRAILING_PUNCTUATION, '');
  return capitalize(title).slice(0, CONVERSATION_TITLE_MAX_LENGTH);
}

/** É a mensagem pronta de um card (ou o formato genérico dela), não algo que a pessoa escreveu? */
export function isCannedGreeting(text: string, cannedMessages: readonly string[]): boolean {
  const trimmed = text.trim();
  return cannedMessages.includes(trimmed) || GENERIC_CATEGORY_GREETING.test(trimmed);
}

/** O título ainda é um provisório (rótulo do card ou "Olá! ...") que deve ceder ao título real? */
export function isPlaceholderTitle(title: string | null, shortLabels: readonly string[]): boolean {
  const trimmed = title?.trim();
  if (!trimmed) return true;
  return shortLabels.includes(trimmed) || /^ol[áa]!?\s/i.test(trimmed);
}
