// Helpers para gerar títulos curtos e descritivos das conversas do Chico.
// Em vez de salvar "Olá! Estou com um problema em..." (mensagem-padrão da categoria),
// transformamos a mensagem real do usuário em algo como "Problema no mouse",
// "Senha bloqueada", "Erro ao acessar o SEI", etc.

import { CATEGORY_MESSAGES, type CategoryKey } from "./category-messages";

// Rótulo curto inicial enquanto o usuário ainda não descreveu o problema.
export const CATEGORY_SHORT_LABELS: Record<CategoryKey, string> = {
  "Eixo de manutenção/hardware": "Computador/equipamento",
  "Eixo de redes e problemas de internet": "Internet/rede",
  "E-mail e comunicação": "E-mail institucional",
  "Segurança da informação": "Segurança/vírus",
  "Instalação de sistemas": "Instalação de sistema",
  "Eixo de dúvidas referentes ao SEI": "Dúvida no SEI",
  "Eixo da Repros": "Impressora",
  "Eixo de redefinição de senhas": "Redefinição de senha",
  "Eixo de chamados de outros tipos": "Outro tipo de chamado",
};

const CANNED_GREETINGS = new Set<string>(Object.values(CATEGORY_MESSAGES));

export function isCannedCategoryGreeting(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (CANNED_GREETINGS.has(t)) return true;
  // Fallback genérico definido em getCategoryMessage()
  return /^Olá!\s*Estou com um problema relacionado a .+\. Pode me ajudar\?$/i.test(t);
}

// Frases iniciais comuns que não agregam significado a um título.
const STRIP_PATTERNS: RegExp[] = [
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

const TRAILING_PUNCT = /[\s.,;:!?\-–—]+$/;

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function smartConversationTitle(text: string, maxLen = 50): string {
  let t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";

  // Remove prefixos repetidamente, caso o usuário tenha empilhado vários
  let changed = true;
  let guard = 0;
  while (changed && guard < 5) {
    changed = false;
    for (const re of STRIP_PATTERNS) {
      const next = t.replace(re, "");
      if (next !== t) {
        t = next.trim();
        changed = true;
      }
    }
    guard++;
  }

  // Se sobrou só pontuação/nada, mantém o texto original
  if (!t) t = text.trim();

  // Pega apenas a primeira oração para evitar títulos longos
  const firstChunk = t.split(/[.!?\n]/)[0]?.trim() || t;
  let title = firstChunk;

  if (title.length > maxLen) {
    title = title.slice(0, maxLen).replace(/\s+\S*$/, "").trim() + "…";
  }

  title = title.replace(TRAILING_PUNCT, "");
  return capitalize(title);
}

export function titleForFirstMessage(
  text: string,
  categoryName: string | null,
): string {
  if (isCannedCategoryGreeting(text) && categoryName && categoryName in CATEGORY_SHORT_LABELS) {
    return CATEGORY_SHORT_LABELS[categoryName as CategoryKey];
  }
  const smart = smartConversationTitle(text);
  return smart || text.slice(0, 50);
}

// Verifica se o título atual ainda é um placeholder genérico (rótulo de categoria
// ou greeting canned cortado) e deve ser substituído quando o usuário descrever
// o problema de verdade.
export function isPlaceholderTitle(titulo: string | null | undefined): boolean {
  if (!titulo) return true;
  const t = titulo.trim();
  if (!t) return true;
  if (t === "Nova conversa") return true;
  if (Object.values(CATEGORY_SHORT_LABELS).includes(t)) return true;
  // Títulos antigos no formato "Olá! Estou com..."
  if (/^ol[áa]!?\s/i.test(t)) return true;
  return false;
}
