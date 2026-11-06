/**
 * Conversas em que a pessoa escolheu "Pular" a avaliação: o pedido não volta nelas (RF-060). A
 * escolha fica no navegador; se o armazenamento estiver bloqueado, vale só enquanto a página
 * estiver aberta.
 */
const KEY = 'chico-feedback-skipped';
const memory = new Set<string>();

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function wasSkipped(conversationId: string): boolean {
  return memory.has(conversationId) || read().includes(conversationId);
}

export function skipFeedback(conversationId: string): void {
  try {
    // Guarda só as mais recentes, para a lista não crescer sem fim.
    localStorage.setItem(KEY, JSON.stringify([...read(), conversationId].slice(-200)));
  } catch {
    // Armazenamento bloqueado: fica na memória, só até fechar a página.
    memory.add(conversationId);
  }
}
