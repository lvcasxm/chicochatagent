import {
  bootstrapResponseSchema,
  conversationDetailSchema,
  conversationListResponseSchema,
  conversationSummarySchema,
  type BootstrapResponse,
  type ChatEvent,
  type ConversationDetail,
  type ConversationSummary,
} from '@chicochat/shared';
import { ApiError, call } from './api';
import { readChatEvents } from './sse';

export async function fetchBootstrap(): Promise<BootstrapResponse> {
  const response = await call('/api/bootstrap');
  if (!response.ok) throw new ApiError(response.status);
  return bootstrapResponseSchema.parse(await response.json());
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const response = await call('/api/conversations');
  if (!response.ok) throw new ApiError(response.status);
  return conversationListResponseSchema.parse(await response.json()).conversations;
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  const response = await call(`/api/conversations/${encodeURIComponent(id)}`);
  if (!response.ok) throw new ApiError(response.status);
  return conversationDetailSchema.parse(await response.json());
}

export async function createConversation(categoryKey?: string): Promise<ConversationSummary> {
  const response = await call('/api/conversations', {
    method: 'POST',
    body: JSON.stringify(categoryKey ? { categoryKey } : {}),
  });
  if (!response.ok) throw new ApiError(response.status);
  return conversationSummarySchema.parse(await response.json());
}

export async function deleteConversation(id: string): Promise<void> {
  const response = await call(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new ApiError(response.status);
}

/** Falha antes do primeiro trecho: o servidor respondeu com um erro HTTP normal. */
export class SendError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** Segundos sugeridos pelo servidor para tentar de novo. */
  readonly retryAfter: number | null;

  constructor(status: number, code: string | null, retryAfter: number | null) {
    super(`Falha ao enviar: ${status}`);
    this.name = 'SendError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/**
 * Envia a mensagem e entrega os eventos da resposta, um a um. Erros anteriores ao stream viram
 * `SendError`; os posteriores chegam como evento `error`.
 */
export async function* sendMessage(
  conversationId: string,
  content: string,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent, void, undefined> {
  const response = await call(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
    headers: { accept: 'text/event-stream' },
    signal,
  });

  if (!response.ok || !response.body) {
    let code: string | null = null;
    try {
      code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? null;
    } catch {
      // Corpo que não é JSON: só o status importa.
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new SendError(
      response.status,
      code,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }

  yield* readChatEvents(response.body);
}

/** Avaliação do atendimento. 409 "já enviada" não é erro para a pessoa: o objetivo foi atingido. */
export async function submitFeedback(
  conversationId: string,
  rating: number,
  suggestion: string,
): Promise<void> {
  const response = await call(`/api/conversations/${encodeURIComponent(conversationId)}/feedback`, {
    method: 'POST',
    body: JSON.stringify({
      rating,
      ...(suggestion.trim() ? { suggestion: suggestion.trim() } : {}),
    }),
  });
  if (response.status === 409) {
    const code = ((await response.json().catch(() => null)) as { error?: { code?: string } } | null)
      ?.error?.code;
    if (code === 'FEEDBACK_ALREADY_SENT') return;
  }
  if (!response.ok) throw new ApiError(response.status);
}
